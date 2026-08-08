# Contributing

Thanks for contributing to specmine. This is a small library that
deliberately stays small — please read the principles before opening a PR.

## Project status

The repo contains working implementations of every contract under `src/`
(extractors, readers, PDF inspector, LLM clients, resilience wrapper,
validator). Tests live in `test/` and run with node:test. Contract changes
must stay reviewable on their own; implementation follows.

## Design principles (read first)

- **KISS** — "Make everything as simple as possible, but not simpler"
  (Kelly Johnson / U.S. Navy, 1960). One public function, two output
  shapes, a handful of options. If a change adds surface area, it needs a
  strong reason.
- **DRY / single source of truth** — Hunt & Thomas: _"Every piece of
  knowledge must have a single, unambiguous, authoritative representation
  within a system."_
  - `ExtractInput` (`src/types.ts`) is the **one place** the list of
    supported inputs lives. Adding an input kind means adding one union
    member plus one `extract` overload — nothing else.
  - `ProductSpec` / `NestedSpecs` / `SpecsResult` (`src/types.ts`) are the
    **one place** the output shape lives. Never redefine the shape anywhere
    else.
  - `LlmProviderOptions` (`src/llm/provider.ts`) is the **one place** the
    LLM connection knobs live. Provider-specific extras extend it; they
    don't fork it. Built-in host/model defaults live with their provider
    factory (`src/llm/openai.ts`, `src/llm/anthropic.ts`).
- **Output shapes are a promise.** Values are always strings. Two shapes,
  mirroring the reference service (`plugai-card-creation/DETAIL.md`):
  - flat `ProductSpec` (`{"<key>": "<value>"}`) — text input, and PDF
    input with `flattened: true`;
  - nested `NestedSpecs` (category → key → value) — PDF input by default
    (`flattened` unset).

## Architecture map

```
ExtractInput (string | Blob | URL)
        │
        ▼
InputReader.read ──► ReadResult { text, imageOnly }
        │              PDF: pdf-inspector classifies locally (no OCR)
        │                TextBased/Mixed → Markdown → LLM text path
        │                All-image → imageOnly → empty spec, no LLM call
        ▼
LlmProvider.complete  (OpenAI-compatible / Anthropic-compatible REST)
        │
        ▼
SpecValidator.validate  (enforces the output shape)
        │
        ▼
   SpecsResult (flat or nested)
```

- **OCP:** a new LLM provider is a new file in `src/llm/` plus a factory
  returning `LlmProvider`. Nothing else changes.
- **Retry / circuit breaker:** `createResilientProvider` wraps any
  `LlmProvider` and owns all retry/breaker state — it is the one place
  that state lives, and it never touches the wrapped provider. Its
  settings resolve `options` → `SPECMINE_LLM_*` env vars → the
  `DEFAULT_*` constants in `src/llm/resilience.ts`.
- **DIP:** `createExtractor(dependencies)` receives `InputReader`,
  `LlmProvider`, and `SpecValidator` — the extractor never constructs
  concrete dependencies itself.
- **ISP:** each contract (`InputReader`, `PdfInspector`, `LlmProvider`,
  `SpecValidator`) is tiny and single-purpose. A consumer implements only
  what it uses.
- **Single choice principle:** the input union, the output shape, and the
  `PdfType` union are each listed in exactly one module.
- **Local-first PDF routing:** `PdfInspector` (backed by
  `@firecrawl/pdf-inspector`) classifies before the LLM is involved;
  text-based PDFs go to the LLM as Markdown, all-image PDFs skip the LLM
  and yield an empty spec. The routing rule is encoded once in
  `ReadResult` (`imageOnly`).

## Code style

Two references govern style, in this order:

1. [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
2. [clean-code-typescript](https://github.com/labs42io/clean-code-typescript)
   (Clean Code concepts adapted for TypeScript)

Where they disagree, Google wins. This project adds its own override on top
of both: **no comments inside code** — the code must describe itself. Names
and structure carry the meaning; README carries the examples.

### From the Google TypeScript Style Guide

- **Exports:** named exports only. No default exports, no `namespace`
  blocks, no `require`. Minimize the exported API surface — export only
  what consumers use.
- **Imports:** `import type` for type-only imports, `export type` for
  type-only re-exports. Group imports: polyfills, builtins, external,
  internal, parent, sibling — separated by blank lines.
- **Declarations:** `const` by default, `let` only when reassigned, never
  `var`. One variable per declaration.
- **Classes:** no `#private` fields — use TypeScript `private`. Prefer
  `readonly`. Use parameter properties
  (`constructor(private readonly service: Service)`). Never use the
  `public` modifier except for non-readonly public parameter properties.
- **Functions:** function declarations for named functions; arrow
  functions for callbacks; never bare function expressions. No `bind` to
  rebind `this` — use arrows. Avoid flags as parameters.
- **Strings:** single quotes. Template literals over concatenation.
- **Numbers:** `Number()` to parse, checked for `NaN`/`Infinity`. No unary
  `+`, no `parseInt`/`parseFloat` (except non-base-10 after validating the
  input).
- **Types:** interfaces for object shapes (index signatures where
  appropriate), type aliases for unions and primitives. `T[]` sugar for
  simple element types. No `IMyInterface` prefixes, no trailing/leading
  underscores, no `I`/`T` decorations that repeat type information.
- **Naming:** `UpperCamelCase` for types, `lowerCamelCase` for values,
  `CONSTANT_CASE` for global constants. Names are descriptive; no
  ambiguous abbreviations; acronyms camel-cased (`loadHttpUrl`, not
  `loadHTTPURL`).
- **Control flow:** no `for...in` without filtering; prefer
  `for...of Object.entries(...)`. No unfiltered `hasOwnProperty` reliance.
- **Never `any`.** Use `unknown` and narrow. No `@ts-ignore`.

### From clean-code-typescript

- **Meaningful, pronounceable, searchable names.** Same vocabulary for the
  same concept (`getUser`, not `getUserInfo` / `getUserDetails`). No
  mental mapping (`user`, not `u`). No unneeded context (`car.make`, not
  `car.carMake`).
- **Small functions.** Two or fewer parameters; three or more go into an
  options object (destructured). One thing per function, one level of
  abstraction. Names say what they do (`addMonthToDate`, not
  `addToDate`).
- **No duplicate code** — but prefer duplication over the wrong
  abstraction (Sandi Metz). Two similar implementations in different
  domains may stay separate.
- **No flags as parameters.** Split the function instead.
- **No side effects.** Pure functions; clone and return rather than
  mutate. No global state, no writing to globals.
- **Favor functional over imperative.** Encapsulate conditionals in named
  functions; prefer positive conditionals (`isUsed`, not `isNotUsed`).
- **Immutability.** `readonly` members, `ReadonlyArray`, `as const` where
  it expresses intent.
- **Prefer composition over inheritance** (Gang of Four).
- **SOLID:** SRP (one reason to change), OCP (extend, don't modify), LSP
  (subtypes substitutable), ISP (small interfaces), DIP (depend on
  abstractions).
- **Testing (when tests arrive):** F.I.R.S.T. (Fast, Independent,
  Repeatable, Self-validating, Timely), one concept per test, names that
  reveal intent.
- **Promises over callbacks; async/await over promise chains.**
- **Errors:** always reject/throw real `Error` types, never strings.

### Project override: no comments in code

- **Zero comments inside `src/`.** No `//`, no JSDoc, no `TODO` in code.
  If a reader needs an explanation, the name or structure is wrong — fix
  the name or structure. (Clean-code-typescript: "Comments are an
  apology, not a requirement.")
- Exceptions: none in `src/`. Documentation lives in `README.md` and this
  file.

## Rules of thumb

1. **Public API changes need a README update.** README examples are part
   of the contract.
2. **Errors reject with `ExtractionError` and a `code`** from
   `ExtractionErrorCode`. Callers branch on `code`, not on messages.
3. **No new dependencies without discussion.** The library stays lean.
4. **Interfaces/contracts before implementation.** Changes to `src/`
   should be reviewable on their own.
5. **One choice per module.** Don't add a second place for input kinds,
   output shape, or LLM options.

## Getting started

```sh
npm install
npm run typecheck
npm run lint
npm run format:check
```

All four must pass before a PR is reviewable.

## Scripts

| Script                 | What it does                |
| ---------------------- | --------------------------- |
| `npm run build`        | Emit declarations to `dist` |
| `npm run typecheck`    | `tsc --noEmit`              |
| `npm run lint`         | ESLint (flat config)        |
| `npm run lint:fix`     | Autofix lint issues         |
| `npm run format`       | Prettier write all files    |
| `npm run format:check` | Prettier check only         |
| `npm test`             | Test placeholder            |

## Branching and commits

- Branch from `main`, name the branch after the change
  (`feat/anthropic-provider`).
- Conventional Commits, e.g. `feat: add extract(Blob) overload`,
  `fix: reject EMPTY_INPUT for whitespace-only text`.
- Keep PRs small; one logical change each.

## Pull request checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run format:check` passes
- [ ] No comments added inside `src/` (self-describing code)
- [ ] README updated if the public API changed
- [ ] New input kinds are reflected in `ExtractInput` (single choice
      principle)
- [ ] New providers implement `LlmProvider` and extend
      `LlmProviderOptions` without modifying existing providers

## Questions

Open an issue. Keep it specific: what you tried, what you expected, what
happened.
