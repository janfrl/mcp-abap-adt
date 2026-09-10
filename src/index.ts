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
 * Whether this file is the process's main module, as opposed to being imported
 * by a test. Both sides are resolved to their real paths first: npm installs a
 * package's bin as a symlink on macOS and Linux, and Node resolves the main
 * module to the file behind the link while argv[1] keeps the link itself.
 * Comparing the two verbatim made every installed command - global install
 * and npx alike - exit silently without ever running main(); only a direct
 * `node dist/index.js` matched, which is exactly what the tests used.
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

if (isMainModule()) {
  main().catch((error: unknown) => {
    logWarn(`fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
