import { logger } from '../log.js';

/**
 * Stage 1 of the picture decision (rules). We never look at pixels here: the
 * candidate list comes only from markup the page already ships, so "reuse" is
 * always free and always faithful to what the publisher chose.
 */
export type CandidateSource = 'og:image' | 'twitter:image' | 'gallery' | 'thumbnail' | 'alt';

export interface ImageCandidate {
  url: string;
  source: CandidateSource;
  alt: string;
  /** 0–1; higher wins when several candidates are equally plausible */
  score: number;
  /** pixel width, when the markup or the url states one */
  width?: number;
  /** pixel height, when the markup or the url states one */
  height?: number;
  /** image mime type, sniffed from the file extension or stated by og:image:type */
  type?: string;
  /** the image's own title, when it has one */
  title?: string;
  /** where it sat in the page: meta tags first, then images in document order */
  position: number;
}

export const MIN_CANDIDATE_SCORE = 0.5;

/** Small decorative sprites are never "a photo the page already has". */
const TOO_SMALL = /(?:[?&](?:w|width|h|height|size)=(\d{1,4})(&|$))/i;

export const THUMBNAIL_SCORE = 0.8;

const SOURCE_SCORE: Record<CandidateSource, number> = {
  'og:image': 1,
  'twitter:image': 0.9,
  thumbnail: THUMBNAIL_SCORE,
  gallery: 0.6,
  alt: 0.5,
};

const TRACKER_ONLY = /(?:\.svg$|spacer|pixel|blank|1x1|tracking|logo)/i;

const EXTENSION_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

const EXTENSION = /\.(\w{3,4})(?:[?#]|$)/;
const WIDTH_HINT = /[?&]w(?:idth)?=(\d{1,4})/i;
const HEIGHT_HINT = /[?&]h(?:eight)?=(\d{1,4})/i;

/** Attribute value of `name` inside an html tag, unquoted or quoted. */
function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function metaContent(html: string, property: string): string | undefined {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const reverse = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
    'i',
  );
  return pattern.exec(html)?.[1] ?? reverse.exec(html)?.[1];
}

/**
 * What makes two references the same picture. Compared as the "main link" —
 * host without `www.`, and path without the query or fragment — because a page
 * routinely references one asset several ways: a CDN that resizes via `?w=800`,
 * a `#hero` anchor, or the same file served from `www.`. Those are one image,
 * and listing it three times tells the caller nothing.
 *
 * The path keeps its case, since a path can legitimately be case-sensitive.
 */
function imageKey(url: string): string {
  // Even a non-url ("alt:…") parses, so there is no failure to handle here —
  // it simply yields an empty host and its own text as the path.
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./i, '');
  return `${host}${parsed.pathname}`;
}

function absolutize(src: string, base: string | undefined): string | undefined {
  if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:'))
    return src;
  if (!base) return undefined;
  try {
    return new URL(src, base).toString();
  } catch {
    return undefined;
  }
}

function isUsable(url: string | undefined): url is string {
  if (!url || url.startsWith('data:')) return false;
  if (TRACKER_ONLY.test(url)) return false;
  const size = TOO_SMALL.exec(url)?.[1];
  return size === undefined || Number(size) >= 200;
}

interface Detail {
  width?: number | undefined;
  height?: number | undefined;
  type?: string | undefined;
  title?: string | undefined;
}

function toInt(value: string | undefined): number | undefined {
  const n = Number(value);
  return value !== undefined && Number.isInteger(n) ? n : undefined;
}

function push(
  out: ImageCandidate[],
  seen: Set<string>,
  raw: string | undefined,
  base: string | undefined,
  source: CandidateSource,
  alt = '',
  detail: Detail = {},
): void {
  if (!raw) return;
  const url = absolutize(raw, base);
  if (!isUsable(url)) return;
  // One picture per main link, so a resized or anchored copy of the same asset
  // does not fill the list twice. The first reference wins, which is why the
  // rule order above matters.
  const key = imageKey(url);
  if (seen.has(key)) return;
  seen.add(key);
  // An explicit attribute always wins; a query-string hint is a weaker fallback.
  const width = detail.width ?? toInt(WIDTH_HINT.exec(url)?.[1]);
  const height = detail.height ?? toInt(HEIGHT_HINT.exec(url)?.[1]);
  const type = detail.type ?? EXTENSION_TYPE[EXTENSION.exec(url)?.[1]?.toLowerCase() ?? ''];
  out.push({
    url,
    source,
    alt,
    score: SOURCE_SCORE[source],
    position: out.length,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(detail.title !== undefined ? { title: detail.title } : {}),
  });
}

/**
 * Rule order mirrors the page's own priority: Open Graph first, then Twitter's
 * mirror, then the biggest thing on the page, then alt text of a lone image.
 * Nothing is dropped for being small or unlabelled — every usable reference is
 * kept, with whatever detail the markup happened to state.
 */
export function extractImageCandidates(html: string, baseUrl?: string): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const seen = new Set<string>();
  push(out, seen, metaContent(html, 'og:image'), baseUrl, 'og:image', '', {
    width: toInt(metaContent(html, 'og:image:width')),
    height: toInt(metaContent(html, 'og:image:height')),
    type: metaContent(html, 'og:image:type'),
    title: metaContent(html, 'og:image:alt') || metaContent(html, 'og:title'),
  });
  push(out, seen, metaContent(html, 'twitter:image'), baseUrl, 'twitter:image', '', {
    title: metaContent(html, 'twitter:image:alt'),
  });
  push(out, seen, metaContent(html, 'twitter:image:src'), baseUrl, 'twitter:image', '', {
    title: metaContent(html, 'twitter:image:alt'),
  });
  const galleryPattern = /<img\b[^>]*>/gi;
  for (const tag of html.matchAll(galleryPattern)) {
    push(out, seen, attr(tag[0], 'src'), baseUrl, 'gallery', attr(tag[0], 'alt') ?? '', {
      width: toInt(attr(tag[0], 'width')),
      height: toInt(attr(tag[0], 'height')),
      type: attr(tag[0], 'data-type') ?? attr(tag[0], 'type'),
      title: attr(tag[0], 'title'),
    });
  }
  if (out.length === 0) {
    const alt = /\balt=["']([^"']{4,})["']/i.exec(html)?.[1];
    if (alt) {
      logger().debug('No reusable image url, falling back to alt text');
      // The same identity check as a real url, so a non-url candidate is
      // namespaced rather than colliding with one.
      seen.add(imageKey(`alt:${alt}`));
      out.push({
        url: `alt:${alt}`,
        source: 'alt',
        alt,
        score: SOURCE_SCORE.alt,
        position: 0,
      });
    }
  }
  out.sort((a, b) => b.score - a.score || a.position - b.position);
  return out;
}

const TAG_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Entity-decodes the handful of escapes a title or meta tag realistically carries. */
function decode(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const text = raw
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(\w+);/g, (whole, name: string) => TAG_ENTITIES[name] ?? whole)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : undefined;
}

/**
 * The page's own words about itself, read from the markup. This is what the
 * source already states, so it costs nothing and is always preferred over a
 * generated title or description. Open Graph first because that is what a page
 * publishes for this purpose, then Twitter's mirror, then the standard meta.
 * A `<title>` stands in for a missing title only — it is not a description.
 */
export function extractPageMeta(html: string): { title?: string; description?: string } {
  const tag = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
  const title =
    decode(metaContent(html, 'og:title')) ?? decode(metaContent(html, 'twitter:title')) ?? tag;
  const description =
    decode(metaContent(html, 'og:description')) ??
    decode(metaContent(html, 'twitter:description')) ??
    decode(metaContent(html, 'description'));
  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
  };
}

/** Stage 2 of the decision (reuse): the best candidate, if any is usable. */
export function pickReusableImage(candidates: ImageCandidate[]): ImageCandidate | undefined {
  const best = candidates
    .filter((candidate) => candidate.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score)[0];
  if (best) logger().info('Reusing page picture', { source: best.source, url: best.url });
  return best;
}
