import type { Site } from '../crawl.ts';
import type { Severity, Thresholds } from '../types.ts';

/** What a rule reports; the runner adds the rule id, pack and severity. */
export interface Problem {
  path: string;
  message: string;
  fix: string;
  /**
   * Distinguishes several findings of one rule on one page, so the baseline
   * comparison can tell them apart. Leave unset when a page can have only one.
   */
  detail?: string;
  needle?: string;
}

export interface Rule {
  id: string;
  severity: Severity;
  /** One line for the rule reference. */
  summary: string;
  check(site: Site, thresholds: Thresholds): Problem[];
}

export interface RulePack {
  name: string;
  rules: Rule[];
}
