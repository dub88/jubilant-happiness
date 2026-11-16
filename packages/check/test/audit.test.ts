import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { audit, compareToBaseline, failures, type AuditResult } from '../src/audit.ts';
import { CrawlError } from '../src/crawl.ts';
import { renderMarkdown, renderText } from '../src/report.ts';
import { packs } from '../src/rules/index.ts';
import { attachSources } from '../src/source.ts';
import { jsonLd, page, redirect, serve, sitemap, type Routes, type TestSite } from './helpers.ts';

const business = { '@context': 'https://schema.org', '@type': 'Bakery', name: 'Example Bakery' };

async function site(t: TestContext, routes: Routes): Promise<TestSite> {
  const server = await serve(routes);
  t.after(() => server.close());
  return server;
}

/** A small site that passes every rule. `publicOrigin` is what the pages call themselves. */
function cleanRoutes(origin: string, publicOrigin = origin): ReturnType<Routes> {
  return {
    '/': page({
      origin: publicOrigin,
      path: '/',
      head: jsonLd({ ...business, url: `${publicOrigin}/`, logo: `${publicOrigin}/hero.jpg` }),
      body: '<h1>Example Bakery</h1><a href="/about">About</a><img src="/hero.jpg" alt="Fresh loaves">',
    }),
    '/about': page({ origin: publicOrigin, path: '/about', body: '<h1>About us</h1><a href="/">Home</a>' }),
    '/hero.jpg': { headers: { 'content-type': 'image/jpeg' }, body: 'jpeg' },
    '/robots.txt': `User-agent: *\nAllow: /\nSitemap: ${publicOrigin}/sitemap.xml\n`,
    '/sitemap.xml': sitemap([`${publicOrigin}/`, `${publicOrigin}/about`]),
  };
}

const rulesOf = (result: AuditResult): string[] => [...new Set(result.findings.map((finding) => finding.rule))].sort();

const on = (result: AuditResult, rule: string): string[] =>
  result.findings.filter((finding) => finding.rule === rule).map((finding) => `${finding.path}: ${finding.message}`);

test('a well-formed site has no findings', async (t) => {
  const server = await site(t, (origin) => cleanRoutes(origin));
  const result = await audit({ url: server.origin });
  assert.deepEqual(result.findings, []);
  assert.equal(result.pagesCrawled, 2);
  assert.equal(result.truncated, false);
});

test('page-level rules', async (t) => {
  const longTitle = 'Example Bakery: bread, pastries, custom cakes and catering for every occasion in town';
  const server = await site(t, (origin) => ({
    ...cleanRoutes(origin),
    '/': page({
      origin,
      path: '/',
      title: longTitle,
      description: 'Too short.',
      body: `<h1>One</h1><h1>Two</h1><img src="/hero.jpg">
             <a href="/bare">bare</a><a href="/twin-a">a</a><a href="/twin-b">b</a><a href="/badjson">j</a>`,
    }),
    '/bare': '<html><body><p>No head tags at all.</p></body></html>',
    '/twin-a': page({ origin, path: '/twin-a', title: 'The same title on two pages', description: `${'Same words. '.repeat(11)}` }),
    '/twin-b': page({ origin, path: '/twin-b', title: 'The same title on two pages', description: `${'Same words. '.repeat(11)}` }),
    '/badjson': page({ origin, path: '/badjson', head: '<script type="application/ld+json">{"name": </script>' }),
    '/sitemap.xml': sitemap([`${origin}/`]),
  }));
  const result = await audit({ url: server.origin });

  assert.deepEqual(on(result, 'title-length'), [`/: Title is ${longTitle.length} characters (max 70): "${longTitle.slice(0, 70)}…"`]);
  assert.deepEqual(on(result, 'description-length'), ['/: Meta description is 10 characters (min 100): "Too short."']);
  assert.deepEqual(on(result, 'h1-multiple'), ['/: Page has 2 h1 headings.']);
  assert.deepEqual(on(result, 'image-alt-missing'), ['/: Image has no alt attribute: /hero.jpg']);
  assert.deepEqual(on(result, 'structured-data-missing'), ['/: The home page has no JSON-LD structured data.']);

  assert.deepEqual(on(result, 'title-missing'), ['/bare: Page has no title.']);
  assert.deepEqual(on(result, 'description-missing'), ['/bare: Page has no meta description.']);
  assert.deepEqual(on(result, 'canonical-missing'), ['/bare: Page has no canonical link.']);
  assert.deepEqual(on(result, 'h1-missing'), ['/bare: Page has no h1 heading.']);
  assert.deepEqual(on(result, 'lang-missing'), ['/bare: The <html> element has no lang attribute.']);
  assert.deepEqual(on(result, 'og-incomplete'), [
    '/bare: Open Graph tags are incomplete: missing og:title, og:type, og:image, og:url.',
  ]);

  assert.equal(on(result, 'duplicate-title').length, 2);
  assert.equal(on(result, 'duplicate-description').length, 2);
  assert.match(on(result, 'structured-data-invalid')[0] ?? '', /^\/badjson: JSON-LD block 1 is not valid JSON/);
});

test('link, reference, sitemap and robots rules', async (t) => {
  const server = await site(t, (origin) => {
    const www = origin.replace('://', '://www.');
    return {
      '/': page({
        origin,
        path: '/',
        head:
          jsonLd({ ...business, url: `${www}/`, logo: `${origin}/missing.png` }) +
          `<meta name="twitter:image" content="${origin}/old-hero.jpg">`,
        body: `<h1>Example Bakery</h1>
               <a href="/menu.html">Menu</a><a href="menu.html#lunch">Lunch</a>
               <a href="/gone">Gone</a><a href="${www}/menu">Menu on www</a>
               <a href="https://elsewhere.example/">Elsewhere</a><a href="mailto:hi@example.com">Mail</a>`,
      }),
      '/menu.html': redirect('/menu'),
      '/menu': page({ origin, path: '/menu', head: `<meta property="og:url" content="${origin}/">` })
        // The page helper already wrote og:url; the first one wins, so drop it.
        .replace(`<meta property="og:url" content="${origin}/menu">`, ''),
      '/old-hero.jpg': redirect('/hero.jpg', 301),
      '/hero.jpg': { headers: { 'content-type': 'image/jpeg' }, body: 'jpeg' },
      '/staff': page({ origin, path: '/staff', head: '<meta name="robots" content="noindex, nofollow">', bare: true }),
      '/robots.txt': `Sitemap: ${www}/sitemap.xml\n`,
      '/sitemap.xml': sitemap([`${origin}/`, `${origin}/menu.html`, `${origin}/vanished`, `${origin}/staff`, `${www}/menu`]),
    };
  });
  const www = server.origin.replace('://', '://www.');
  const host = new URL(server.origin).host;
  const result = await audit({ url: server.origin });

  assert.deepEqual(on(result, 'redirect-link'), ['/: Links to /menu.html, which redirects (308) to /menu.']);
  assert.deepEqual(on(result, 'broken-link'), ['/: Links to /gone, which returns 404.']);
  assert.deepEqual(on(result, 'redirect-reference'), ['/: twitter:image points at /old-hero.jpg, which redirects (301) to /hero.jpg.']);
  assert.deepEqual(on(result, 'broken-reference'), ['/: Structured data points at /missing.png, which returns 404.']);
  assert.deepEqual(on(result, 'og-url-mismatch'), ['/menu: og:url is /, but this page is /menu.']);
  assert.deepEqual(on(result, 'host-variant'), [
    `/: A link points at ${www}/menu, which is not on the site's host, ${host}.`,
    `/: Structured data points at ${www}/, which is not on the site's host, ${host}.`,
    `/robots.txt: robots.txt lists ${www}/sitemap.xml, which is not on the site's host, ${host}.`,
    `/sitemap.xml: The sitemap lists ${www}/menu, which is not on the site's host, ${host}.`,
  ]);
  assert.deepEqual(on(result, 'sitemap-redirect'), ['/sitemap.xml: Sitemap lists /menu.html, which redirects (308) to /menu.']);
  assert.deepEqual(on(result, 'sitemap-broken'), ['/sitemap.xml: Sitemap lists /vanished, which returns 404.']);
  assert.deepEqual(on(result, 'sitemap-noindex'), ['/sitemap.xml: Sitemap lists /staff, which is marked noindex.']);

  // A noindex page is exempt from the content rules even though it has no title or description.
  assert.deepEqual(result.findings.filter((finding) => finding.path === '/staff'), []);
  assert.deepEqual(rulesOf(result), [
    'broken-link', 'broken-reference', 'host-variant', 'og-url-mismatch', 'redirect-link',
    'redirect-reference', 'sitemap-broken', 'sitemap-noindex', 'sitemap-redirect',
  ]);
});

test('missing robots.txt and sitemap are reported, and an HTML fallback does not count', async (t) => {
  const server = await site(t, (origin) => ({
    '/': page({ origin, path: '/', head: jsonLd(business) }),
    '/hero.jpg': { headers: { 'content-type': 'image/jpeg' }, body: 'jpeg' },
    // A single-page app that answers every path with its shell.
    '/robots.txt': '<html><body>app shell</body></html>',
  }));
  const result = await audit({ url: server.origin });
  assert.deepEqual(rulesOf(result), ['robots-missing', 'sitemap-missing']);
});

test('rules can be switched off or re-graded, and paths ignored', async (t) => {
  const server = await site(t, (origin) => ({
    ...cleanRoutes(origin),
    '/about': page({ origin, path: '/about', title: 'Short', body: '<h1>About</h1><a href="/nowhere">x</a>' }),
  }));
  const plain = await audit({ url: server.origin });
  assert.deepEqual(plain.findings.map((finding) => `${finding.severity} ${finding.rule}`), ['error broken-link', 'warning title-length']);

  const tuned = await audit({ url: server.origin, rules: { 'broken-link': 'warning', 'title-length': 'off' } });
  assert.deepEqual(tuned.findings.map((finding) => `${finding.severity} ${finding.rule}`), ['warning broken-link']);

  const relaxed = await audit({ url: server.origin, thresholds: { titleMin: 3 }, ignorePaths: ['/ab*'] });
  assert.deepEqual(relaxed.findings, []);
});

test('a preview is compared with production and only new problems fail', async (t) => {
  const production = await site(t, (origin) => ({
    ...cleanRoutes(origin),
    '/about': page({ origin, path: '/about', title: 'Short', body: '<h1>About us</h1><a href="/">Home</a>' }),
  }));
  const preview = await site(t, (origin) => ({
    // The preview's pages, sitemap and robots.txt all name the production origin.
    ...cleanRoutes(origin, production.origin),
    '/about': page({
      origin: production.origin,
      path: '/about',
      title: 'Short',
      body: `<h1>About us</h1><a href="${production.origin}/">Home</a><a href="/contact">Contact</a>`,
    }),
    '/contact': page({ origin: production.origin, path: '/contact', description: 'New page, thin description.' }),
  }));

  const baseline = await audit({ url: production.origin });
  const result = await audit({ url: preview.origin, canonicalOrigin: baseline.crawlOrigin });
  compareToBaseline(result, baseline);

  assert.equal(result.pagesCrawled, 3);
  assert.deepEqual(
    result.findings.map((finding) => `${finding.isNew ? 'new' : 'old'} ${finding.rule} ${finding.path}`),
    ['old title-length /about', 'new description-length /contact'],
  );
  assert.deepEqual(failures(result, 'warning').map((finding) => finding.rule), ['description-length']);
  assert.deepEqual(failures(result, 'error'), []);
  assert.deepEqual(failures(result, 'none'), []);

  const text = renderText(result, { color: false, showExisting: false });
  assert.match(text, /description-length/);
  assert.doesNotMatch(text, /title-length/);
  assert.match(text, /1 new problem, 1 already there/);
  assert.match(renderText(result, { color: false, showExisting: true }), /title-length/);
  assert.match(renderMarkdown(result, false), /\| warning \| `description-length` \|/);
});

test('a preview served with a noindex header is still audited', async (t) => {
  const noindex = { 'x-robots-tag': 'noindex' };
  const routes = (origin: string, publicOrigin: string): ReturnType<Routes> => ({
    ...cleanRoutes(origin, publicOrigin),
    '/': { headers: noindex, body: page({ origin: publicOrigin, path: '/', title: 'Short', head: jsonLd(business) }) },
  });
  const server = await site(t, (origin) => routes(origin, 'https://www.example.com'));
  const preview = await audit({ url: server.origin, canonicalOrigin: 'https://www.example.com' });
  assert.deepEqual(on(preview, 'title-length'), ['/: Title is 5 characters (min 20): "Short"']);

  // On the real host the same header means the page is deliberately hidden from search.
  const live = await site(t, (origin) => routes(origin, origin));
  const production = await audit({ url: live.origin });
  assert.deepEqual(on(production, 'title-length'), []);
  assert.deepEqual(on(production, 'sitemap-noindex'), ['/sitemap.xml: Sitemap lists /, which is marked noindex.']);
});

test('the crawl follows a redirecting start URL and respects the page limit', async (t) => {
  const server = await site(t, (origin) => ({
    ...cleanRoutes(origin),
    '/start': redirect('/'),
  }));
  const result = await audit({ url: `${server.origin}/start`, maxPages: 1 });
  assert.equal(result.pagesCrawled, 1);
  assert.equal(result.truncated, true);
});

test('an unreachable or protected site is a crawl error', async (t) => {
  const server = await site(t, () => ({ '/': { status: 401, body: 'Authentication required' } }));
  await assert.rejects(audit({ url: server.origin }), (error: unknown) => {
    assert.ok(error instanceof CrawlError);
    assert.match(error.message, /answered 401.*--header/);
    return true;
  });
  await assert.rejects(audit({ url: 'not a url' }), CrawlError);
});

test('findings are traced to source files', async (t) => {
  const server = await site(t, (origin) => ({
    ...cleanRoutes(origin),
    '/about': page({ origin, path: '/about', body: '<h1>About</h1><a href="/old-menu">Menu</a>' }),
    '/old-menu': redirect('/'),
  }));
  const src = await mkdtemp(join(tmpdir(), 'plumbline-src-'));
  t.after(() => rm(src, { recursive: true }));
  await writeFile(join(src, 'about.html'), '<h1>About</h1>\n<p>Intro</p>\n<a href="/old-menu">Menu</a>\n');
  // Also mentions the path, but is not the page and does not hold it as a whole value.
  await writeFile(join(src, 'NOTES.md'), 'Remember to retire /old-menu-archive.\n');
  await writeFile(join(src, 'notes.png'), '/old-menu');

  const result = await audit({ url: server.origin });
  await attachSources(result.findings, src);
  assert.deepEqual(result.findings.map((finding) => [finding.rule, finding.sources]), [
    ['redirect-link', ['about.html:3', 'NOTES.md:1']],
  ]);
});

test('the command line reports, writes Markdown and sets the exit code', async (t) => {
  const run = promisify(execFile);
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const server = await site(t, (origin) => ({
    ...cleanRoutes(origin),
    '/about': page({ origin, path: '/about', body: '<h1>About</h1><a href="/nowhere">x</a>' }),
  }));
  const dir = await mkdtemp(join(tmpdir(), 'plumbline-cli-'));
  t.after(() => rm(dir, { recursive: true }));
  const markdown = join(dir, 'report.md');

  const failed = await run(process.execPath, [cli, 'check', server.origin, '--json', '--markdown', markdown], { cwd: dir }).catch(
    (error: { code: number; stdout: string }) => error,
  );
  assert.equal('code' in failed ? failed.code : 0, 1);
  const [result] = JSON.parse(failed.stdout) as AuditResult[];
  assert.deepEqual(result?.findings.map((finding) => finding.rule), ['broken-link']);
  assert.match(await readFile(markdown, 'utf8'), /### plumbline: 1 error, 0 warnings/);

  const passed = await run(process.execPath, [cli, 'check', server.origin, '--ignore', '/about'], { cwd: dir });
  assert.match(passed.stdout, /No problems found\./);

  // A config file can list several sites; one that cannot be reached does not hide the others.
  await writeFile(
    join(dir, 'plumbline.config.json'),
    JSON.stringify({ ignorePaths: ['/about'], sites: [{ url: server.origin }, { name: 'down', url: 'http://127.0.0.1:1/' }] }),
  );
  const fleet = await run(process.execPath, [cli, 'check'], { cwd: dir }).catch(
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
  assert.equal('code' in fleet ? fleet.code : 0, 2);
  assert.match(fleet.stdout, /No problems found\./);
  assert.match(fleet.stderr, /^down: Could not reach/m);

  const usage = await run(process.execPath, [cli, 'check', '--fail-on', 'sometimes'], { cwd: dir }).catch(
    (error: { code: number; stderr: string }) => error,
  );
  assert.equal('code' in usage ? usage.code : 0, 2);
  assert.match(usage.stderr, /--fail-on must be error, warning or none/);
});

test('the README documents every rule', async () => {
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
  for (const pack of packs) {
    for (const rule of pack.rules) assert.ok(readme.includes(`\`${rule.id}\``), `README is missing ${rule.id}`);
  }
});
