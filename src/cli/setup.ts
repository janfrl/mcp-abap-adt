import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { loadConfig } from 'c12';
import { defu } from 'defu';
import { parse as parseRc, serialize as serializeRc } from 'rc9';

import { loadKeychainBackend } from '../auth/providers/keychain.js';
import { formatIssues } from '../config/load.js';
import { AppConfigFileSchema, SystemConfigSchema, type ResolvedSystem } from '../config/schema.js';
import { defaultIo, storeBulk, type CliDeps, type CliIo } from './storeCredentials.js';

export interface SetupOptions {
  /** Path or https URL of the shared team list (.json or .jsonc). */
  from?: string;
  username?: string;
  skipCredentials?: boolean;
}

export interface SetupDeps extends CliDeps {
  /** Directory holding the rc file; tests point this at a scratch directory. */
  rcDir?: string;
  fetch?: typeof globalThis.fetch;
  env?: NodeJS.ProcessEnv;
}

/** The same resolution rc9 uses when c12 reads the file back. */
function defaultRcDir(): string {
  return process.env.XDG_CONFIG_HOME || homedir();
}

/** Generous for a system list; a limit only so a wrong URL cannot stream anything into memory. */
const MAX_TEAM_FILE_BYTES = 256 * 1024;

interface TeamFileSource {
  file: string;
  cleanup?: () => Promise<void>;
}

/** A local path, or an https URL that is downloaded to a temporary file so both take the same path from here. */
async function resolveTeamFile(from: string, deps: SetupDeps, io: CliIo): Promise<TeamFileSource | number> {
  let url: URL | undefined;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(from)) {
    try {
      url = new URL(from);
    } catch {
      io.err(`"${from}" is not a valid URL.\n`);
      return 2;
    }
  }

  // Data only, never code: a shared file gets edited by whoever can push to
  // the team repo, and .ts configs execute on load. The same reasoning bans
  // `extends`, which can pull further files from anywhere.
  const extension = extname(url ? url.pathname : from).toLowerCase();
  if (extension !== '.json' && extension !== '.jsonc') {
    io.err(
      `The team file must be .json or .jsonc, not "${extension || '(none)'}": a shared file must be data, not code.\n`,
    );
    return 2;
  }

  if (!url) {
    const file = resolve(from);
    if (!existsSync(file)) {
      io.err(`No file at ${file}.\n`);
      return 2;
    }
    return { file };
  }

  if (url.protocol !== 'https:') {
    io.err('The team file URL must use https: the systems in it are where passwords get sent.\n');
    return 2;
  }
  // A token, when the environment has one, is what makes a private repository
  // readable; the names are the ones the gh CLI and GitHub Actions use.
  const env = deps.env ?? process.env;
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await (deps.fetch ?? globalThis.fetch)(url, { headers, redirect: 'follow' });
  } catch (error) {
    io.err(`Could not download ${url.href}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (!response.ok) {
    const hint = [401, 403, 404].includes(response.status)
      ? ' A private repository answers like this without a token: set GITHUB_TOKEN, or clone the repository and pass the local path instead.'
      : '';
    io.err(`Could not download ${url.href}: HTTP ${response.status}.${hint}\n`);
    return 2;
  }
  const text = await response.text();
  if (text.length > MAX_TEAM_FILE_BYTES) {
    io.err(`${url.href} is larger than ${MAX_TEAM_FILE_BYTES} bytes, which no system list is.\n`);
    return 2;
  }

  const dir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-setup-'));
  const file = join(dir, `team-systems${extension}`);
  await writeFile(file, text, 'utf8');
  return { file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/**
 * Onboarding as one command: read a shared team list, fold it into the
 * user-level rc file, and store the credentials for everything in it - so a
 * new team member runs `setup --from <file>` once instead of clicking six
 * systems together and being asked six times for the same password.
 *
 * Returns the process exit code.
 */
export async function setup(options: SetupOptions, deps: SetupDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;

  if (!options.from) {
    io.err(
      'Usage: mcp-abap-adt setup --from <path or https URL of the shared systems file> [--username <user>] [--skip-credentials]\n' +
        'The file holds the same object a config file does ("systems", optional "defaultSystem") and no secrets.\n',
    );
    return 2;
  }

  const source = await resolveTeamFile(options.from, deps, io);
  if (typeof source === 'number') return source;
  try {
    return await setupFromFile(source.file, options, deps, io);
  } finally {
    await source.cleanup?.();
  }
}

async function setupFromFile(from: string, options: SetupOptions, deps: SetupDeps, io: CliIo): Promise<number> {
  const loaded = await loadConfig({
    configFile: from,
    rcFile: false,
    dotenv: false,
    globalRc: false,
    packageJson: false,
    extend: false,
  });
  const raw = (loaded.config ?? {}) as Record<string, unknown>;
  if ('extends' in raw) {
    io.err('The team file must be self-contained; "extends" is not followed.\n');
    return 2;
  }

  const parsed = AppConfigFileSchema.safeParse(raw);
  if (!parsed.success) {
    io.err(`The team file is invalid: ${formatIssues(parsed.error)}\n`);
    return 2;
  }
  const team = parsed.data;
  // The app config tolerates single malformed systems so one typo cannot take
  // a running server down. A team file is different: it is authored once for
  // everyone, so a broken entry is rejected here, before it spreads.
  const keychainDefaulted: string[] = [];
  const teamSystems: Array<[string, ResolvedSystem]> = [];
  for (const [name, value] of Object.entries(team.systems)) {
    // rc9 flattens system names into dotted keys. A dot nests, whitespace
    // makes the line unparseable, and an all-digit name turns `systems` into
    // a sparse array - each of them silently, on the next read. Measured, not
    // imagined; hence names are gated here, where the file can still be fixed.
    if (!/^[A-Za-z0-9_-]+$/u.test(name) || /^\d+$/u.test(name)) {
      io.err(
        `The team file is invalid - system name "${name}" cannot survive the rc file format: ` +
          'use letters, digits, _ or - (not digits only), without spaces or dots.\n',
      );
      return 2;
    }
    const system = SystemConfigSchema.safeParse(value);
    if (!system.success) {
      io.err(`The team file is invalid - system "${name}": ${formatIssues(system.error)}\n`);
      return 2;
    }
    // A team file's whole point is per-user credentials from the keychain. An
    // entry that names no credential source at all means exactly that, so the
    // author should not have to know a schema default to get working onboarding.
    const rawEntry = value as Record<string, unknown>;
    if (!('keychain' in rawEntry) && !system.data.password && !system.data.passwordEnv) {
      system.data.keychain = true;
      keychainDefaulted.push(name);
    }
    teamSystems.push([name, { ...system.data, origin: 'config-file' }]);
  }
  if (teamSystems.length === 0) {
    io.err('The team file holds no systems.\n');
    return 2;
  }

  // Fold into the rc file, with everything local winning: a personal
  // allowSelfSigned or defaultSystem must survive re-running setup after the
  // team list changed.
  const rcDir = deps.rcDir ?? defaultRcDir();
  const rcPath = join(rcDir, '.mcp-abap-adtrc');
  let existing: Record<string, unknown> = {};
  let hadRc = false;
  try {
    existing = parseRc(await readFile(rcPath, 'utf8'));
    hadRc = true;
  } catch {
    // no rc file yet - the normal case on a fresh machine
  }

  // Written from the raw entries, not the parsed ones: parsing fills every
  // schema default, and serialising those would freeze today's defaults into
  // each colleague's rc file - a later release changing a default would never
  // reach them. Only the keychain normalisation from above is added on top.
  const normalisedSystems = Object.fromEntries(
    Object.entries(team.systems).map(([name, value]) => [
      name,
      keychainDefaulted.includes(name)
        ? { ...(value as Record<string, unknown>), keychain: true }
        : (value as Record<string, unknown>),
    ]),
  );
  const merged = defu(existing, {
    ...(team.defaultSystem ? { defaultSystem: team.defaultSystem } : {}),
    // The usage text promises "the same object a config file holds", so the
    // flag must travel too rather than being dropped without a word.
    ...('importFioriSystems' in raw ? { importFioriSystems: team.importFioriSystems } : {}),
    systems: normalisedSystems,
  });

  if (hadRc) {
    // The rc file is hand-editable state; a re-run must never cost the user
    // their own edits without a way back.
    await copyFile(rcPath, `${rcPath}.bak`);
  }
  await writeFile(rcPath, serializeRc(merged), 'utf8');

  const existingSystems = new Set(Object.keys((existing.systems as Record<string, unknown> | undefined) ?? {}));
  const added = teamSystems.filter(([name]) => !existingSystems.has(name)).map(([name]) => name);
  const kept = teamSystems.filter(([name]) => existingSystems.has(name)).map(([name]) => name);
  io.out(`Wrote ${rcPath}${hadRc ? ` (previous version in ${rcPath}.bak)` : ''}.\n`);
  // Named back so a wrong URL, and with it a wrong destination for passwords, is visible.
  io.out(`  systems from:        ${options.from}\n`);
  if (added.length > 0) io.out(`  added:               ${added.join(', ')}\n`);
  if (kept.length > 0) io.out(`  kept local settings: ${kept.join(', ')}\n`);
  if (keychainDefaulted.length > 0) {
    io.out(`  keychain enabled:    ${keychainDefaulted.join(', ')} (no credential source named in the team file)\n`);
  }

  if (!options.skipCredentials) {
    // Keyed by the merged url and client, not the team file's: local overrides win.
    const mergedSystems = merged.systems as Record<string, unknown>;
    const targets: Array<[string, ResolvedSystem]> = [];
    const unusable: string[] = [];
    for (const [name] of teamSystems) {
      const effective = SystemConfigSchema.safeParse(mergedSystems[name]);
      if (!effective.success) {
        unusable.push(name);
        continue;
      }
      if (effective.data.keychain && !effective.data.password && !effective.data.passwordEnv) {
        targets.push([name, { ...effective.data, origin: 'config-file' }]);
      }
    }
    if (unusable.length > 0) {
      io.out(
        `  not stored:          ${unusable.join(', ')} (the local entry is invalid after the merge; ListSystems names the problem)\n`,
      );
    }
    if (targets.length > 0) {
      const backend = deps.backend ?? (await loadKeychainBackend());
      const code = await storeBulk(targets, { username: options.username }, backend, io);
      if (code !== 0) return code;
    } else {
      // "Done." after silently storing nothing sent users to their first tool
      // call convinced their password was saved.
      io.out('No system in the team file uses the keychain, so no password was stored.\n');
    }
  }

  io.out(
    '\nDone. Point your MCP client at the command: mcp-abap-adt\n' +
      'Check the result with:                       mcp-abap-adt doctor\n',
  );
  return 0;
}
