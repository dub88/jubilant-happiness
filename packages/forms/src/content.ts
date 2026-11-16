const LINK = /\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|xyz|ru|info|biz|top|site|online|shop|store)\b/i;
const LINKS = new RegExp(LINK.source, 'gi');

/**
 * Sales-pitch and junk patterns. Phrases, not single words, so a real customer
 * describing their situation does not trip them.
 */
export const DEFAULT_SPAM_PHRASES: readonly (readonly [flag: string, pattern: RegExp])[] = [
  ['seo', /\bseo\b|search engine optimi[sz]ation|backlinks?\b/i],
  ['ranking_pitch', /(first|1st|top) page (of|on) google|rank(ing)? (#?1|higher|first) (on|in) google/i],
  ['web_services', /\b(web|website|app) (design|development|redesign) (services|agency|company)|\bwordpress (developer|expert)/i],
  ['traffic_leads', /(increase|boost|drive) (your )?(website )?(traffic|sales|leads)|lead generation|more (customers|clients) for your/i],
  ['guest_post', /guest post|sponsored (post|article)|link (exchange|insertion)/i],
  ['outsourcing', /virtual assistant|outsourc(e|ing) (team|services)|offshore (team|developers)/i],
  ['finance_junk', /\b(crypto(currency)?|bitcoin|forex|binary options|casino|loan offer|viagra|cialis)\b/i],
];

const NON_LATIN = /[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

export function countLinks(text: string): number {
  return (text.match(LINKS) ?? []).length;
}

export interface ContentOptions {
  phrases: readonly (readonly [string, RegExp])[];
  /** Flag text that is mostly Cyrillic or CJK. Only sensible on a site whose visitors write in Latin script. */
  flagNonLatin: boolean;
}

/**
 * Reasons a submission's text looks like spam. Empty means it looks genuine.
 *
 * These only ever flag a submission; they never block one, so a real enquiry
 * is not thrown away because it contained a link or an unusual phrase.
 */
export function contentFlags(names: string[], messages: string[], options: ContentOptions): string[] {
  const flags: string[] = [];
  const message = messages.join('\n');

  if (countLinks(message) >= 2) flags.push('links');
  if (names.some((name) => LINK.test(name))) flags.push('link_in_name');
  for (const [flag, pattern] of options.phrases) if (pattern.test(message)) flags.push(flag);

  if (options.flagNonLatin) {
    const text = `${names.join('\n')}\n${message}`;
    const letters = text.match(/\p{L}/gu) ?? [];
    const nonLatin = text.match(NON_LATIN) ?? [];
    if (letters.length > 20 && nonLatin.length / letters.length > 0.3) flags.push('non_latin');
  }
  return flags;
}
