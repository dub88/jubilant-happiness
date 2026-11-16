#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { audit, compareToBaseline, failures, type AuditResult, type FailOn } from './audit.ts';
import { ConfigError, DEFAULT_CONFIG_FILE, loadConfig, resolveSites, type SiteConfig, type SiteSettings } from './config.ts';
import { CrawlError } from './crawl.ts';
import { renderMarkdown, renderText } from './report.ts';
import { packs } from './rules/index.ts';
import { attachSources } from './source.ts';

const HELP = `plumbline — check a site against the plumbline standard

Usage
  plumbline check [url] [options]   Audit a site (or every site in the config)
  plumbline rules                   List the rules

Options
  --baseline <url>          Production URL to compare against. Only problems that
                            production does not already have are reported.
  --canonical-origin <url>  The origin the site calls itself, when auditing a
                            preview without --baseline.
  --src <dir>               Source directory; findings are traced to file:line.
  --fail-on <level>         error | warning | none. Default: warning with a
                            baseline, error without.
  --max-pages <n>           Stop reading new pages after n (default 200).
  --ignore <path>           Drop findings on this path; a trailing * is a prefix.
                            Repeatable.
  --header <"name: value">  Extra request header for the audited site, e.g. a
                            preview-protection bypass token. Repeatable.
  --form <path>             Form endpoint to probe, e.g. /api/contact. Needs the
                            PLUMBLINE_PROBE_SECRET environment variable.
                            Repeatable.
  --all                     With a baseline, also show problems already there.
  --json                    Print the results as JSON.
  --markdown <file>         Also write a Markdown report to this file.
  --config <file>           Config file (default: ${DEFAULT_CONFIG_FILE}).

Exit codes: 0 pass, 1 problems found, 2 the audit could not run.
`;

class UsageError extends Error {}

function parseHeaders(values: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const value of values) {
    const colon = value.indexOf(':');
    if (colon < 1) throw new UsageError(`--header expects "name: value", got "${value}".`);
    headers[value.slice(0, colon).trim()] = value.slice(colon + 1).trim();
  }
  return headers;
}

function parseFailOn(value: string | undefined): FailOn | undefined {
  if (value === undefined) return undefined;
  if (value === 'error' || value === 'warning' || value === 'none') return value;
  throw new UsageError(`--fail-on must be error, warning or none, got "${value}".`);
}

async function auditSite(site: SiteConfig, headers: Record<string, string>, src: string | undefined): Promise<AuditResult> {
  const shared = {
    thresholds: site.thresholds,
    rules: site.rules,
    ignorePaths: site.ignorePaths,
    maxPages: site.maxPages,
    forms: site.forms,
    probeSecret: process.env.PLUMBLINE_PROBE_SECRET,
  };
  let canonicalOrigin = site.canonicalOrigin;
  let baseline: AuditResult | undefined;
  if (site.baseline) {
    // Bypass headers belong to the audited deployment; they are not sent to production.
    baseline = await audit({ ...shared, url: site.baseline });
    canonicalOrigin ??= baseline.crawlOrigin;
  }
  const result = await audit({ ...shared, url: site.url, canonicalOrigin, headers });
  if (baseline) compareToBaseline(result, baseline);
  if (src) await attachSources(result.findings, src);
  return result;
}

async function check(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      baseline: { type: 'string' },
      'canonical-origin': { type: 'string' },
      src: { type: 'string' },
      'fail-on': { type: 'string' },
      'max-pages': { type: 'string' },
      ignore: { type: 'string', multiple: true },
      header: { type: 'string', multiple: true },
      form: { type: 'string', multiple: true },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      markdown: { type: 'string' },
      config: { type: 'string' },
    },
  });
  if (positionals.length > 1) throw new UsageError('Give one URL, or list several sites in the config file.');

  const overrides: SiteSettings = {};
  if (values.baseline) overrides.baseline = values.baseline;
  if (values['canonical-origin']) overrides.canonicalOrigin = values['canonical-origin'];
  if (values.ignore) overrides.ignorePaths = values.ignore;
  if (values.form) overrides.forms = values.form.map((endpoint) => ({ endpoint }));
  const failOn = parseFailOn(values['fail-on']);
  if (failOn) overrides.failOn = failOn;
  if (values['max-pages'] !== undefined) {
    const maxPages = Number(values['max-pages']);
    if (!Number.isInteger(maxPages) || maxPages < 1) throw new UsageError('--max-pages must be a whole number above 0.');
    overrides.maxPages = maxPages;
  }

  const config = await loadConfig(values.config ?? DEFAULT_CONFIG_FILE, values.config !== undefined);
  const sites = resolveSites(config, positionals[0], overrides);
  if (sites.length === 0) throw new UsageError(`Give a URL, or add "url" or "sites" to ${DEFAULT_CONFIG_FILE}.`);
  const headers = parseHeaders(values.header ?? []);

  const results: AuditResult[] = [];
  let failed = false;
  let unreachable = false;
  for (const site of sites) {
    let result: AuditResult;
    try {
      result = await auditSite(site, headers, values.src);
    } catch (error) {
      if (!(error instanceof CrawlError)) throw error;
      // One unreachable site must not hide the results of the others.
      unreachable = true;
      console.error(`${site.name ?? site.url}: ${error.message}`);
      continue;
    }
    results.push(result);
    if (failures(result, site.failOn ?? (site.baseline ? 'warning' : 'error')).length > 0) failed = true;
    if (!values.json) {
      const color = process.stdout.isTTY === true && !process.env.NO_COLOR;
      console.log(`${renderText(result, { color, showExisting: values.all })}\n`);
    }
  }

  if (values.json) console.log(JSON.stringify(results, null, 2));
  if (values.markdown) {
    await writeFile(values.markdown, results.map((result) => renderMarkdown(result, values.all)).join('\n'));
  }
  return unreachable ? 2 : failed ? 1 : 0;
}

function listRules(): number {
  for (const pack of packs) {
    console.log(`${pack.name}`);
    const width = Math.max(...pack.rules.map((rule) => rule.id.length));
    for (const rule of pack.rules) {
      console.log(`  ${rule.id.padEnd(width)}  ${rule.severity.padEnd(7)}  ${rule.summary}`);
    }
  }
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return command ? 0 : 2;
  }
  if (command === 'rules') return listRules();
  if (command === 'check') return check(rest);
  throw new UsageError(`Unknown command "${command}". Run plumbline --help.`);
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const expected =
      error instanceof UsageError ||
      error instanceof ConfigError ||
      (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'));
    console.error(expected ? (error as Error).message : error);
    process.exitCode = 2;
  },
);
