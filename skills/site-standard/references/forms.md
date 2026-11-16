# Contact forms that resist spam

A contact form on a small site starts receiving bot submissions within days. Most are scripts that post straight to the endpoint or fill in every field of a scraped form. A few cheap checks stop nearly all of them without a captcha and without sending visitor data to a third party.

## What the form must do

Whatever you build it with, a form endpoint that sends a message should:

1. **Refuse posts that do not come from the site's own pages.** A browser sends `Origin` (and usually `Referer`) with a form post. Reject a request whose origin is another site, or that has neither header.
2. **Have a honeypot.** A text field that people never see or reach, and that bots filling in every field do. Drop any submission that fills it in.
3. **Have a time trap.** The page reports how long the form was open; the server drops submissions that arrive with no time or within a few seconds.
4. **Flag suspicious content without discarding it.** A message full of links or sales patter is probably spam, but it might be a customer. Deliver it marked as possible spam so the owner decides.
5. **Never send a confirmation email to a flagged sender.** A form that emails "thanks, we got your message" to whatever address was typed in lets anyone use the business's domain to send mail to an address of their choosing.
6. **Answer dropped submissions as though they succeeded.** Telling a script which check it failed teaches it to pass that check. The exception is the cross-site refusal, which no real visitor ever sees.
7. **Validate on the server.** Checks in the browser are a convenience; anyone can post to the endpoint directly.
8. **Log outcomes without personal data.** One line per submission (blocked, flagged or accepted, and why) lets the owner see how much spam arrives and which check caught it. No names, addresses or message text.

Run a paid bot-detection service, if the site has one, after these checks, so it is only billed for submissions that passed them. If the service is unreachable, let the submission through: a lost enquiry costs the business more than one spam email.

## Using the plumbline guard

`plumbline-forms` implements points 1 to 6 and 8 for any route that receives a web `Request` (Next.js route handlers, Astro endpoints, Vercel and Cloudflare functions). It has no dependencies.

Until it is published to npm, copy it into the site:

```sh
${CLAUDE_SKILL_DIR}/scripts/vendor-forms.sh src/lib/plumbline-forms
```

Then wire the endpoint:

```ts
import { createFormGuard } from '@/lib/plumbline-forms/index.js';

const guard = createFormGuard({
  probeSecret: process.env.PLUMBLINE_PROBE_SECRET,
  // messageFields: ['message'], nameFields: ['name'], honeypotField: 'website', elapsedField: 'elapsedMs'
});

export async function POST(request: Request) {
  const result = await guard.check(request);
  if (!result.ok) return result.response; // blocked, or a checker probe was answered

  const { fields, flagged, allowConfirmation } = result;
  // 1. Validate fields (the guard screens for spam; it does not validate).
  // 2. Deliver. If flagged, mark it: prefix the subject with "[Possible spam]".
  // 3. Send the sender a confirmation only if allowConfirmation is true.
  return Response.json({ ok: true });
}
```

Set the option names to match the form's real field names. If `messageFields` names a field the form does not have, the content check silently never runs.

`successBody` should match what the endpoint returns on a real success, so a dropped submission is indistinguishable from an accepted one.

### In the page

The page must send the elapsed time and include the honeypot field.

```tsx
import { startFormTimer } from '@/lib/plumbline-forms/client.js';

// Start the timer when the form appears (in an effect, not during render).
const timer = useRef<ReturnType<typeof startFormTimer> | null>(null);
useEffect(() => { timer.current = startFormTimer(); }, []);

// Inside the form. Off-screen, not display:none; out of the tab order and the accessibility tree.
<div aria-hidden="true" style={{ position: 'absolute', left: -10000, width: 1, height: 1, overflow: 'hidden' }}>
  <label htmlFor="contact-website">Website</label>
  <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off"
         value={website} onChange={(event) => setWebsite(event.target.value)} />
</div>

// On submit, send both with the visible fields.
body: JSON.stringify({ ...values, website, elapsedMs: timer.current?.elapsedMs() })
```

For a plain HTML form that posts without JavaScript building the request, `guardHtmlForm(form)` from the client module adds both fields.

Give the honeypot an ordinary-looking name such as `website` or `company`. A field named `honeypot` announces itself.

## Showing the result to the visitor

Tell the visitor plainly whether the message was sent. If the endpoint answers with an error, show another way to get in touch (the phone number or email address) so a real person who was wrongly blocked is not left with nothing. Announce the result to screen readers and move focus to it.

## Checking it

Give the site and the checker the same secret, then name the endpoint:

```sh
PLUMBLINE_PROBE_SECRET=<secret> ${CLAUDE_SKILL_DIR}/scripts/check.sh http://localhost:3000 --form /api/contact
```

The checker sends seven crafted submissions: one normal, one from another site, one with no origin, one with no timer, one sent too fast, one that fills the honeypot, and one sales pitch. It reports any the guard judges wrongly, including a normal one that gets blocked. A guard that recognises the secret runs its checks, delivers nothing and returns its verdict, so probing never sends a real enquiry.

Generate the secret with something like `openssl rand -hex 24`, store it as an environment variable in the hosting platform, and keep it out of the repository and out of client-side code. In a config file, `"forms": [{ "endpoint": "/api/contact", "page": "/contact" }]` also confirms that the page contains the fields the guard expects.

If the form is not built with the guard, the checker reports it as unverified. Test it by hand against the eight points above.

## What these checks do not stop

A bot that drives a real browser, waits a few seconds and leaves the honeypot alone will get through. That is rare for a small site and is what a bot-detection service is for. Say so if the user asks whether the form is "spam-proof"; it is not, and nothing is.
