import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtractionError } from '../errors.js';
import type { ExtractInput } from '../types.js';
import { htmlToMarkdown } from './html.js';
import type { PdfInspector } from './pdf.js';
import { pickUserAgent } from './user-agent.js';

export const REMOTE_TEMP_PREFIX = 'specmine-remote-';

export interface ReadResult {
  text: string;
  imageOnly: boolean;
}

export interface InputReader {
  read(input: ExtractInput): Promise<ReadResult>;
}

export class DefaultReader implements InputReader {
  constructor(private readonly pdfInspector?: PdfInspector) {}

  async read(input: ExtractInput): Promise<ReadResult> {
    if (typeof input === 'string') {
      return { text: htmlToMarkdown(input), imageOnly: false };
    }
    if (input instanceof URL) {
      return this.readUrl(input);
    }
    return this.readBlob(input);
  }

  private async readUrl(url: URL): Promise<ReadResult> {
    if (url.protocol === 'file:') {
      return this.readBlob(new Blob([await readFile(fileURLToPath(url))]));
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const response = await fetch(url, { headers: { 'User-Agent': pickUserAgent() } });
      if (!response.ok) {
        throw new ExtractionError('LLM_ERROR', `Failed to fetch ${url}: ${response.status}`);
      }
      return this.readRemoteFile(
        await response.arrayBuffer(),
        response.headers.get('content-type'),
      );
    }
    throw new ExtractionError('UNSUPPORTED_INPUT', `Unsupported URL scheme: ${url.protocol}`);
  }

  private async readRemoteFile(
    bytes: ArrayBuffer,
    contentType: string | null,
  ): Promise<ReadResult> {
    const tmpPath = join(tmpdir(), `${REMOTE_TEMP_PREFIX}${randomUUID()}`);
    try {
      await writeFile(tmpPath, Buffer.from(bytes));
      const diskBytes = await readFile(tmpPath);
      return await this.readBlob(new Blob([diskBytes], { type: contentType ?? '' }));
    } finally {
      await rm(tmpPath, { force: true });
    }
  }

  private async readBlob(blob: Blob): Promise<ReadResult> {
    if (await this.isPdf(blob)) {
      return this.readPdf(blob);
    }
    return { text: htmlToMarkdown(await blob.text()), imageOnly: false };
  }

  private async isPdf(blob: Blob): Promise<boolean> {
    if (blob.type === 'application/pdf') return true;
    if (blob.size < 4) return false;
    const head = await blob.slice(0, 4).text();
    return head === '%PDF';
  }

  private async readPdf(blob: Blob): Promise<ReadResult> {
    if (!this.pdfInspector) {
      throw new ExtractionError(
        'UNSUPPORTED_INPUT',
        'PDF input requires a PdfInspector implementation',
      );
    }
    const data = new Uint8Array(await blob.arrayBuffer());
    const result = this.pdfInspector.process(data);
    if (result.markdown === null) {
      return { text: '', imageOnly: true };
    }
    return { text: result.markdown, imageOnly: false };
  }
}
