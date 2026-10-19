import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtractionError } from '../errors.js';
import { logger } from '../log.js';
import type { ExtractInput } from '../types.js';
import { htmlToMarkdown } from './html.js';
import { extractImageCandidates } from '../media/candidates.js';
import type { ImageCandidate } from '../media/candidates.js';
import type { PdfInspector } from './pdf.js';
import { pickUserAgent } from './user-agent.js';
import { isVideoUrl, readVideoMetadata, thumbnailCandidate, videoToText } from './video.js';
import type { VideoSessionOptions } from './video.js';

export const REMOTE_TEMP_PREFIX = 'specmine-remote-';

export type InputKind = 'text' | 'html' | 'url' | 'video' | 'pdf' | 'scanned_pdf';

export interface ReadResult {
  text: string;
  imageOnly: boolean;
  /** which of the six input kinds this was detected as */
  kind: InputKind;
  /** the page's own pictures, when the source markup offered any. Optional so
   *  custom readers written against the older shape keep working. */
  candidates?: ImageCandidate[];
}

export interface InputReader {
  read(input: ExtractInput): Promise<ReadResult>;
}

/**
 * One place where HTML is turned into Markdown, so the kind label and the
 * picture candidates always agree with the text the classifier will read.
 */
function fromMarkdown(raw: string, baseUrl: string | undefined): ReadResult {
  const text = htmlToMarkdown(raw);
  const candidates = extractImageCandidates(raw, baseUrl);
  return { text, imageOnly: false, kind: candidates.length > 0 ? 'html' : 'text', candidates };
}

export class DefaultReader implements InputReader {
  constructor(
    private readonly pdfInspector?: PdfInspector,
    /** youtubei.js session options; see https://ytjs.dev/guide/getting-started.html */
    private readonly videoSession?: VideoSessionOptions,
  ) {}

  async read(input: ExtractInput): Promise<ReadResult> {
    if (typeof input === 'string') {
      return fromMarkdown(input, undefined);
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
    if (isVideoUrl(url)) {
      const metadata = await readVideoMetadata(url, this.videoSession);
      const text = videoToText(metadata);
      return {
        text,
        imageOnly: false,
        kind: 'video',
        candidates: thumbnailCandidate(metadata.thumbnail),
      };
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const response = await fetch(url, { headers: { 'User-Agent': pickUserAgent() } });
      if (!response.ok) {
        throw new ExtractionError('LLM_ERROR', `Failed to fetch ${url}: ${response.status}`);
      }
      const contentType = response.headers.get('content-type');
      logger().info('Fetched remote input', {
        url: url.toString(),
        status: response.status,
        contentType,
      });
      return this.readRemoteFile(await response.arrayBuffer(), contentType, url.toString());
    }
    throw new ExtractionError('UNSUPPORTED_INPUT', `Unsupported URL scheme: ${url.protocol}`);
  }

  private async readRemoteFile(
    bytes: ArrayBuffer,
    contentType: string | null,
    baseUrl?: string,
  ): Promise<ReadResult> {
    const tmpPath = join(tmpdir(), `${REMOTE_TEMP_PREFIX}${randomUUID()}`);
    try {
      await writeFile(tmpPath, Buffer.from(bytes));
      const diskBytes = await readFile(tmpPath);
      return await this.readBlob(new Blob([diskBytes], { type: contentType ?? '' }), baseUrl);
    } finally {
      await rm(tmpPath, { force: true });
    }
  }

  private async readBlob(blob: Blob, baseUrl?: string): Promise<ReadResult> {
    if (await this.isPdf(blob)) {
      return this.readPdf(blob);
    }
    logger().debug('Read text input', { type: blob.type, size: blob.size });
    return fromMarkdown(await blob.text(), baseUrl);
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
      logger().warn('PDF is image only, returning empty result', {
        type: blob.type,
        size: blob.size,
      });
      return { text: '', imageOnly: true, kind: 'scanned_pdf', candidates: [] };
    }
    return { text: result.markdown, imageOnly: false, kind: 'pdf', candidates: [] };
  }
}
