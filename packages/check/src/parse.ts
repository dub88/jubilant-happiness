import { parse, type HTMLElement } from 'node-html-parser';
import type { JsonLdBlock, PageData, Ref, RefKind } from './types.ts';

const SKIPPED_SCHEMES = /^(mailto|tel|sms|javascript|data|blob|about):/i;

function clean(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function insideSvg(element: HTMLElement): boolean {
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.rawTagName?.toLowerCase() === 'svg') return true;
  }
  return false;
}

function resolve(raw: string, base: string): string | undefined {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

/** Every http(s) URL that appears as a string value anywhere in a JSON-LD block. */
function urlsInJsonLd(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) urlsInJsonLd(item, found);
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) {
      if (name !== '@context') urlsInJsonLd(item, found);
    }
  }
  return found;
}

/**
 * Extract what the rules need from one HTML page.
 *
 * Metadata is read from the whole document, not only <head>: some frameworks
 * stream <title> and <meta> tags into the body for dynamically rendered pages.
 */
export function parsePage(key: string, pageUrl: string, html: string, headerNoindex: boolean): PageData {
  const root = parse(html);
  const base = resolve(root.querySelector('base[href]')?.getAttribute('href') ?? '', pageUrl) ?? pageUrl;

  const refs: Ref[] = [];
  const addRef = (kind: RefKind, raw: string | undefined): Ref | undefined => {
    const value = raw?.trim();
    if (!value) return undefined;
    const url = resolve(value, base);
    if (!url) return undefined;
    const ref: Ref = { kind, raw: value, url };
    refs.push(ref);
    return ref;
  };

  const meta = new Map<string, string>();
  for (const element of root.querySelectorAll('meta')) {
    const name = (element.getAttribute('property') ?? element.getAttribute('name'))?.trim().toLowerCase();
    const content = element.getAttribute('content');
    if (name && content !== undefined && !meta.has(name)) meta.set(name, clean(content));
  }

  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  for (const [name, content] of meta) {
    if (name.startsWith('og:')) og[name] = content;
    if (name.startsWith('twitter:')) twitter[name] = content;
  }

  const canonicalElement = root
    .querySelectorAll('link[rel]')
    .find((element) => /(^|\s)canonical(\s|$)/i.test(element.getAttribute('rel') ?? ''));
  const canonical = addRef('canonical', canonicalElement?.getAttribute('href'));
  addRef('og:url', og['og:url']);
  addRef('og:image', og['og:image']);
  addRef('twitter:image', twitter['twitter:image']);

  const seenLinks = new Set<string>();
  for (const element of root.querySelectorAll('a[href]')) {
    const href = element.getAttribute('href')?.trim();
    if (!href || href.startsWith('#') || SKIPPED_SCHEMES.test(href) || seenLinks.has(href)) continue;
    seenLinks.add(href);
    addRef('link', href);
  }

  const jsonld: JsonLdBlock[] = [];
  for (const element of root.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = element.rawText.trim();
    if (!raw) continue;
    try {
      const data: unknown = JSON.parse(raw);
      jsonld.push({ raw, data });
      for (const url of new Set(urlsInJsonLd(data))) addRef('structured data', url);
    } catch (error) {
      jsonld.push({ raw, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const imagesMissingAlt: string[] = [];
  for (const element of root.querySelectorAll('img')) {
    const decorative =
      element.getAttribute('aria-hidden') === 'true' ||
      /^(presentation|none)$/i.test(element.getAttribute('role') ?? '');
    if (element.getAttribute('alt') === undefined && !decorative) {
      imagesMissingAlt.push(element.getAttribute('src') ?? '(no src)');
    }
  }

  const robots = `${meta.get('robots') ?? ''},${meta.get('googlebot') ?? ''}`.toLowerCase();
  const lang = clean(root.querySelector('html')?.getAttribute('lang'));

  const page: PageData = {
    key,
    titles: root
      .querySelectorAll('title')
      .filter((element) => !insideSvg(element))
      .map((element) => clean(element.text)),
    noindex: headerNoindex || /\b(noindex|none)\b/.test(robots),
    og,
    twitter,
    h1: root.querySelectorAll('h1').map((element) => clean(element.text)),
    jsonld,
    imagesMissingAlt,
    inputNames: root
      .querySelectorAll('input, textarea, select')
      .map((element) => element.getAttribute('name') ?? '')
      .filter(Boolean),
    refs,
  };
  const description = meta.get('description');
  if (description !== undefined) page.description = description;
  if (canonical) page.canonical = canonical;
  if (lang) page.lang = lang;
  return page;
}
