import { FeedFormatError } from './ics';
import type { OfficialUpdate, UpdateFeed } from './types';

/**
 * Official update feeds (RSS 2.0 / RSS 1.0 (RDF) / Atom): the BLS "latest releases" feed and
 * the Federal Reserve monetary-policy press releases. Each item is stored exactly as the
 * source published it — title, link and publication time — so a trader can see that a
 * release went out and open it. Prop Guard never reads numbers, forecasts or conclusions
 * out of these items.
 */
export const BLS_LATEST_RSS = 'https://www.bls.gov/feed/bls_latest.rss';
export const FED_MONETARY_RSS = 'https://www.federalreserve.gov/feeds/press_monetary.xml';

const decode = (v: string) =>
  v
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(block);
    if (m && decode(m[1])) return decode(m[1]);
  }
  return null;
}

/** RFC 822 ("Wed, 14 Oct 2026 12:30:00 GMT" / "-0400") or ISO 8601 → ISO UTC; null when unreadable. */
export function feedDate(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw.trim().replace(/\s+(EST|EDT)$/i, (_, z: string) => (z.toUpperCase() === 'EST' ? ' -0500' : ' -0400')));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseUpdateFeed(xml: string, feed: UpdateFeed, retrievedAt: string): OfficialUpdate[] {
  if (!/<(rss|rdf:RDF|feed)[\s>]/i.test(xml)) throw new FeedFormatError('not an RSS or Atom feed');
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  const out = new Map<string, OfficialUpdate>();
  for (const b of blocks) {
    const title = tag(b, ['title']);
    const atomLink = /<link[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? null;
    const link = tag(b, ['link']) ?? atomLink;
    const guid = tag(b, ['guid', 'id']) ?? link;
    const publishedAt = feedDate(tag(b, ['pubDate', 'dc:date', 'published', 'updated']));
    if (!title || !link || !guid || !/^https:\/\//i.test(link)) continue;
    const id = `${feed}:${guid}`.slice(0, 300);
    if (!out.has(id)) out.set(id, { id, feed, title, link, publishedAt, retrievedAt });
  }
  if (!out.size) throw new FeedFormatError('no items found in the feed');
  return [...out.values()].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}
