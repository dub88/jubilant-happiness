export type Severity = 'error' | 'warning';

/** How a URL relates to the site being audited. */
export type UrlClass =
  /** On the site: either the origin being crawled or the origin the site calls itself. */
  | 'internal'
  /** The same site under its other host or scheme (www vs bare, http vs https). */
  | 'variant'
  | 'external';

export interface FetchResult {
  url: string;
  /** HTTP status, or 0 when the request failed before a response arrived. */
  status: number;
  /** Absolute redirect target, for 3xx responses. */
  location?: string;
  contentType: string;
  xRobotsTag?: string;
  /** Only read for 200 responses that are HTML, XML or plain text. */
  body?: string;
  error?: string;
}

export type RefKind =
  | 'link'
  | 'canonical'
  | 'og:url'
  | 'og:image'
  | 'twitter:image'
  | 'structured data'
  | 'sitemap'
  | 'robots.txt';

/** A URL a page (or the sitemap, or robots.txt) points at. */
export interface Ref {
  kind: RefKind;
  /** The value as written in the source. */
  raw: string;
  /** The value resolved to an absolute URL, without a fragment. */
  url: string;
}

export interface JsonLdBlock {
  raw: string;
  data?: unknown;
  error?: string;
}

export interface PageData {
  /** Path plus query string: the page's identity on the site. */
  key: string;
  titles: string[];
  description?: string;
  noindex: boolean;
  canonical?: Ref;
  og: Record<string, string>;
  twitter: Record<string, string>;
  h1: string[];
  lang?: string;
  jsonld: JsonLdBlock[];
  imagesMissingAlt: string[];
  /** Names of the form controls on the page. */
  inputNames: string[];
  /** The text a visitor reads: the body without scripts, styles, inline SVG or code samples. Block elements end a line. */
  text: string;
  images: { src: string; alt?: string }[];
  /** The text of each link that goes nowhere (href="#", empty, or a javascript: URL). */
  deadLinks: string[];
  /** Favicon URLs the page declares. A data: URI is recorded as "data:". */
  icons: string[];
  /** Emoji that stand alone in an element or open a heading, in page order. */
  emojiIcons: string[];
  refs: Ref[];
}

/** A favicon the site declares (or /favicon.ico), and what fetching it found. */
export interface IconResult {
  url: string;
  status: number;
  sha256?: string;
}

/** A form endpoint to probe, and optionally the page that shows the form. */
export interface FormTarget {
  endpoint: string;
  page?: string;
}

/** The submissions a probe sends. Only "genuine" should get through. */
export type ProbeScenario = 'genuine' | 'cross-site' | 'no-origin' | 'no-timer' | 'too-fast' | 'honeypot' | 'spam-content';

export interface ProbeAnswer {
  outcome: 'accept' | 'flag' | 'block';
  reason?: string;
  flags: string[];
}

export interface FormProbe extends FormTarget {
  /** answered: the endpoint speaks the probe protocol. Otherwise nothing could be verified. */
  status: 'answered' | 'no-secret' | 'unanswered';
  /** Why the endpoint did not answer. */
  detail?: string;
  honeypotField?: string;
  /** The fields the guard scans for spam text, as it reports them. */
  messageFields?: string[];
  answers: Partial<Record<ProbeScenario, ProbeAnswer>>;
}

export interface Finding {
  rule: string;
  pack: string;
  severity: Severity;
  /** The page (or file such as /sitemap.xml) the problem is on. */
  path: string;
  message: string;
  fix: string;
  /** Stable identity used to tell a new finding from one the baseline already has. */
  key: string;
  /** Literal text from the page that produced the finding; used to locate the source file. */
  needle?: string;
  /** Source locations (file:line) that contain the needle. */
  sources?: string[];
  /** Set when a baseline was given: false means production already has this problem. */
  isNew?: boolean;
}

export interface Thresholds {
  titleMin: number;
  titleMax: number;
  descriptionMin: number;
  descriptionMax: number;
  /** How many different stock marketing phrases a page may use before it is reported. */
  stockPhrases: number;
}

/**
 * Chosen to agree with what a commercial site audit did and did not flag on
 * real sites: titles of 68 characters passed and 72 failed; descriptions of
 * 81 and 173 characters failed and 103 passed.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  titleMin: 20,
  titleMax: 70,
  descriptionMin: 100,
  descriptionMax: 160,
  stockPhrases: 3,
};
