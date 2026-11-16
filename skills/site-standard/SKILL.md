---
name: site-standard
description: Build, edit and review small-business and client websites so they have sound SEO fundamentals, contact forms that resist spam, and design and copy that do not look machine-made, then verify the result with the plumbline checker. Use this whenever you create or change a marketing site, landing page, brochure site, portfolio or any public page for a business or client, in any stack (Next.js, Astro, plain HTML, anything else); when adding or fixing a contact form; when the task mentions SEO, meta tags, Open Graph, sitemaps, canonical URLs or structured data; when a site looks generic or AI-generated; and before you call any such site finished, even if the user never mentions SEO or quality.
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/check.sh *), Bash(${CLAUDE_SKILL_DIR}/scripts/vendor-forms.sh *)
---

# Site standard

Small-business sites fail in the same few ways. Titles and descriptions are the wrong length, shared links have no preview, internal links bounce through redirects, the contact form is flooded by bots within a week, and the whole thing reads and looks as if nobody in particular made it. Each problem is small. Together they are the difference between a site that brings a business customers and one that only exists.

This skill is a standard for getting those things right the first time, and a checker that confirms it. The checker finds what can be detected mechanically. The rest (whether the page looks and sounds like this particular business) depends on your judgement, and `references/design.md` is there to inform it.

## How to work

### 1. Get the facts before you write anything

A site is only as real as what you put in it. Before building or rewriting a page, find out what you actually know about the business:

- its exact name, what it does, and where
- address, phone, email, opening hours
- real photos, a logo, existing brand colours or type
- real social profiles, reviews, credentials, prices

Look in the repository first (existing pages, a brief, a content file), then ask the user for what is missing.

Never invent these. A made-up phone number, address, testimonial, statistic, award or team member is worse than a gap, because the owner may not notice it before a customer does. When a fact is missing, leave that element out of the page and list what you still need in your final message. Do not put "TODO", "[phone]" or lorem ipsum on a page; placeholders get shipped.

### 2. Build to the standard

Read the reference that matches what you are touching. Each is short.

| If you are... | Read |
|---|---|
| writing or changing page metadata, links, routing, the sitemap or robots.txt | `references/seo.md` |
| adding or changing a form that sends a message | `references/forms.md` |
| making any decision about layout, type, colour, imagery or wording | `references/design.md` |

For a new page or site, read `references/design.md` before you write markup or CSS. Its advice shapes the structure of the page, so it is far cheaper to apply at the start than to retrofit.

The essentials, for when you are making a small change and do not need the full reference:

- **Every page** has its own title (20 to 70 characters) and meta description (100 to 160), a canonical link, `og:title`, `og:type`, `og:image` and `og:url`, one `<h1>`, `lang` on `<html>`, and `alt` on every image.
- **The site** has a robots.txt that names the sitemap, a sitemap of the pages that should be indexed, JSON-LD on the home page describing the business, and its own favicon.
- **Every URL the site writes** uses one host and the final address, so nothing redirects: not `/about.html` when the page lives at `/about`, not the bare domain when the site lives on `www`.
- **Forms** reject posts from other sites, have a hidden honeypot field and a minimum fill time, and never email a confirmation to an address that a suspicious submission supplied.
- **Nothing is filler**: no starter content, placeholder text or images, invented contact details, links to `#`, or social icons that link to a network's home page.

### 3. Check the result

Run the checker against the site as it is actually served. Start the dev or preview server first, then:

```sh
${CLAUDE_SKILL_DIR}/scripts/check.sh http://localhost:3000 --canonical-origin https://www.example.com --src .
```

- `--canonical-origin` is the production address the site calls itself in canonical links and the sitemap. It lets the checker treat those URLs as belonging to the local server. Leave it out when the pages refer to themselves by the address you are checking.
- `--src .` traces each finding to a file and line.
- If the site is already live, add `--baseline https://www.example.com` in place of `--canonical-origin`. Only problems your change introduced are reported, so an old site's backlog does not bury them.
- If the site has a guarded form, add `--form /api/contact` (see `references/forms.md`).

The first run builds the checker and takes a little longer. `check.sh rules` lists every rule.

Each finding names the rule, the pages, the fix, and where possible the source file. Fix the errors and warnings, run it again, and repeat until it reports no problems. Exit code 0 means clean, 1 means findings remain, 2 means the site could not be reached.

Then look at the page yourself. If you can take a screenshot, do so at a phone width and a desktop width and compare what you see against `references/design.md`. The checker reads text and markup; it cannot see that a layout is cramped or that a page looks like every other page.

### 4. Report honestly

Tell the user what the checker verified, what you checked by eye, and what is still open: facts you need from them, and anything the checker cannot see. If you could not run the checker, say so; do not describe the site as checked.

## When a finding seems wrong

Rules are heuristics. A page may have good reason for two `<h1>` elements, and an emoji may suit a brand. If a finding does not fit this site, do not contort the page to silence it, and do not quietly ignore it. Tell the user which rule and why, and with their agreement turn it off for this site in `plumbline.config.json`:

```json
{ "rules": { "emoji-icons": "off" }, "ignorePaths": ["/admin*"], "thresholds": { "titleMax": 65 } }
```

A rule that is wrong in general is worth reporting to the plumbline project.

## For sites maintained by several agents or people

`assets/AGENTS-snippet.md` is a short block to add to a site's `AGENTS.md` (or `CLAUDE.md`). It tells any coding agent working on the site that the standard applies and how to run the checker. Offer to add it when you set a site up; some frameworks rewrite `AGENTS.md`, so append to the file and leave their block alone.
