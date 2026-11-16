import type { RulePack } from './rule.ts';
import { seoRules } from './seo.ts';

/** Every rule pack the checker runs. New packs (forms, slop) register here. */
export const packs: RulePack[] = [{ name: 'seo', rules: seoRules }];

export type { Problem, Rule, RulePack } from './rule.ts';
