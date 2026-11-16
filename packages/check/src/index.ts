/** Programmatic API: run the same audit the command line runs. */
export { audit, compareToBaseline, failures } from './audit.ts';
export type { AuditOptions, AuditResult, FailOn, RuleSetting } from './audit.ts';
export { CrawlError } from './crawl.ts';
export { packs } from './rules/index.ts';
export type { Rule, RulePack } from './rules/index.ts';
export { DEFAULT_THRESHOLDS } from './types.ts';
export type { Finding, FormTarget, Severity, Thresholds } from './types.ts';
