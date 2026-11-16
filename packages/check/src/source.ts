import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import type { Finding } from './types.ts';

const SKIPPED_DIRS = new Set([
  'node_modules', '.git', '.next', '.vercel', '.astro', '.turbo', '.cache', 'dist', 'build', 'out', 'coverage',
]);
const SOURCE_FILE = /\.(html?|[cm]?[jt]sx?|astro|vue|svelte|mdx?|json|xml|txt|ya?ml|njk|liquid|php)$/i;
const SKIPPED_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const PROSE_FILE = /\.(mdx?|txt)$/i;
const ROUTE_ROOTS = new Set(['.', 'src', 'app', 'pages', 'public']);
const MAX_FILE_BYTES = 512_000;
const MAX_FILES = 5_000;
const MAX_MATCHES_PER_NEEDLE = 40;
const MAX_SOURCES = 3;

interface Match {
  /** Path relative to the source root, with forward slashes. */
  file: string;
  line: number;
  /** The text appears as a whole attribute value, string literal or element body. */
  exact: boolean;
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= MAX_FILES) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(path);
      } else if (entry.isFile() && SOURCE_FILE.test(entry.name) && !SKIPPED_FILES.has(entry.name)) {
        if ((await stat(path)).size <= MAX_FILE_BYTES) files.push(path);
      }
    }
  };
  await walk(root);
  return files.sort();
}

function locate(text: string, needle: string): { index: number; exact: boolean } | undefined {
  for (const [open, close] of [['"', '"'], ["'", "'"], ['`', '`'], ['>', '<']] as const) {
    const index = text.indexOf(open + needle + close);
    if (index >= 0) return { index: index + 1, exact: true };
  }
  const index = text.indexOf(needle);
  return index >= 0 ? { index, exact: false } : undefined;
}

/** Whether a source file plausibly builds the page at this path (privacy.html or app/privacy/page.tsx for /privacy). */
function buildsPage(file: string, pagePath: string): boolean {
  const name = basename(file, extname(file));
  const segment = pagePath.split('?')[0]!.split('/').filter(Boolean).at(-1)?.replace(/\.[a-z0-9]+$/i, '');
  if (!segment) {
    return ['index', 'page', 'layout'].includes(name) && ROUTE_ROOTS.has(basename(dirname(file)));
  }
  return name === segment || file.split('/').slice(0, -1).includes(segment);
}

function rank(match: Match, pagePath: string): number {
  return (buildsPage(match.file, pagePath) ? 4 : 0) + (match.exact ? 2 : 0) - (PROSE_FILE.test(match.file) ? 1 : 0);
}

/**
 * Point each finding at the source files that contain the text it is about
 * (a title, a link target, an image path), as file:line.
 *
 * This is a literal search, so text assembled at build time will not be found.
 * When several files contain the text, files that build the affected page and
 * files that hold the text as a whole value are preferred.
 */
export async function attachSources(findings: Finding[], root: string): Promise<void> {
  const needles = new Map<string, Match[]>();
  for (const finding of findings) {
    if (finding.needle && finding.needle.length >= 4) needles.set(finding.needle, []);
  }
  if (needles.size === 0) return;

  for (const path of await sourceFiles(root)) {
    const text = await readFile(path, 'utf8');
    for (const [needle, matches] of needles) {
      if (matches.length >= MAX_MATCHES_PER_NEEDLE) continue;
      const found = locate(text, needle) ?? locate(text, needle.replace(/&/g, '&amp;'));
      if (!found) continue;
      matches.push({
        file: relative(root, path).split(sep).join('/'),
        line: text.slice(0, found.index).split('\n').length,
        exact: found.exact,
      });
    }
  }

  for (const finding of findings) {
    const matches = finding.needle ? needles.get(finding.needle) : undefined;
    if (!matches || matches.length === 0) continue;
    finding.sources = [...matches]
      .sort((a, b) => rank(b, finding.path) - rank(a, finding.path) || a.file.localeCompare(b.file))
      .slice(0, MAX_SOURCES)
      .map((match) => `${match.file}:${match.line}`);
  }
}
