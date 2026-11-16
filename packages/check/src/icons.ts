import { createHash } from 'node:crypto';
import type { Site } from './crawl.ts';
import type { IconResult } from './types.ts';

const MAX_ICONS = 4;

/**
 * SHA-256 of the favicon each framework's starter template ships, taken from
 * the published packages. A site still serving one of these never replaced it.
 */
export const DEFAULT_FAVICONS = new Map<string, string>([
  ['2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932', 'Next.js'], // create-next-app 13 to 15
  ['c28fdd2a4f31e2dc64f653962286da5c82a4cdfc518b242d32812c624e9a19a4', 'Next.js'], // create-next-app 16
  ['4a748afd443918bb16591c834c401dae33e87861ab5dbad0811c3a3b4a9214fb', 'Vite'], // create-vite 4 to 6, vite.svg
  ['61bc9a161de58248288e6905425d7180f0624c2865007b97d763fdac12043a66', 'Vite'], // create-vite 7 and later, favicon.svg
  ['ceeac38434be7a3b4d0f68b8cd8aa2b9ae78c260d6343087c6e095f8031ce4ff', 'Vite'], // create-vite vanilla template
  ['d7d9227f0fe5bfb4189fb6ba4dd9e2d524f6a1dfd02bd901c65330987675c0b3', 'SvelteKit'],
  ['3d10f7da6c603178340081668c4ac5b3ae9743ca9a262ab0fcd312fbb9f48bdd', 'Create React App'],
]);

export interface IconOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Fetch the favicons the home page declares, or /favicon.ico when it declares
 * none, and hash them. Icons on other hosts are taken as present and not fetched.
 */
export async function inspectIcons(site: Site, options: IconOptions = {}): Promise<IconResult[]> {
  const declared = site.page(site.startKey)?.icons ?? [];
  const urls = declared.length > 0 ? [...new Set(declared)].slice(0, MAX_ICONS) : [`${site.crawlOrigin}/favicon.ico`];

  return Promise.all(
    urls.map(async (url): Promise<IconResult> => {
      if (url === 'data:' || site.classify(url) !== 'internal') return { url, status: 200 };
      const key = site.keyOf(url);
      // Report the path alone: frameworks add a build hash to the query, which changes on every deploy.
      const path = new URL(url).pathname;
      try {
        const response = await fetch(site.crawlOrigin + key, {
          headers: { 'user-agent': 'plumbline/0.1 (site audit)', ...options.headers },
          signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
        });
        if (response.status !== 200) {
          await response.body?.cancel();
          return { url: path, status: response.status };
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        // A single-page app answers unknown paths with its HTML shell; that is not an icon.
        if (/html/i.test(response.headers.get('content-type') ?? '')) return { url: path, status: 404 };
        return { url: path, status: 200, sha256: createHash('sha256').update(bytes).digest('hex') };
      } catch {
        return { url: path, status: 0 };
      }
    }),
  );
}
