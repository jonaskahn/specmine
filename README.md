# specmine

Mine product specifications (JSON) from text content or PDF files using an
LLM (OpenAI-compatible or Anthropic-compatible REST services).

A library — no HTTP server, no routes, no auth, no multipart parsing. Import
it and call a function.

**Status: implemented.** All contracts in `src/` have working implementations
(`DefaultExtractor`, `DefaultReader`, `NapiPdfInspector`, `OpenAiClient`,
`AnthropicClient`, `ResilientProvider`, `JsonSpecValidator`). The LLM HTTP
clients are built on native `fetch` — no SDKs, no HTTP libraries.

## Install

```sh
npm install @jonaskahn/specmine
```

Requires Node.js 18+ (ESM).

## Usage

One function, three input kinds:

```ts
import { extract } from '@jonaskahn/specmine';
import type { ExtractOptions, SpecsResult } from '@jonaskahn/specmine';

const options: ExtractOptions = { provider: 'openai', model: 'gpt-5.6-luna' };

// 1. Raw text
const fromText: SpecsResult = await extract('The Acme Kettle holds 1.5L, £49.', options);

// 2. File / Blob (PDF or text). `File` works on Node 20+ and in browsers;
//    on Node 18 pass a `Blob` — one signature covers both.
const fromFile: SpecsResult = await extract(fileOrBlob, options);

// 3. File path or URL
const fromPath: SpecsResult = await extract(new URL('file:///specs/kettle.pdf'), options);
```

**LiteLLM proxy example:** LiteLLM speaks the OpenAI wire protocol, so point
the OpenAI factory at the proxy host — key and model come from `LlmProviderOptions`:

```ts
import { createExtractor, createOpenAiProvider } from '@jonaskahn/specmine';

const llm = createOpenAiProvider({
  apiHost: 'https://litellm.example.com/v1',
  apiKey: process.env.LITELLM_API_KEY,
  model: 'azure/gpt-5.6-luna',
});

const extractor = createExtractor({ llm });
const spec = await extractor.extract('The Acme Kettle holds 1.5L, £49.');
```

If `SPECMINE_LLM_API_HOST`, `SPECMINE_LLM_API_KEY`, and `SPECMINE_LLM_MODEL`
are all set (see [Providers](#providers)), the same call needs no options at
all — `createOpenAiProvider()` resolves host, key, and model from env, and
`extract()` uses it by default:

```ts
import { extract } from '@jonaskahn/specmine';

const spec = await extract('The Acme Kettle holds 1.5L, £49.');
```

Note `ExtractOptions` has no `apiHost` field — only `provider`, `model`,
`apiKey`, `lang`, and `flattened` are per-call overrides. A custom `apiHost`
must come from `SPECMINE_LLM_API_HOST` or from building the provider
explicitly, as in the LiteLLM example above.

### Options

| Option      | Type                 | Default                              | Meaning                                                        |
| ----------- | -------------------- | ------------------------------------ | -------------------------------------------------------------- |
| `provider`  | `string`             | —                                    | LLM provider (`"openai"`, `"anthropic"`, or a registered name) |
| `model`     | `string`             | `gpt-5.6-luna` / `haiku-4.5`         | Model identifier, e.g. `"gpt-5.6-luna"`                        |
| `apiKey`    | `string`             | provider env var                     | Provider key                                                   |
| `lang`      | `string` (ISO 639-1) | detected from input, `"en"` fallback | Language for the extracted keys and values                     |
| `flattened` | `boolean`            | `false`                              | `true` → reduce output to innermost leaf pairs                 |
| `timeoutMs` | `number`             | —                                    | Abort the LLM call after this many milliseconds                |
| `signal`    | `AbortSignal`        | —                                    | External abort signal                                          |

### Output

Values are strings. Two shapes, mirroring the reference service:

**Flat** — text input, and PDF input with `flattened: true`:

```json
{
  "Weight": "1.5 kg",
  "Dimensions": "239 x 44 x 190 mm",
  "Processor": "Intel Core i5",
  "RAM": "8 GB"
}
```

**Nested** — PDF input by default (`flattened` unset), category → key → value:

```json
{
  "Hardware": {
    "Power Supply": "12 V DC, external power supply",
    "Operating Environment": {
      "Temperature Range": "0 - 40 °C",
      "Humidity": "0 - 95%, non-condensing"
    }
  }
}
```

### Errors

Every failure rejects with an `ExtractionError` carrying a `code`:

`EMPTY_INPUT` · `UNSUPPORTED_INPUT` · `LLM_ERROR` · `INVALID_OUTPUT` · `TIMEOUT`

## Composability (dependency injection)

`extract()` is the zero-config convenience entry. For full control, compose
the pipeline yourself — the implementation of each contract is swappable:

```ts
import { createExtractor, createOpenAiProvider } from '@jonaskahn/specmine';
import type { InputReader, LlmProvider, SpecValidator } from '@jonaskahn/specmine';

const reader: InputReader = { read: (input) => Promise.resolve(String(input)) };
const llm: LlmProvider = createOpenAiProvider({ apiKey: process.env.OPENAI_API_KEY });
const validator: SpecValidator = { validate: (raw) => ({ spec: JSON.parse(raw), errors: [] }) };

const extractor = createExtractor({ reader, llm, validator });
const spec = await extractor.extract('The Acme Kettle holds 1.5L, £49.', { lang: 'de' });
```

### Pipeline

```
ExtractInput (string | Blob | URL)
  → InputReader.read → ReadResult { text, imageOnly }
  → LlmProvider.complete → LLM JSON
  → SpecValidator.validate → SpecsResult (flat or nested)
```

### PDF handling (local-first)

Before any PDF bytes reach the LLM, a `PdfInspector` classifies and extracts
locally with [@firecrawl/pdf-inspector](https://github.com/firecrawl/pdf-inspector)
(no OCR, no LLM round trip):

```
PDF bytes
  → PdfInspector.classify (~20ms) → TextBased / Scanned / ImageBased / Mixed
  → TextBased or Mixed with text
      → PdfInspector.process → Markdown → LLM (text path) — no OCR, no vision
  → All-image (markdown is null — Scanned / ImageBased)
      → imageOnly: true → extractor returns an empty spec {} without calling the LLM
```

No OCR and no vision path in v1: all-image PDFs yield an empty `ProductSpec`.

```ts
import type { PdfInspector } from '@jonaskahn/specmine';
import { processPdf, classifyPdf } from '@firecrawl/pdf-inspector';

const pdf: PdfInspector = {
  classify: (data) => classifyPdf(data),
  process: (data) => processPdf(data),
};
```

`InputReader.read` returns `ReadResult`; `imageOnly: true` tells the
extractor to skip the LLM and return an empty spec.

### Providers

| Factory                            | Talks to                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `createOpenAiProvider(options)`    | OpenAI and any OpenAI-compatible REST service — **LiteLLM proxy, Azure, Ollama, OpenRouter, Groq**, … — via `apiHost` |
| `createAnthropicProvider(options)` | Anthropic and Anthropic-compatible REST services via `apiHost`                                                        |

Both clients speak the wire protocols directly over `fetch` — no SDKs.
`extract()` picks the provider via `options.provider` (`"openai"` default,
`"anthropic"`).

**Quickstart:**

```ts
// SPECMINE_LLM_API_KEY=sk-…
// SPECMINE_LLM_API_HOST=https://litellm.example.com/v1 (optional, defaults per provider)
// SPECMINE_LLM_MODEL=azure/gpt-5.6-luna (optional, defaults per provider)
const spec = await extract('The device weighs 1.5 kg and has 8 GB RAM.', {
  lang: 'en',
});
```

Each provider resolves its settings in this order:

1. explicit `options` (`apiHost`, `apiKey`, `model`)
2. env vars:
   - `apiKey` — `SPECMINE_LLM_API_KEY`, then native key fallback
     (`OPENAI_API_KEY` for the OpenAI factory, `ANTHROPIC_API_KEY` for the
     Anthropic factory)
   - `apiHost` — `SPECMINE_LLM_API_HOST`
   - `model` — `SPECMINE_LLM_MODEL`
3. built-in defaults — `DEFAULT_OPENAI_API_HOST` /
   `DEFAULT_OPENAI_MODEL`, `DEFAULT_ANTHROPIC_API_HOST` /
   `DEFAULT_ANTHROPIC_MODEL` (see below)

```ts
createOpenAiProvider({ apiKey: 'sk-…' }); // key from the option, host/model default
```

| Constant                     | Default                     |
| ---------------------------- | --------------------------- |
| `DEFAULT_OPENAI_API_HOST`    | `https://api.openai.com/v1` |
| `DEFAULT_OPENAI_MODEL`       | `gpt-5.6-lune`              |
| `DEFAULT_ANTHROPIC_API_HOST` | `https://api.anthropic.com` |
| `DEFAULT_ANTHROPIC_MODEL`    | `haiku-4.5`                 |

### Retry and circuit breaker

Wrap any provider to retry failed calls and stop retrying when the host
misbehaves:

```ts
import { createResilientProvider } from '@jonaskahn/specmine';

const llm = createResilientProvider(openAiProvider, {
  retry: { maxRetries: 3, backoffMs: 200 },
  circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
});
```

Behavior:

- `retry.maxRetries` (default `2`) — attempts after the first try; failures
  wait `retry.backoffMs` (default `200`) between attempts.
- `circuitBreaker.failureThreshold` (default `5`) — consecutive failures
  open the circuit; while open, calls fail immediately with
  `LLM_ERROR` (no retry loop, no hammering the host).
- `circuitBreaker.cooldownMs` (default `30_000`) — after the cooldown the
  circuit half-opens and lets one probe call through; success closes it,
  failure reopens it.

Settings resolve in this order: explicit `options` → `SPECMINE_LLM_*` env →
built-in defaults:

| Env var                          | Maps to                           | Default  |
| -------------------------------- | --------------------------------- | -------- |
| `SPECMINE_LLM_MAX_RETRIES`       | `retry.maxRetries`                | `2`      |
| `SPECMINE_LLM_BACKOFF_MS`        | `retry.backoffMs`                 | `200`    |
| `SPECMINE_LLM_FAILURE_THRESHOLD` | `circuitBreaker.failureThreshold` | `5`      |
| `SPECMINE_LLM_COOLDOWN_MS`       | `circuitBreaker.cooldownMs`       | `30_000` |

The wrapper owns all state — the underlying provider is untouched.

Adding a provider = one new file implementing `LlmProvider` + a factory.
Nothing else changes (Open/Closed).

## Design principles

- **KISS** — one function, minimal options, values are plain strings.
- **DRY / single source of truth** — the input union (`ExtractInput`) and
  the output types (`ProductSpec`, `NestedSpecs`) are defined exactly once;
  every entry point funnels through the single `Extractor` contract.
- **Clean code** — style follows the
  [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
  and [clean-code-typescript](https://github.com/labs42io/clean-code-typescript);
  no comments inside code, names carry the meaning. Details in
  [CONTRIBUTING.md](CONTRIBUTING.md).

## Project structure

```
src/
├── index.ts              public entry (named exports only)
├── extractor.ts          Extractor contract, dependencies, extract() overloads
├── types.ts              ProductSpec, NestedSpecs, ExtractInput, options, errors
├── input/
│   ├── reader.ts         InputReader contract (input → ReadResult)
│   └── pdf.ts            PdfInspector contract (classify + local Markdown)
├── llm/
│   ├── provider.ts       LlmProvider contract (messages, content parts, usage)
│   ├── openai.ts         OpenAI-compatible factory
│   └── anthropic.ts      Anthropic factory
└── spec/
    └── validator.ts      SpecValidator contract (enforces flat/nested shape)
```

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write .
npm test            # node:test + tsx (45 tests)
npm run build       # emit dist/
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
