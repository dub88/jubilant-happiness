# @plumbline/check

Audit a small-business or client website for SEO fundamentals, contact-form spam defences and the leftovers of a generated or unfinished site. Point it at a preview deployment and it reports only the problems the change introduced.

```sh
npx @plumbline/check check https://www.example.com
```

```text
https://www.example.com · 5 pages in 1.9s

warning  redirect-link  Links to /privacy.html, which redirects (308) to /privacy.
         on   /terms, /sitemap
         fix  Link straight to /privacy.
         in   terms.html:307, sitemap.html:264

0 errors, 1 warning.
```

Check a preview against production, and trace findings to source files:

```sh
npx @plumbline/check check https://my-site-git-new-page.vercel.app --baseline https://www.example.com --src .
```

`npx @plumbline/check rules` lists the rules. The full documentation (options, the config file for several sites, the GitHub Action, form probing and every rule) is in the [project README](https://github.com/dub88/jubilant-happiness#readme).

## Programmatic use

```ts
import { audit, failures } from '@plumbline/check';

const result = await audit({ url: 'https://www.example.com' });
console.log(result.findings, failures(result, 'error').length);
```

Requires Node 20 or newer. The checker reads the HTML the server sends and does not run JavaScript.

## Licence

MIT
