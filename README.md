# plumbline

A standard for small-business and client websites, a checker that enforces it, and drop-in parts that make sites pass.

> **Status: early.** The checker, its SEO, form and slop rules, and the form guard work today. The coding-agent skill is planned (see [Roadmap](#roadmap)). "plumbline" is a working name.

| Part | What it is |
|---|---|
| [`packages/check`](packages/check) | The checker: a command line and GitHub Action that audit a site against the rules below. |
| [`packages/forms`](packages/forms) | A form guard: spam screening for contact forms with no third-party service. |

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
| `--form <path>` | Form endpoint to probe, e.g. `/api/contact`. Repeatable. See [Form spam](#form-spam). |
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

Inputs mirror the command-line options: `url`, `baseline`, `canonical-origin`, `src` (default `.`), `fail-on`, `max-pages`, `config`, and `ignore`, `headers` and `forms` (one per line). `probe-secret` carries the form probe secret.

## Form spam

Contact forms on small sites attract bots within days. [`@plumbline/forms`](packages/forms) screens submissions with the checks a real visitor never trips (a honeypot field, a same-site check and a minimum fill time), flags sales pitches without discarding them, and leaves a paid bot-detection service as an optional last step so it is only billed for submissions the free checks let through.

```ts
import { createFormGuard } from '@plumbline/forms';

const guard = createFormGuard({ probeSecret: process.env.PLUMBLINE_PROBE_SECRET });

export async function POST(request: Request) {
  const result = await guard.check(request);
  if (!result.ok) return result.response; // blocked, or a probe was answered

  const { fields, flagged, allowConfirmation } = result;
  // Validate fields, then deliver. Prefix the subject when flagged, and only
  // email a confirmation to the sender when allowConfirmation is true.
  return Response.json({ ok: true });
}
```

The checker can then verify those defences on every preview. Tell it the endpoint and give it the same secret:

```sh
PLUMBLINE_PROBE_SECRET=... node packages/check/dist/cli.js check https://www.example.com --form /api/contact
```

It sends seven crafted submissions (a normal one, one from another site, one with no origin, one with no timer, one sent too fast, one that fills the honeypot, one sales pitch) and reports any the guard judges wrongly. A guard that recognises the secret runs its checks, delivers nothing and returns its verdict, so probing never sends a real enquiry. The first request has an empty body; an endpoint that does not answer it with a verdict is reported as unverified and receives nothing else.

In a config file, `"forms": [{ "endpoint": "/api/contact", "page": "/contact" }]` also checks that the page showing the form contains the fields the guard expects.

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

`rules` turns a rule `off` or sets it to `warning` or `error`. `thresholds` accepts `titleMin`, `titleMax`, `descriptionMin`, `descriptionMax` and `stockPhrases`.

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

### Forms

These run only for form endpoints you configure, and need the probe secret.

| Rule | Severity | What it catches |
|---|---|---|
| `form-probe-unanswered` | warning | A configured endpoint could not be probed, so its defences are unverified. |
| `form-blocks-genuine` | error | A normal submission from the site's own page is blocked or flagged. |
| `form-accepts-cross-site` | error | A submission posted from another site is accepted. |
| `form-accepts-no-origin` | error | A submission with no Origin or Referer, as a script sends, is accepted. |
| `form-accepts-instant` | error | A submission with no timer, or sent faster than a person can type, is accepted. |
| `form-accepts-honeypot` | error | A submission that filled in the honeypot field is accepted. |
| `form-misses-spam` | warning | An obvious sales pitch with links is not flagged. |
| `form-honeypot-not-rendered` | warning | The form's page does not contain the honeypot field. |
| `form-message-field-missing` | warning | The endpoint scans a field for spam text that the form's page does not have. |

### Slop

Mechanical tells of a site that was generated or started from a template and never finished. These catch what can be detected reliably; they do not judge taste.

| Rule | Severity | What it catches |
|---|---|---|
| `default-metadata` | error | The title or description is a starter default ("Create Next App"). |
| `starter-content` | error | The page still shows a framework's starter content. |
| `default-favicon` | error | The favicon is the default Next.js, Vite, SvelteKit or Create React App icon. |
| `favicon-missing` | warning | No favicon loads. |
| `placeholder-text` | error | Lorem ipsum, "[Your Company Name]", "tagline goes here". |
| `unrendered-template` | error | "{{ name }}" or "[object Object]" on the page, or "undefined" in a title. |
| `placeholder-contact` | error | An example.com address, a 555 phone number, "Anytown". |
| `placeholder-image` | error | An image from a placeholder service, or a file named placeholder. |
| `generic-alt` | warning | Alt text that is a filler word or a file name ("image", "hero.jpg"). |
| `dead-link` | warning | A link that goes nowhere (`href="#"`, empty, or `javascript:`). |
| `placeholder-social-link` | warning | A social link to the network's home page, not to a profile. |
| `stock-phrases` | warning | Three or more stock marketing phrases on one page ("elevate your", "look no further"). |
| `emoji-icons` | warning | Three or more emoji used as icons or to decorate headings. |
| `stale-copyright` | warning | The copyright year is in the past. |

`stock-phrases` and `emoji-icons` are judgement calls; turn them off in the config if they do not suit a site. The `stockPhrases` threshold sets how many phrases a page may use.

### What the checker does not do yet

- It reads the HTML the server sends and does not run JavaScript, so a site rendered entirely in the browser will look empty to it.
- It checks internal links only; external links are not requested.
- It does not judge content quality, keywords, page speed or backlinks.
- It does not look at layout, colour or typography; the slop rules read text and markup only.

## Roadmap

1. **Agent skill.** A coding-agent skill and `AGENTS.md` pack that teaches the standard, including the design judgement the checker cannot enforce, so sites are built to pass and the checker confirms it.
2. **Pull request comments and an npm release.**

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
