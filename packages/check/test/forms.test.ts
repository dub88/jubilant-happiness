import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createFormGuard, type FormGuardOptions } from '../../forms/src/index.ts';
import { audit, type AuditResult } from '../src/audit.ts';
import { jsonLd, page, serve, sitemap, type Handler, type Routes } from './helpers.ts';

const SECRET = 'probe-secret-for-tests';

/** A contact endpoint protected by the real form guard, counting what it would have delivered. */
function contactEndpoint(options: FormGuardOptions = {}): { handler: Handler; delivered: () => number } {
  const guard = createFormGuard({ probeSecret: SECRET, log: false, ...options });
  let delivered = 0;
  return {
    delivered: () => delivered,
    handler: async (request) => {
      const result = await guard.check(request);
      if (!result.ok) return result.response;
      delivered++;
      return Response.json({ ok: true });
    },
  };
}

const HONEYPOT = '<div aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>';

function routes(origin: string, contact: Handler, form = HONEYPOT): ReturnType<Routes> {
  return {
    '/': page({
      origin,
      path: '/',
      head: jsonLd({ '@context': 'https://schema.org', '@type': 'Bakery', name: 'Example Bakery' }),
      body: '<h1>Example Bakery</h1><a href="/contact">Contact</a>',
    }),
    '/contact': page({
      origin,
      path: '/contact',
      body: `<h1>Contact us</h1><form><input name="name"><textarea name="message"></textarea>${form}</form>`,
    }),
    '/api/contact': contact,
    '/hero.jpg': { headers: { 'content-type': 'image/jpeg' }, body: 'jpeg' },
    '/robots.txt': `Sitemap: ${origin}/sitemap.xml\n`,
    '/sitemap.xml': sitemap([`${origin}/`, `${origin}/contact`]),
  };
}

async function auditForms(
  t: TestContext,
  build: (origin: string) => ReturnType<Routes>,
  secret: string | undefined = SECRET,
): Promise<AuditResult> {
  const server = await serve(build);
  t.after(() => server.close());
  const options: Parameters<typeof audit>[0] = { url: server.origin, forms: [{ endpoint: '/api/contact', page: '/contact' }] };
  if (secret) options.probeSecret = secret;
  return audit(options);
}

const found = (result: AuditResult): string[] => result.findings.map((finding) => `${finding.rule} ${finding.path}: ${finding.message}`);

test('a guarded form passes every probe and nothing is delivered', async (t) => {
  const contact = contactEndpoint();
  const result = await auditForms(t, (origin) => routes(origin, contact.handler));
  assert.deepEqual(found(result), []);
  assert.equal(contact.delivered(), 0);
});

test('a guard with its time trap switched off is reported', async (t) => {
  const contact = contactEndpoint({ minFillMs: 0 });
  const result = await auditForms(t, (origin) => routes(origin, contact.handler));
  assert.deepEqual(found(result), [
    'form-accepts-instant /api/contact: A submission sent 50 ms after the form appeared is accepted.',
  ]);
  assert.equal(result.findings[0]?.severity, 'error');
});

test('a guard whose field names do not match the form on the page is reported', async (t) => {
  const contact = contactEndpoint({ messageFields: ['comments'], honeypotField: 'company' });
  const result = await auditForms(t, (origin) => routes(origin, contact.handler));
  assert.deepEqual(found(result), [
    'form-honeypot-not-rendered /contact: The form page has no field named "company", the honeypot the endpoint expects.',
    'form-message-field-missing /contact: The endpoint scans a field named "comments" for spam, but the form page has no such field.',
  ]);
});

test('a form page that cannot be read is reported', async (t) => {
  const contact = contactEndpoint();
  const server = await serve((origin) => routes(origin, contact.handler));
  t.after(() => server.close());
  const result = await audit({ url: server.origin, probeSecret: SECRET, forms: [{ endpoint: '/api/contact', page: '/get-in-touch' }] });
  assert.deepEqual(found(result), [
    'form-honeypot-not-rendered /get-in-touch: The form page /get-in-touch could not be read, so its fields were not checked.',
  ]);
});

test('an endpoint that blocks its own site is reported as losing real enquiries', async (t) => {
  // Behind a proxy that rewrites Host, the guard no longer recognises the site's own pages.
  const guarded = contactEndpoint();
  const behindProxy: Handler = (request) => {
    const headers = new Headers(request.headers);
    headers.set('host', 'internal-service:3000');
    return guarded.handler(new Request(request, { headers }));
  };
  const result = await auditForms(t, (origin) => routes(origin, behindProxy));
  assert.deepEqual(found(result), [
    "form-blocks-genuine /api/contact: A normal submission from the site's own page is blocked (cross_site).",
  ]);
  assert.match(result.findings[0]?.fix ?? '', /X-Forwarded-Host/);
});

test('an endpoint with no defences that still speaks the protocol fails every scenario', async (t) => {
  // Stands in for a hand-written or misconfigured guard that answers probes but blocks nothing.
  const open: Handler = () =>
    Response.json({
      plumbline: {
        protocol: 1,
        outcome: 'accept',
        flags: [],
        form: { honeypotField: 'website', elapsedField: 'elapsedMs', minFillMs: 3000, nameFields: ['name'], messageFields: ['message'] },
      },
    });
  const result = await auditForms(t, (origin) => routes(origin, open));
  assert.deepEqual(result.findings.map((finding) => finding.rule).sort(), [
    'form-accepts-cross-site', 'form-accepts-honeypot', 'form-accepts-instant', 'form-accepts-instant',
    'form-accepts-no-origin', 'form-misses-spam',
  ]);
});

test('an endpoint that does not speak the protocol gets one empty request and is reported unverified', async (t) => {
  const bodies: string[] = [];
  const plain: Handler = async (request) => {
    bodies.push(await request.text());
    return Response.json({ error: 'Invalid form submission.' }, { status: 422 });
  };
  const result = await auditForms(t, (origin) => routes(origin, plain));
  assert.deepEqual(found(result), [
    'form-probe-unanswered /api/contact: The form endpoint did not answer the probe: it answered 422, and it did not return a probe verdict.',
  ]);
  assert.deepEqual(bodies, ['{}'], 'no filled-in submission is ever sent to an endpoint that might deliver it');
});

test('the wrong secret, or none, verifies nothing and delivers nothing', async (t) => {
  const contact = contactEndpoint();
  const wrong = await auditForms(t, (origin) => routes(origin, contact.handler), 'not-the-secret');
  // The guard treats the empty probe as an ordinary submission and silently drops it.
  assert.deepEqual(found(wrong), [
    'form-probe-unanswered /api/contact: The form endpoint did not answer the probe: it answered 200, and it did not return a probe verdict.',
  ]);

  let requests = 0;
  const counting: Handler = (request) => (requests++, contact.handler(request));
  const server = await serve((origin) => routes(origin, counting));
  t.after(() => server.close());
  const none = await audit({ url: server.origin, forms: [{ endpoint: '/api/contact' }] });
  assert.deepEqual(found(none), ['form-probe-unanswered /api/contact: The form endpoint was not probed: no probe secret was given.']);
  assert.equal(requests, 0);
  assert.equal(contact.delivered(), 0);
});

test('sites with no forms configured are not probed', async (t) => {
  let requests = 0;
  const counting: Handler = () => (requests++, Response.json({ ok: true }));
  const server = await serve((origin) => routes(origin, counting));
  t.after(() => server.close());
  const result = await audit({ url: server.origin, probeSecret: SECRET });
  assert.deepEqual(found(result), []);
  assert.equal(requests, 0);
});

test('the command line probes a form given --form and the secret in the environment', async (t) => {
  const run = promisify(execFile);
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const contact = contactEndpoint({ minFillMs: 0 });
  const server = await serve((origin) => routes(origin, contact.handler));
  t.after(() => server.close());

  const args = [cli, 'check', server.origin, '--form', '/api/contact', '--json'];
  const failed = await run(process.execPath, args, { env: { ...process.env, PLUMBLINE_PROBE_SECRET: SECRET } }).catch(
    (error: { code: number; stdout: string }) => error,
  );
  assert.equal('code' in failed ? failed.code : 0, 1);
  const [result] = JSON.parse(failed.stdout) as AuditResult[];
  assert.deepEqual(result?.findings.map((finding) => `${finding.pack} ${finding.rule}`), ['forms form-accepts-instant']);

  // Without the secret the run still passes by default: an unverified form is a warning.
  const { PLUMBLINE_PROBE_SECRET: _, ...env } = process.env;
  const unverified = await run(process.execPath, args, { env });
  const [warned] = JSON.parse(unverified.stdout) as AuditResult[];
  assert.deepEqual(warned?.findings.map((finding) => `${finding.severity} ${finding.rule}`), ['warning form-probe-unanswered']);
  assert.equal(contact.delivered(), 0);
});
