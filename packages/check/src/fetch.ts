import type { FetchResult } from './types.ts';

const USER_AGENT = 'plumbline/0.1 (site audit)';
const MAX_BODY_BYTES = 5_000_000;
const RETRY_STATUSES = new Set([0, 502, 503, 504]);

export interface FetcherOptions {
  /** Extra request headers, e.g. a deployment-protection bypass token. */
  headers?: Record<string, string>;
  concurrency?: number;
  timeoutMs?: number;
}

/** Fetches each URL at most once, never follows redirects, and limits concurrency. */
export class Fetcher {
  private readonly cache = new Map<string, Promise<FetchResult>>();
  private readonly waiting: (() => void)[] = [];
  private readonly headers: Record<string, string>;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private active = 0;

  constructor(options: FetcherOptions = {}) {
    this.headers = options.headers ?? {};
    this.concurrency = options.concurrency ?? 6;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  get(url: string): Promise<FetchResult> {
    let pending = this.cache.get(url);
    if (!pending) {
      pending = this.limited(url);
      this.cache.set(url, pending);
    }
    return pending;
  }

  private async limited(url: string): Promise<FetchResult> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      const first = await this.request(url);
      return RETRY_STATUSES.has(first.status) ? await this.request(url) : first;
    } finally {
      const next = this.waiting.shift();
      // Hand the slot straight to the next waiter, or free it.
      if (next) next();
      else this.active--;
    }
  }

  private async request(url: string): Promise<FetchResult> {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...this.headers,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const contentType = response.headers.get('content-type') ?? '';
      const result: FetchResult = { url, status: response.status, contentType };
      const xRobotsTag = response.headers.get('x-robots-tag');
      if (xRobotsTag) result.xRobotsTag = xRobotsTag;

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location) result.location = new URL(location, url).href;
      }
      if (response.status === 200 && /html|xml|text\/plain/i.test(contentType)) {
        const text = await response.text();
        result.body = text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text;
      } else {
        await response.body?.cancel();
      }
      return result;
    } catch (error) {
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      const message = cause instanceof Error ? cause.message : String(cause);
      return { url, status: 0, contentType: '', error: message };
    }
  }
}
