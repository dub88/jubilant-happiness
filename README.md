# plumbline

A standard for small-business and client websites, a checker that enforces it, and drop-in parts that make sites pass.

> **Status: early.** The checker and its SEO rules work today. The form-spam and design-slop rules, the form handler and the coding-agent skill are planned (see [Roadmap](#roadmap)). "plumbline" is a working name.

## Why

Client sites tend to fail in the same few ways: titles and descriptions the wrong length, missing Open Graph tags, links that bounce through redirects, contact forms that bots walk straight through, and design that looks machine-made. These problems are usually found by a paid audit after the site is live, then fixed by hand, one site at a time.

plumbline moves that check into the pull request. It crawls the preview deployment, compares it with production, and fails only on problems the change introduced. Each finding names the rule, the page, the fix and, where it can, the source file and line, so a person or a coding agent can fix it in the same pull request.

## Quick start

plumbline is not on npm yet, so run it from a clone. It needs Node 22.18 or newer to develop and Node 20 or newer to run.

```sh
git clone https://github.com/dub88/jubilant-happiness.git plumbline
cd plumbline
npm ci
npm run build

node packages/check/dist/cli.js check https://www.example.com
```

```text
https://www.example.com · 5 pages in 1.9s

warning  redirect-link  Links to /privacy.html, which redirects (308) to /privacy.
         on   /terms, /sitemap
         fix  Link straight to /privacy.
         in   terms.html:307, sitemap.html:264

warning  title-length  Title is 89 characters (max 70): "Example Bakery — fresh bread, pastries, custom cakes and catering for …"
         on   /
         fix  Shorten the title to 70 characters or fewer.
         in   index.html:39

0 errors, 2 warnings.
```

### Check a preview against production

```sh
node packages/check/dist/cli.js check https://my-site-git-new-page.vercel.app \
  --baseline https://www.example.com \
  --src .
```

With `--baseline`, plumbline audits production as well and reports only the problems production does not already have. An old site can adopt it without first fixing its backlog.

A preview deployment lives on a different host from the one its canonical links, sitemap and Open Graph tags name. plumbline treats URLs on the production origin as belonging to the preview, so they are checked against the preview's pages and not flagged as foreign.

`--src` points at the site's source. plumbline searches it for the text each finding is about and reports `file:line`. This is a literal search: text assembled at build time (a title built from a template, for example) will not be found.

### Options

| Option | What it does |
|---|---|
| `--baseline <url>` | Production URL to compare against; only new problems are reported. |
| `--canonical-origin <url>` | The origin the site calls itself, when auditing a preview without `--baseline`. |
| `--src <dir>` | Trace findings to `file:line` in this source directory. |
| `--fail-on <level>` | `error`, `warning` or `none`. Default: `warning` with a baseline, `error` without. |
| `--max-pages <n>` | Stop reading new pages after `n` (default 200). |
| `--ignore <path>` | Drop findings on a path; a trailing `*` matches a prefix. Repeatable. |
| `--header "name: value"` | Extra request header for the audited site. Repeatable. Not sent to the baseline. |
| `--all` | With a baseline, also show the problems production already has. |
| `--json` | Print results as JSON. |
| `--markdown <file>` | Also write a Markdown report. |
| `--config <file>` | Config file (default `plumbline.config.json`). |

Exit codes: `0` pass, `1` problems found, `2` the audit could not run.

## GitHub Action

The action builds plumbline, runs the audit and writes the report to the job summary.

For a site deployed by Vercel, audit each preview when its deployment succeeds ([full example](examples/workflows/vercel-preview.yml)):

```yaml
on:
  deployment_status:

jobs:
  audit:
    if: >-
      github.event.deployment_status.state == 'success' &&
      !contains(github.event.deployment.environment, 'Production')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.deployment.sha }}
      - uses: dub88/jubilant-happiness@main # pin to a commit SHA for stability
        with:
          url: ${{ github.event.deployment_status.target_url }}
          baseline: https://www.example.com
          headers: |
            x-vercel-protection-bypass: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
```

The `headers` line is only needed when the project uses Vercel Deployment Protection. Without it a protected preview answers 401 and the audit stops with exit code 2.

Inputs mirror the command-line options: `url`, `baseline`, `canonical-origin`, `src` (default `.`), `fail-on`, `max-pages`, `ignore` and `headers` (one per line) and `config`.

## Many sites, one config

List every site you look after in `plumbline.config.json` and run `plumbline check` with no URL. Settings at the top level apply to every site; a site can override them. [Example config](examples/plumbline.config.json), and a [weekly workflow](examples/workflows/weekly-fleet.yml) that runs it on a schedule.

```json
{
  "ignorePaths": ["/admin*", "/login"],
  "rules": { "h1-multiple": "off" },
  "thresholds": { "titleMax": 65 },
  "sites": [
    { "name": "Bakery", "url": "https://www.example-bakery.com" },
    { "name": "Plumber", "url": "https://www.example-plumber.com" }
  ]
}
```

`rules` turns a rule `off` or sets it to `warning` or `error`. `thresholds` accepts `titleMin`, `titleMax`, `descriptionMin` and `descriptionMax`.

## Rules

Every rule comes from a problem found on a real site. `plumbline rules` prints this list.

### SEO

| Rule | Severity | What it catches |
|---|---|---|
| `title-missing` | error | Page has no `<title>`, or it is empty. |
| `title-length` | warning | Title is outside 20–70 characters. |
| `description-missing` | warning | Page has no meta description. |
| `description-length` | warning | Meta description is outside 100–160 characters. |
| `duplicate-title` | warning | Two or more pages share a title. |
| `duplicate-description` | warning | Two or more pages share a meta description. |
| `canonical-missing` | warning | Page has no canonical link. |
| `og-incomplete` | warning | `og:title`, `og:type`, `og:image` or `og:url` is missing. |
| `og-url-mismatch` | warning | `og:url` points at a different page than the canonical URL. |
| `redirect-link` | warning | Page links to an internal URL that redirects. |
| `broken-link` | error | Page links to an internal URL that fails. |
| `redirect-reference` | warning | A canonical, Open Graph, structured-data or robots.txt URL redirects. |
| `broken-reference` | error | A canonical, Open Graph, structured-data or robots.txt URL fails. |
| `host-variant` | warning | A URL uses the site's other host or scheme (`www` vs bare, `http` vs `https`) and will redirect. |
| `sitemap-missing` | warning | No XML sitemap was found. |
| `sitemap-redirect` | warning | The sitemap lists a URL that redirects. |
| `sitemap-broken` | error | The sitemap lists a URL that fails. |
| `sitemap-noindex` | error | The sitemap lists a page marked `noindex`. |
| `robots-missing` | warning | No robots.txt was found. |
| `structured-data-missing` | warning | The home page has no JSON-LD structured data. |
| `structured-data-invalid` | error | A JSON-LD block is not valid JSON. |
| `h1-missing` | warning | Page has no `<h1>`. |
| `h1-multiple` | warning | Page has more than one `<h1>`. |
| `lang-missing` | warning | `<html>` has no `lang` attribute. |
| `image-alt-missing` | warning | An image has no `alt` attribute. |

Pages marked `noindex`, and pages whose canonical link points elsewhere, are exempt from the content rules (titles, descriptions, Open Graph, headings).

### What the checker does not do yet

- It reads the HTML the server sends and does not run JavaScript, so a site rendered entirely in the browser will look empty to it.
- It checks internal links only; external links are not requested.
- It does not judge content quality, keywords, page speed or backlinks.

## Roadmap

1. **Forms pack and form handler.** A drop-in, spam-resistant form handler for Next.js, Vercel functions and Astro (origin check, time trap, honeypot, content flags, no confirmation email to unverified addresses), plus rules that probe a site's form endpoint for the same defences.
2. **Slop pack.** Rules for mechanical tells of a machine-made site: a default framework favicon or title, placeholder text, stock phrases, emoji used as icons, a stale copyright year.
3. **Agent skill.** A coding-agent skill and `AGENTS.md` pack that teaches the standard, so sites are built to pass and the checker confirms it.
4. **Pull request comments and an npm release.**

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Tests run TypeScript directly with Node's built-in type stripping and serve in-memory fixture sites on local ports. To add a rule, add it to a pack in `packages/check/src/rules/`, cover it in `packages/check/test/audit.test.ts` and list it in the table above; a test fails if a rule is missing from this file.

## Licence

[MIT](LICENSE)
