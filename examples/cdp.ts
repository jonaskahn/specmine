import { DefaultReader } from '../src/input/reader.js';
import { CDP_LINKS } from './cdp-links.js';

const endpoint = process.env.SPECMINE_CDP_ENDPOINT ?? 'ws://127.0.0.1:9222/devtools/browser';
const token = process.env.OBSCURA_CDP_TOKEN;
const reader = new DefaultReader();
let failed = 0;

// Sequential reads keep a heavy page from blocking another page in Obscura.
for (const link of CDP_LINKS) {
  const started = Date.now();
  try {
    const result = await reader.read(new URL(link.url), {
      cdp: {
        endpoint,
        waitUntil: 'domcontentloaded',
        timeoutMs: 45_000,
        ...(token ? { headers: { Authorization: 'Bearer ' + token } } : {}),
      },
    });
    if (result.text.trim().length < 200 || !link.expected.test(result.text)) {
      throw new Error(
        'Expected product content missing; possible challenge or incomplete rendering',
      );
    }
    console.log(
      JSON.stringify({
        country: link.country,
        name: link.name,
        url: link.url,
        ok: true,
        chars: result.text.length,
        title: result.title,
        images: result.candidates?.length ?? 0,
        durationMs: Date.now() - started,
      }),
    );
  } catch (error) {
    failed += 1;
    console.log(
      JSON.stringify({
        country: link.country,
        name: link.name,
        url: link.url,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      }),
    );
  }
}

console.log(JSON.stringify({ total: CDP_LINKS.length, passed: CDP_LINKS.length - failed, failed }));
process.exitCode = failed > 0 ? 1 : 0;
