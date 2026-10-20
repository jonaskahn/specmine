import type { Browser, ConnectionTransport, Page } from 'puppeteer-core';
import type WebSocket from 'ws';
import { ExtractionError } from '../errors.js';
import { logger } from '../log.js';
import type { CallOptions, CdpOptions } from '../types.js';

/** Capture rendered markup while leaving the browser server running. */
export async function readCdpHtml(
  url: URL,
  options: CdpOptions,
  callOptions?: CallOptions,
  connectBrowser?: typeof import('puppeteer-core').connect,
): Promise<{ html: string; url: string }> {
  const timeoutMs = options.timeoutMs ?? callOptions?.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ExtractionError(
      'UNSUPPORTED_INPUT',
      'CDP timeoutMs must be a positive finite number',
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch (cause) {
    throw new ExtractionError('UNSUPPORTED_INPUT', 'Invalid CDP endpoint URL', cause);
  }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(endpoint.protocol)) {
    throw new ExtractionError('UNSUPPORTED_INPUT', 'CDP endpoint must use ws, wss, http or https');
  }

  const controller = new AbortController();
  const aborted = (): ExtractionError =>
    new ExtractionError('TIMEOUT', 'CDP read timed out or was aborted');
  const checkAbort = (): void => {
    if (controller.signal.aborted) throw aborted();
  };
  const onAbort = (): void => controller.abort();
  callOptions?.signal?.addEventListener('abort', onAbort, { once: true });
  if (callOptions?.signal?.aborted) controller.abort();
  const timer = setTimeout(onAbort, timeoutMs);
  let browser: Browser | undefined;
  let page: Page | undefined;
  let socket: WebSocket | undefined;

  const cleanup = async (): Promise<void> => {
    const ownedPage = page;
    const connection = browser;
    page = undefined;
    browser = undefined;
    try {
      await ownedPage?.close();
    } catch {
      // A failed navigation may have already destroyed the target.
    } finally {
      try {
        await connection?.disconnect();
      } catch {
        // Preserve the read result or error when the connection is already gone.
      } finally {
        socket?.terminate();
      }
    }
  };

  let rejectOnAbort: (() => void) | undefined;
  const expiry = new Promise<never>((_, reject) => {
    rejectOnAbort = () => {
      reject(aborted());
      void cleanup();
    };
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    if (controller.signal.aborted) rejectOnAbort();
  });

  const read = async (): Promise<{ html: string; url: string }> => {
    try {
      checkAbort();
      let connect: typeof import('puppeteer-core').connect;
      let WebSocketClass: typeof WebSocket;
      try {
        connect = connectBrowser ?? (await import('puppeteer-core')).connect;
        WebSocketClass = (await import('ws')).default;
      } catch (cause) {
        throw new ExtractionError(
          'UNSUPPORTED_INPUT',
          'CDP input requires optional dependencies. Install with npm install puppeteer-core@24 ws@8',
          cause,
        );
      }
      checkAbort();
      let browserWSEndpoint = endpoint.toString();
      if (endpoint.protocol === 'http:' || endpoint.protocol === 'https:') {
        // Discover explicitly so authentication headers reach /json/version too.
        const response = await fetch(new URL('/json/version', endpoint), {
          ...(options.headers !== undefined ? { headers: options.headers } : {}),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new ExtractionError('LLM_ERROR', 'CDP discovery failed: ' + response.status);
        }
        const info = (await response.json()) as { webSocketDebuggerUrl?: unknown };
        if (typeof info.webSocketDebuggerUrl !== 'string') {
          throw new ExtractionError('LLM_ERROR', 'CDP discovery returned no webSocketDebuggerUrl');
        }
        browserWSEndpoint = info.webSocketDebuggerUrl;
      }
      checkAbort();
      // Own the socket so a stalled WebSocket handshake can be cancelled too.
      socket = new WebSocketClass(browserWSEndpoint, {
        ...(options.headers !== undefined ? { headers: options.headers } : {}),
        handshakeTimeout: timeoutMs,
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024,
      });
      const ws = socket;
      const transport: ConnectionTransport = {
        send: (message) => ws.send(message),
        close: () => ws.terminate(),
      };
      ws.on('message', (data) => transport.onmessage?.(data.toString()));
      ws.on('close', () => transport.onclose?.());
      ws.on('error', () => {
        // Opening errors reject below; later failures are handled by CDP onclose.
      });
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
      });
      checkAbort();
      browser = await connect({
        transport,
        defaultViewport: null,
        protocolTimeout: timeoutMs,
      });
      checkAbort();
      page = await browser.newPage();
      checkAbort();
      const response = await page.goto(url.toString(), {
        waitUntil: options.waitUntil ?? 'networkidle2',
        timeout: timeoutMs,
      });
      if (response && !response.ok()) {
        throw new ExtractionError('LLM_ERROR', 'CDP page request failed: ' + response.status());
      }
      if (response?.headers()['content-type']?.toLowerCase().includes('application/pdf')) {
        throw new ExtractionError(
          'UNSUPPORTED_INPUT',
          'CDP input expects HTML; read PDFs without the cdp option',
        );
      }
      if (options.waitForSelector !== undefined) {
        await page.waitForSelector(options.waitForSelector, { timeout: timeoutMs });
      }
      checkAbort();
      const html = await page.content();
      const finalUrl = page.url();
      logger().info('Read rendered HTML via CDP', { url: finalUrl });
      return { html, url: finalUrl };
    } finally {
      // Also clean up connections that finish after timeout or cancellation.
      await cleanup();
    }
  };

  try {
    return await Promise.race([read(), expiry]);
  } catch (cause) {
    if (controller.signal.aborted) throw aborted();
    if (cause instanceof ExtractionError) throw cause;
    if (cause instanceof Error && cause.name === 'TimeoutError') {
      throw new ExtractionError('TIMEOUT', 'CDP operation timed out', cause);
    }
    throw new ExtractionError('LLM_ERROR', 'Failed to read HTML through CDP', cause);
  } finally {
    clearTimeout(timer);
    callOptions?.signal?.removeEventListener('abort', onAbort);
    if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
  }
}
