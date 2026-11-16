# plumbline-forms

Spam screening for contact forms, with no third-party service and no dependencies. It works anywhere a route receives a web `Request`: Next.js route handlers, Astro endpoints, Vercel and Cloudflare functions.

## What it does

Checks run in this order, cheapest first.

| Check | Catches | Response |
|---|---|---|
| Honeypot | Bots that fill in every field, including one hidden from people. | Dropped; answered as if it worked. |
| Same site | Scripts that post straight to the endpoint from somewhere else, or from nowhere. | `403` |
| Time trap | Submissions with no timer, or sent sooner than a person can type (3 seconds by default). | Dropped; answered as if it worked. |
| Bot check (optional) | Bots that drive a real browser. You supply the function; it is called last, so a paid service is billed only for submissions that passed the free checks. | `403` |
| Content flags | Sales pitches, link dumps and junk. | **Delivered**, but flagged. |

Blocks are reserved for things a real visitor never does. Content checks only flag, so a genuine enquiry is never thrown away because it contained a link. Silent drops answer with your normal success body, because telling a scraper which check it tripped teaches it to get past that check.

## Installing

The package is not on npm yet. Until it is, copy the built files into your site with the script in this repository:

```sh
skills/site-standard/scripts/vendor-forms.sh path/to/your-site/src/lib/plumbline-forms
```

and import from that folder (`.../plumbline-forms/index.js` and `.../plumbline-forms/client.js`) where the examples below say `plumbline-forms`.

## Server

```ts
// app/api/contact/route.ts
import { createFormGuard } from 'plumbline-forms';

const guard = createFormGuard({
  probeSecret: process.env.PLUMBLINE_PROBE_SECRET,
});

export async function POST(request: Request) {
  const result = await guard.check(request);
  if (!result.ok) return result.response;

  const { fields, flagged, allowConfirmation } = result;
  // 1. Validate `fields` yourself; the guard screens for spam, it does not validate.
  // 2. Deliver. When `flagged`, label it, e.g. prefix the subject with "[Possible spam]".
  // 3. Email a confirmation to the sender only when `allowConfirmation` is true.
  return Response.json({ ok: true });
}
```

`guard.check` reads the body itself, as JSON or as a form post, and returns it as `fields`.

`allowConfirmation` is false for flagged submissions. A form that emails a confirmation to whatever address it was given lets anyone send mail from your domain to an address of their choosing.

### Options

| Option | Default | |
|---|---|---|
| `honeypotField` | `"website"` | Name of the hidden field. |
| `elapsedField` | `"elapsedMs"` | Field in which the browser reports how long the form was open, in milliseconds. |
| `minFillMs` | `3000` | Faster submissions are dropped. |
| `nameFields` | `["name"]` | Checked for links. |
| `messageFields` | `["message"]` | Free text, checked for links and sales pitches. |
| `extraPhrases` | `[]` | More `[flag, pattern]` pairs that flag a submission. |
| `flagNonLatin` | `false` | Flag text that is mostly Cyrillic or CJK. Only for sites whose visitors write in Latin script. |
| `allowedHosts` | `[]` | Other hosts whose pages may post to this endpoint. |
| `verifyHuman` | none | `(request) => boolean`. Return `false` to block. If it throws, the submission goes through. |
| `probeSecret` | none | Enables probe mode (below). |
| `successBody` | `{ ok: true }` | Body of the response to a silent drop. Make it match your real success response. |
| `log` | `console.info` | Receives one record per submission; `false` turns it off. |

The log record holds the outcome, the reason or flags, and a few traits that identify no one: user agent, country header, fill time, message length and link count. It never contains names, addresses or message text.

If you do not have a web `Request`, call `screenSubmission(headers, fields, options)` with a `Headers` object and the parsed fields. It runs the free checks and returns the verdict.

## Browser

The page has to send two things: how long the form was open, and the honeypot field.

For a form submitted with `fetch`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { startFormTimer, type FormTimer } from 'plumbline-forms/client';

const timer = useRef<FormTimer | null>(null);
const [website, setWebsite] = useState('');
useEffect(() => {
  timer.current = startFormTimer();
}, []);

// In the form: hidden from people, reachable by bots.
<div aria-hidden="true" style={{ position: 'absolute', left: -10000 }}>
  <label htmlFor="contact-website">Website</label>
  <input id="contact-website" name="website" tabIndex={-1} autoComplete="off"
    value={website} onChange={(event) => setWebsite(event.target.value)} />
</div>

// On submit:
await fetch('/api/contact', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ...values, website, elapsedMs: timer.current?.elapsedMs() }),
});
```

For a plain HTML form, one call adds both fields:

```html
<script type="module">
  import { guardHtmlForm } from 'plumbline-forms/client';
  guardHtmlForm(document.querySelector('#contact-form'));
</script>
```

`HONEYPOT_STYLE` is the inline style string that call uses, for markup you write by hand.

## Probe mode

Set `probeSecret` and the [plumbline checker](../check) can verify the guard on every preview deployment without sending a real enquiry.

A request whose `x-plumbline-probe` header equals the secret is evaluated by the free checks, **never handed back for delivery**, never logged, and never passed to `verifyHuman`. The response is the verdict:

```json
{ "plumbline": { "protocol": 1, "outcome": "block", "reason": "too_fast", "flags": [],
  "form": { "honeypotField": "website", "elapsedField": "elapsedMs", "minFillMs": 3000,
            "nameFields": ["name"], "messageFields": ["message"] } } }
```

Keep the secret out of the page and the repository. Anyone who holds it can learn which checks a submission trips, though never get one delivered. Without a `probeSecret`, or with the wrong header value, the request is treated as an ordinary submission.

## What it does not do

- It does not stop a determined bot that drives a real browser and waits; that is what `verifyHuman` is for.
- It has no rate limiting; it keeps no state between requests.
- The elapsed time is reported by the browser, so a bot written for this guard can fake it. It is a filter for bulk spam, not a proof of humanity.
