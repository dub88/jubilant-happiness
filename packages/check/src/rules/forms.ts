import type { Site } from '../crawl.ts';
import type { FormProbe, PageData, ProbeAnswer, ProbeScenario } from '../types.ts';
import type { Problem, Rule } from './rule.ts';

const describe = (answer: ProbeAnswer): string =>
  answer.outcome === 'block'
    ? `blocked (${answer.reason ?? 'no reason given'})`
    : answer.outcome === 'flag'
      ? `flagged as spam (${answer.flags.join(', ')})`
      : 'accepted';

/** A rule that expects one or more probe scenarios to be blocked. */
function mustBlock(
  id: string,
  summary: string,
  scenarios: [ProbeScenario, what: string][],
  fix: string,
): Rule {
  return {
    id,
    severity: 'error',
    summary,
    check: (site) => {
      const problems: Problem[] = [];
      for (const probe of site.formProbes) {
        for (const [scenario, what] of scenarios) {
          const answer = probe.answers[scenario];
          if (!answer || answer.outcome === 'block') continue;
          problems.push({ path: probe.endpoint, message: `${what} is ${describe(answer)}.`, fix, detail: scenario });
        }
      }
      return problems;
    },
  };
}

function unansweredProblem(probe: FormProbe): Problem | undefined {
  if (probe.status === 'no-secret') {
    return {
      path: probe.endpoint,
      message: 'The form endpoint was not probed: no probe secret was given.',
      fix: "Set PLUMBLINE_PROBE_SECRET to the secret the site's form guard uses.",
    };
  }
  if (probe.status === 'unanswered') {
    return {
      path: probe.endpoint,
      message: `The form endpoint did not answer the probe: ${probe.detail}.`,
      fix: 'Protect the endpoint with plumbline-forms and give it the same probe secret.',
    };
  }
  return undefined;
}

/** The page a probe's form is shown on, when one was configured. `page` is unset if it could not be read. */
function formPage(site: Site, probe: FormProbe): { key: string; page: PageData | undefined } | undefined {
  if (!probe.page) return undefined;
  const key = site.keyOf(new URL(probe.page, site.crawlOrigin).href);
  return { key, page: site.page(key) };
}

export const formRules: Rule[] = [
  {
    id: 'form-probe-unanswered',
    severity: 'warning',
    summary: "A configured form endpoint could not be probed, so its defences are unverified.",
    check: (site) => site.formProbes.map(unansweredProblem).filter((problem) => problem !== undefined),
  },
  {
    id: 'form-blocks-genuine',
    severity: 'error',
    summary: 'A normal submission from the site itself is blocked or flagged.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const probe of site.formProbes) {
        const answer = probe.answers.genuine;
        if (!answer || answer.outcome === 'accept') continue;
        problems.push({
          path: probe.endpoint,
          message: `A normal submission from the site's own page is ${describe(answer)}.`,
          fix:
            answer.reason === 'cross_site'
              ? "The endpoint does not recognise the site's own host: check the Host or X-Forwarded-Host header it receives, or add the host to allowedHosts."
              : 'Loosen the check that caught it; real enquiries are being lost.',
        });
      }
      return problems;
    },
  },
  mustBlock(
    'form-accepts-cross-site',
    'The form endpoint accepts a submission posted from another site.',
    [['cross-site', 'A submission posted from another site']],
    "Reject requests whose Origin or Referer is not the site's own host.",
  ),
  mustBlock(
    'form-accepts-no-origin',
    'The form endpoint accepts a submission that carries no Origin or Referer.',
    [['no-origin', 'A submission with no Origin or Referer header, as a script sends']],
    'Reject requests that carry neither header; browsers always send one on a form post.',
  ),
  mustBlock(
    'form-accepts-instant',
    'The form endpoint accepts a submission sent without a timer, or faster than a person can type.',
    [
      ['no-timer', 'A submission that does not report how long the form was open'],
      ['too-fast', 'A submission sent 50 ms after the form appeared'],
    ],
    'Require the elapsed-time field and a minimum fill time of a few seconds.',
  ),
  mustBlock(
    'form-accepts-honeypot',
    'The form endpoint accepts a submission that filled in the honeypot field.',
    [['honeypot', 'A submission with the honeypot field filled in']],
    'Drop submissions whose honeypot field is not empty.',
  ),
  {
    id: 'form-misses-spam',
    severity: 'warning',
    summary: 'An obvious sales pitch with links is accepted without being flagged.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const probe of site.formProbes) {
        if (probe.answers['spam-content']?.outcome !== 'accept') continue;
        problems.push({
          path: probe.endpoint,
          message: 'An SEO sales pitch with two links is accepted without being flagged.',
          fix: 'Check that the guard is told which fields hold the message (messageFields).',
        });
      }
      return problems;
    },
  },
  {
    id: 'form-honeypot-not-rendered',
    severity: 'warning',
    summary: 'The page that shows the form does not contain the honeypot field.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const probe of site.formProbes) {
        const form = formPage(site, probe);
        if (!form || !probe.honeypotField) continue;
        if (!form.page) {
          problems.push({
            path: form.key,
            message: `The form page ${form.key} could not be read, so its fields were not checked.`,
            fix: 'Check the "page" given for this form.',
          });
        } else if (!form.page.inputNames.includes(probe.honeypotField)) {
          problems.push({
            path: form.key,
            message: `The form page has no field named "${probe.honeypotField}", the honeypot the endpoint expects.`,
            fix: `Render a hidden, off-screen input named "${probe.honeypotField}" inside the form.`,
          });
        }
      }
      return problems;
    },
  },
  {
    id: 'form-message-field-missing',
    severity: 'warning',
    summary: 'The endpoint scans a field for spam text that the form page does not have.',
    check: (site) => {
      const problems: Problem[] = [];
      for (const probe of site.formProbes) {
        const page = formPage(site, probe)?.page;
        if (!page) continue;
        for (const field of probe.messageFields ?? []) {
          if (page.inputNames.includes(field)) continue;
          problems.push({
            path: page.key,
            message: `The endpoint scans a field named "${field}" for spam, but the form page has no such field.`,
            fix: "Set the guard's messageFields to the names of the form's free-text fields.",
            detail: field,
          });
        }
      }
      return problems;
    },
  },
];
