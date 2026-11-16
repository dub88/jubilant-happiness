import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFormGuard, PROBE_HEADER, screenSubmission, type FormGuardOptions, type GuardResult, type LogEntry,
} from '../src/index.ts';

const SITE = 'https://www.example.com';
const genuine = { name: 'Jane Doe', email: 'jane@example.org', message: 'Do you cater weddings in June?', website: '', elapsedMs: 9000 };

interface Submit {
  fields?: unknown;
  headers?: Record<string, string>;
  /** Send as a form post instead of JSON. */
  form?: boolean;
  body?: string;
}

function request({ fields = genuine, headers = {}, form = false, body }: Submit = {}): Request {
  const payload =
    body ?? (form ? new URLSearchParams(fields as Record<string, string>).toString() : JSON.stringify(fields));
  return new Request(`${SITE}/api/contact`, {
    method: 'POST',
    headers: {
      host: 'www.example.com',
      origin: SITE,
      'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      ...headers,
    },
    body: payload,
  });
}

/** The response of a submission the guard did not hand back for delivery. */
function refusal(result: GuardResult): Response {
  assert.ok(!result.ok, 'expected the guard to answer the request itself');
  return result.response;
}

/** A guard that records its log lines instead of printing them. */
function guard(options: FormGuardOptions = {}) {
  const log: LogEntry[] = [];
  return { log, ...createFormGuard({ log: (entry) => log.push(entry), ...options }) };
}

test('a genuine submission is accepted', async () => {
  const { check, log } = guard();
  const result = await check(request());
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.deepEqual(result.verdict, { outcome: 'accept', flags: [] });
  assert.equal(result.flagged, false);
  assert.equal(result.allowConfirmation, true);
  assert.equal(result.fields.name, 'Jane Doe');
  assert.deepEqual(log, [
    { event: 'form_submission', outcome: 'accepted', ua: null, country: null, elapsedMs: 9000, msgLen: 30, links: 0 },
  ]);
});

test('a filled honeypot is dropped with a response that looks like success', async () => {
  const { check, log } = guard({ successBody: { received: true } });
  const result = await check(request({ fields: { ...genuine, website: 'https://spam.example' } }));
  assert.ok(!result.ok);
  assert.equal(result.verdict.reason, 'honeypot');
  assert.equal(result.response.status, 200);
  assert.deepEqual(await result.response.json(), { received: true });
  assert.equal(log[0]?.outcome, 'blocked');
  assert.equal(log[0]?.reason, 'honeypot');
});

test('a post from another site, or from no site, is refused', async () => {
  const { check } = guard();
  for (const headers of [{ origin: 'https://elsewhere.example' }, { origin: '' }, { origin: 'null' }]) {
    const result = await check(request({ headers }));
    assert.ok(!result.ok);
    assert.equal(result.verdict.reason, 'cross_site');
    assert.equal(result.response.status, 403);
  }
});

test('the site is recognised by Referer, a forwarded host, or an allowed host', async () => {
  const { check } = guard({ allowedHosts: ['landing.example.net'] });
  const accepted: Record<string, string>[] = [
    { origin: '', referer: `${SITE}/contact` },
    { host: 'internal:3000', 'x-forwarded-host': 'www.example.com' },
    { origin: 'https://landing.example.net' },
  ];
  for (const headers of accepted) assert.equal((await check(request({ headers }))).ok, true, JSON.stringify(headers));
});

test('a submission with no timer, or sent too fast, is dropped silently', async () => {
  const { check } = guard({ minFillMs: 2000 });
  const { elapsedMs: _, ...untimed } = genuine;
  const cases: [unknown, string][] = [
    [untimed, 'no_timer'],
    [{ ...genuine, elapsedMs: 'soon' }, 'no_timer'],
    [{ ...genuine, elapsedMs: 1999 }, 'too_fast'],
  ];
  for (const [fields, reason] of cases) {
    const result = await check(request({ fields }));
    assert.ok(!result.ok);
    assert.equal(result.verdict.reason, reason);
    assert.equal(result.response.status, 200);
  }
  assert.equal((await check(request({ fields: { ...genuine, elapsedMs: 2000 } }))).ok, true);
});

test('form-encoded posts are read, including the elapsed time as text', async () => {
  const { check } = guard();
  const result = await check(request({ form: true, fields: { ...genuine, elapsedMs: '9000' } }));
  assert.ok(result.ok);
  assert.equal(result.fields.message, genuine.message);
});

test('an unreadable body is a 400', async () => {
  const { check } = guard();
  for (const body of ['{"name": ', '[1, 2]', '"text"']) {
    const result = await check(request({ body }));
    assert.ok(!result.ok);
    assert.equal(result.verdict.reason, 'invalid_body');
    assert.equal(result.response.status, 400);
  }
});

test('spam-looking text is flagged, not blocked, and gets no confirmation', async () => {
  const { check, log } = guard();
  const message = 'We offer SEO services. See https://spam.example and www.spam.example/pricing';
  const result = await check(request({ fields: { ...genuine, message } }));
  assert.ok(result.ok);
  assert.equal(result.flagged, true);
  assert.equal(result.allowConfirmation, false);
  assert.deepEqual(result.verdict, { outcome: 'flag', flags: ['links', 'seo'] });
  assert.deepEqual(log[0]?.flags, ['links', 'seo']);
  assert.equal(log[0]?.links, 2);
});

test('content flags: link in a name, extra phrases, and non-Latin text only when asked', () => {
  const headers = new Headers({ host: 'www.example.com', origin: SITE });
  const flagsFor = (fields: object, options?: FormGuardOptions) =>
    screenSubmission(headers, { ...genuine, ...fields }, options).flags;

  assert.deepEqual(flagsFor({ name: 'Visit best-deals.shop' }), ['link_in_name']);
  assert.deepEqual(flagsFor({ message: 'I saw your site at example.com and want a quote.' }), []);
  assert.deepEqual(flagsFor({ message: 'Extended car warranty offer' }, { extraPhrases: [['warranty', /car warranty/i]] }), ['warranty']);

  const russian = 'Здравствуйте, мы предлагаем продвижение сайтов и другие услуги для вашего бизнеса.';
  assert.deepEqual(flagsFor({ message: russian }), []);
  assert.deepEqual(flagsFor({ message: russian }, { flagNonLatin: true }), ['non_latin']);

  // Custom field names.
  const custom = { fullName: 'Jane', enquiry: 'guest post on your blog?', trap: '', ms: 5000 };
  const options = { nameFields: ['fullName'], messageFields: ['enquiry'], honeypotField: 'trap', elapsedField: 'ms' };
  assert.deepEqual(screenSubmission(headers, custom, options), { outcome: 'flag', flags: ['guest_post'] });
  assert.equal(screenSubmission(headers, { ...custom, trap: 'x' }, options).reason, 'honeypot');
});

test('the bot check runs last, blocks on false and lets submissions through when it fails', async (t) => {
  let calls = 0;
  const counting = guard({ verifyHuman: () => (calls++, false) });
  await counting.check(request({ fields: { ...genuine, website: 'x' } }));
  await counting.check(request({ headers: { origin: 'https://elsewhere.example' } }));
  assert.equal(calls, 0, 'not called for submissions the free checks already blocked');

  const blocked = await counting.check(request());
  assert.ok(!blocked.ok);
  assert.equal(calls, 1);
  assert.equal(blocked.verdict.reason, 'bot');
  assert.equal(blocked.response.status, 403);
  assert.equal(counting.log.at(-1)?.botCheck, 'bot');

  const human = guard({ verifyHuman: async () => true });
  assert.equal((await human.check(request())).ok, true);
  assert.equal(human.log[0]?.botCheck, 'human');

  t.mock.method(console, 'error', () => {});
  const failing = guard({
    verifyHuman: () => {
      throw new Error('service unreachable');
    },
  });
  assert.equal((await failing.check(request())).ok, true);
  assert.equal(failing.log[0]?.botCheck, 'error');
});

test('probe mode returns the verdict, delivers nothing and needs the secret', async () => {
  let botChecks = 0;
  const { check, log } = guard({ probeSecret: 'correct horse', verifyHuman: () => (botChecks++, true) });
  const probe = (fields: unknown, headers = {}) =>
    check(request({ fields, headers: { [PROBE_HEADER]: 'correct horse', ...headers } }));

  const accepted = await probe(genuine);
  assert.equal(accepted.ok, false, 'a probe is never handed back for delivery');
  assert.deepEqual(await accepted.response.json(), {
    plumbline: {
      protocol: 1,
      outcome: 'accept',
      flags: [],
      form: { honeypotField: 'website', elapsedField: 'elapsedMs', minFillMs: 3000, nameFields: ['name'], messageFields: ['message'] },
    },
  });

  const empty = await refusal(await probe({})).json();
  assert.equal(empty.plumbline.outcome, 'block');
  assert.equal(empty.plumbline.reason, 'no_timer');
  const crossSite = await refusal(await probe(genuine, { origin: 'https://elsewhere.example' })).json();
  assert.equal(crossSite.plumbline.reason, 'cross_site');

  assert.equal(botChecks, 0, 'the paid bot check is not spent on probes');
  assert.deepEqual(log, [], 'probes are not logged as submissions');

  // The wrong secret, or no secret configured, is an ordinary submission.
  const wrong = await check(request({ fields: {}, headers: { [PROBE_HEADER]: 'guess' } }));
  assert.ok(!wrong.ok);
  assert.deepEqual(await wrong.response.json(), { ok: true });
  const disabled = guard();
  const ignored = await disabled.check(request({ fields: {}, headers: { [PROBE_HEADER]: 'correct horse' } }));
  assert.deepEqual(await refusal(ignored).json(), { ok: true });
});

test('logging can be turned off and defaults to one JSON line', async (t) => {
  const info = t.mock.method(console, 'info', () => {});
  await createFormGuard({ log: false }).check(request());
  assert.equal(info.mock.callCount(), 0);

  await createFormGuard().check(request({ headers: { 'user-agent': 'TestBrowser/1.0', 'x-vercel-ip-country': 'US' } }));
  assert.equal(info.mock.callCount(), 1);
  const line = JSON.parse(String(info.mock.calls[0]?.arguments[0]));
  assert.deepEqual(line, {
    event: 'form_submission', outcome: 'accepted', ua: 'TestBrowser/1.0', country: 'US', elapsedMs: 9000, msgLen: 30, links: 0,
  });
  // Nothing that identifies the sender is logged.
  assert.doesNotMatch(JSON.stringify(line), /Jane|jane@example\.org|wedding/);
});
