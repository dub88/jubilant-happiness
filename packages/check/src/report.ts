import type { AuditResult } from './audit.ts';
import type { Finding, Severity } from './types.ts';

/** Findings with the same rule and message, collapsed across the pages they appear on. */
interface Group {
  rule: string;
  severity: Severity;
  message: string;
  fix: string;
  paths: string[];
  sources: string[];
}

function group(findings: Finding[]): Group[] {
  const groups = new Map<string, Group>();
  for (const finding of findings) {
    const id = `${finding.rule}\n${finding.message}`;
    let entry = groups.get(id);
    if (!entry) {
      entry = { rule: finding.rule, severity: finding.severity, message: finding.message, fix: finding.fix, paths: [], sources: [] };
      groups.set(id, entry);
    }
    if (!entry.paths.includes(finding.path)) entry.paths.push(finding.path);
    for (const source of finding.sources ?? []) {
      if (!entry.sources.includes(source)) entry.sources.push(source);
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(b.severity === 'error') - Number(a.severity === 'error') ||
      a.rule.localeCompare(b.rule) ||
      a.message.localeCompare(b.message),
  );
}

function listPaths(paths: string[], max: number): string {
  const shown = paths.slice(0, max).join(', ');
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** The findings a report shows: only new ones when a baseline was compared, unless asked for all. */
function visible(result: AuditResult, showExisting: boolean): Finding[] {
  return showExisting ? result.findings : result.findings.filter((finding) => finding.isNew !== false);
}

function counts(findings: Finding[]): string {
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  return `${plural(errors, 'error')}, ${plural(findings.length - errors, 'warning')}`;
}

function baselineLine(result: AuditResult): string | undefined {
  if (!result.baselineUrl) return undefined;
  const existing = result.findings.filter((finding) => finding.isNew === false).length;
  return `Compared with ${result.baselineUrl}: ${plural(result.findings.length - existing, 'new problem')}, ${existing} already there.`;
}

export interface TextOptions {
  color: boolean;
  showExisting: boolean;
}

export function renderText(result: AuditResult, options: TextOptions): string {
  const paint = (code: number, text: string): string => (options.color ? `\x1b[${code}m${text}\x1b[0m` : text);
  const dim = (text: string): string => paint(2, text);
  const lines: string[] = [];

  const seconds = (result.durationMs / 1000).toFixed(1);
  lines.push(`${paint(1, result.crawlOrigin)} ${dim(`· ${plural(result.pagesCrawled, 'page')} in ${seconds}s`)}`);
  if (result.crawlOrigin !== result.canonicalOrigin) lines.push(dim(`Audited as a preview of ${result.canonicalOrigin}.`));
  const compared = baselineLine(result);
  if (compared) lines.push(dim(compared));
  if (result.truncated) lines.push(paint(33, 'The page limit was reached, so some pages were not read. Raise --max-pages.'));
  lines.push('');

  const shown = visible(result, options.showExisting);
  for (const entry of group(shown)) {
    const label = entry.severity === 'error' ? paint(31, 'error  ') : paint(33, 'warning');
    lines.push(`${label}  ${paint(1, entry.rule)}  ${entry.message}`);
    lines.push(dim(`         on   ${listPaths(entry.paths, 6)}`));
    lines.push(dim(`         fix  ${entry.fix}`));
    if (entry.sources.length > 0) lines.push(dim(`         in   ${listPaths(entry.sources, 6)}`));
    lines.push('');
  }

  if (shown.length === 0) {
    lines.push(paint(32, result.baselineUrl ? 'No new problems.' : 'No problems found.'));
  } else {
    lines.push(`${counts(shown)}${result.baselineUrl && !options.showExisting ? ' (new)' : ''}.`);
  }
  return lines.join('\n');
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(result: AuditResult, showExisting: boolean): string {
  const shown = visible(result, showExisting);
  const lines: string[] = [];
  const heading = shown.length === 0 ? 'no problems' : counts(shown);
  lines.push(`### plumbline: ${heading}${result.baselineUrl && !showExisting ? ' introduced' : ''}`);
  lines.push('');
  lines.push(`Checked ${plural(result.pagesCrawled, 'page')} on ${result.crawlOrigin}.`);
  const compared = baselineLine(result);
  if (compared) lines.push(compared);
  if (result.truncated) lines.push('The page limit was reached, so some pages were not read.');
  if (shown.length === 0) return `${lines.join('\n')}\n`;

  lines.push('');
  lines.push('| | Rule | Problem | Pages | Fix | Source |');
  lines.push('|---|---|---|---|---|---|');
  for (const entry of group(shown)) {
    lines.push(
      `| ${entry.severity} | \`${entry.rule}\` | ${cell(entry.message)} | ${cell(listPaths(entry.paths, 4))} | ${cell(entry.fix)} | ${cell(listPaths(entry.sources, 6))} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
