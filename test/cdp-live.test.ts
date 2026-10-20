import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import { DefaultReader } from '../src/input/reader.js';
import { createExtractor } from '../src/extractor.js';
import { createPipeline } from '../src/pipeline.js';
import type { CdpOptions, LlmProvider } from '../src/index.js';

const endpoint = process.env.SPECMINE_CDP_ENDPOINT;
const live = {
  skip: !endpoint && 'Set SPECMINE_CDP_ENDPOINT to run against a live CDP server',
  timeout: 15_000,
};

async function localPage(t: TestContext) {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/products/kettle' });
      response.end();
      return;
    }
    if (request.url === '/missing') {
      response.writeHead(404);
      response.end('Missing');
      return;
    }
    if (request.url === '/specs.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' });
      response.end(
        'setTimeout(function () {' +
          'document.getElementById("content").innerHTML = ' +
          JSON.stringify(
            '<table id="specs"><thead><tr><th>Feature</th><th>Value</th></tr></thead><tbody><tr><td>Capacity</td><td>1.7 L</td></tr><tr><td>Power</td><td>2200 W</td></tr></tbody></table>',
          ) +
          ';}, 40);',
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      '<!doctype html><html><head><title>Rendered Kettle</title>' +
        '<meta name="description" content="A kettle with dynamically loaded specs.">' +
        '<meta property="og:image" content="images/kettle.jpg"></head>' +
        '<body><h1>Rendered Kettle</h1><div id="content">Loading specifications</div>' +
        '<script src="/specs.js"></script></body></html>',
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const origin = 'http://127.0.0.1:' + address.port;
  const token = process.env.OBSCURA_CDP_TOKEN;
  const cdp: CdpOptions = {
    endpoint: endpoint!,
    waitUntil: 'domcontentloaded',
    waitForSelector: '#specs',
    timeoutMs: 10_000,
    ...(token ? { headers: { Authorization: 'Bearer ' + token } } : {}),
  };
  return { origin, cdp };
}

test(
  'live CDP renders JavaScript, follows redirects, and preserves metadata and relative images',
  live,
  async (t) => {
    const f = await localPage(t);
    const reader = new DefaultReader();
    const raw = await reader.read(new URL(f.origin + '/redirect'));
    assert.doesNotMatch(raw.text, /2200 W/);
    const rendered = await reader.read(new URL(f.origin + '/redirect'), { cdp: f.cdp });
    assert.match(rendered.text, /1.7 L/);
    assert.match(rendered.text, /2200 W/);
    assert.match(rendered.text, /| Feature | Value |/);
    assert.equal(rendered.title, 'Rendered Kettle');
    assert.equal(rendered.description, 'A kettle with dynamically loaded specs.');
    assert.ok(
      rendered.candidates?.some((image) => image.url === f.origin + '/products/images/kettle.jpg'),
    );
  },
);

test('live CDP constructor defaults can be overridden per read', live, async (t) => {
  const f = await localPage(t);
  const reader = new DefaultReader(undefined, undefined, undefined, f.cdp);
  assert.match((await reader.read(new URL(f.origin + '/products/kettle'))).text, /2200 W/);
  await assert.rejects(reader.read(new URL(f.origin), { cdp: { endpoint: 'invalid' } }), {
    code: 'UNSUPPORTED_INPUT',
  });
});

test('live CDP passes rendered text to the extractor and pipeline', live, async (t) => {
  const f = await localPage(t);
  let calls = 0;
  const llm: LlmProvider = {
    complete: async (request) => {
      assert.match(String(request.messages.at(-1)?.content), /2200 W/);
      calls += 1;
      return { content: JSON.stringify({ Capacity: '1.7 L', Power: '2200 W' }) };
    },
  };
  const url = new URL(f.origin + '/redirect');
  const expected = { Capacity: '1.7 L', Power: '2200 W' };
  assert.deepEqual(await createExtractor({ llm }).extract(url, { cdp: f.cdp }), expected);
  // Only the external classifier identification call is stubbed; browser I/O stays real.
  const originalFetch = globalThis.fetch;
  t.mock.method(
    globalThis,
    'fetch',
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).includes('api.typesafe.ai')) return new Response('{}');
      return originalFetch(input, init);
    },
  );
  const pipeline = createPipeline({ llm }, { cdp: f.cdp });
  const result = await pipeline.process(url, { category: 'electronics', summary: false });
  assert.deepEqual(result.spec, expected);
  assert.equal(result.title, 'Rendered Kettle');
  assert.equal(calls, 2);
});

test('live CDP rejects HTTP errors and a subsequent read still works', live, async (t) => {
  const f = await localPage(t);
  const reader = new DefaultReader();
  await assert.rejects(reader.read(new URL(f.origin + '/missing'), { cdp: f.cdp }), {
    code: 'LLM_ERROR',
  });
  assert.match((await reader.read(new URL(f.origin + '/redirect'), { cdp: f.cdp })).text, /2200 W/);
});

test('live CDP bounds selector waiting and supports cancellation', live, async (t) => {
  const f = await localPage(t);
  const reader = new DefaultReader();
  await assert.rejects(
    reader.read(new URL(f.origin), {
      cdp: { ...f.cdp, waitForSelector: '#never-exists', timeoutMs: 500 },
    }),
    { code: 'TIMEOUT' },
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    await assert.rejects(
      reader.read(new URL(f.origin), {
        cdp: { ...f.cdp, waitForSelector: '#never-exists', timeoutMs: 1500 },
        signal: controller.signal,
      }),
      { code: 'TIMEOUT' },
    );
  } finally {
    clearTimeout(timer);
  }
});
