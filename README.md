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

Each kind has a plain-English description and the module that handles it:

| Kind        | What it is                                                                                                                                                        | Where it happens                           |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| text        | A string or a plain file, read as-is.                                                                                                                             | `reader.ts · read()`, `html.ts` is a no-op |
| html        | Saved or fetched markup, converted to Markdown — tables stay as tables.                                                                                           | `html.ts · htmlToMarkdown()`               |
| url         | A live page, fetched and converted, keeping the words and dropping the code.                                                                                      | `reader.ts · readUrl()`                    |
| video       | A YouTube or Vimeo link. The page has no readable prose, so title, author and description are fetched from oEmbed and classified from those. No frame extraction. | `reader.ts · readUrl()`, `video.ts`        |
| pdf         | A PDF with a real text layer.                                                                                                                                     | `napi-pdf-inspector.ts`                    |
| scanned_pdf | A PDF that is only pictures. We stop and tell you, instead of guessing.                                                                                           | `pipeline.ts · the halt`                   |

`reader.read()` reports which kind it saw on `ReadResult.kind`, so you can log
or branch on it yourself.

#### Video links

```ts
const spec = await extract(new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
```

#### Scanned PDFs

A PDF whose pages carry no text layer raises `EMPTY_INPUT` rather than returning
a half-empty spec.

```ts
await extract(scannedPdf); // throws ExtractionError('EMPTY_INPUT')
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
const html =
  '<html><body><h1>Acme Kettle</h1><table><tr><td>Weight</td><td>1.5 kg</td></tr></table></body></html>';
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

### Combined spec + image output

`analyze()` classifies the input, then extracts specs and/or generates
a product image through LiteLLM. Each category gets its own spec hints,
visual slots and render style — see "Classification" below:

```ts
import { analyze, generateImage } from '@jonaskahn/specmine';

// Parallel: spec and image from the same content in one call
const result = await analyze('The Acme Kettle holds 1.5L, matte black steel.', {
  outputs: ['spec', 'image'],
  mode: 'parallel', // or 'sequential': extract spec first, render image from it
});
// { category: { kind, domain, family, archetype, confidence },
//   spec: { ... }, image: { blob, mimeType, base64, dataUrl } }

// Image only — the prompt is built internally, the result is the image itself
const image = await generateImage(htmlOrPdf, { category: 'electronics' });
// image.base64 — raw base64, no prefix
// image.dataUrl — "data:image/png;base64,...", ready for <img src>
// import { generateImageBase64 } from '@jonaskahn/specmine'; // base64 string only

// Pass image: { includePrompt: true } to also get the internal render prompt
// (and the provider's revised prompt) back in the result for debugging.
```

Image generation uses the OpenAI-compatible `/images/generations` endpoint,
so a LiteLLM proxy works with `SPECMINE_IMAGE_API_HOST` + `SPECMINE_IMAGE_MODEL`.
Each image setting falls back to its `SPECMINE_LLM_*` counterpart when unset
(`SPECMINE_IMAGE_API_KEY` → `SPECMINE_LLM_API_KEY`,
`SPECMINE_IMAGE_API_HOST` → `SPECMINE_LLM_API_HOST`,
`SPECMINE_IMAGE_MODEL` → `SPECMINE_LLM_MODEL`), so one base URL and key
covers both text and image calls.
Skip the classifier with `category` (e.g. `electronics`, `apparel_footwear`,
`real_estate`); use `mode: 'sequential'` to render from the extracted spec
instead of a separate visual pass.

### Picture decision

The pipeline decides where the picture comes from, and always says what it
decided in `result.picture.outcome`:

| Outcome     | Meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `reused`    | The page already had a usable photo; nothing was generated. `source` and `url` say which. |
| `generated` | The page had no photo, so one was drawn from the extracted facts.                         |
| `blocked`   | There was something to depict, but the draw was refused or failed.                        |
| `none`      | The category never takes a picture, so none was attempted.                                |

Reuse comes from the page's own markup — `og:image`, `twitter:image`, gallery
images, then alt text — never from a generated image. A page that already
carries a good photo costs nothing and is more faithful than a render.

```ts
const result = await analyze(htmlPage, { outputs: ['image'] });
result.picture;
// { outcome: 'reused', source: 'og:image', url: 'https://cdn.example.com/hero.jpg', alt: 'the kettle' }
```

### Every image the page offers

`result.images` returns the full candidate list, not just the winner, so you can
pick a different image than the pipeline did without re-reading the page. Each
entry carries `url`, `source`, `alt`, `score`, `position` (document order), and
whichever of `width`, `height`, `type` and `title` the markup stated — keys are
absent rather than empty when the page said nothing.

`picture` is the decision; `images` is the evidence behind it.

```ts
const result = await analyze(htmlPage, { outputs: ['image'] });
result.images?.[0];
// {
//   url: 'https://cdn.example.com/hero.jpg',
//   source: 'og:image', alt: '', score: 1, position: 0,
//   width: 1600, height: 900, type: 'image/webp', title: 'The kettle',
// }
```

When `reuse` wins, no image provider is called at all.

### Cost

Every run reports what it spent:

```ts
const result = await analyze('...', { outputs: ['spec'] });
JSON.stringify(result.cost, null, 2);
```

```json
{
  "calls": [
    {
      "stage": "identify",
      "model": "jev-latest",
      "inputTokens": 41,
      "outputTokens": 0,
      "estimated": true
    },
    { "stage": "spec", "model": "gpt-5.6-luna", "inputTokens": 1180, "outputTokens": 96 }
  ],
  "inputTokens": 1221,
  "outputTokens": 96,
  "totalTokens": 1317,
  "estimated": true
}
```

Token counts come from the provider's own usage report. The single exception is
`identify`: Jev's endpoint returns no usage block, so its input size is inferred
from the payload and flagged `estimated: true`, which also sets `cost.estimated`
on the summary. A provider that reports no usage at all records zero rather than
a guess.

`identify` is priced at the Jev rate and its output is free; spec and image calls
use the blended LLM rate (`BLENDED_RATE_PER_MTOK`). `estimateCost(result.cost)`
returns the dollars.

> `console.log` truncates at depth 2 and will print `calls: [Object]`. Use
> `JSON.stringify`, or `console.dir(cost, { depth: null })` to keep the shape.

### Classification

`analyze()` routes the input through a classifier to pick the category profile
(kind, domain, image archetype). Modes, in order of precedence —
`classifier.mode` option, then `classifier.provider` (deprecated alias),
then `SPECMINE_CLASSIFIER`, default `auto`:

| mode   | behaviour                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `auto` | Jev when a key is set (`classifier.apiKey` → `apiKey` → `TYPESAFE_API_KEY`); otherwise the general profile with zero classifier calls |
| `jev`  | Jev only — errors and low confidence fall back to the general profile, no silent LLM call                                             |
| `llm`  | Small structured-output LLM call on your text provider (opt-in)                                                                       |
| `off`  | Always the general profile                                                                                                            |

Jev answers in ~~70–500 ms and bills input tokens only (~~$0.042/1M, output
free), up to 10 questions per request. Note the 60 req/min self-serve rate
limit. `result.category` carries `source` (`jev` | `llm` | `user` |
`fallback`) and, on fallback, a `reason` (`no_key`, `disabled`,
`jev_error`, `low_confidence`, `llm_error`, `classify_error`,
`user_override`).

Custom domains inherit a family profile:

```ts
import { registerCategory } from '@jonaskahn/specmine';

registerCategory('wine' as DomainId, {
  family: 'goods',
  subjectNoun: 'bottle',
  specHints: ['vintage', 'region', 'grape variety'],
  specIgnore: ['serving suggestions'],
  notDepictable: ['price', 'vintage year'],
  archetype: 'food_shot',
  defaultStyle: 'elegant bottle photo',
  defaultSize: '1024x1024',
  allowImage: true,
});
```

### Workflow

```
input (string | Blob | URL)
  │  read once — HTML→Markdown, PDF→Markdown, '' → EMPTY_INPUT
  ▼
classify ──► { kind, domain, scope, visual } ──► category profile
  │                                              (spec hints + ignore list,
  │                                               visual slots, archetype)
  ▼
outputs? ── ['spec'] ──► spec flow ──────────────────────►─┐
         └─ ['image'] ─► image gate ──► image flow ──►─┤
                                                      ▼
                              { category, spec?, image?, errors? }
```

Only requested flows run. One flow failing never loses the other — the
failure lands in `errors` (`{ spec?, image? }`). With `failFast: true` the
first failure throws instead. If every requested flow fails, it throws.

```
classifier modes (classifier.mode → provider → SPECMINE_CLASSIFIER → auto)

  auto ─┬─ key set ──► Jev ─┬─ ok ──────────► { kind, domain, … }
        │                   ├─ low confidence ► general (low_confidence)
        │                   └─ error ─────────► general (jev_error)
        └─ no key ───► general, zero calls (no_key)

  jev ──► Jev only, same fallbacks, never a silent LLM call
  llm ──► small structured-output call on your text provider
  off ──► general profile (disabled)
```

```
parallel (default)                    sequential

  ┌─ spec flow ────────────┐            spec flow
  │ text + category prompt │                 │
  │  → structured spec    │                 ▼
  └────────┬───────────────┘            enough visual facts?
           │                           ┌─ yes ─► render from spec
  ┌─ image flow ───────────┐           └─ no ──► dynamic flow
  │ visual-facts prompt    │
  │  → facts → render      │           (also used when the spec
  └────────┬───────────────┘            call itself fails)
           ▼
  Promise.allSettled → merged result
```

```
image flow detail

  facts ──► prompt builder ──► POST {apiHost}/images/generations
  │         (archetype recipe      { model, prompt, size, n: 1 }
  │          + model dialect,   │
  │          prices/SKUs/units  ▼
  │          stripped)      b64_json → bytes ─┐
  │                         url ──► fetch ────┤
  │                                           ▼
  │                       { blob, mimeType, base64, dataUrl }
  │                       (+ prompt only with includePrompt: true)
  │
  ├─ dynamic: visual-facts LLM call on the cleaned text
  │           (refuses when facts are too thin for the category)
  └─ from-spec: category key-map picks depictable spec keys
                (falls back to dynamic when the spec is thin)

  skipped without a call when: not depictable, non_content,
  collection/multiple scope, policy_legal, or allowImage: false
  → errors.image = UNSUPPORTED_INPUT, other outputs unaffected
```

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

### Logging

Internal pipeline logs use [pino](https://github.com/pinojs/pino) or
[winston](https://github.com/winstonjs/winston) — whichever the consuming app
has installed (both are optional peers; with neither, logging is a no-op).
Set the level with `SPECMINE_LOG_LEVEL` (or the global `LOG_LEVEL`), and pick
the driver with `SPECMINE_LOG_DRIVER` (`pino` | `winston` | `auto`):

```sh
export SPECMINE_LOG_LEVEL=info
export SPECMINE_LOG_DRIVER=auto   # auto-detects pino, then winston
```

Levels: `silent` · `fatal` · `error` · `warn` · `info` · `debug` · `trace`.
At `debug` level the LLM, image and Jev calls also log their formatted
request and response bodies: indented JSON with credentials redacted,
embedded base64 shortened to a length marker, and output capped at 4000
characters. API keys and prompt content never appear at `info` or above.

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
`examples/html.ts`, `examples/anthropic.ts`, `examples/resilient.ts`,
`examples/analyze.ts`, `examples/sequential.ts`, `examples/generate-image.ts`,
`examples/classify.ts`, `examples/auto.ts`, `examples/litellm.ts`, `examples/eval-categories.ts`
(live API evaluation, not CI).
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
