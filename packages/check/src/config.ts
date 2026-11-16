import { readFile } from 'node:fs/promises';
import type { FailOn, RuleSetting } from './audit.ts';
import type { FormTarget, Thresholds } from './types.ts';

export const DEFAULT_CONFIG_FILE = 'plumbline.config.json';

/** Settings that can be given once for every site, or per site. */
export interface SiteSettings {
  /** Production URL to compare against; only problems it does not already have are reported. */
  baseline?: string;
  /** The origin the site calls itself, when it differs from the URL being crawled. */
  canonicalOrigin?: string;
  maxPages?: number;
  failOn?: FailOn;
  thresholds?: Partial<Thresholds>;
  rules?: Record<string, RuleSetting>;
  ignorePaths?: string[];
  /** Form endpoints to probe, e.g. [{ "endpoint": "/api/contact", "page": "/contact" }]. */
  forms?: FormTarget[];
}

export interface SiteConfig extends SiteSettings {
  name?: string;
  url: string;
}

export interface Config extends SiteSettings {
  url?: string;
  /** Several sites to audit in one run. */
  sites?: SiteConfig[];
}

export class ConfigError extends Error {}

export async function loadConfig(path: string, required: boolean): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new ConfigError(`Could not read ${path}.`);
  }
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new ConfigError(`${path} must contain a JSON object.`);
  }
  const { sites } = config as Config;
  if (sites !== undefined && (!Array.isArray(sites) || sites.some((site) => typeof site?.url !== 'string'))) {
    throw new ConfigError(`${path}: "sites" must be a list of objects that each have a "url".`);
  }
  return config as Config;
}

/** The sites to audit: the URL given on the command line, or else the ones in the config. */
export function resolveSites(config: Config, url: string | undefined, overrides: SiteSettings): SiteConfig[] {
  const { url: configUrl, sites, ...shared } = config;
  const merge = (site: SiteConfig): SiteConfig => ({
    ...shared,
    ...site,
    ...overrides,
    thresholds: { ...shared.thresholds, ...site.thresholds },
    rules: { ...shared.rules, ...site.rules },
    ignorePaths: [...(shared.ignorePaths ?? []), ...(site.ignorePaths ?? []), ...(overrides.ignorePaths ?? [])],
    forms: [...(site.forms ?? shared.forms ?? []), ...(overrides.forms ?? [])],
  });
  if (url) return [merge({ url })];
  if (sites && sites.length > 0) return sites.map(merge);
  if (configUrl) return [merge({ url: configUrl })];
  return [];
}
