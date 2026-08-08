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

One function, three input kinds:

```ts
import { extract } from '@jonaskahn/specmine';

const options = { provider: 'openai', model: 'gpt-5.6-luna' };

// 1. Raw text
const spec = await extract('The Acme Kettle holds 1.5L, £49.', options);

// 2. File / Blob (PDF or text)
const spec = await extract(fileOrBlob, options);

// 3. File path or URL
const spec = await extract(new URL('file:///specs/kettle.pdf'), options);
```

### Zero config via env

Set `SPECMINE_LLM_API_KEY` (+ optionally `SPECMINE_LLM_API_HOST` and
`SPECMINE_LLM_MODEL`) and call `extract()` with no options at all:

```ts
const spec = await extract('The Acme Kettle holds 1.5L, £49.');
```

For other OpenAI-compatible hosts (LiteLLM, Azure, Ollama, OpenRouter, Groq),
build the provider explicitly:

```ts
import { createExtractor, createOpenAiProvider } from '@jonaskahn/specmine';

const llm = createOpenAiProvider({
  apiHost: 'https://litellm.example.com/v1',
  apiKey: process.env.LITELLM_API_KEY,
  model: 'azure/gpt-5.6-luna',
});

const spec = await createExtractor({ llm }).extract('The Acme Kettle holds 1.5L, £49.');
```

The Anthropic provider works the same way: `createAnthropicProvider()`, or
`provider: 'anthropic'` with `ANTHROPIC_API_KEY`.

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

### PDFs

Text-based PDFs are extracted locally with
[@firecrawl/pdf-inspector](https://github.com/firecrawl/pdf-inspector) before
the LLM sees anything. All-image (scanned) PDFs return an empty `{}` — no OCR
or vision in v1.

### Composability

`extract()` is the zero-config convenience entry. The pipeline
`InputReader → LlmProvider → SpecValidator` is fully swappable — pass custom
implementations to `createExtractor({ reader, llm, validator })`. Wrap any
provider with `createResilientProvider()` for retries and a circuit breaker.
Adding a provider = one file implementing `LlmProvider` + a factory.

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
