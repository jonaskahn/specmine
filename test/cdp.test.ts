import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import type { Browser, Page, PuppeteerNode } from 'puppeteer-core';
import { WebSocketServer } from 'ws';
import { readCdpHtml } from '../src/input/cdp.js';
import { DefaultReader } from '../src/input/reader.js';
import { createExtractor } from '../src/extractor.js';
import { createPipeline } from '../src/pipeline.js';
import type { ReadOptions } from '../src/types.js';
import { CDP_LINKS } from '../examples/cdp-links.js';

const target = new URL('https://example.com/product');
type Connect = PuppeteerNode['connect'];

async function fixture(
  t: TestContext,
  settings: {
    status?: number;
    contentType?: string;
    discoveryStatus?: number;
    discoveryBody?: unknown;
    stallDiscovery?: boolean;
    stallUpgrade?: boolean;
    failAt?: 'connect' | 'newPage' | 'goto' | 'selector' | 'content' | 'close' | 'disconnect';
    failure?: Error;
  } = {},
) {
  const calls: string[] = [];
  const seen: Record<string, unknown> = {};
  const failure = settings.failure ?? new Error('fixture failure');
  let endpoint = '';
  const server = createServer((request, response) => {
    seen.discoveryHeaders = request.headers;
    seen.discoveryPath = request.url;
    if (settings.stallDiscovery) return;
    response.writeHead(settings.discoveryStatus ?? 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(settings.discoveryBody ?? { webSocketDebuggerUrl: endpoint }));
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    seen.wsHeaders = request.headers;
    if (settings.stallUpgrade) return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const http = 'http://127.0.0.1:' + address.port;
  endpoint = http.replace('http:', 'ws:') + '/devtools/browser';
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const step = (name: string) => {
    calls.push(name);
    if (settings.failAt === name) throw failure;
  };
  const page = {
    goto: async (url: string, options: unknown) => {
      step('goto');
      seen.url = url;
      seen.navigation = options;
      return {
        ok: () => (settings.status ?? 200) < 400,
        status: () => settings.status ?? 200,
        headers: () => ({ 'content-type': settings.contentType ?? 'text/html' }),
      };
    },
    waitForSelector: async (selector: string) => {
      step('selector');
      seen.selector = selector;
    },
    content: async () => {
      step('content');
      return '<h1>Rendered kettle</h1>';
    },
    url: () => 'https://example.com/redirected/product',
    close: async () => step('close'),
  } as unknown as Page;
  const browser = {
    newPage: async () => {
      step('newPage');
      return page;
    },
    disconnect: async () => step('disconnect'),
  } as unknown as Browser;
  const connect: Connect = async (options) => {
    step('connect');
    seen.connection = options;
    return browser;
  };
  return { endpoint, http, connect, calls, seen, sockets };
}

for (const endpoint of ['not a URL', 'ftp://example.com', 'file:///tmp/browser']) {
  test('CDP rejects unsupported endpoint ' + endpoint, async () => {
    await assert.rejects(readCdpHtml(target, { endpoint }), { code: 'UNSUPPORTED_INPUT' });
  });
}
for (const timeoutMs of [0, -1, Infinity, NaN]) {
  test('CDP rejects invalid deadline ' + timeoutMs, async () => {
    await assert.rejects(readCdpHtml(target, { endpoint: 'ws://localhost:9222', timeoutMs }), {
      code: 'UNSUPPORTED_INPUT',
    });
  });
}

test('CDP captures HTML, final URL, navigation defaults, and cleans up', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await readCdpHtml(target, { endpoint: f.endpoint }, undefined, f.connect), {
    html: '<h1>Rendered kettle</h1>',
    url: 'https://example.com/redirected/product',
  });
  assert.deepEqual(f.seen.navigation, { waitUntil: 'networkidle2', timeout: 30_000 });
  assert.equal(f.seen.url, target.toString());
  assert.deepEqual(f.calls, ['connect', 'newPage', 'goto', 'content', 'close', 'disconnect']);
});

test('CDP discovers HTTP endpoint and sends auth to discovery and WebSocket', async (t) => {
  const f = await fixture(t);
  await readCdpHtml(
    target,
    {
      endpoint: f.http,
      headers: { Authorization: 'Bearer test-token' },
      waitUntil: 'load',
      waitForSelector: '#specs',
      timeoutMs: 2000,
    },
    undefined,
    f.connect,
  );
  assert.equal(f.seen.discoveryPath, '/json/version');
  for (const name of ['discoveryHeaders', 'wsHeaders']) {
    assert.equal((f.seen[name] as Record<string, unknown>).authorization, 'Bearer test-token');
  }
  assert.equal(f.seen.selector, '#specs');
  assert.deepEqual(f.seen.navigation, { waitUntil: 'load', timeout: 2000 });
  assert.ok(f.calls.indexOf('selector') < f.calls.indexOf('content'));
});

test('CDP falls back to call timeoutMs', async (t) => {
  const f = await fixture(t);
  await readCdpHtml(target, { endpoint: f.endpoint }, { timeoutMs: 3000 }, f.connect);
  assert.deepEqual(f.seen.navigation, { waitUntil: 'networkidle2', timeout: 3000 });
});

for (const settings of [{ discoveryStatus: 401 }, { discoveryBody: {} }]) {
  test('CDP reports discovery failure ' + JSON.stringify(settings), async (t) => {
    const f = await fixture(t, settings);
    await assert.rejects(readCdpHtml(target, { endpoint: f.http }, undefined, f.connect), {
      code: 'LLM_ERROR',
    });
    assert.deepEqual(f.calls, []);
  });
}

for (const failAt of ['connect', 'newPage', 'goto', 'selector', 'content'] as const) {
  test('CDP cleans up after ' + failAt + ' failure', async (t) => {
    const f = await fixture(t, { failAt });
    await assert.rejects(
      readCdpHtml(
        target,
        { endpoint: f.endpoint, waitForSelector: '#specs' },
        undefined,
        f.connect,
      ),
      { code: 'LLM_ERROR' },
    );
    if (failAt !== 'connect') assert.ok(f.calls.includes('disconnect'));
    if (['goto', 'selector', 'content'].includes(failAt)) assert.ok(f.calls.includes('close'));
  });
}

for (const failAt of ['close', 'disconnect'] as const) {
  test('CDP preserves successful output after ' + failAt + ' failure', async (t) => {
    const f = await fixture(t, { failAt });
    const result = await readCdpHtml(target, { endpoint: f.endpoint }, undefined, f.connect);
    assert.match(result.html, /Rendered kettle/);
    assert.ok(f.calls.includes('disconnect'));
  });
}

test('CDP maps navigation timeout to TIMEOUT', async (t) => {
  const failure = new Error('navigation deadline');
  failure.name = 'TimeoutError';
  const f = await fixture(t, { failAt: 'goto', failure });
  await assert.rejects(readCdpHtml(target, { endpoint: f.endpoint }, undefined, f.connect), {
    code: 'TIMEOUT',
  });
});

test('CDP rejects an HTTP error page', async (t) => {
  const f = await fixture(t, { status: 403 });
  await assert.rejects(readCdpHtml(target, { endpoint: f.endpoint }, undefined, f.connect), {
    code: 'LLM_ERROR',
  });
  assert.ok(f.calls.includes('close'));
});

test('CDP rejects PDFs with actionable error', async (t) => {
  const f = await fixture(t, { contentType: 'application/pdf' });
  await assert.rejects(readCdpHtml(target, { endpoint: f.endpoint }, undefined, f.connect), {
    code: 'UNSUPPORTED_INPUT',
    message: /read PDFs without the cdp option/,
  });
});

test('CDP rejects a pre-aborted signal before connecting', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    readCdpHtml(target, { endpoint: f.endpoint }, { signal: AbortSignal.abort() }, f.connect),
    { code: 'TIMEOUT' },
  );
  assert.deepEqual(f.calls, []);
});

for (const phase of ['discovery', 'handshake'] as const) {
  test('CDP deadline cancels stalled ' + phase, async (t) => {
    const f = await fixture(t, {
      stallDiscovery: phase === 'discovery',
      stallUpgrade: phase === 'handshake',
    });
    await assert.rejects(
      readCdpHtml(
        target,
        { endpoint: phase === 'discovery' ? f.http : f.endpoint, timeoutMs: 50 },
        undefined,
        f.connect,
      ),
      { code: 'TIMEOUT' },
    );
    assert.deepEqual(f.calls, []);
  });
}

test('CDP abort cancels an active discovery request', { timeout: 2000 }, async (t) => {
  const f = await fixture(t, { stallDiscovery: true });
  const controller = new AbortController();
  const reading = readCdpHtml(
    target,
    { endpoint: f.http },
    { signal: controller.signal },
    f.connect,
  );
  while (!f.seen.discoveryPath) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(reading, { code: 'TIMEOUT' });
});

test('string HTML ignores CDP and remains local input', async () => {
  const result = await new DefaultReader().read('<h1>Local kettle</h1>', {
    cdp: { endpoint: 'invalid' },
  });
  assert.equal(result.text, '# Local kettle');
});

test('extractor forwards CDP read options and extracts reader text', async () => {
  const options = { cdp: { endpoint: 'ws://localhost:9222' } };
  let seen: ReadOptions | undefined;
  const extractor = createExtractor({
    reader: {
      read: async (_, opts) => {
        seen = opts;
        return { text: 'Weight: 2 kg', imageOnly: false, kind: 'html' };
      },
    },
    llm: { complete: async () => ({ content: JSON.stringify({ Weight: '2 kg' }) }) },
  });
  assert.deepEqual(await extractor.extract(target, options), { Weight: '2 kg' });
  assert.equal(seen, options);
});

test('live URL sample contains ten unique pages split evenly between US and Germany', () => {
  assert.equal(CDP_LINKS.length, 10);
  assert.equal(new Set(CDP_LINKS.map((link) => link.url)).size, 10);
  for (const country of ['US', 'DE'])
    assert.equal(CDP_LINKS.filter((link) => link.country === country).length, 5);
  for (const link of CDP_LINKS) assert.equal(new URL(link.url).protocol, 'https:');
});

test('pipeline forwards per-call CDP read options', async () => {
  const options = { cdp: { endpoint: 'ws://localhost:9222' } };
  const stop = new Error('stop after reader');
  const pipeline = createPipeline({
    reader: {
      read: async (_, seen) => {
        assert.equal(seen, options);
        throw stop;
      },
    },
  });
  await assert.rejects(pipeline.process(target, options), (error) => error === stop);
});
