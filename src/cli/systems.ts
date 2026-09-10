import { loadKeychainBackend } from '../auth/providers/keychain.js';
import { formatIssues, loadAppConfig } from '../config/load.js';
import { SystemConfigSchema } from '../config/schema.js';
import { defaultRcDir, isRcSafeName, rcPathIn, rcSystems, readRc, writeRc } from './rcFile.js';
import { defaultIo, storeBulk, type CliDeps, type CliIo } from './storeCredentials.js';

export interface AddSystemOptions {
  name?: string;
  url?: string;
  client?: string;
  language?: string;
  username?: string;
  skipCredentials?: boolean;
}

export interface RemoveSystemOptions {
  name?: string;
}

export interface DefaultSystemOptions {
  /** Without it, the current default and the known systems are shown. */
  name?: string;
  configFile?: string;
}

export interface SystemsDeps extends CliDeps {
  /** Directory holding the rc file; tests point this at a scratch directory. */
  rcDir?: string;
  stdin?: { isTTY?: boolean };
}

/** Prompts only where someone can answer; without a terminal a missing value stays empty. */
async function ask(io: CliIo, interactive: boolean, given: string | undefined, question: string): Promise<string> {
  if (given?.trim()) return given.trim();
  return interactive ? (await io.line(question)).trim() : '';
}

/**
 * One system, asked for field by field, into the user-level rc file plus its
 * keychain entry. The route for a single system, where pasting JSON or editing
 * the rc file asks the user to know things they should not have to.
 */
export async function addSystem(options: AddSystemOptions, deps: SystemsDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;
  const rcPath = rcPathIn(deps.rcDir ?? defaultRcDir());
  const { config, existed } = await readRc(rcPath);
  const systems = rcSystems(config);
  const interactive = (deps.stdin ?? process.stdin).isTTY === true;

  const name = await ask(io, interactive, options.name, 'System name, as you want to address it (e.g. DEV100): ');
  if (!name && !interactive) {
    io.err('Usage: mcp-abap-adt add <name> --url <url> [--client <nnn>] [--language <xx>] [--skip-credentials]\n');
    return 2;
  }
  if (!isRcSafeName(name)) {
    io.err(
      `"${name}" cannot be a system name here: use letters, digits, _ or - (not digits only), no spaces or dots.\n`,
    );
    return 2;
  }
  const replacing = name in systems;
  if (replacing && !(await io.yesNo(`System "${name}" already exists. Replace it?`, false))) {
    io.out('Nothing changed.\n');
    return 0;
  }

  const url = await ask(io, interactive, options.url, 'URL (e.g. https://sap.example.com:44300): ');
  if (!url && !interactive) {
    io.err(`No terminal to ask on: pass --url for "${name}".\n`);
    return 2;
  }
  const client = await ask(io, interactive, options.client, 'Client (three digits; empty for the system default): ');
  const language = await ask(io, interactive, options.language, 'Logon language (empty to leave it to SAP): ');

  const entry: Record<string, unknown> = { url, keychain: true };
  if (client) entry.client = client;
  if (language) entry.language = language;
  const parsed = SystemConfigSchema.safeParse(entry);
  if (!parsed.success) {
    io.err(`Not a valid system: ${formatIssues(parsed.error)}\n`);
    return 2;
  }

  await writeRc(rcPath, { ...config, systems: { ...systems, [name]: entry } }, existed);
  io.out(
    `Wrote ${rcPath}${existed ? ` (previous version in ${rcPath}.bak)` : ''}: ${replacing ? 'replaced' : 'added'} "${name}".\n`,
  );

  if (!options.skipCredentials) {
    const backend = deps.backend ?? (await loadKeychainBackend());
    const code = await storeBulk(
      [[name, { ...parsed.data, origin: 'config-file' }]],
      { username: options.username },
      backend,
      io,
    );
    if (code !== 0) return code;
  }

  io.out('\nDone. Restart your MCP clients to pick up the system; check with: mcp-abap-adt doctor\n');
  return 0;
}

/**
 * The default is validated against every configured system, imported ones
 * included, since the rc file alone does not know what the server will see.
 */
export async function setDefaultSystem(options: DefaultSystemOptions, deps: SystemsDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;
  const rcDir = deps.rcDir ?? defaultRcDir();
  // With an injected rcDir (tests) the lookup stays inside it; otherwise it is the ambient one the server uses.
  const config = await loadAppConfig(
    deps.rcDir
      ? { configFile: options.configFile, homeDir: rcDir, cwd: rcDir, env: {} }
      : { configFile: options.configFile },
  );
  const known = [...config.systems.keys()];

  if (!options.name) {
    io.out(
      `${config.defaultSystem ? `Default system: ${config.defaultSystem}` : 'No default system is set.'}\n` +
        `Configured systems: ${known.join(', ') || '(none)'}\n` +
        'Set one with: mcp-abap-adt default <name>\n',
    );
    return 0;
  }
  if (!known.includes(options.name)) {
    io.err(`"${options.name}" is not a configured system. Configured systems: ${known.join(', ') || '(none)'}\n`);
    return 2;
  }

  const rcPath = rcPathIn(rcDir);
  const { config: rc, existed } = await readRc(rcPath);
  await writeRc(rcPath, { ...rc, defaultSystem: options.name }, existed);
  io.out(`Default system is now "${options.name}" (in ${rcPath}). Restart your MCP clients to pick it up.\n`);
  return 0;
}

export async function removeSystem(options: RemoveSystemOptions, deps: SystemsDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;
  if (!options.name) {
    io.err('Usage: mcp-abap-adt remove <system name>\n');
    return 2;
  }

  const rcPath = rcPathIn(deps.rcDir ?? defaultRcDir());
  const { config, existed } = await readRc(rcPath);
  const systems = rcSystems(config);
  if (!(options.name in systems)) {
    const known = Object.keys(systems);
    io.err(
      `No system "${options.name}" in ${rcPath}.${known.length > 0 ? ` Systems there: ${known.join(', ')}.` : ''} ` +
        'A system imported from SAP Fiori tools is removed there, not here.\n',
    );
    return 2;
  }

  const remaining = { ...systems };
  delete remaining[options.name];
  await writeRc(rcPath, { ...config, systems: remaining }, existed);
  io.out(
    `Wrote ${rcPath} (previous version in ${rcPath}.bak): removed "${options.name}".\n` +
      'Its keychain entry stays, since the SAP Fiori tools extension may share it; delete it in the Credential Manager if you want it gone.\n',
  );
  if (config.defaultSystem === options.name) {
    io.out(
      `Note: "${options.name}" was the default system. Set defaultSystem to another one, or every call has to name a system.\n`,
    );
  }
  return 0;
}
