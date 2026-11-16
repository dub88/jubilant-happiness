import type { Site } from './crawl.ts';
import type { FormProbe, FormTarget, ProbeAnswer, ProbeScenario } from './types.ts';

const PROBE_HEADER = 'x-plumbline-probe';
const PROBE_PROTOCOL = 1;
const USER_AGENT = 'plumbline/0.1 (form probe)';
const OTHER_SITE = 'https://cross-site.plumbline.invalid';

/** What the endpoint's form guard says about its own field names. */
interface FormShape {
  honeypotField: string;
  elapsedField: string;
  minFillMs: number;
  nameFields: string[];
  messageFields: string[];
}

interface Reply {
  answer?: ProbeAnswer;
  form?: FormShape;
  /** Why there is no answer. */
  problem?: string;
}

export interface ProbeOptions {
  forms: FormTarget[];
  /** The secret the site's form guard was given. Without it nothing is sent. */
  secret?: string;
  /** Extra request headers, e.g. a deployment-protection bypass token. */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function parseReply(body: unknown): Reply {
  const reply = (body as { plumbline?: Record<string, unknown> } | null)?.plumbline;
  if (!reply || reply.protocol !== PROBE_PROTOCOL) return { problem: 'it did not return a probe verdict' };
  const { outcome, reason, flags, form } = reply;
  if (outcome !== 'accept' && outcome !== 'flag' && outcome !== 'block') return { problem: 'its probe verdict is malformed' };
  const answer: ProbeAnswer = { outcome, flags: Array.isArray(flags) ? flags.map(String) : [] };
  if (typeof reason === 'string') answer.reason = reason;
  return { answer, form: form as FormShape };
}

async function send(
  url: string,
  fields: Record<string, unknown>,
  origin: string | undefined,
  options: ProbeOptions,
): Promise<Reply> {
  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    'content-type': 'application/json',
    accept: 'application/json',
    ...options.headers,
    [PROBE_HEADER]: options.secret ?? '',
  };
  if (origin) headers.origin = origin;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(fields),
      redirect: 'manual',
      // No Referer, so the "no-origin" scenario really carries neither header.
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { problem: `it answered ${response.status} without a probe verdict` };
    }
    const reply = parseReply(body);
    return reply.problem ? { problem: `it answered ${response.status}, and ${reply.problem}` } : reply;
  } catch (error) {
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    return { problem: `the request failed: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

/**
 * Send a handful of crafted submissions to each form endpoint and record the
 * guard's verdict on each.
 *
 * Every request carries the probe secret, and a guard that recognises it
 * delivers nothing. The first request has an empty body: an endpoint that
 * does not speak the probe protocol gets only that, never a filled-in form.
 */
export async function probeForms(site: Site, options: ProbeOptions): Promise<FormProbe[]> {
  const probes: FormProbe[] = [];
  for (const target of options.forms) {
    const probe: FormProbe = { ...target, status: 'answered', answers: {} };
    probes.push(probe);
    if (!options.secret) {
      probe.status = 'no-secret';
      continue;
    }
    const url = new URL(target.endpoint, site.crawlOrigin).href;
    const sameSite = site.crawlOrigin;

    const first = await send(url, {}, sameSite, options);
    if (!first.answer || !first.form) {
      probe.status = 'unanswered';
      probe.detail = first.problem ?? 'its probe verdict is malformed';
      continue;
    }
    const form = first.form;
    probe.honeypotField = form.honeypotField;
    probe.messageFields = form.messageFields;
    probe.answers['no-timer'] = first.answer;

    const genuine: Record<string, unknown> = {
      email: 'probe@example.com',
      [form.honeypotField]: '',
      [form.elapsedField]: form.minFillMs + 5000,
    };
    for (const name of form.nameFields) genuine[name] = 'Plumbline Probe';
    for (const name of form.messageFields) genuine[name] = 'Hello, could you tell me your opening hours next week? Thank you.';
    const spam = { ...genuine };
    for (const name of form.messageFields) {
      spam[name] = 'We offer SEO services to put you on the first page of Google. See https://spam.example and https://spam.example/pricing';
    }

    const scenarios: [ProbeScenario, Record<string, unknown>, string | undefined][] = [
      ['genuine', genuine, sameSite],
      ['cross-site', genuine, OTHER_SITE],
      ['no-origin', genuine, undefined],
      ['too-fast', { ...genuine, [form.elapsedField]: 50 }, sameSite],
      ['honeypot', { ...genuine, [form.honeypotField]: 'https://spam.example' }, sameSite],
      ['spam-content', spam, sameSite],
    ];
    for (const [scenario, fields, origin] of scenarios) {
      const reply = await send(url, fields, origin, options);
      if (!reply.answer) {
        probe.status = 'unanswered';
        probe.detail = reply.problem ?? 'its probe verdict is malformed';
        break;
      }
      probe.answers[scenario] = reply.answer;
    }
  }
  return probes;
}
