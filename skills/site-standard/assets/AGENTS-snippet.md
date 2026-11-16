## Site standard (plumbline)

This site follows the plumbline standard for client websites: https://github.com/dub88/jubilant-happiness

Before you finish any change that affects a page, its metadata, its links or a form:

1. Keep to the standard. The full guidance is in that repository under `skills/site-standard/` (`references/seo.md`, `references/forms.md`, `references/design.md`). In brief:
   - Every page has its own title (20 to 70 characters) and meta description (100 to 160), a canonical link, `og:title`, `og:type`, `og:image` and `og:url`, one `<h1>`, and `alt` on every image.
   - Every URL the site writes uses the production host and the final address, so nothing redirects.
   - Forms keep their spam defences: same-site check, honeypot field, minimum fill time, no confirmation email for flagged submissions.
   - Nothing invented or placeholder goes on a page: no made-up contact details, testimonials or statistics, no lorem ipsum, no links to `#`. If a fact is missing, leave the element out and ask.
2. Run the checker against the locally served site and fix what it reports:

   ```sh
   git clone --depth 1 https://github.com/dub88/jubilant-happiness ~/.cache/plumbline   # once
   ~/.cache/plumbline/skills/site-standard/scripts/check.sh http://localhost:3000 --baseline <production URL> --src .
   ```

3. Do not turn a rule off or add an ignore to make the check pass without saying so. Site-specific exceptions live in `plumbline.config.json`.
