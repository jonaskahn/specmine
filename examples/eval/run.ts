import 'dotenv/config';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from '../../src';

// Usage:
//   npx tsx eval100/run.ts            full sweep, CSV + images/ folder
//   EVAL_EMBED_IMAGES=1 npx tsx eval100/run.ts
//       inlines the whole data URL in the `image_data` column instead of a
//       size marker — self-contained CSV, but roughly 2.7 MB per row
//   EVAL_CONCURRENCY=3                default 3
//   EVAL_TRUNC=4000                   cap on long text cells (0 = no cap)

const root = dirname(fileURLToPath(import.meta.url));
const fxDir = join(root, 'fixtures');
const imgDir = join(root, 'images');
const outCsv = join(root, 'report.csv');
const EMBED = process.env.EVAL_EMBED_IMAGES === '1';
const TRUNC = Number(process.env.EVAL_TRUNC ?? 4000);

const files = readdirSync(fxDir)
  .filter((f) => f.endsWith('.txt'))
  .sort();
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 3);

const caps = (v: string): string =>
  TRUNC > 0 && v.length > TRUNC ? `${v.slice(0, TRUNC)}…<${v.length - TRUNC} more>` : v;
const cell = (v: unknown): string => {
  const s = v === undefined || v === null ? '' : String(v);
  return `"${s.replace(/"/g, '""')}"`;
};
const header = [
  'idx',
  'file',
  'expected_domain',
  'jev_json',
  'jev_kind',
  'jev_domain',
  'jev_scope',
  'jev_visual',
  'jev_confidence',
  'jev_source',
  'jev_reason',
  'domain_match',
  'spec_ok',
  'spec_keys',
  'spec_json',
  'spec_error',
  'image_ok',
  'image_grounding',
  'image_mime',
  'image_ext',
  'image_file',
  'image_b64_len',
  'image_dataurl_len',
  'prompt_leak',
  'image_prompt',
  'image_data',
  'image_error',
  'input_text',
  'latency_ms',
].join(',');

const rows: string[] = new Array(files.length);
let done = 0;
let specOk = 0;
let imageOk = 0;
let match = 0;
let leaks = 0;

async function one(idx: number): Promise<void> {
  const file = files[idx] as string;
  const base = file.replace(/\.txt$/, '');
  const expected = base.replace(/-\d+$/, '');
  const text = readFileSync(join(fxDir, file), 'utf8');
  const t0 = Date.now();
  try {
    const r = await analyze(text, {
      outputs: ['spec', 'image'],
      mode: 'parallel',
      classifier: { provider: 'jev' },
      image: { includePrompt: true },
    });
    const ms = Date.now() - t0;
    const c = r.category as unknown as Record<string, unknown>;
    const sKeys = r.spec ? Object.keys(r.spec).length : 0;
    const sOk = r.spec ? 1 : 0;
    const iOk = r.image ? 1 : 0;
    const m = c.domain === expected ? 1 : 0;
    specOk += sOk;
    imageOk += iOk;
    match += m;

    let imageFile = '';
    let imageData = '';
    let b64Len = 0;
    let urlLen = 0;
    let ext = '';
    let mime = '';
    let prompt = '';
    if (r.image) {
      mime = r.image.mimeType;
      ext = mime.replace('image/', '') || 'png';
      b64Len = r.image.base64.length;
      urlLen = r.image.dataUrl.length;
      prompt = r.image.prompt ?? '';
      const name = `${base}.${ext}`;
      writeFileSync(join(imgDir, name), Buffer.from(r.image.base64, 'base64'));
      imageFile = relative(root, join(imgDir, name));
      imageData = EMBED ? r.image.dataUrl : `<dataUrl ${urlLen} chars>`;
    }
    const leak =
      /[$€£]\s?\d|\d\s?(kg|g|ml|mm|cm|w|v|mah|gb|hz|usd|eur)\b|https?:|@\w+\.|\+?\d{3}[\s-]\d{3}/i.test(
        prompt,
      )
        ? 1
        : 0;
    leaks += iOk && leak ? 1 : 0;

    rows[idx] = [
      idx + 1,
      base,
      expected,
      cell(JSON.stringify(c)),
      c.kind,
      c.domain,
      c.scope,
      c.visual,
      c.confidence,
      c.source,
      c.reason ?? '',
      m,
      sOk,
      sKeys,
      cell(caps(JSON.stringify(r.spec ?? {}))),
      cell((r.errors as Record<string, { message?: string }>)?.spec?.message ?? ''),
      iOk,
      r.image?.grounding ?? '',
      mime,
      ext,
      imageFile,
      b64Len,
      urlLen,
      leak,
      cell(caps(prompt)),
      cell(caps(imageData)),
      cell((r.errors as Record<string, { message?: string }>)?.image?.message ?? ''),
      cell(caps(text)),
      ms,
    ].join(',');
    console.log(
      `[${idx + 1}/${files.length}] ${base} domain=${c.domain} src=${c.source} spec=${sOk ? `ok(${sKeys})` : 'FAIL'} image=${iOk ? `${r.image?.grounding}` : 'FAIL'}${leak ? ' LEAK' : ''} ${ms}ms`,
    );
  } catch (e) {
    const ms = Date.now() - t0;
    rows[idx] = [
      idx + 1,
      base,
      expected,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      0,
      0,
      0,
      '',
      cell(e instanceof Error ? e.message : String(e)),
      0,
      '',
      '',
      '',
      '',
      0,
      0,
      0,
      '',
      '',
      '',
      cell(caps(text)),
      ms,
    ].join(',');
    console.log(
      `[${idx + 1}/${files.length}] ${base} THROW ${e instanceof Error ? e.message : e} ${ms}ms`,
    );
  }
  done += 1;
  if (done % 10 === 0) writeFileSync(outCsv, `${header}\n${rows.map((r) => r ?? '').join('\n')}\n`);
}

mkdirSync(imgDir, { recursive: true });
const queue = files.map((_, i) => i);
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const i = queue.shift();
      if (i !== undefined) await one(i);
    }
  }),
);

writeFileSync(outCsv, `${header}\n${rows.join('\n')}\n`);
console.log(
  `\nDONE ${done}/${files.length} spec_ok=${specOk} image_ok=${imageOk} domain_match=${match} leaks=${leaks}\nreport: ${outCsv}\nimages: ${imgDir}`,
);
