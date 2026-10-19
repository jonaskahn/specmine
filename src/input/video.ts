import { ExtractionError } from '../errors.js';
import { THUMBNAIL_SCORE, type ImageCandidate } from '../media/candidates.js';
import { logger } from '../log.js';

/**
 * Hosts whose pages carry no readable prose — the oEmbed endpoint is the only
 * sane way to get title/thumbnail/description out of them.
 */
export const VIDEO_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
];

export interface VideoMetadata {
  title: string;
  description: string;
  thumbnail: string;
  author: string;
}

export function isVideoUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? VIDEO_HOSTS.includes(url.hostname.toLowerCase())
    : false;
}

function oembedEndpoint(url: URL): string {
  const host = url.hostname.toLowerCase();
  const target = encodeURIComponent(url.toString());
  return host.includes('youtu')
    ? `https://www.youtube.com/oembed?url=${target}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${target}`;
}

/** Render oEmbed metadata as the markdown-ish text the classifier reads. */
export function videoToText(metadata: VideoMetadata): string {
  const lines = [`# ${metadata.title}`];
  if (metadata.author) lines.push(`By ${metadata.author}`);
  if (metadata.description) lines.push('', metadata.description);
  if (metadata.thumbnail) lines.push('', `Thumbnail: ${metadata.thumbnail}`);
  return lines.join('\n');
}

/**
 * The video's own thumbnail is the one picture a video page truly carries, so
 * it enters the candidate list as a thumbnail and can be reused like any
 * og:image would be.
 */
export function thumbnailCandidate(thumbnail: string): ImageCandidate[] {
  return thumbnail
    ? [
        {
          url: thumbnail,
          source: 'thumbnail',
          alt: '',
          score: THUMBNAIL_SCORE,
          position: 0,
        },
      ]
    : [];
}

export async function readVideoMetadata(url: URL): Promise<VideoMetadata> {
  const response = await fetch(oembedEndpoint(url), {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new ExtractionError(
      'LLM_ERROR',
      `Failed to fetch video metadata for ${url}: ${response.status}`,
    );
  }
  const body = (await response.json()) as Partial<VideoMetadata> & {
    thumbnail_url?: string;
    author_name?: string;
  };
  // oEmbed spells some fields differently to our shape; both spellings are read.
  logger().debug('Read video metadata', { url: url.toString(), title: body.title });
  return {
    title: body.title ?? '',
    description: body.description ?? '',
    thumbnail: body.thumbnail_url ?? body.thumbnail ?? '',
    author: body.author_name ?? '',
  };
}
