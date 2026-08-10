# specmine

Extract product specifications (JSON) from text or PDF files using an LLM
(OpenAI-compatible or Anthropic-compatible REST services). A library — no
server, no CLI. Import it and call a function.

## Install

```sh
npm install @jonaskahn/specmine
```

Requires Node.js 18+ (ESM).

## Usage

The entry point is `extract()`, which accepts three input kinds:

```ts
import { extract } from '@jonaskahn/specmine';

const options = { provider: 'openai', model: 'gpt-5.6-luna' };

// 1. Raw text
const spec = await extract('The Acme Kettle holds 1.5L, £49.', options);

// 2. File / Blob (PDF or text) — a Blob, a File from the browser, or a
//    Buffer wrapped in a Blob in Node
const spec = await extract(fileOrBlob, options);

// 3. URL — https/http URLs are fetched, file:// URLs are read from disk
const spec = await extract(new URL('https://example.com/specs/kettle.pdf'), options);
```

### Sending a file from Node

`extract()` takes a `Blob`. Wrap a file from disk in one:

```ts
import { readFile } from 'node:fs/promises';
import { extract } from '@jonaskahn/specmine';

const data = new Blob([await readFile('./kettle.pdf')], { type: 'application/pdf' });
const spec = await extract(data);
```

The `type` is optional — `extract()` sniffs PDF magic bytes (`%PDF`) when the
content type is missing, so plain text blobs work too.

### Sending a URL

`https`/`http` URLs are fetched automatically; `file://` URLs are read from
disk:

```ts
// Remote PDF
const spec = await extract(new URL('https://example.com/specs/kettle.pdf'));

// Local file
const spec = await extract(new URL('file:///specs/kettle.pdf'));

// Raw text via a URL is fine too
const spec = await extract(new URL('https://example.com/kettle.txt'));
```

HTML content (a string, blob, or fetched page) is detected and converted to
Markdown before extraction, so table- and tag-heavy product pages still
produce clean specs:

### Zero config via env

Set `SPECMINE_LLM_API_KEY` (+ optionally `SPECMINE_LLM_API_HOST` and
`SPECMINE_LLM_MODEL`) and call `extract()` with no options at all:

```ts
const spec = await extract('The Acme Kettle holds 1.5L, £49.');
```

### Options

| Option      | Type          | Default                     | Meaning                                         |
| ----------- | ------------- | --------------------------- | ----------------------------------------------- |
| `provider`  | `string`      | `"openai"`                  | `"openai"`, `"anthropic"`, or a registered name |
| `model`     | `string`      | per-provider default        | Model identifier                                |
| `apiKey`    | `string`      | provider env var            | Provider key                                    |
| `lang`      | `string`      | detected from input, `"en"` | Language for extracted keys and values          |
| `flattened` | `boolean`     | `false`                     | `true` → reduce output to leaf pairs            |
| `timeoutMs` | `number`      | —                           | Abort the LLM call after N milliseconds         |
| `signal`    | `AbortSignal` | —                           | External abort signal                           |

### Output

Values are strings. **Flat** for text input (and PDFs with `flattened: true`),
**nested** (category → key → value) for PDFs by default:

```json
{ "Weight": "1.5 kg", "Dimensions": "239 x 44 x 190 mm" }
```

```json
{ "Hardware": { "Power Supply": "12 V DC, external power supply" } }
```

### Errors

Every failure rejects with an `ExtractionError` carrying a `code`:

`EMPTY_INPUT` · `UNSUPPORTED_INPUT` · `LLM_ERROR` · `INVALID_OUTPUT` · `TIMEOUT`

```ts
import { extract, isExtractionError } from '@jonaskahn/specmine';

try {
  await extract(input);
} catch (error) {
  if (isExtractionError(error)) {
    console.error(error.code, error.message); // e.g. "EMPTY_INPUT Input is empty"
  }
}
```

## API reference

### `extract(input, options?): Promise<SpecsResult>`

Zero-config convenience entry point. Input is `string | Blob | URL`; options
are the table above. Picks the provider via `options.provider` (default
`"openai"`), reads the input, calls the LLM, and validates the JSON output.

### `createExtractor(dependencies?): Extractor`

Builds an `Extractor` with swappable pipeline pieces. The full pipeline is
`InputReader → LlmProvider → SpecValidator`:

```ts
import {
  createExtractor,
  createOpenAiProvider,
  DefaultReader,
  NapiPdfInspector,
} from '@jonaskahn/specmine';

const extractor = createExtractor({
  reader: new DefaultReader(new NapiPdfInspector()),
  llm: createOpenAiProvider({ apiKey: process.env.OPENAI_API_KEY }),
  validator: new JsonSpecValidator(),
});

const spec = await extractor.extract(new URL('https://example.com/kettle.pdf'));
```

`ExtractorDependencies` (all optional — omitted pieces use the defaults):
`reader`, `llm`, `validator`.

### Reader: `DefaultReader`, `InputReader`

`InputReader` turns an `ExtractInput` into text:

```ts
interface InputReader {
  read(input: ExtractInput): Promise<ReadResult>;
}

interface ReadResult {
  text: string; // markdown for PDFs
  imageOnly: boolean; // true for scanned PDFs (no text layer)
}
```

`DefaultReader` handles all three input kinds: strings pass through, blobs are
sniffed for `%PDF` magic bytes, `https`/`http`/`file` URLs are fetched or read.
PDF blobs are routed to the configured `PdfInspector`; without one, PDF input
throws `UNSUPPORTED_INPUT`.

```ts
import { DefaultReader, NapiPdfInspector } from '@jonaskahn/specmine';

const reader = new DefaultReader(new NapiPdfInspector());
const { text, imageOnly } = await reader.read(new URL('https://example.com/kettle.pdf'));
```

### PDF inspection: `PdfInspector`, `NapiPdfInspector`

`PdfInspector` is the interface — `classify(data)` returns the PDF type and
`process(data)` returns markdown:

```ts
interface PdfClassification {
  pdfType: 'TextBased' | 'Scanned' | 'ImageBased' | 'Mixed';
  confidence: number;
  pagesNeedingOcr: number[];
}

interface PdfExtraction {
  pdfType: PdfType;
  markdown: string | null; // null when the PDF has no text layer
}
```

`NapiPdfInspector` is the built-in implementation, backed by
[@firecrawl/pdf-inspector](https://github.com/firecrawl/pdf-inspector).
Text-based PDFs are converted to markdown locally before the LLM sees anything;
all-image (scanned) PDFs return an empty `{}` — no OCR or vision in v1.
Implement `PdfInspector` yourself to plug in a different engine.

### Providers

Both providers implement `LlmProvider`:

```ts
interface LlmProvider {
  complete(request: LlmRequest, options?: CallOptions): Promise<LlmResponse>;
}
```

Settings resolve as: explicit options → `SPECMINE_LLM_*` env vars → native
env vars (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) → built-in defaults.

#### `createOpenAiProvider(options?)` / `OpenAiClient`

OpenAI-compatible REST API (`POST {host}/chat/completions`). Options
(`OpenAiCompatibleOptions`): `apiHost`, `apiKey`, `model`. Defaults:
`https://api.openai.com/v1`, model `gpt-5.6-luna`. Works with LiteLLM, Azure,
Ollama, OpenRouter, Groq and other compatible hosts:

```ts
import { createOpenAiProvider } from '@jonaskahn/specmine';

const llm = createOpenAiProvider({
  apiHost: 'https://litellm.example.com/v1',
  apiKey: process.env.LITELLM_API_KEY,
  model: 'azure/gpt-5.6-luna',
});
```

#### `createAnthropicProvider(options?)` / `AnthropicClient`

Anthropic Messages API (`POST {host}/v1/messages`). Options
(`AnthropicOptions`): `apiHost`, `apiKey`, `model`, `anthropicVersion`.
Defaults: `https://api.anthropic.com`, model `haiku-4.5`, version
`2023-06-01`. Or use `provider: 'anthropic'` with `extract()`.

#### `createResilientProvider(provider, options?)` / `ResilientProvider`

Wraps any provider with retries and a circuit breaker. Retries only
`LLM_ERROR` and `TIMEOUT` codes; the circuit opens after consecutive
failures, probes once after the cooldown, and closes again on success:

```ts
import {
  createExtractor,
  createResilientProvider,
  createOpenAiProvider,
} from '@jonaskahn/specmine';

const llm = createResilientProvider(createOpenAiProvider(), {
  retry: { maxRetries: 2, backoffMs: 200 },
  circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
});

const extractor = createExtractor({ llm });
```

Defaults: `maxRetries: 2`, `backoffMs: 200`, `failureThreshold: 5`,
`cooldownMs: 30_000` — each overridable via `SPECMINE_LLM_MAX_RETRIES`,
`SPECMINE_LLM_BACKOFF_MS`, `SPECMINE_LLM_FAILURE_THRESHOLD`,
`SPECMINE_LLM_COOLDOWN_MS`.

### Validator: `JsonSpecValidator`, `SpecValidator`

Checks the LLM's raw response: strips markdown fences, parses JSON, and
verifies every leaf value is a string. Rejects non-object responses and
arrays. `SpecValidator.validate(raw)` returns `{ spec?, errors }` — implement
it to replace the JSON contract (e.g. with a schema validator).

### Types

- `ExtractInput = string | Blob | URL`
- `ExtractOptions` — `provider`, `model`, `apiKey`, `lang`, `flattened`,
  `timeoutMs`, `signal`
- `CallOptions` — `timeoutMs`, `signal`
- `SpecsResult = ProductSpec | NestedSpecs` — `ProductSpec` is a flat
  `{ [key]: string }`, `NestedSpecs` allows nested objects
- `ExtractionError` / `ExtractionErrorCode` — see [Errors](#errors)
- `LlmRequest` / `LlmMessage` / `LlmResponse` / `LlmProviderOptions` /
  `LlmContentPart` / `LlmTextPart` / `LlmPdfPart` / `LlmUsage` — provider
  plumbing types for custom providers

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write .
npm test            # node:test + tsx
npm run build       # emit dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
