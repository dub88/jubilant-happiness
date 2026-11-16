/**
 * Browser-side helpers for a form protected by createFormGuard.
 *
 * The server needs two things from the page: how long the form was open
 * before it was submitted, and a honeypot field that real visitors never
 * see or fill in.
 */

export interface FormTimer {
  /** Milliseconds since the timer started. Send this as the elapsed field. */
  elapsedMs(): number;
}

/** Start timing when the form appears (for example in an effect that runs on mount). */
export function startFormTimer(): FormTimer {
  const shownAt = performance.now();
  return { elapsedMs: () => Math.round(performance.now() - shownAt) };
}

/**
 * Inline style for the element that wraps the honeypot field. It moves the
 * field off-screen instead of using display:none, which some bots skip.
 * Also give the wrapper aria-hidden="true" and the input tabindex="-1" and
 * autocomplete="off", so keyboard and screen-reader users never reach it.
 */
export const HONEYPOT_STYLE = 'position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden';

export interface GuardHtmlFormOptions {
  honeypotField?: string;
  elapsedField?: string;
}

/**
 * Prepare a plain HTML form (one that submits without JavaScript building the
 * request): adds the hidden honeypot field if the form has none, and a hidden
 * field that is filled with the elapsed time on submit.
 */
export function guardHtmlForm(form: HTMLFormElement, options: GuardHtmlFormOptions = {}): void {
  const honeypotField = options.honeypotField ?? 'website';
  const elapsedField = options.elapsedField ?? 'elapsedMs';
  const timer = startFormTimer();

  if (!form.elements.namedItem(honeypotField)) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.setAttribute('style', HONEYPOT_STYLE);
    const input = document.createElement('input');
    input.type = 'text';
    input.name = honeypotField;
    input.tabIndex = -1;
    input.autocomplete = 'off';
    wrapper.append(input);
    form.append(wrapper);
  }

  const elapsed = document.createElement('input');
  elapsed.type = 'hidden';
  elapsed.name = elapsedField;
  form.append(elapsed);
  form.addEventListener('submit', () => {
    elapsed.value = String(timer.elapsedMs());
  });
}
