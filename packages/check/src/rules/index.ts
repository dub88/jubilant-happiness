import { formRules } from './forms.ts';
import type { RulePack } from './rule.ts';
import { seoRules } from './seo.ts';

/** Every rule pack the checker runs. New packs register here. */
export const packs: RulePack[] = [
  { name: 'seo', rules: seoRules },
  { name: 'forms', rules: formRules },
];

export type { Problem, Rule, RulePack } from './rule.ts';
