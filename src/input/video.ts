import { ExtractionError } from '../errors.js';
import { THUMBNAIL_SCORE, type ImageCandidate } from '../media/candidates.js';
import { logger } from '../log.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Hosts whose pages carry no readable prose, so metadata is the only sane way to
 * read them.
 */
export const VIDEO_HOSTS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'music.youtube.com',
  'vimeo.com',
  'www.vimeo.com',
];

export interface VideoMetadata {
  title: string;
  description: string;
  thumbnail: string;
  author: string;
  /** seconds; 0 when the video is live or its length is unknown */
  duration: number;
  viewCount: number;
  /** ISO date, empty when YouTube did not state one */
  publishedAt: string;
  keywords: string[];
  category: string;
  isLive: boolean;
  /** caption text, empty when the video has no transcript or it could not be read */
  transcript: string;
}

export const EMPTY_VIDEO_METADATA: VideoMetadata = {
  title: '',
  description: '',
  thumbnail: '',
  author: '',
  duration: 0,
  viewCount: 0,
  publishedAt: '',
  keywords: [],
  category: '',
  isLive: false,
  transcript: '',
};

export function isVideoUrl(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:'
    ? VIDEO_HOSTS.includes(url.hostname.toLowerCase())
    : false;
}

function isYouTube(url: URL): boolean {
  return url.hostname.toLowerCase().includes('youtu');
}

/** Accepts both `youtu.be/ID` and every `watch?v=`/embed/shorts spelling. */
export function videoIdOf(url: URL): string | undefined {
  const id = url.hostname.toLowerCase().includes('youtu.be')
    ? url.pathname.slice(1)
    : (url.searchParams.get('v') ??
      /\/shorts\/([^/]+)/.exec(url.pathname)?.[1] ??
      /\/embed\/([^/]+)/.exec(url.pathname)?.[1] ??
      /\/live\/([^/]+)/.exec(url.pathname)?.[1]);
  return id !== undefined && /^[\w-]{6,20}$/.test(id) ? id : undefined;
}

export interface InnertubeVideo {
  basic_info?: {
    title?: string | undefined;
    short_description?: string | undefined;
    author?: string | undefined;
    duration?: number | undefined;
    view_count?: number | undefined;
    publish_date?: string | undefined;
    keywords?: string[] | undefined;
    category?: string | null;
    is_live?: boolean | undefined;
    thumbnail?: Array<{ url: string; width?: number; height?: number }> | undefined;
  };
}

/** Pure mapping of a youtubei.js video info onto our own shape. */
export function fromInnertube(info: InnertubeVideo | undefined): VideoMetadata | undefined {
  const basic = info?.basic_info;
  if (!basic) return undefined;
  // YouTube ships several thumbnails; the widest is the one worth reusing.
  const thumbnail = (basic.thumbnail ?? [])
    .filter((entry) => entry.url.startsWith('http'))
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  return {
    ...EMPTY_VIDEO_METADATA,
    title: basic.title ?? '',
    description: basic.short_description ?? '',
    author: basic.author ?? '',
    duration: basic.duration ?? 0,
    viewCount: basic.view_count ?? 0,
    publishedAt: basic.publish_date ?? '',
    keywords: basic.keywords ?? [],
    category: basic.category ?? '',
    isLive: basic.is_live === true,
    ...(thumbnail ? { thumbnail: thumbnail.url } : {}),
  };
}

/**
 * youtubei.js is an optional dependency: a consumer who never reads video does
 * not pay for it, and one who does can install it. Vimeo has no InnerTube, so it
 * keeps the oEmbed path.
 */
/**
 * Pass-through of youtubei.js' `Innertube.create` options — lang, location,
 * cookie, account_index, client_type, and the rest. See
 * https://ytjs.dev/guide/getting-started.html#configuration-options
 */
export type VideoSessionOptions = Record<string, unknown>;

/**
 * The slice of youtubei.js this module actually uses.
 *
 * Both calls are made: `getInfo` is the only one that can serve captions,
 * because `MediaInfo.getTranscript` reads the transcript panel out of the
 * `next` response that only `getInfo` fetches — `getBasicInfo` sends just the
 * `watch` response and throws "Cannot get transcript from basic video info".
 * `getBasicInfo` is still called alongside it, both because it is the cheaper
 * of the two and because it is the fallback whenever `getInfo` is slow or
 * refused. Its lower parser noise is a bonus, not the reason to call it.
 *
 * `getInfo` is optional so a stand-in only has to offer `getBasicInfo`; a
 * source without it simply has no transcript, which degrades to metadata-only.
 */
export interface VideoInfoSource {
  getBasicInfo(videoId: string): Promise<unknown>;
  getInfo?(videoId: string): Promise<unknown>;
}

/** A caption cue as youtubei.js hands it over. */
interface TranscriptSegment {
  snippet?: { text?: string };
}

/**
 * Captions are the video's actual content. YouTube refuses the transcript
 * endpoint for plenty of ordinary videos (no captions, age or region gates,
 * bot detection), so a failure here degrades to metadata-only rather than
 * failing the whole read.
 */
async function readTranscript(info: unknown): Promise<string> {
  try {
    const transcript = await (
      info as { getTranscript?: () => Promise<unknown> }
    )?.getTranscript?.();
    const segments = (
      transcript as {
        transcript?: { content?: { body?: { initial_segments?: TranscriptSegment[] } } };
      }
    )?.transcript?.content?.body?.initial_segments;
    if (!Array.isArray(segments)) return '';
    return segments
      .map((segment) => segment.snippet?.text?.trim() ?? '')
      .filter((line) => line.length > 0)
      .join(' ');
  } catch (error) {
    logger().debug('Video transcript unavailable', { error: messageOf(error) });
    return '';
  }
}

/** How long the caption fetch may take before the read settles for metadata alone. */
export const DEFAULT_VIDEO_TRANSCRIPT_MS = 15_000;

/**
 * Resolves `run()` with undefined once `ms` has passed. Nothing is cancelled —
 * there is no handle to cancel through this interface — so the loser simply
 * stops mattering. Every caller attaches its own catch before racing, so a
 * late rejection cannot surface as an unhandled one.
 */
async function within<T>(ms: number, run: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([run(), expiry]);
  } finally {
    // Left armed, the timer holds the event loop and the process never exits.
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Builds a session; `undefined` means "youtubei.js is not installed". */
export type InnertubeFactory = (
  session: VideoSessionOptions,
) => Promise<VideoInfoSource | undefined>;

/* c8 ignore start -- the real youtubei.js session needs the network */
const defaultInnertubeFactory: InnertubeFactory = async (session) => {
  let Innertube: (typeof import('youtubei.js'))['Innertube'];
  try {
    ({ Innertube } = await import('youtubei.js'));
  } catch {
    logger().debug('youtubei.js is not installed, falling back to oEmbed');
    return undefined;
  }
  // Generating locally avoids a round trip to YouTube just to make a session.
  return Innertube.create({
    generate_session_locally: true,
    ...session,
  }) as Promise<VideoInfoSource>;
};
/* c8 ignore stop */

async function readYouTubeInfo(
  url: URL,
  session: VideoSessionOptions = {},
  factory: InnertubeFactory = defaultInnertubeFactory,
  timeoutMs: number = DEFAULT_VIDEO_TRANSCRIPT_MS,
): Promise<VideoMetadata | undefined> {
  const videoId = videoIdOf(url);
  if (!videoId) return undefined;
  const innertube = await factory(session);
  if (!innertube) return undefined;

  // Both start together. `getInfo` is the only source of captions but also the
  // one that trips YouTube's bot checks, so it races a deadline; every failure
  // path degrades to whatever `getBasicInfo` produced. Both sides are bounded —
  // an unbounded wait on either one would hang the read outright. Each catch is
  // attached where the promise is made, because a rejection arriving after the
  // race has settled would otherwise be unhandled.
  const basicInfo = within(timeoutMs, () => innertube.getBasicInfo(videoId)).catch(() => undefined);
  const fullInfo = innertube.getInfo
    ? within(timeoutMs, () => innertube.getInfo!(videoId)).catch(() => undefined)
    : undefined;

  // Both are caught where they are made, so both settle as fulfilled; the only
  // way either arrives undefined is the deadline expiring. `fullInfo` is absent
  // entirely for a source with no `getInfo`.
  const [basic, full] = await Promise.all([basicInfo, fullInfo ?? Promise.resolve(undefined)]);
  const fullValue = full;
  const basicValue = basic;

  // `getInfo` wins when it lands — it carries the same metadata plus captions —
  // but a response without usable basic_info still leaves the cheap one to fall
  // back on, so neither call can spoil the other.
  const metadata =
    fromInnertube(fullValue as InnertubeVideo | undefined) ??
    fromInnertube(basicValue as InnertubeVideo | undefined);
  if (!metadata) return undefined;
  if (!fullValue) return metadata;

  const transcript = await readTranscript(fullValue);
  return transcript.length > 0 ? { ...metadata, transcript } : metadata;
}

function oembedEndpoint(url: URL): string {
  const target = encodeURIComponent(url.toString());
  return isYouTube(url)
    ? `https://www.youtube.com/oembed?url=${target}&format=json`
    : `https://vimeo.com/api/oembed.json?url=${target}`;
}

async function readOembedMetadata(url: URL): Promise<VideoMetadata> {
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
  logger().debug('Read video metadata via oEmbed', { url: url.toString(), title: body.title });
  return {
    ...EMPTY_VIDEO_METADATA,
    title: body.title ?? '',
    description: body.description ?? '',
    thumbnail: body.thumbnail_url ?? body.thumbnail ?? '',
    author: body.author_name ?? body.author ?? '',
  };
}

export async function readVideoMetadata(
  url: URL,
  session?: VideoSessionOptions,
  factory?: InnertubeFactory,
  timeoutMs?: number,
): Promise<VideoMetadata> {
  if (isYouTube(url)) {
    const info = await readYouTubeInfo(url, session, factory, timeoutMs);
    if (info) {
      logger().debug('Read video metadata via youtubei.js', {
        url: url.toString(),
        title: info.title,
      });
      return info;
    }
  }
  return readOembedMetadata(url);
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const secs = total % 60;
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/** YouTube states a full ISO timestamp; the date is the human-readable part. */
function toDateOnly(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T/.test(value) ? value.slice(0, 10) : value;
}

export const MAX_TRANSCRIPT_CHARS = 20_000;

/**
 * Render metadata as the text the classifier reads. Facts are labelled so they
 * land as spec values; the thumbnail url is deliberately left out, since a bare
 * image url is not a specification of anything.
 */
export function videoToText(metadata: VideoMetadata): string {
  const lines = [`# ${metadata.title}`];
  if (metadata.author) lines.push(`Channel: ${metadata.author}`);
  if (metadata.isLive) {
    lines.push('Live stream');
  } else if (metadata.duration > 0) {
    lines.push(`Duration: ${formatDuration(metadata.duration)}`);
  }
  if (metadata.publishedAt) lines.push(`Published: ${toDateOnly(metadata.publishedAt)}`);
  if (metadata.viewCount > 0) lines.push(`Views: ${metadata.viewCount}`);
  if (metadata.category) lines.push(`Category: ${metadata.category}`);
  if (metadata.description) lines.push('', '## Description', '', metadata.description);
  if (metadata.keywords.length > 0) lines.push('', `Keywords: ${metadata.keywords.join(', ')}`);
  if (metadata.transcript) {
    const transcript = metadata.transcript.slice(0, MAX_TRANSCRIPT_CHARS);
    const truncated = transcript.length < metadata.transcript.length ? ' (truncated)' : '';
    lines.push('', `## Transcript${truncated}`, '', transcript);
  }
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
