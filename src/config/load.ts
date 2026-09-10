import { loadConfig } from 'c12';
import { defu } from 'defu';

import { logWarn } from '../lib/log.js';
import { discoverFioriSystems } from './fiori.js';
import {
  AppConfigFileSchema,
  type ConfigError,
  type ResolvedAppConfig,
  type ResolvedSystem,
  SystemConfigSchema,
} from './schema.js';

/** Base name c12 uses to find mcp-abap-adt.config.{ts,jsonc,yaml,...} and rc files. */
export const CONFIG_NAME = 'mcp-abap-adt';

/** Name of the system synthesised from the SAP_* environment variables. */
export const ENV_SYSTEM_NAME = 'default';

const ENV_KEYS = ['SAP_URL', 'SAP_USERNAME', 'SAP_PASSWORD', 'SAP_CLIENT'] as const;

/** Replaced by SAP_ALLOW_SELF_SIGNED, which matches the config key and its polarity. */
const LEGACY_TLS_ENV = 'TLS_REJECT_UNAUTHORIZED';

export interface LoadAppConfigOptions {
  cwd?: string;
  /** Explicit config file path; also read from MCP_ABAP_ADT_CONFIG. */
  configFile?: string;
  env?: NodeJS.ProcessEnv;
  /** Home directory to search for the Fiori tools store (tests override this). */
  homeDir?: string;
  /** Settings from the command line, which win over the file and the environment. */
  overrides?: AppConfigOverrides;
}

/**
 * Anything the config file can express, supplied without a file. JSON carries
 * its own types, which a flat environment variable cannot: `client` has to stay
 * the string "100" rather than becoming the number 100.
 */
export interface AppConfigOverrides {
  defaultSystem?: string;
  importFioriSystems?: boolean;
  systems?: Record<string, unknown>;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  const normalised = value?.trim().toLowerCase();
  if (!normalised) return undefined;
  if (['1', 'true', 'yes'].includes(normalised)) return true;
  if (['0', 'false', 'no'].includes(normalised)) return false;
  return undefined;
}

/**
 * Reads settings from the environment: the whole configuration as JSON in
 * MCP_ABAP_ADT_CONFIG_JSON, plus flat variables for the two that are wanted
 * often enough to deserve a short spelling of their own.
 */
function readEnvConfig(env: NodeJS.ProcessEnv, errors: ConfigError[], sources: string[]): AppConfigOverrides {
  const overrides: AppConfigOverrides = {};

  const json = env.MCP_ABAP_ADT_CONFIG_JSON?.trim();
  if (json) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('the value is not a JSON object');
      }
      Object.assign(overrides, parsed);
      sources.push('MCP_ABAP_ADT_CONFIG_JSON');
    } catch (error) {
      errors.push({
        scope: 'global',
        message: `MCP_ABAP_ADT_CONFIG_JSON could not be read: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const importFiori = parseBoolean(env.SAP_IMPORT_FIORI_SYSTEMS);
  if (importFiori !== undefined) {
    overrides.importFioriSystems = importFiori;
    sources.push('SAP_IMPORT_FIORI_SYSTEMS');
  }

  const defaultSystem = env.SAP_DEFAULT_SYSTEM?.trim();
  if (defaultSystem) {
    overrides.defaultSystem = defaultSystem;
    sources.push('SAP_DEFAULT_SYSTEM');
  }

  return overrides;
}

export function formatIssues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Lays a config-file entry over an imported system so an override only has to
 * name what it changes. Without this, adjusting one setting on a system that
 * came from the SAP Fiori tools store would mean repeating its url and client.
 */
function mergeOverride(base: ResolvedSystem, override: unknown): unknown {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override;
  const explicit = Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined));
  return { ...base, ...explicit };
}

/**
 * Loads the server configuration from a config file, the SAP Fiori tools store
 * and the SAP_* environment variables.
 *
 * This function never throws. A stdio MCP server that dies before the
 * handshake surfaces in clients as an opaque "server failed to start", so
 * every problem is collected in `errors` instead and reported through the
 * ListSystems tool and stderr.
 */
export async function loadAppConfig(options: LoadAppConfigOptions = {}): Promise<ResolvedAppConfig> {
  const env = options.env ?? process.env;
  const errors: ConfigError[] = [];
  const sources: string[] = [];
  const systems = new Map<string, ResolvedSystem>();

  // Precedence: command line over environment over file. c12 applies
  // `overrides` above every discovered layer and merges with defu, which is a
  // deep merge, so `systems` combines entry by entry rather than being
  // replaced. A file is therefore optional; the common setup needs none.
  const overrides = defu(options.overrides ?? {}, readEnvConfig(env, errors, sources));

  let rawConfig: unknown = {};
  try {
    const loaded = await loadConfig<AppConfigOverrides>({
      name: CONFIG_NAME,
      cwd: options.cwd,
      configFile: options.configFile ?? env.MCP_ABAP_ADT_CONFIG,
      dotenv: true,
      // Also reads .mcp-abap-adtrc from the user's config directory, which is
      // the only way to configure the server once for several MCP clients: a
      // client spawns it with a filtered environment, so a machine-wide
      // MCP_ABAP_ADT_CONFIG never arrives. rc files coerce types, which the
      // client field allows for.
      globalRc: true,
      overrides,
    });
    rawConfig = loaded.config ?? {};
    for (const layer of loaded.layers ?? []) {
      if (layer.configFile) sources.push(layer.configFile);
    }
  } catch (error) {
    errors.push({
      scope: 'global',
      message: `Could not read the configuration: ${error instanceof Error ? error.message : String(error)}`,
    });
    // Losing the file must not lose the command line and the environment too.
    rawConfig = overrides;
  }

  const appParsed = AppConfigFileSchema.safeParse(rawConfig);
  const app = appParsed.success ? appParsed.data : { defaultSystem: undefined, importFioriSystems: false, systems: {} };
  if (!appParsed.success) {
    errors.push({
      scope: 'global',
      message: `Invalid configuration: ${formatIssues(appParsed.error)}`,
    });
  }

  // Imported systems are resolved first so config-file entries can override
  // individual settings on them instead of replacing them wholesale.
  const imported = new Map<string, ResolvedSystem>();
  if (app.importFioriSystems) {
    const discovered = await discoverFioriSystems(options.homeDir);
    errors.push(...discovered.errors);
    sources.push(...discovered.sources);
    for (const [name, system] of discovered.systems) {
      imported.set(name, { ...system, origin: 'fiori-tools' });
    }
  }

  for (const [name, value] of Object.entries(app.systems)) {
    const base = imported.get(name);
    const parsed = SystemConfigSchema.safeParse(base ? mergeOverride(base, value) : value);
    if (!parsed.success) {
      // A broken override leaves the imported system in place rather than
      // removing it: a typo in one optional setting should not cost access to
      // the whole system. Entries with no import to fall back on are dropped.
      errors.push({
        scope: `system:${name}`,
        message: base
          ? `The override for imported system "${name}" was ignored, the imported settings are used instead: ${formatIssues(parsed.error)}`
          : `Invalid system "${name}": ${formatIssues(parsed.error)}`,
      });
      continue;
    }
    imported.delete(name);
    systems.set(name, { ...parsed.data, origin: base ? 'fiori-tools' : 'config-file' });
    if (parsed.data.password) {
      logWarn(
        `system "${name}" has a plaintext password in the configuration file. Prefer "passwordEnv" or "keychain": true.`,
      );
    }
  }

  for (const [name, system] of imported) systems.set(name, system);

  applyEnvFallback({ env, systems, errors, sources });

  // Over the final set, so imported and SAP_* systems are covered too.
  // Allowed, because local trial systems speak plain http; but said once.
  for (const [name, system] of systems) {
    if (system.url.startsWith('http:')) {
      logWarn(`system "${name}" uses plain http, so its password travels unencrypted. Fine for a local sandbox only.`);
    }
  }

  const defaultSystem = resolveDefaultSystem(app.defaultSystem, systems, errors);

  if (systems.size === 0) {
    errors.push({
      scope: 'global',
      message: await describeNothingConfigured(app.importFioriSystems, options.homeDir),
    });
  }

  return { defaultSystem, systems, errors, sources };
}

/** Names at most this many systems before summarising the rest. */
const HINT_LIMIT = 5;

/**
 * The message for a server with nothing to connect to.
 *
 * When importing was not asked for, this looks in the SAP Fiori tools store to
 * report what is sitting there unused. Naming the systems is the difference
 * between a wall of options and one that obviously applies. Adopting them
 * without being asked would be something else entirely: it would hand a model
 * read access to every system a developer has saved, production included, which
 * is why `importFioriSystems` stays off by default.
 *
 * Only the store's metadata is read, never a credential; those live in the OS
 * keychain and are fetched per system on its first request.
 */
async function describeNothingConfigured(importedAlready: boolean, homeDir?: string): Promise<string> {
  const base = 'No SAP system is configured.';
  const routes =
    'Create an mcp-abap-adt.config.jsonc file with a "systems" entry, or set SAP_URL, SAP_USERNAME, SAP_PASSWORD and SAP_CLIENT.';

  if (!importedAlready) {
    const available = await findImportableSystems(homeDir);
    if (available.length > 0) {
      const shown = available.slice(0, HINT_LIMIT).join(', ');
      const rest = available.length - HINT_LIMIT;
      const listed = rest > 0 ? `${shown} and ${rest} more` : shown;
      return `${base} ${available.length} system${available.length === 1 ? '' : 's'} saved by the SAP Fiori tools VS Code extension could be used (${listed}): set "importFioriSystems": true, or SAP_IMPORT_FIORI_SYSTEMS=true, to adopt them together with their stored passwords. ${routes}`;
    }
  }

  return `${base} ${importedAlready ? routes : `Set "importFioriSystems": true to adopt systems saved by the SAP Fiori tools VS Code extension. ${routes}`}`;
}

/** A look, not a load: discovery problems are somebody else's message. */
async function findImportableSystems(homeDir?: string): Promise<string[]> {
  try {
    const discovered = await discoverFioriSystems(homeDir);
    return [...discovered.systems.keys()];
  } catch {
    return [];
  }
}

function isTruthy(value: string): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * SAP_ALLOW_SELF_SIGNED mirrors the config key in both name and polarity.
 * TLS_REJECT_UNAUTHORIZED is the inverted spelling older versions documented
 * (but never read); it still works so an upgrade needs no edit.
 */
function readAllowSelfSigned(env: NodeJS.ProcessEnv): boolean {
  const current = env.SAP_ALLOW_SELF_SIGNED?.trim().toLowerCase();
  if (current) return isTruthy(current);

  const legacy = env[LEGACY_TLS_ENV]?.trim().toLowerCase();
  if (!legacy) return false;

  logWarn(
    `${LEGACY_TLS_ENV} is deprecated; use SAP_ALLOW_SELF_SIGNED=true instead (note the inverted meaning: ${LEGACY_TLS_ENV}=0 equals SAP_ALLOW_SELF_SIGNED=true).`,
  );
  return legacy === '0' || legacy === 'false';
}

/** Unlike the others this one defaults to true, so only an explicit no counts. */
function readAllowFreeSql(env: NodeJS.ProcessEnv): boolean {
  const value = env.SAP_ALLOW_FREE_SQL?.trim().toLowerCase();
  if (!value) return true;
  return !(value === '0' || value === 'false' || value === 'no');
}

function applyEnvFallback(ctx: {
  env: NodeJS.ProcessEnv;
  systems: Map<string, ResolvedSystem>;
  errors: ConfigError[];
  sources: string[];
}): void {
  const { env, systems, errors, sources } = ctx;
  const present = ENV_KEYS.filter((key) => env[key]);
  if (present.length === 0) return;

  if (present.length < ENV_KEYS.length) {
    const missing = ENV_KEYS.filter((key) => !env[key]);
    errors.push({
      scope: 'global',
      message: `Incomplete SAP_* environment configuration, missing: ${missing.join(', ')}. Set all of ${ENV_KEYS.join(', ')} or configure systems in a config file.`,
    });
    return;
  }

  if (systems.has(ENV_SYSTEM_NAME)) {
    errors.push({
      scope: 'global',
      message: `The SAP_* environment variables were ignored because a system named "${ENV_SYSTEM_NAME}" is already configured.`,
    });
    return;
  }

  const parsed = SystemConfigSchema.safeParse({
    url: env.SAP_URL,
    client: env.SAP_CLIENT,
    language: env.SAP_LANGUAGE || undefined,
    username: env.SAP_USERNAME,
    password: env.SAP_PASSWORD,
    allowSelfSigned: readAllowSelfSigned(env),
    allowFreeSql: readAllowFreeSql(env),
  });

  if (!parsed.success) {
    errors.push({
      scope: `system:${ENV_SYSTEM_NAME}`,
      message: `Invalid SAP_* environment configuration: ${formatIssues(parsed.error)}`,
    });
    return;
  }

  systems.set(ENV_SYSTEM_NAME, { ...parsed.data, origin: 'environment' });
  sources.push('SAP_* environment variables');
}

function resolveDefaultSystem(
  configured: string | undefined,
  systems: Map<string, ResolvedSystem>,
  errors: ConfigError[],
): string | undefined {
  if (configured) {
    if (systems.has(configured)) return configured;
    errors.push({
      scope: 'global',
      message: `defaultSystem "${configured}" is not a configured system. Known systems: ${[...systems.keys()].join(', ') || '(none)'}.`,
    });
  }
  if (systems.has(ENV_SYSTEM_NAME)) return ENV_SYSTEM_NAME;
  if (systems.size === 1) return [...systems.keys()][0];
  return undefined;
}
