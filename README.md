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

```ts
import { extract } from '@jonaskahn/specmine';

// Raw text
const spec = await extract('The Acme Kettle holds 1.5L, £49.');

// A Blob / File (PDF or text)
const spec = await extract(fileOrBlob);

// A URL — https/http fetched, file:// read from disk
const spec = await extract(new URL('https://example.com/kettle.pdf'));
```

### Files from Node

Wrap a file in a `Blob` — the content type is optional, `%PDF` magic bytes are sniffed:

```ts
import { readFile } from 'node:fs/promises';
import { extract } from '@jonaskahn/specmine';

const data = new Blob([await readFile('./kettle.pdf')], { type: 'application/pdf' });
const spec = await extract(data);
```

HTML input is detected and converted to Markdown before extraction.

### Configuration

Set `SPECMINE_LLM_API_KEY` in the environment and call `extract()` with zero options.
Everything else falls back to provider defaults.

| Option      | Type          | Default               | Meaning                                    |
| ----------- | ------------- | --------------------- | ------------------------------------------ |
| `provider`  | `string`      | `"openai"`            | `"openai"`, `"anthropic"`, or registered   |
| `model`     | `string`      | per-provider default  | Model identifier                           |
| `apiKey`    | `string`      | env var               | Provider key                               |
| `lang`      | `string`      | detected from input   | Language for extracted keys and values     |
| `flattened` | `boolean`     | `false`               | `true` → reduce output to leaf pairs       |
| `tags`      | `boolean`     | `false`               | `true` → also return a short list of tags  |
| `timeoutMs` | `number`      | —                     | Abort the LLM call after N ms              |
| `signal`    | `AbortSignal` | —                     | External abort signal                      |

### Tags

```ts
const result = await extract('The Acme Kettle holds 1.5L, £49.', { tags: true });
// { "spec": { "Capacity": "1.5 L", "Price": "£49" }, "tags": ["kettle"] }
```

Or tags only — a dedicated prompt and schema, no spec pairs:

```ts
import { extractTags } from '@jonaskahn/specmine';

const tags = await extractTags('The Acme Kettle holds 1.5L, £49.');
// ["kettle"]
```

### Errors

Every failure rejects with an `ExtractionError` and a `code`:

`EMPTY_INPUT` · `UNSUPPORTED_INPUT` · `LLM_ERROR` · `INVALID_OUTPUT` · `TIMEOUT`

```ts
import { extract, isExtractionError } from '@jonaskahn/specmine';

try {
  await extract(input);
} catch (error) {
  if (isExtractionError(error)) {
    console.error(error.code, error.message);
  }
}
```

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

Runnable examples live in [`examples/`](examples/) — `npx tsx examples/tags.ts` etc.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
