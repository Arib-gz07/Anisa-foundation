/**
 * Build Sirv CDN URLs with on-the-fly resize/quality.
 * Non-Sirv URLs (e.g. Path CDN blog thumbs) are returned unchanged.
 */
export function isSirvUrl(src: string): boolean {
  try {
    return new URL(src).hostname.endsWith('sirv.com');
  } catch {
    return false;
  }
}

export function isRasterUrl(src: string): boolean {
  return /\.(webp|jpe?g|png|gif|avif)(\?|$)/i.test(src);
}

export function sirvUrl(src: string, width: number, quality = 82): string {
  if (!isSirvUrl(src) || !isRasterUrl(src)) return src;

  const url = new URL(src);
  url.searchParams.set('w', String(Math.round(width)));
  url.searchParams.set('q', String(quality));
  if (!url.searchParams.has('format')) {
    url.searchParams.set('format', 'webp');
  }
  return url.href;
}

export function sirvSrcSet(
  src: string,
  widths: number[],
  quality = 82,
): string | undefined {
  if (!isSirvUrl(src) || !isRasterUrl(src)) return undefined;

  const unique = [...new Set(widths.map((w) => Math.round(w)))].sort(
    (a, b) => a - b,
  );
  return unique.map((w) => `${sirvUrl(src, w, quality)} ${w}w`).join(', ');
}

/** Display-aware candidate widths (covers 1x–2x DPR). */
export const IMAGE_WIDTHS = {
  hero: [480, 720, 960, 1200],
  wide: [640, 960, 1200, 1400],
  half: [400, 640, 800, 1000],
  card: [360, 480, 640, 800],
  portrait: [320, 480, 640, 800],
  blog: [360, 480, 640],
} as const;
