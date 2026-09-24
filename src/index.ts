#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadAppConfig, type AppConfigOverrides } from './config/load.js';
import type { ConfigError, ResolvedAppConfig } from './config/schema.js';
import { ConnectionRegistry } from './connection/registry.js';
import { logWarn } from './lib/log.js';
import { createServer } from './server.js';
import { closest } from './cli/suggest.js';
import { SERVER_VERSION } from './version.js';

/**
 * Earlier versions read a .env file sitting next to the installed package.
 * c12 loads the one in the working directory; keep the old location working
 * for source installs that already have it.
 */
function loadPackageEnvFile(): void {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    process.loadEnvFile(path.join(packageRoot, '.env'));
  } catch {
    // absent, which is the normal case
  }
}

/**
 * Turns the command line into configuration overrides. A malformed value is
 * reported rather than thrown: the server has to start so ListSystems can
 * explain the problem.
 */
function readCliOverrides(values: Record<string, unknown>): {
  overrides: AppConfigOverrides;
  errors: ConfigError[];
} {
  const overrides: AppConfigOverrides = {};
  const errors: ConfigError[] = [];

  const json = typeof values['config-json'] === 'string' ? values['config-json'].trim() : '';
  if (json) {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('the value is not a JSON object');
      }
      Object.assign(overrides, parsed);
    } catch (error) {
      errors.push({
        scope: 'global',
        message: `--config-json could not be read: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (values['import-fiori-systems'] === true) overrides.importFioriSystems = true;
  if (typeof values['default-system'] === 'string' && values['default-system']) {
    overrides.defaultSystem = values['default-system'];
  }

  return { overrides, errors };
}

const USAGE = `Usage: mcp-abap-adt <command>

  setup              Add systems from a list and store the password
  add                Add one system
  remove             Remove a system
  default            Show or set the default system
  config             Show or change the configuration
  store-credentials  Store or change a password
  doctor             Check the setup
  version            Show the installed version
`;

const COMMANDS = [
  'setup',
  'add',
  'remove',
  'delete',
  'default',
  'config',
  'store-credentials',
  'doctor',
  'version',
  'serve',
  'help',
];

function suggestCommand(input: string): string | undefined {
  return closest(input, COMMANDS);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      config: { type: 'string' },
      'config-json': { type: 'string' },
      'import-fiori-systems': { type: 'boolean' },
      'default-system': { type: 'string' },
      system: { type: 'string' },
      systems: { type: 'string' },
      all: { type: 'boolean' },
      username: { type: 'string' },
      from: { type: 'string' },
      login: { type: 'boolean' },
      'skip-credentials': { type: 'boolean' },
      name: { type: 'string' },
      url: { type: 'string' },
      client: { type: 'string' },
      language: { type: 'string' },
      help: { type: 'boolean' },
      version: { type: 'boolean' },
      unset: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: false,
  });

  loadPackageEnvFile();
  const configFile = values.config as string | undefined;

  // A subcommand means this is an interactive run, not an MCP session.
  if (positionals[0] === 'setup') {
    const { setup } = await import('./cli/setup.js');
    process.exitCode = await setup({
      from: values.from as string | undefined,
      username: values.username as string | undefined,
      skipCredentials: values['skip-credentials'] === true,
    });
    return;
  }

  if (positionals[0] === 'add') {
    const { addSystem } = await import('./cli/systems.js');
    process.exitCode = await addSystem({
      name: positionals[1] ?? (values.name as string | undefined),
      url: values.url as string | undefined,
      client: values.client as string | undefined,
      language: values.language as string | undefined,
      username: values.username as string | undefined,
      skipCredentials: values['skip-credentials'] === true,
    });
    return;
  }

  if (positionals[0] === 'remove' || positionals[0] === 'delete') {
    const { removeSystem } = await import('./cli/systems.js');
    process.exitCode = await removeSystem({ name: positionals[1] ?? (values.name as string | undefined) });
    return;
  }

  if (positionals[0] === 'doctor') {
    const { doctor } = await import('./cli/doctor.js');
    process.exitCode = await doctor({ configFile, login: values.login === true });
    return;
  }

  if (positionals[0] === 'store-credentials') {
    const { storeCredentials } = await import('./cli/storeCredentials.js');
    process.exitCode = await storeCredentials({
      system: values.system as string | undefined,
      systems: values.systems as string | undefined,
      all: values.all === true,
      username: values.username as string | undefined,
      configFile,
    });
    return;
  }

  if (positionals[0] === 'config') {
    const { config } = await import('./cli/config.js');
    process.exitCode = await config({ key: positionals[1], value: positionals[2], unset: values.unset === true });
    return;
  }

  if (positionals[0] === 'default') {
    const { setDefaultSystem } = await import('./cli/systems.js');
    process.exitCode = await setDefaultSystem({ name: positionals[1], configFile });
    return;
  }

  if (positionals[0] === 'help' || values.help === true) {
    process.stdout.write(USAGE);
    return;
  }
  if (positionals[0] === 'version' || values.version === true) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  const serve = positionals[0] === 'serve';
  if (positionals.length > 0 && !serve) {
    // Anything else would start the MCP server and sit waiting for a client
    // that never comes, which from a terminal looks like a hang.
    const guess = suggestCommand(positionals[0]);
    process.stderr.write(`Unknown command "${positionals[0]}".${guess ? ` Did you mean "${guess}"?` : ''}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  // MCP clients always connect through pipes; a terminal on stdin means a person typed the bare command.
  if (!serve && process.stdin.isTTY) {
    process.stdout.write(USAGE);
    return;
  }

  const { overrides, errors: argErrors } = readCliOverrides(values);
  const loaded = await loadAppConfig({ configFile, overrides });
  // Argument errors join the configuration's own, or ListSystems would report
  // only the consequence ("no system is configured") and never the cause. A
  // client shows stderr to nobody, so logging them there is not enough.
  const config: ResolvedAppConfig = { ...loaded, errors: [...argErrors, ...loaded.errors] };
  for (const error of config.errors) {
    logWarn(`${error.scope}: ${error.message}`);
  }

  const registry = new ConnectionRegistry(config);
  const server = createServer(registry);

  // The server starts even with a broken configuration. Dying before the MCP
  // handshake would only show up in clients as an opaque startup failure,
  // whereas ListSystems can explain what is actually wrong.
  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    await registry.closeAll().catch(() => undefined);
    await server.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Main module, as opposed to imported by a test. Real paths on both sides:
 * npm installs the bin as a symlink, and Node resolves the main module
 * behind the link while argv[1] keeps the link.
 */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync.native(fileURLToPath(import.meta.url)) === realpathSync.native(entry);
  } catch {
    return false;
  }
}

/** Ctrl+C in a prompt: readline rejects with an AbortError, the secret prompt with its own error. */
function isUserCancel(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'Aborted.' || error.message.includes('Ctrl+C'))
  );
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    if (isUserCancel(error)) {
      process.stderr.write('\nCancelled.\n');
      process.exit(130);
    }
    logWarn(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
