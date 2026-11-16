import type { Site } from '../crawl.ts';
import type { PageData, Ref, RefKind } from '../types.ts';
import type { Problem, Rule } from './rule.ts';

const length = (text: string): number => [...text].length;

function quote(text: string, max = 70): string {
  const characters = [...text];
  return `"${characters.length > max ? `${characters.slice(0, max).join('')}…` : text}"`;
}

/** The path a URL points at, for any URL on the site or its other host. */
function pathOf(site: Site, url: string): string | undefined {
  return site.classify(url) === 'external' ? undefined : site.keyOf(url);
}

/** Pages that search engines are asked to index under their own URL. */
function contentPages(site: Site): PageData[] {
  return site.pages.filter((page) => {
    if (page.noindex) return false;
    const canonicalPath = page.canonical && pathOf(site, page.canonical.url);
    return !canonicalPath || canonicalPath === page.key;
  });
}

const isRedirect = (status: number): boolean => status >= 300 && status < 400;
const isBroken = (status: number): boolean => status === 0 || status >= 400;
const statusText = (status: number): string => (status === 0 ? 'does not respond' : `returns ${status}`);

const META_KINDS: ReadonlySet<RefKind> = new Set(['canonical', 'og:url', 'og:image', 'twitter:image', 'structured data']);

/** How a message starts for each kind of reference, e.g. "og:image points at /hero.jpg, which …". */
const POINTS_AT: Record<RefKind, string> = {
  link: 'A link points at',
  canonical: 'The canonical link points at',
  'og:url': 'og:url points at',
  'og:image': 'og:image points at',
  'twitter:image': 'twitter:image points at',
  'structured data': 'Structured data points at',
  sitemap: 'The sitemap lists',
  'robots.txt': 'robots.txt lists',
};

function redirectTarget(site: Site, ref: Ref): { status: number; to: string } | undefined {
  const result = site.resultFor(ref.url);
  if (!result || !isRedirect(result.status)) return undefined;
  return { status: result.status, to: result.location ? site.display(result.location) : 'another URL' };
}

function duplicates(site: Site, what: string, pick: (page: PageData) => string | undefined): Problem[] {
  const groups = new Map<string, PageData[]>();
  for (const page of contentPages(site)) {
    const value = pick(page);
    if (value) groups.set(value, [...(groups.get(value) ?? []), page]);
  }
  const problems: Problem[] = [];
  for (const [value, pages] of groups) {
    if (pages.length < 2) continue;
    for (const page of pages) {
      problems.push({
        path: page.key,
        message: `${what} is shared by ${pages.length} pages: ${quote(value)}`,
        fix: `Give each page its own ${what.toLowerCase()}.`,
        needle: value,
      });
    }
  }
  return problems;
}

export const seoRules: Rule[] = [
  {
    id: 'title-missing',
    severity: 'error',
    summary: 'Page has no <title>, or it is empty.',
    check: (site) =>
      contentPages(site)
        .filter((page) => !page.titles[0])
        .map((page) => ({
          path: page.key,
          message: 'Page has no title.',
          fix: 'Add a <title> that names the page and the business.',
        })),
  },
  {
    id: 'title-length',
    severity: 'warning',
    summary: 'Title is longer or shorter than search results display well.',
    check: (site, { titleMin, titleMax }) => {
      const problems: Problem[] = [];
      for (const page of contentPages(site)) {
        const title = page.titles[0];
        if (!title) continue;
        const size = length(title);
        if (size > titleMax) {
          problems.push({
            path: page.key,
            message: `Title is ${size} characters (max ${titleMax}): ${quote(title)}`,
            fix: `Shorten the title to ${titleMax} characters or fewer.`,
            needle: title,
          });
        } else if (size < titleMin) {
          problems.push({
            path: page.key,
            message: `Title is ${size} characters (min ${titleMin}): ${quote(title)}`,
            fix: `Lengthen the title to at least ${titleMin} characters.`,
            needle: title,
          });
        }
      }
      return problems;
    },
  },
  {
    id: 'description-missing',
    severity: 'warning',
    summary: 'Page has no meta description.',
    check: (site) =>
      contentPages(site)
        .filter((page) => !page.description)
        .map((page) => ({
          path: page.key,
          message: 'Page has no meta description.',
          fix: 'Add <meta name="description"> summarising this page.',
        })),
  },
  {
    id: 'description-length',
    severity: 'warning',
    summary: 'Meta description is longer or shorter than search results display well.',
    check: (site, { descriptionMin, descriptionMax }) => {
      const problems: Problem[] = [];
      for (const page of contentPages(site)) {
        const description = page.description;
        if (!description) continue;
        const size = length(description);
        if (size > descriptionMax) {
          problems.push({
            path: page.key,
            message: `Meta description is ${size} characters (max ${descriptionMax}): ${quote(description)}`,
            fix: `Shorten the meta description to ${descriptionMax} characters or fewer.`,
            needle: description,
          });
        } else if (size < descriptionMin) {
          problems.push({
            path: page.key,
            message: `Meta description is ${size} characters (min ${descriptionMin}): ${quote(description)}`,
            fix: `Lengthen the meta description to at least ${descriptionMin} characters.`,
            needle: description,
          });
        }
      }
      return problems;
    },
  },
  {
    id: 'duplicate-title',
    severity: 'warning',
    summary: 'Two or more pages share the same title.',
    check: (site) => duplicates(site, 'Title', (page) => page.titles[0]),
  },
  {
    id: 'duplicate-description',
    severity: 'warning',
    summary: 'Two or more pages share the same meta description.',
    check: (site) => duplicates(site, 'Meta description', (page) => page.description),
  },
  {
    id: 'canonical-missing',
    severity: 'warning',
    summary: 'Page has no canonical link.',
    check: (site) =>
      site.pages
        .filter((page) => !page.noindex && !page.canonical)
        .map((page) => ({
          path: page.key,
          message: 'Page has no canonical link.',
          fix: `Add <link rel="canonical" href="${site.canonicalOrigin}${page.key}">.`,
        })),
  },
  {
    id: 'og-incomplete',
    severity: 'warning',
    summary: 'Open Graph tags are incomplete, so shared links have no proper preview.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const page of contentPages(site)) {
        const missing = ['og:title', 'og:type', 'og:image', 'og:url'].filter((name) => !page.og[name]);
        if (missing.length > 0) {
          problems.push({
            path: page.key,
            message: `Open Graph tags are incomplete: missing ${missing.join(', ')}.`,
            fix: `Add ${missing.map((name) => `<meta property="${name}">`).join(', ')}.`,
            detail: missing.join(','),
          });
        }
      }
      return problems;
    },
  },
  {
    id: 'og-url-mismatch',
    severity: 'warning',
    summary: 'og:url points at a different page than the canonical URL.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const page of contentPages(site)) {
        const ogUrl = page.refs.find((ref) => ref.kind === 'og:url');
        const actual = ogUrl && pathOf(site, ogUrl.url);
        if (!ogUrl || actual === undefined || actual === page.key) continue;
        problems.push({
          path: page.key,
          message: `og:url is ${actual}, but this page is ${page.key}.`,
          fix: "Set og:url to this page's own canonical URL.",
          needle: ogUrl.raw,
        });
      }
      return problems;
    },
  },
  {
    id: 'redirect-link',
    severity: 'warning',
    summary: 'Page links to an internal URL that redirects.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const page of site.pages) {
        for (const ref of page.refs) {
          if (ref.kind !== 'link') continue;
          const redirect = redirectTarget(site, ref);
          if (!redirect) continue;
          const target = site.display(ref.url);
          problems.push({
            path: page.key,
            message: `Links to ${target}, which redirects (${redirect.status}) to ${redirect.to}.`,
            fix: `Link straight to ${redirect.to}.`,
            detail: target,
            needle: ref.raw,
          });
        }
      }
      return problems;
    },
  },
  {
    id: 'broken-link',
    severity: 'error',
    summary: 'Page links to an internal URL that fails.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const page of site.pages) {
        for (const ref of page.refs) {
          const result = ref.kind === 'link' ? site.resultFor(ref.url) : undefined;
          if (!result || !isBroken(result.status)) continue;
          const target = site.display(ref.url);
          problems.push({
            path: page.key,
            message: `Links to ${target}, which ${statusText(result.status)}.`,
            fix: 'Fix the link or remove it.',
            detail: target,
            needle: ref.raw,
          });
        }
      }
      return problems;
    },
  },
  {
    id: 'redirect-reference',
    severity: 'warning',
    summary: 'A canonical, Open Graph, structured-data or robots.txt URL redirects.',
    check: (site) => {
      const problems: Problem[] = [];
      const inspect = (path: string, ref: Ref): void => {
        const redirect = redirectTarget(site, ref);
        if (!redirect) return;
        const target = site.display(ref.url);
        problems.push({
          path,
          message: `${POINTS_AT[ref.kind]} ${target}, which redirects (${redirect.status}) to ${redirect.to}.`,
          fix: `Use ${redirect.to} instead.`,
          detail: `${ref.kind}|${target}`,
          needle: ref.raw,
        });
      };
      for (const page of site.pages) {
        for (const ref of page.refs) if (META_KINDS.has(ref.kind)) inspect(page.key, ref);
      }
      for (const ref of site.sitemapRefs) if (ref.kind === 'robots.txt') inspect('/robots.txt', ref);
      return problems;
    },
  },
  {
    id: 'broken-reference',
    severity: 'error',
    summary: 'A canonical, Open Graph, structured-data or robots.txt URL fails.',
    check: (site) => {
      const problems: Problem[] = [];
      const inspect = (path: string, ref: Ref): void => {
        const result = site.resultFor(ref.url);
        if (!result || !isBroken(result.status)) return;
        const target = site.display(ref.url);
        problems.push({
          path,
          message: `${POINTS_AT[ref.kind]} ${target}, which ${statusText(result.status)}.`,
          fix: 'Point it at a URL that loads.',
          detail: `${ref.kind}|${target}`,
          needle: ref.raw,
        });
      };
      for (const page of site.pages) {
        for (const ref of page.refs) if (META_KINDS.has(ref.kind)) inspect(page.key, ref);
      }
      for (const ref of site.sitemapRefs) if (ref.kind === 'robots.txt') inspect('/robots.txt', ref);
      return problems;
    },
  },
  {
    id: 'host-variant',
    severity: 'warning',
    summary: "A URL uses the site's other host or scheme (www vs bare, http vs https) and will redirect.",
    check: (site) => {
      const canonicalHost = new URL(site.canonicalOrigin).host;
      const problems: Problem[] = [];
      const inspect = (path: string, ref: Ref): void => {
        if (site.classify(ref.url) !== 'variant') return;
        problems.push({
          path,
          message: `${POINTS_AT[ref.kind]} ${ref.url}, which is not on the site's host, ${canonicalHost}.`,
          fix: `Use ${site.canonicalOrigin}${site.keyOf(ref.url)}.`,
          detail: `${ref.kind}|${ref.url}`,
          needle: ref.raw,
        });
      };
      for (const page of site.pages) for (const ref of page.refs) inspect(page.key, ref);
      for (const ref of site.sitemapRefs) inspect(ref.kind === 'sitemap' ? '/sitemap.xml' : '/robots.txt', ref);
      return problems;
    },
  },
  {
    id: 'sitemap-missing',
    severity: 'warning',
    summary: 'No XML sitemap was found.',
    check: (site) =>
      site.sitemapFound
        ? []
        : [
            {
              path: '/sitemap.xml',
              message: 'No XML sitemap was found at /sitemap.xml or listed in robots.txt.',
              fix: 'Publish a sitemap.xml that lists every page you want indexed.',
            },
          ],
  },
  {
    id: 'sitemap-redirect',
    severity: 'warning',
    summary: 'The sitemap lists a URL that redirects.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const ref of site.sitemapRefs) {
        const redirect = ref.kind === 'sitemap' ? redirectTarget(site, ref) : undefined;
        if (!redirect) continue;
        const target = site.display(ref.url);
        problems.push({
          path: '/sitemap.xml',
          message: `Sitemap lists ${target}, which redirects (${redirect.status}) to ${redirect.to}.`,
          fix: `List ${redirect.to} instead.`,
          detail: target,
          needle: ref.raw,
        });
      }
      return problems;
    },
  },
  {
    id: 'sitemap-broken',
    severity: 'error',
    summary: 'The sitemap lists a URL that fails.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const ref of site.sitemapRefs) {
        const result = ref.kind === 'sitemap' ? site.resultFor(ref.url) : undefined;
        if (!result || !isBroken(result.status)) continue;
        const target = site.display(ref.url);
        problems.push({
          path: '/sitemap.xml',
          message: `Sitemap lists ${target}, which ${statusText(result.status)}.`,
          fix: 'Remove it from the sitemap or restore the page.',
          detail: target,
          needle: ref.raw,
        });
      }
      return problems;
    },
  },
  {
    id: 'sitemap-noindex',
    severity: 'error',
    summary: 'The sitemap lists a page that is marked noindex.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const ref of site.sitemapRefs) {
        if (ref.kind !== 'sitemap' || site.classify(ref.url) !== 'internal') continue;
        const page = site.page(site.keyOf(ref.url));
        if (!page?.noindex) continue;
        problems.push({
          path: '/sitemap.xml',
          message: `Sitemap lists ${page.key}, which is marked noindex.`,
          fix: 'Remove it from the sitemap, or remove the noindex.',
          detail: page.key,
          needle: ref.raw,
        });
      }
      return problems;
    },
  },
  {
    id: 'robots-missing',
    severity: 'warning',
    summary: 'No robots.txt was found.',
    check: (site) =>
      site.robotsFound
        ? []
        : [
            {
              path: '/robots.txt',
              message: 'No robots.txt was found.',
              fix: 'Publish a robots.txt with a Sitemap line.',
            },
          ],
  },
  {
    id: 'structured-data-missing',
    severity: 'warning',
    summary: 'The home page has no JSON-LD structured data describing the business.',
    check: (site) => {
      const home = site.page(site.startKey);
      if (!home || home.noindex || home.jsonld.length > 0) return [];
      return [
        {
          path: home.key,
          message: 'The home page has no JSON-LD structured data.',
          fix: 'Add a JSON-LD block (LocalBusiness or a more specific type) with the name, address and phone shown on the site.',
        },
      ];
    },
  },
  {
    id: 'structured-data-invalid',
    severity: 'error',
    summary: 'A JSON-LD block is not valid JSON.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const page of site.pages) {
        page.jsonld.forEach((block, index) => {
          if (!block.error) return;
          problems.push({
            path: page.key,
            message: `JSON-LD block ${index + 1} is not valid JSON: ${block.error}`,
            fix: 'Fix the JSON so search engines can read it.',
            detail: String(index),
          });
        });
      }
      return problems;
    },
  },
  {
    id: 'h1-missing',
    severity: 'warning',
    summary: 'Page has no <h1>.',
    check: (site) =>
      contentPages(site)
        .filter((page) => page.h1.every((text) => !text))
        .map((page) => ({
          path: page.key,
          message: 'Page has no h1 heading.',
          fix: 'Add one <h1> that states what the page is about.',
        })),
  },
  {
    id: 'h1-multiple',
    severity: 'warning',
    summary: 'Page has more than one <h1>.',
    check: (site) =>
      contentPages(site)
        .filter((page) => page.h1.filter(Boolean).length > 1)
        .map((page) => ({
          path: page.key,
          message: `Page has ${page.h1.filter(Boolean).length} h1 headings.`,
          fix: 'Keep one <h1> and demote the others to <h2>.',
        })),
  },
  {
    id: 'lang-missing',
    severity: 'warning',
    summary: 'The <html> element has no lang attribute.',
    check: (site) =>
      site.pages
        .filter((page) => !page.lang)
        .map((page) => ({
          path: page.key,
          message: 'The <html> element has no lang attribute.',
          fix: 'Add lang, e.g. <html lang="en">.',
        })),
  },
  {
    id: 'image-alt-missing',
    severity: 'warning',
    summary: 'An image has no alt attribute.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const page of site.pages) {
        for (const src of new Set(page.imagesMissingAlt)) {
          problems.push({
            path: page.key,
            message: `Image has no alt attribute: ${src.length > 90 ? `${src.slice(0, 90)}…` : src}`,
            fix: 'Describe the image in alt, or use alt="" if it is decorative.',
            detail: src,
            needle: src,
          });
        }
      }
      return problems;
    },
  },
];
