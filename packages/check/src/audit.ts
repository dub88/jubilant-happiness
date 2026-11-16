import { crawl, type CrawlOptions } from './crawl.ts';
import { probeForms } from './probe.ts';
import { packs } from './rules/index.ts';
import { DEFAULT_THRESHOLDS, type Finding, type FormTarget, type Severity, type Thresholds } from './types.ts';

export type RuleSetting = 'off' | Severity;

export interface AuditOptions extends CrawlOptions {
  thresholds?: Partial<Thresholds>;
  /** Turn a rule off or change its severity, by rule id. */
  rules?: Record<string, RuleSetting>;
  /** Paths whose findings are dropped. A trailing * matches any path with that prefix. */
  ignorePaths?: string[];
  /** Form endpoints whose spam defences should be probed. */
  forms?: FormTarget[];
  /** The secret the site's form guard was given; without it forms are not probed. */
  probeSecret?: string;
}

export interface AuditResult {
  url: string;
  /** The origin requests were sent to, after following redirects from the start URL. */
  crawlOrigin: string;
  canonicalOrigin: string;
  pagesCrawled: number;
  truncated: boolean;
  durationMs: number;
  findings: Finding[];
  /** The production URL the findings were compared with, when one was given. */
  baselineUrl?: string;
}

function ignored(path: string, patterns: string[]): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern,
  );
}

export async function audit(options: AuditOptions): Promise<AuditResult> {
  const started = Date.now();
  const forms = options.forms ?? [];
  const formPages = forms.flatMap((form) => (form.page ? [form.page] : []));
  const site = await crawl({ ...options, extraPaths: [...(options.extraPaths ?? []), ...formPages] });
  if (forms.length > 0) {
    const probe: Parameters<typeof probeForms>[1] = { forms };
    if (options.probeSecret) probe.secret = options.probeSecret;
    if (options.headers) probe.headers = options.headers;
    if (options.timeoutMs) probe.timeoutMs = options.timeoutMs;
    site.formProbes = await probeForms(site, probe);
  }
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const ignorePaths = options.ignorePaths ?? [];

  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const rule of pack.rules) {
      const setting = options.rules?.[rule.id] ?? rule.severity;
      if (setting === 'off') continue;
      for (const { detail, ...problem } of rule.check(site, thresholds)) {
        if (ignored(problem.path, ignorePaths)) continue;
        const key = `${rule.id}|${problem.path}|${detail ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ rule: rule.id, pack: pack.name, severity: setting, key, ...problem });
      }
    }
  }
  findings.sort(
    (a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message),
  );

  return {
    url: options.url,
    crawlOrigin: site.crawlOrigin,
    canonicalOrigin: site.canonicalOrigin,
    pagesCrawled: site.pages.length,
    truncated: site.truncated,
    durationMs: Date.now() - started,
    findings,
  };
}

/** Mark each finding as new, or as one the baseline (production) already has. */
export function compareToBaseline(result: AuditResult, baseline: AuditResult): void {
  const existing = new Set(baseline.findings.map((finding) => finding.key));
  for (const finding of result.findings) finding.isNew = !existing.has(finding.key);
  result.baselineUrl = baseline.url;
}

export type FailOn = Severity | 'none';

/** The findings that should fail the run: new ones (when compared) at or above the threshold. */
export function failures(result: AuditResult, failOn: FailOn): Finding[] {
  if (failOn === 'none') return [];
  return result.findings.filter(
    (finding) => finding.isNew !== false && (failOn === 'warning' || finding.severity === 'error'),
  );
}
