import { Fetcher } from './fetch.ts';
import { parsePage } from './parse.ts';
import type { FetchResult, PageData, Ref, UrlClass } from './types.ts';

export interface CrawlOptions {
  /** Where to start. Redirects from this URL are followed to find the site's real origin. */
  url: string;
  /**
   * The origin the site calls itself in canonicals, sitemaps and Open Graph tags.
   * Set this when crawling a preview deployment; defaults to the crawled origin.
   */
  canonicalOrigin?: string;
  maxPages?: number;
  headers?: Record<string, string>;
  concurrency?: number;
  timeoutMs?: number;
}

export class CrawlError extends Error {}

const bareHost = (host: string): string => host.replace(/^www\./i, '');

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)].map((match) => decodeXml(match[1] ?? ''));
}

/** Everything the crawl learned about a site; the rules read from this. */
export class Site {
  /** The origin requests were sent to. */
  readonly crawlOrigin: string;
  /** The origin the site calls itself. Differs from crawlOrigin for a preview deployment. */
  readonly canonicalOrigin: string;
  readonly startKey: string;
  readonly pages: PageData[] = [];
  readonly results = new Map<string, FetchResult>();
  /** URLs listed in sitemaps and on robots.txt Sitemap lines. */
  readonly sitemapRefs: Ref[] = [];
  robotsFound = false;
  sitemapFound = false;
  /** True when the page limit stopped the crawl before every page was read. */
  truncated = false;

  constructor(crawlOrigin: string, canonicalOrigin: string, startKey: string) {
    this.crawlOrigin = crawlOrigin;
    this.canonicalOrigin = canonicalOrigin;
    this.startKey = startKey;
  }

  get isPreview(): boolean {
    return this.crawlOrigin !== this.canonicalOrigin;
  }

  classify(url: string): UrlClass {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'external';
    }
    if (parsed.origin === this.crawlOrigin || parsed.origin === this.canonicalOrigin) return 'internal';
    const canonical = new URL(this.canonicalOrigin);
    return bareHost(parsed.host) === bareHost(canonical.host) ? 'variant' : 'external';
  }

  keyOf(url: string): string {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  }

  /** The fetch result for an internal URL, if it was requested. */
  resultFor(url: string): FetchResult | undefined {
    return this.classify(url) === 'internal' ? this.results.get(this.keyOf(url)) : undefined;
  }

  page(key: string): PageData | undefined {
    return this.pages.find((page) => page.key === key);
  }

  /** How a URL should be shown in a message: a path when it is on the site. */
  display(url: string): string {
    return this.classify(url) === 'internal' ? this.keyOf(url) : url;
  }
}

async function resolveStart(fetcher: Fetcher, start: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(start);
  } catch {
    throw new CrawlError(`"${start}" is not a valid URL.`);
  }
  for (let hop = 0; hop < 5; hop++) {
    const result = await fetcher.get(url.href);
    if (result.status >= 300 && result.status < 400 && result.location) {
      url = new URL(result.location);
      continue;
    }
    if (result.status === 200) return url;
    if (result.status === 401 || result.status === 403) {
      throw new CrawlError(
        `${url.href} answered ${result.status}. If this is a protected preview deployment, ` +
          `pass its bypass token with --header "name: value".`,
      );
    }
    throw new CrawlError(
      result.status === 0
        ? `Could not reach ${url.href}: ${result.error ?? 'request failed'}.`
        : `${url.href} answered ${result.status}.`,
    );
  }
  throw new CrawlError(`${start} redirects more than five times.`);
}

export async function crawl(options: CrawlOptions): Promise<Site> {
  const fetcher = new Fetcher(options);
  const maxPages = options.maxPages ?? 200;

  const start = await resolveStart(fetcher, options.url);
  const canonicalOrigin = options.canonicalOrigin ? new URL(options.canonicalOrigin).origin : start.origin;
  const site = new Site(start.origin, canonicalOrigin, start.pathname + start.search);

  const seen = new Set<string>();
  let queue: string[] = [];
  const enqueue = (url: string): void => {
    if (site.classify(url) !== 'internal') return;
    const key = site.keyOf(url);
    if (!seen.has(key)) {
      seen.add(key);
      queue.push(key);
    }
  };

  let parsedPages = 0;
  const visit = async (key: string): Promise<void> => {
    const result = await fetcher.get(site.crawlOrigin + key);
    site.results.set(key, result);
    if (result.location) enqueue(result.location);
    if (result.status !== 200 || result.body === undefined || !/html/i.test(result.contentType)) return;
    if (parsedPages >= maxPages) {
      site.truncated = true;
      return;
    }
    parsedPages++;
    // A preview host is usually served with a noindex header that production does not have.
    const headerNoindex = !site.isPreview && /\b(noindex|none)\b/i.test(result.xRobotsTag ?? '');
    const page = parsePage(key, site.crawlOrigin + key, result.body, headerNoindex);
    site.pages.push(page);
    for (const ref of page.refs) enqueue(ref.url);
  };

  enqueue(site.crawlOrigin + site.startKey);
  await readRobotsAndSitemaps(site, fetcher, enqueue);

  while (queue.length > 0) {
    const batch = queue;
    queue = [];
    await Promise.all(batch.map(visit));
  }

  site.pages.sort((a, b) => a.key.localeCompare(b.key));
  return site;
}

async function readRobotsAndSitemaps(site: Site, fetcher: Fetcher, enqueue: (url: string) => void): Promise<void> {
  const fetchKey = async (key: string): Promise<FetchResult> => {
    const result = await fetcher.get(site.crawlOrigin + key);
    site.results.set(key, result);
    return result;
  };
  const isText = (result: FetchResult): boolean =>
    result.status === 200 && result.body !== undefined && !/html/i.test(result.contentType);

  const sitemapKeys: string[] = [];
  const robots = await fetchKey('/robots.txt');
  if (isText(robots)) {
    site.robotsFound = true;
    for (const match of robots.body!.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      const raw = match[1]!;
      let url: string;
      try {
        url = new URL(raw, site.canonicalOrigin).href;
      } catch {
        continue;
      }
      site.sitemapRefs.push({ kind: 'robots.txt', raw, url });
      // A sitemap listed under the site's other host is still worth reading.
      if (site.classify(url) !== 'external') sitemapKeys.push(site.keyOf(url));
    }
  }
  if (sitemapKeys.length === 0) sitemapKeys.push('/sitemap.xml');

  const read = new Set<string>();
  const readSitemap = async (key: string, depth: number): Promise<void> => {
    if (read.has(key)) return;
    read.add(key);
    let result = await fetchKey(key);
    if (result.location && site.classify(result.location) === 'internal') {
      result = await fetchKey(site.keyOf(result.location));
    }
    if (!isText(result)) return;
    site.sitemapFound = true;
    const body = result.body!;
    const isIndex = /<sitemapindex\b/i.test(body);
    for (const raw of locs(body)) {
      let url: string;
      try {
        url = new URL(raw).href;
      } catch {
        continue;
      }
      if (isIndex) {
        if (depth < 2 && site.classify(url) === 'internal') await readSitemap(site.keyOf(url), depth + 1);
        continue;
      }
      site.sitemapRefs.push({ kind: 'sitemap', raw, url });
      enqueue(url);
    }
  };
  for (const key of sitemapKeys) await readSitemap(key, 0);
}
