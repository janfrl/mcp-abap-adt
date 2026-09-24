import { readFile, rm, writeFile } from 'node:fs/promises';

import { loadAppConfig } from '../config/load.js';
import type { ResolvedAppConfig, ResolvedSystem } from '../config/schema.js';
import { ConnectionRegistry } from '../connection/registry.js';
import { defaultRcDir, isRcSafeName, rcPathIn, readRc, rcSystems, writeRc, type RcConfig } from './rcFile.js';
import { defaultIo, type CliDeps } from './storeCredentials.js';
import { renderTable } from './table.js';

type ValueType = 'string' | 'boolean' | 'number';

export const GLOBAL_KEYS: Record<string, ValueType> = { defaultSystem: 'string', importFioriSystems: 'boolean' };

/** Every per-system setting except `password`; a test keeps this in step with SystemConfigSchema. */
export const SYSTEM_KEYS: Record<string, ValueType> = {
  url: 'string',
  client: 'string',
  language: 'string',
  authType: 'string',
  username: 'string',
  passwordEnv: 'string',
  keychain: 'boolean',
  allowSelfSigned: 'boolean',
  allowFreeSql: 'boolean',
  timeoutMs: 'number',
};

const DEFAULTS: Record<string, unknown> = {
  authType: 'basic',
  keychain: false,
  allowSelfSigned: false,
  allowFreeSql: true,
  timeoutMs: 60_000,
};

export interface ConfigOptions {
  key?: string;
  value?: string;
  unset?: boolean;
}

export interface ConfigDeps extends CliDeps {
  /** Directory holding the rc file; tests point this at a scratch directory. */
  rcDir?: string;
  env?: NodeJS.ProcessEnv;
}

type Key = { path: string[]; type: ValueType } | { error: string };

function parseKey(key: string): Key {
  if (key in GLOBAL_KEYS) return { path: [key], type: GLOBAL_KEYS[key] };
  const match = /^systems\.([^.]+)\.([^.]+)$/u.exec(key);
  if (!match) {
    return {
      error:
        `Unknown setting "${key}". Settings: ${Object.keys(GLOBAL_KEYS).join(', ')}, ` +
        `and per system systems.<name>.<${Object.keys(SYSTEM_KEYS).join('|')}>.`,
    };
  }
  const [, name, field] = match;
  if (field === 'password') {
    return { error: 'A password is not set here, since it would land in a file: use mcp-abap-adt store-credentials.' };
  }
  if (!(field in SYSTEM_KEYS))
    return { error: `Unknown system setting "${field}". Settings: ${Object.keys(SYSTEM_KEYS).join(', ')}.` };
  if (!isRcSafeName(name))
    return { error: `"${name}" cannot be a system name: use letters, digits, _ or - (not digits only).` };
  return { path: ['systems', name, field], type: SYSTEM_KEYS[field] };
}

function coerce(raw: string, type: ValueType): unknown {
  if (type === 'boolean') {
    const normalised = raw.trim().toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(normalised)) return true;
    if (['false', 'no', 'off', '0'].includes(normalised)) return false;
    throw new Error(`"${raw}" is not true or false.`);
  }
  if (type === 'number') {
    if (!/^\d+$/u.test(raw.trim())) throw new Error(`"${raw}" is not a whole number.`);
    return Number(raw.trim());
  }
  return raw;
}

function load(deps: ConfigDeps, rcDir: string): Promise<ResolvedAppConfig> {
  // With an injected rcDir (tests) the lookup stays inside it; otherwise it is the ambient one the server uses.
  return loadAppConfig(deps.rcDir ? { homeDir: rcDir, cwd: rcDir, env: deps.env ?? {} } : {});
}

function settingsOf(system: ResolvedSystem): string {
  return Object.entries(system)
    .filter(([key, value]) => key in SYSTEM_KEYS && !['url', 'client', 'keychain'].includes(key) && value !== undefined)
    .filter(([key, value]) => DEFAULTS[key] !== value)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
}

function show(resolved: ResolvedAppConfig, rcPath: string): string {
  const registry = new ConnectionRegistry(resolved);
  const rows = registry
    .listSystems()
    .map((entry) => [
      `${entry.name}${entry.isDefault ? ' *' : ''}`,
      entry.url,
      entry.client ?? '',
      entry.origin,
      entry.credentialSource,
      settingsOf(resolved.systems.get(entry.name) as ResolvedSystem),
    ]);
  const lines = [
    `defaultSystem       ${resolved.defaultSystem ?? '(none)'}`,
    `importFioriSystems  ${resolved.importFioriSystems === true}`,
    '',
    rows.length > 0
      ? renderTable(['system', 'url', 'client', 'origin', 'credentials', 'settings'], rows)
      : 'No systems.',
  ];
  if (resolved.errors.length > 0) {
    lines.push('', 'Problems:', ...resolved.errors.map((error) => `  [${error.scope}] ${error.message}`));
  }
  lines.push('', `Changes go to ${rcPath}. Change one with: mcp-abap-adt config <setting> <value>`);
  return `${lines.join('\n')}\n`;
}

/** `config` alone shows the effective configuration; with a setting it reads, sets or unsets it in the rc file. */
export async function config(options: ConfigOptions, deps: ConfigDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;
  const rcDir = deps.rcDir ?? defaultRcDir();
  const rcPath = rcPathIn(rcDir);

  if (!options.key) {
    io.out(show(await load(deps, rcDir), rcPath));
    return 0;
  }

  const key = parseKey(options.key);
  if ('error' in key) {
    io.err(`${key.error}\n`);
    return 2;
  }

  const { config: rc, existed } = await readRc(rcPath);
  const parent = key.path
    .slice(0, -1)
    .reduce<RcConfig | undefined>((node, segment) => node?.[segment] as RcConfig | undefined, rc);
  const field = key.path.at(-1) as string;

  if (options.value === undefined && !options.unset) {
    const current = parent?.[field];
    io.out(current === undefined ? `${options.key} is not set in ${rcPath}.\n` : `${JSON.stringify(current)}\n`);
    return 0;
  }

  let value: unknown;
  if (!options.unset) {
    try {
      value = coerce(options.value as string, key.type);
    } catch (error) {
      io.err(`${error instanceof Error ? error.message : String(error)}\n`);
      return 2;
    }
  }

  const next = structuredClone(rc);
  if (key.path.length === 1) {
    if (options.unset) delete next[field];
    else next[field] = value;
  } else {
    const systems = rcSystems(next);
    const name = key.path[1];
    const entry = { ...systems[name] };
    if (options.unset) delete entry[field];
    else entry[field] = value;
    if (Object.keys(entry).length === 0) delete systems[name];
    else systems[name] = entry;
    next.systems = systems;
  }

  const before = await load(deps, rcDir);
  const previousText = existed ? await readFile(rcPath, 'utf8') : undefined;
  await writeRc(rcPath, next, existed);

  // Written first and checked with the loader the server uses; a value that makes the configuration worse is undone.
  const after = await load(deps, rcDir);
  const known = new Set(before.errors.map((error) => `${error.scope}|${error.message}`));
  const introduced = after.errors.filter((error) => !known.has(`${error.scope}|${error.message}`));
  // Checked directly: another source may be overriding the default, which would hide the loader's own error.
  if (
    field === 'defaultSystem' &&
    !options.unset &&
    !after.systems.has(String(value)) &&
    !introduced.some((error) => error.message.includes('defaultSystem'))
  ) {
    introduced.push({
      scope: 'global',
      message: `"${String(value)}" is not a configured system. Configured systems: ${[...after.systems.keys()].join(', ') || '(none)'}.`,
    });
  }
  if (introduced.length > 0) {
    if (previousText === undefined) await rm(rcPath, { force: true });
    else await writeFile(rcPath, previousText, 'utf8');
    io.err(
      `Not changed, since it would break the configuration:\n${introduced.map((error) => `  ${error.message}`).join('\n')}\n`,
    );
    return 2;
  }

  io.out(
    `${options.unset ? `Removed ${options.key}` : `${options.key} = ${String(value)}`} (in ${rcPath}). Restart your MCP clients to pick it up.\n`,
  );

  // The rc file is the lowest layer; a config file, the environment or a .env can still win.
  if (!options.unset) {
    const effective =
      key.path.length === 1
        ? (after as unknown as Record<string, unknown>)[field]
        : (after.systems.get(key.path[1]) as unknown as Record<string, unknown> | undefined)?.[field];
    if (effective !== undefined && JSON.stringify(effective) !== JSON.stringify(value)) {
      const others = after.sources.filter((source) => !source.endsWith('.mcp-abap-adtrc'));
      io.out(
        `But ${options.key} is ${JSON.stringify(effective)} in effect, set by a source that takes precedence` +
          `${others.length > 0 ? ` (${others.join(', ')})` : ''}. Change it there, or it stays in effect.\n`,
      );
      return 1;
    }
  }
  return 0;
}
