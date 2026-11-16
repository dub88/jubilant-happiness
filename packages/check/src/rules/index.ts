import { formRules } from './forms.ts';
import type { RulePack } from './rule.ts';
import { seoRules } from './seo.ts';
import { slopRules } from './slop.ts';

/** Every rule pack the checker runs. New packs register here. */
export const packs: RulePack[] = [
  { name: 'seo', rules: seoRules },
  { name: 'forms', rules: formRules },
  { name: 'slop', rules: slopRules },
];

export type { Problem, Rule, RuleContext, RulePack } from './rule.ts';
