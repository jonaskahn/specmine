```
███████╗ ██████╗  ███████╗  ██████╗ ███╗   ███╗ ██╗ ███╗   ██╗ ███████╗
██╔════╝ ██╔══██╗ ██╔════╝ ██╔════╝ ████╗ ████║ ██║ ████╗  ██║ ██╔════╝
███████╗ ██████╔╝ █████╗   ██║      ██╔████╔██║ ██║ ██╔██╗ ██║ █████╗  
╚════██║ ██╔═══╝  ██╔══╝   ██║      ██║╚██╔╝██║ ██║ ██║╚██╗██║ ██╔══╝  
███████║ ██║      ███████╗ ╚██████╗ ██║ ╚═╝ ██║ ██║ ██║ ╚████║ ███████╗
╚══════╝ ╚═╝      ╚══════╝  ╚═════╝ ╚═╝     ╚═╝ ╚═╝ ╚═╝  ╚═══╝ ╚══════╝
```

Mine product specifications (JSON) from text, PDFs, or web pages — with an LLM.
A library. No server, no CLI. Call a function, get a spec.

## Install

```sh
npm install @jonaskahn/specmine
```

Requires Node.js 18+ (ESM).

## Usage

### Quick start — plain text

```ts
import { extract } from '@jonaskahn/specmine';

const spec = await extract('The Acme Kettle holds 1.5L, £49.');
// { "Capacity": "1.5 L", "Price": "£49" }
```

### Input kinds

`extract()` accepts three input kinds:

```ts
// 1. A string — plain text or HTML (converted to Markdown automatically)
const spec = await extract('The Acme Kettle holds 1.5L, £49.');

// 2. A Blob / File — PDF or text. Works in browsers and Node
const spec = await extract(fileOrBlob);

// 3. A URL — https/http URLs are fetched, file:// URLs are read from disk
const spec = await extract(new URL('https://example.com/kettle.pdf'));
```

### Reading a file from disk

Wrap a file in a `Blob`. The content type is optional — `%PDF` magic bytes are
sniffed, so text blobs work too:

```ts
import { readFile } from 'node:fs/promises';
import { extract } from '@jonaskahn/specmine';

// PDF
const pdf = new Blob([await readFile('./kettle.pdf')], { type: 'application/pdf' });
const spec = await extract(pdf);

// Plain text file — type omitted
const txt = new Blob([await readFile('./kettle.txt')]);
const spec = await extract(txt);
```

### Fetching a remote PDF

```ts
const spec = await extract(new URL('https://example.com/specs/kettle.pdf'));
// { "Weight": "1.5 kg", "Dimensions": "239 x 44 x 190 mm" }
```

Remote HTML pages are converted to Markdown before extraction, so table- and
tag-heavy product pages still produce clean specs:

```ts
const spec = await extract(new URL('https://example.com/products/kettle'));
```

### HTML input

HTML strings and blobs are detected and converted to Markdown automatically:

```ts
const html = '<html><body><h1>Acme Kettle</h1><table><tr><td>Weight</td><td>1.5 kg</td></tr></table></body></html>';
const spec = await extract(html);
// { "Weight": "1.5 kg" }
```

### Output shape

Values are always strings. Output is **nested** (group → key → value) when the
content has labeled sections:

```json
{
  "Hardware": { "Power Supply": "12 V DC, external power supply" },
  "Dimensions": "239 x 44 x 190 mm"
}
```

Pass `flattened: true` to reduce output to innermost leaf pairs:

```ts
const spec = await extract(pdfBlob, { flattened: true });
// { "Power Supply": "12 V DC, external power supply", "Dimensions": "239 x 44 x 190 mm" }
```

With `inheritance: true` the parent keys are kept as `Parent · Child` prefixes:

```ts
const spec = await extract(pdfBlob, { flattened: true, inheritance: true });
// { "Hardware · Power Supply": "12 V DC, external power supply" }
```

### Language

Keys and values are written in the language detected from the input. Force a
language with `lang`:

```ts
const spec = await extract('Der Acme Wasserkocher fasst 1,5 Liter.', { lang: 'de' });
// { "Fassungsvermögen": "1,5 Liter" }
```

### Providers

The default provider is OpenAI-compatible. Switch with `provider`:

```ts
const spec = await extract('The Acme Kettle holds 1.5L, £49.', {
  provider: 'anthropic',
  model: 'haiku-4.5',
});
```

Zero config via env: `SPECMINE_LLM_API_KEY` picks the key for both providers;
`SPECMINE_LLM_API_HOST` and `SPECMINE_LLM_MODEL` override host and model:

```sh
export SPECMINE_LLM_API_KEY=sk-...
export SPECMINE_LLM_MODEL=gpt-5.6-luna   # optional
export SPECMINE_LLM_API_HOST=https://api.openai.com/v1   # optional
```

```ts
const spec = await extract('The Acme Kettle holds 1.5L, £49.'); // no options needed
```

### Tags

Pass `tags: true` to also get a short list of descriptive labels:

```ts
const result = await extract('The Acme Kettle holds 1.5L, £49.', { tags: true });
// {
//   "spec": { "Capacity": "1.5 L", "Price": "£49" },
//   "tags": ["kettle", "stainless-steel"]
// }
```

Or tags only — a dedicated prompt and schema, no spec pairs:

```ts
import { extractTags } from '@jonaskahn/specmine';

const tags = await extractTags('The Acme Kettle holds 1.5L, £49.');
// ["kettle", "stainless-steel"]
```

Tags are normalized in code: lowercased, trimmed, deduplicated, max 8.

### Timeouts and cancellation

Abort a hanging LLM call after N milliseconds, or wire in your own signal:

```ts
import { extract } from '@jonaskahn/specmine';

// Abort after 10 seconds
const spec = await extract(text, { timeoutMs: 10_000 });

// External abort
const controller = new AbortController();
const spec = await extract(text, { signal: controller.signal });
controller.abort(); // rejects with TIMEOUT
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
    console.error(error.code, error.message);
    // e.g. "EMPTY_INPUT Input is empty"
    //      "LLM_ERROR LLM host responded 401"
    //      "TIMEOUT LLM call aborted"
  }
}
```

### Advanced: custom pipeline

`createExtractor()` builds an extractor with swappable pieces
(`reader`, `llm`, `validator` — all optional). Wrap the LLM in
`createResilientProvider()` for retries and a circuit breaker:

```ts
import {
  createExtractor,
  createOpenAiProvider,
  createResilientProvider,
} from '@jonaskahn/specmine';

const llm = createResilientProvider(createOpenAiProvider(), {
  retry: { maxRetries: 2, backoffMs: 200 },
  circuitBreaker: { failureThreshold: 5, cooldownMs: 30_000 },
});

const extractor = createExtractor({ llm });

const spec = await extractor.extract('The Acme Kettle holds 1.5L, £49.');
```

Retries only fire on `LLM_ERROR` and `TIMEOUT`. Resilient defaults:
`maxRetries: 2`, `backoffMs: 200`, `failureThreshold: 5`, `cooldownMs: 30_000`.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run format      # prettier --write
npm test            # node:test + tsx
npm run coverage    # 100% coverage gate
npm run build       # emit dist/
```

Runnable examples live in [`examples/`](examples/) — `npx tsx examples/text.ts`,
`examples/pdf.ts`, `examples/tags.ts`, `examples/flattened.ts`, `examples/language.ts`,
`examples/html.ts`, `examples/anthropic.ts`, `examples/resilient.ts`.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
