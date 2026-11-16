import { contentFlags, countLinks, DEFAULT_SPAM_PHRASES } from './content.ts';

export { contentFlags, countLinks, DEFAULT_SPAM_PHRASES } from './content.ts';

/** Request header that carries the probe secret. See FormGuardOptions.probeSecret. */
export const PROBE_HEADER = 'x-plumbline-probe';
export const PROBE_PROTOCOL = 1;

export type BlockReason = 'invalid_body' | 'honeypot' | 'cross_site' | 'no_timer' | 'too_fast' | 'bot';

export interface Verdict {
  /**
   * accept: looks genuine. flag: deliver it, but labelled, and send no
   * confirmation email. block: do not deliver.
   */
  outcome: 'accept' | 'flag' | 'block';
  reason?: BlockReason;
  /** Why the text looks like spam. Present on flagged submissions. */
  flags: string[];
}

export interface LogEntry {
  event: 'form_submission';
  outcome: 'blocked' | 'flagged' | 'accepted';
  reason?: BlockReason;
  flags?: string[];
  /** Result of verifyHuman, when one is configured and was reached. */
  botCheck?: 'human' | 'bot' | 'error';
  [trait: string]: unknown;
}

export interface FormGuardOptions {
  /** A field real visitors never see or fill in; bots that fill every field trip it. Default "website". */
  honeypotField?: string;
  /** The field in which the browser reports how long the form was open, in milliseconds. Default "elapsedMs". */
  elapsedField?: string;
  /** Submissions sent sooner than this after the form appeared are blocked. Default 3000. */
  minFillMs?: number;
  /** Fields holding a person's name, checked for links. Default ["name"]. */
  nameFields?: string[];
  /** Free-text fields, checked for links and sales pitches. Default ["message"]. */
  messageFields?: string[];
  /** Extra phrase patterns that flag a submission, as [flag name, pattern]. */
  extraPhrases?: readonly (readonly [string, RegExp])[];
  /** Flag text that is mostly Cyrillic or CJK. Default false; turn on for a site whose visitors write in Latin script. */
  flagNonLatin?: boolean;
  /** Other hosts whose pages may post to this endpoint, besides the one the request was sent to. */
  allowedHosts?: string[];
  /**
   * A paid or slower bot check (for example a bot-detection service), called
   * last so it only runs for submissions the free checks let through. Return
   * false to block. If it throws, the submission is let through: the free
   * checks have already run, and a lost enquiry is worse than one more spam email.
   */
  verifyHuman?: (request: Request) => boolean | Promise<boolean>;
  /**
   * Enables probe mode for requests whose x-plumbline-probe header equals this
   * secret: the checks run, nothing is delivered, and the verdict is returned.
   * It lets the plumbline checker verify the defences without sending real
   * enquiries. Leave unset to disable. Keep it secret: anyone who has it can
   * see which checks a submission trips.
   */
  probeSecret?: string;
  /** Body of the response to a silently dropped submission. Make it match your real success response. Default { ok: true }. */
  successBody?: unknown;
  /** Where the one-line record of each submission goes. Default: console.info as JSON. false turns it off. */
  log?: false | ((entry: LogEntry) => void);
}

export type GuardResult =
  | {
      /** Do not deliver. Return `response` to the client as it is. */
      ok: false;
      response: Response;
      verdict: Verdict;
    }
  | {
      ok: true;
      /** The parsed request body. Validate it before use; the guard only screens for spam. */
      fields: Record<string, unknown>;
      verdict: Verdict;
      /** Deliver it labelled (for example a "[Possible spam]" subject prefix). */
      flagged: boolean;
      /**
       * False for flagged submissions. Sending a confirmation to an address a
       * suspected bot supplied lets anyone use the form to send mail from your domain.
       */
      allowConfirmation: boolean;
    };

export interface FormGuard {
  check(request: Request): Promise<GuardResult>;
}

type Settings = Required<
  Pick<FormGuardOptions, 'honeypotField' | 'elapsedField' | 'minFillMs' | 'nameFields' | 'messageFields' | 'flagNonLatin' | 'allowedHosts'>
> & { phrases: readonly (readonly [string, RegExp])[] };

function settings(options: FormGuardOptions): Settings {
  return {
    honeypotField: options.honeypotField ?? 'website',
    elapsedField: options.elapsedField ?? 'elapsedMs',
    minFillMs: options.minFillMs ?? 3000,
    nameFields: options.nameFields ?? ['name'],
    messageFields: options.messageFields ?? ['message'],
    flagNonLatin: options.flagNonLatin ?? false,
    allowedHosts: options.allowedHosts ?? [],
    phrases: [...DEFAULT_SPAM_PHRASES, ...(options.extraPhrases ?? [])],
  };
}

/**
 * Whether the request came from one of the site's own pages. Browsers send
 * Origin (and usually Referer) on a form or fetch POST; a script posting
 * straight to the endpoint sends neither, or one that is not this site.
 */
export function isSameSite(headers: Headers, allowedHosts: string[] = []): boolean {
  // || not ??: an empty header is treated as an absent one.
  const host = headers.get('x-forwarded-host') || headers.get('host');
  const source = headers.get('origin') || headers.get('referer');
  if (!host || !source) return false;
  try {
    const sourceHost = new URL(source).host;
    return sourceHost === host || allowedHosts.includes(sourceHost);
  } catch {
    return false;
  }
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return undefined;
}

/**
 * How long the form was open, as reported by the browser, so the visitor's
 * clock never has to agree with the server's. Missing means the request did
 * not come from the form at all.
 */
export function timingProblem(elapsedMs: unknown, minFillMs: number): 'no_timer' | 'too_fast' | null {
  const elapsed = toNumber(elapsedMs);
  if (elapsed === undefined) return 'no_timer';
  return elapsed < minFillMs ? 'too_fast' : null;
}

const texts = (fields: Record<string, unknown>, names: string[]): string[] =>
  names.map((name) => fields[name]).filter((value): value is string => typeof value === 'string');

/** Run the free checks on already-parsed fields. Use this directly when you do not have a web Request. */
export function screenSubmission(headers: Headers, fields: Record<string, unknown>, options: FormGuardOptions = {}): Verdict {
  const config = settings(options);
  const block = (reason: BlockReason): Verdict => ({ outcome: 'block', reason, flags: [] });

  // Blocks are reserved for things a real visitor submitting the form in a browser never does.
  const honeypot = fields[config.honeypotField];
  if (typeof honeypot === 'string' && honeypot.trim() !== '') return block('honeypot');
  if (!isSameSite(headers, config.allowedHosts)) return block('cross_site');
  const timing = timingProblem(fields[config.elapsedField], config.minFillMs);
  if (timing) return block(timing);

  const flags = contentFlags(texts(fields, config.nameFields), texts(fields, config.messageFields), config);
  return { outcome: flags.length > 0 ? 'flag' : 'accept', flags };
}

async function readFields(request: Request): Promise<Record<string, unknown> | undefined> {
  const type = request.headers.get('content-type') ?? '';
  try {
    if (/application\/x-www-form-urlencoded|multipart\/form-data/i.test(type)) {
      const fields: Record<string, unknown> = {};
      for (const [name, value] of await request.formData()) {
        if (typeof value === 'string') fields[name] = value;
      }
      return fields;
    }
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Compare without stopping at the first difference, so timing does not leak the secret. */
function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * What a submission looked like, without who sent it: enough to tell one bot
 * operation from real people. No names, addresses, phone numbers or message text.
 */
function traits(request: Request, fields: Record<string, unknown>, config: Settings): Record<string, unknown> {
  const message = texts(fields, config.messageFields).join('\n');
  const elapsed = toNumber(fields[config.elapsedField]);
  return {
    ua: request.headers.get('user-agent')?.slice(0, 200) ?? null,
    country: request.headers.get('x-vercel-ip-country') ?? request.headers.get('cf-ipcountry'),
    elapsedMs: elapsed === undefined ? null : Math.round(elapsed),
    msgLen: message.length,
    links: countLinks(message),
  };
}

export function createFormGuard(options: FormGuardOptions = {}): FormGuard {
  const config = settings(options);
  const record =
    options.log === false ? undefined : (options.log ?? ((entry: LogEntry) => console.info(JSON.stringify(entry))));
  const success = (): Response => json(options.successBody ?? { ok: true });

  return {
    async check(request) {
      const probing = sameSecret(request.headers.get(PROBE_HEADER), options.probeSecret);
      const fields = await readFields(request);
      let verdict: Verdict = fields
        ? screenSubmission(request.headers, fields, options)
        : { outcome: 'block', reason: 'invalid_body', flags: [] };

      if (probing) {
        const { honeypotField, elapsedField, minFillMs, nameFields, messageFields } = config;
        const answer = {
          protocol: PROBE_PROTOCOL,
          ...verdict,
          form: { honeypotField, elapsedField, minFillMs, nameFields, messageFields },
        };
        return { ok: false, verdict, response: json({ plumbline: answer }) };
      }

      let botCheck: LogEntry['botCheck'];
      if (verdict.outcome !== 'block' && options.verifyHuman) {
        try {
          botCheck = (await options.verifyHuman(request)) ? 'human' : 'bot';
          if (botCheck === 'bot') verdict = { outcome: 'block', reason: 'bot', flags: verdict.flags };
        } catch (error) {
          botCheck = 'error';
          console.error('Form guard: the bot check failed; letting the submission through.', error);
        }
      }

      if (record) {
        const entry: LogEntry = {
          event: 'form_submission',
          outcome: verdict.outcome === 'block' ? 'blocked' : verdict.outcome === 'flag' ? 'flagged' : 'accepted',
        };
        if (verdict.reason) entry.reason = verdict.reason;
        if (verdict.flags.length > 0) entry.flags = verdict.flags;
        if (botCheck) entry.botCheck = botCheck;
        record({ ...entry, ...traits(request, fields ?? {}, config) });
      }

      if (verdict.outcome === 'block' || !fields) {
        switch (verdict.reason) {
          case 'invalid_body':
            return { ok: false, verdict, response: json({ error: 'Invalid request body.' }, 400) };
          // No real visitor's browser ever sees this one, and a misjudged
          // visitor should see an error, not a false "message received".
          case 'cross_site':
          case 'bot':
            return { ok: false, verdict, response: json({ error: 'Forbidden.' }, 403) };
          // Answer as if it worked: telling a scraper which check it tripped
          // teaches it to get past that check next time.
          default:
            return { ok: false, verdict, response: success() };
        }
      }

      const flagged = verdict.outcome === 'flag';
      return { ok: true, fields, verdict, flagged, allowConfirmation: !flagged };
    },
  };
}
