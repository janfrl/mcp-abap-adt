import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadAppConfig } from '../../src/config/load.js';
import { fioriKeychainId } from '../../src/config/fiori.js';
import { setLogSink } from '../../src/lib/log.js';

let workDir: string;
let homeDir: string;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-'));
  workDir = join(root, 'work');
  homeDir = join(root, 'home');
  await mkdir(workDir);
  await mkdir(homeDir);
});

afterEach(async () => {
  await rm(join(workDir, '..'), { recursive: true, force: true });
});

/** Loads with a hermetic environment so the developer's own SAP_* vars cannot leak in. */
function load(env: NodeJS.ProcessEnv = {}, configFile?: string) {
  return loadAppConfig({ cwd: workDir, homeDir, env, configFile });
}

async function writeConfig(config: unknown): Promise<string> {
  const path = join(workDir, 'mcp-abap-adt.config.json');
  await writeFile(path, JSON.stringify(config), 'utf8');
  return path;
}

/** Mirrors the real layout written by @sap-ux/store: { systems: { "<id>": entry } }. */
async function writeFioriStore(dir: string, systems: unknown): Promise<void> {
  await mkdir(join(homeDir, dir), { recursive: true });
  await writeFile(join(homeDir, dir, 'systems.json'), JSON.stringify({ systems }), 'utf8');
}

const ENV_COMPLETE = {
  SAP_URL: 'https://sap.example.com:44300',
  SAP_USERNAME: 'DEVELOPER',
  SAP_PASSWORD: 'secret',
  SAP_CLIENT: '001',
};

describe('environment fallback', () => {
  it('synthesises a default system from the legacy SAP_* variables', async () => {
    const config = await load(ENV_COMPLETE);

    expect(config.errors).toEqual([]);
    expect(config.defaultSystem).toBe('default');
    expect(config.systems.get('default')).toMatchObject({
      url: 'https://sap.example.com:44300',
      client: '001',
      username: 'DEVELOPER',
      password: 'secret',
      allowSelfSigned: false,
      timeoutMs: 60_000,
    });
  });

  it('honours SAP_LANGUAGE, which older versions ignored', async () => {
    const config = await load({ ...ENV_COMPLETE, SAP_LANGUAGE: 'DE' });

    expect(config.systems.get('default')).toMatchObject({ language: 'DE' });
  });

  it('records that the system came from the environment', async () => {
    const config = await load(ENV_COMPLETE);

    expect(config.systems.get('default')?.origin).toBe('environment');
  });

  it('reports which variables are missing when the set is incomplete', async () => {
    const config = await load({ SAP_URL: 'https://sap.example.com', SAP_USERNAME: 'DEVELOPER' });

    expect(config.systems.size).toBe(0);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('SAP_PASSWORD, SAP_CLIENT');
  });

  it('rejects a malformed URL instead of creating a broken system', async () => {
    const config = await load({ ...ENV_COMPLETE, SAP_URL: 'not-a-url' });

    expect(config.systems.size).toBe(0);
    expect(config.errors.some((e) => e.scope === 'system:default')).toBe(true);
  });

  it('complains when nothing at all is configured', async () => {
    const config = await load();

    expect(config.systems.size).toBe(0);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('No SAP system is configured');
  });

  it('names the Fiori systems going unused, so the fix is obvious', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'DEV100', url: 'https://dev.example.com', client: '100' },
      b: { name: 'PRD400', url: 'https://prd.example.com', client: '400' },
    });

    const config = await load();
    const message = config.errors.map((e) => e.message).join('\n');

    expect(config.systems.size).toBe(0);
    expect(message).toContain('2 systems saved by the SAP Fiori tools');
    expect(message).toContain('DEV100');
    expect(message).toContain('PRD400');
    expect(message).toContain('importFioriSystems');
  });

  it('counts one system in the singular', async () => {
    await writeFioriStore('.saptools', { a: { name: 'DEV100', url: 'https://dev.example.com', client: '100' } });

    const config = await load();

    expect(config.errors.map((e) => e.message).join('\n')).toContain('1 system saved by');
  });

  it('summarises a long list rather than printing all of it', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `k${index}`,
        { name: `SYS${index}`, url: `https://s${index}.example.com`, client: '100' },
      ]),
    );
    await writeFioriStore('.saptools', many);

    const config = await load();
    const message = config.errors.map((e) => e.message).join('\n');

    expect(message).toContain('8 systems saved by');
    expect(message).toContain('and 3 more');
    expect(message).not.toContain('SYS7');
  });

  it('does not suggest importing when importing is already on', async () => {
    // The store is empty here, so the suggestion would be a dead end.
    await writeConfig({ importFioriSystems: true });

    const config = await load();
    const message = config.errors.map((e) => e.message).join('\n');

    expect(message).toContain('No SAP system is configured');
    expect(message).not.toContain('importFioriSystems');
  });
});

describe('allowSelfSigned from the environment', () => {
  it('is off by default, so certificates are verified', async () => {
    const config = await load(ENV_COMPLETE);

    expect(config.systems.get('default')?.allowSelfSigned).toBe(false);
  });

  it('is enabled by SAP_ALLOW_SELF_SIGNED', async () => {
    const values = ['true', '1', 'yes', 'TRUE'];

    const configs = await Promise.all(values.map((value) => load({ ...ENV_COMPLETE, SAP_ALLOW_SELF_SIGNED: value })));

    for (const [index, config] of configs.entries()) {
      expect(config.systems.get('default')?.allowSelfSigned, values[index]).toBe(true);
    }
  });

  it('still accepts the deprecated TLS_REJECT_UNAUTHORIZED with its inverted meaning', async () => {
    const disabled = await load({ ...ENV_COMPLETE, TLS_REJECT_UNAUTHORIZED: '0' });
    expect(disabled.systems.get('default')?.allowSelfSigned).toBe(true);

    const enforced = await load({ ...ENV_COMPLETE, TLS_REJECT_UNAUTHORIZED: '1' });
    expect(enforced.systems.get('default')?.allowSelfSigned).toBe(false);
  });

  it('lets the current variable win over the deprecated one', async () => {
    const config = await load({
      ...ENV_COMPLETE,
      SAP_ALLOW_SELF_SIGNED: 'false',
      TLS_REJECT_UNAUTHORIZED: '0',
    });

    expect(config.systems.get('default')?.allowSelfSigned).toBe(false);
  });

  it('ignores an empty deprecated variable, as shipped in .env.example', async () => {
    const config = await load({ ...ENV_COMPLETE, TLS_REJECT_UNAUTHORIZED: '' });

    expect(config.systems.get('default')?.allowSelfSigned).toBe(false);
  });
});

describe('configuration without a file', () => {
  it('takes the whole configuration from MCP_ABAP_ADT_CONFIG_JSON', async () => {
    const config = await load({
      MCP_ABAP_ADT_CONFIG_JSON: JSON.stringify({
        defaultSystem: 'dev',
        systems: { dev: { url: 'https://dev.example.com', client: '100', username: 'U', password: 'P' } },
      }),
    });

    expect(config.errors).toEqual([]);
    expect(config.defaultSystem).toBe('dev');
    // JSON carries its own types, so the client stays a string rather than 100.
    expect(config.systems.get('dev')).toMatchObject({ client: '100', origin: 'config-file' });
  });

  it('accepts the two common settings as flat variables', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'FIORI_DEV', url: 'https://fiori.example.com', client: '100' },
    });
    const config = await load({ SAP_IMPORT_FIORI_SYSTEMS: 'true', SAP_DEFAULT_SYSTEM: 'FIORI_DEV' });

    expect(config.systems.get('FIORI_DEV')?.origin).toBe('fiori-tools');
    expect(config.defaultSystem).toBe('FIORI_DEV');
  });

  it('reports malformed JSON instead of starting blind', async () => {
    const config = await load({ MCP_ABAP_ADT_CONFIG_JSON: '{ not json' });

    expect(config.errors.map((e) => e.message).join('\n')).toContain('MCP_ABAP_ADT_CONFIG_JSON could not be read');
  });

  it('rejects a JSON value that is not an object', async () => {
    const config = await load({ MCP_ABAP_ADT_CONFIG_JSON: '["a"]' });

    expect(config.errors.map((e) => e.message).join('\n')).toContain('not a JSON object');
  });

  it('overrides an imported system without repeating it', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'PRD400', url: 'https://prd.example.com', client: '400' },
    });
    const config = await load({
      SAP_IMPORT_FIORI_SYSTEMS: 'true',
      MCP_ABAP_ADT_CONFIG_JSON: JSON.stringify({ systems: { PRD400: { allowSelfSigned: true } } }),
    });

    expect(config.systems.get('PRD400')).toMatchObject({
      url: 'https://prd.example.com',
      client: '400',
      keychain: true,
      allowSelfSigned: true,
    });
  });

  it('rejects a url that carries credentials, naming the alternatives', async () => {
    // ListSystems and doctor echo the url and promise to show no credentials.
    const config = await load({
      MCP_ABAP_ADT_CONFIG_JSON: JSON.stringify({
        systems: { dev: { url: 'https://someone:secret@dev.example.com', client: '100' } },
      }),
    });

    expect(config.systems.has('dev')).toBe(false);
    const message = config.errors.map((e) => e.message).join('\n');
    expect(message).toContain('username or password');
    expect(message).toContain('passwordEnv');
    expect(message).not.toContain('secret');
  });
});

describe('precedence between the layers', () => {
  it('lets the environment win over the file', async () => {
    await writeConfig({ defaultSystem: 'fromFile', systems: { fromFile: { url: 'https://a.example.com' } } });
    const config = await load({
      MCP_ABAP_ADT_CONFIG_JSON: JSON.stringify({ systems: { fromEnv: { url: 'https://b.example.com' } } }),
      SAP_DEFAULT_SYSTEM: 'fromEnv',
    });

    // Systems merge per entry, so both survive; the default is the env one.
    expect([...config.systems.keys()].toSorted()).toEqual(['fromEnv', 'fromFile']);
    expect(config.defaultSystem).toBe('fromEnv');
  });

  it('lets the command line win over the environment', async () => {
    const config = await loadAppConfig({
      cwd: workDir,
      homeDir,
      env: {
        SAP_DEFAULT_SYSTEM: 'fromEnv',
        MCP_ABAP_ADT_CONFIG_JSON: JSON.stringify({
          systems: { a: { url: 'https://a.example.com' }, b: { url: 'https://b.example.com' } },
        }),
      },
      overrides: { defaultSystem: 'b' },
    });

    expect(config.defaultSystem).toBe('b');
  });

  it('merges a command-line override onto a system from the file', async () => {
    await writeConfig({ systems: { dev: { url: 'https://dev.example.com', client: '100' } } });
    const config = await loadAppConfig({
      cwd: workDir,
      homeDir,
      env: {},
      overrides: { systems: { dev: { url: 'https://dev.example.com', client: '100', allowFreeSql: false } } },
    });

    expect(config.systems.get('dev')).toMatchObject({ client: '100', allowFreeSql: false });
  });
});

describe('allowFreeSql', () => {
  it('is on by default, because the alternative reads whole tables', async () => {
    const config = await load(ENV_COMPLETE);

    expect(config.systems.get('default')?.allowFreeSql).toBe(true);
  });

  it('is switched off by an explicit no in SAP_ALLOW_FREE_SQL', async () => {
    const values = ['false', '0', 'no', 'FALSE'];

    const configs = await Promise.all(values.map((value) => load({ ...ENV_COMPLETE, SAP_ALLOW_FREE_SQL: value })));

    for (const [index, config] of configs.entries()) {
      expect(config.systems.get('default')?.allowFreeSql, values[index]).toBe(false);
    }
  });

  it('stays on for any other value, including an empty one', async () => {
    const on = await load({ ...ENV_COMPLETE, SAP_ALLOW_FREE_SQL: '' });
    expect(on.systems.get('default')?.allowFreeSql).toBe(true);

    const alsoOn = await load({ ...ENV_COMPLETE, SAP_ALLOW_FREE_SQL: 'true' });
    expect(alsoOn.systems.get('default')?.allowFreeSql).toBe(true);
  });

  it('can be turned off for a single imported system through an override', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'PRD', url: 'https://prd.example.com', client: '400' },
    });
    await writeConfig({ importFioriSystems: true, systems: { PRD: { allowFreeSql: false } } });
    const config = await load();

    expect(config.systems.get('PRD')).toMatchObject({
      url: 'https://prd.example.com',
      keychain: true,
      allowFreeSql: false,
    });
  });
});

describe('config file', () => {
  const twoSystems = {
    defaultSystem: 'dev',
    systems: {
      dev: {
        url: 'https://dev.example.com:44300',
        client: '100',
        username: 'DEV_USER',
        keychain: true,
      },
      prd: {
        url: 'https://prd.example.com:44300',
        client: '200',
        username: 'PRD_USER',
        keychain: true,
      },
    },
  };

  it('loads multiple named systems and the declared default', async () => {
    await writeConfig(twoSystems);
    const config = await load();

    expect(config.errors).toEqual([]);
    expect([...config.systems.keys()].toSorted()).toEqual(['dev', 'prd']);
    expect(config.defaultSystem).toBe('dev');
  });

  it('is found through an explicit path as well', async () => {
    const path = await writeConfig(twoSystems);
    const config = await loadAppConfig({ cwd: homeDir, homeDir, env: {}, configFile: path });

    expect([...config.systems.keys()].toSorted()).toEqual(['dev', 'prd']);
  });

  it('keeps the healthy systems when one entry is malformed', async () => {
    await writeConfig({
      systems: {
        good: { url: 'https://good.example.com', client: '100' },
        broken: { url: 'https://broken.example.com', client: 'XX' },
      },
    });
    const config = await load();

    expect([...config.systems.keys()]).toEqual(['good']);
    expect(config.errors).toHaveLength(1);
    expect(config.errors[0].scope).toBe('system:broken');
  });

  it('accepts a client written as a number, which an rc file coerces it into', async () => {
    // rc9 turns an unquoted 100 into a number. Converting it back is lossless
    // because it only coerces values without a leading zero: 010 stays a
    // string, so no client is rebuilt from a number that lost a digit.
    await writeConfig({
      systems: {
        coerced: { url: 'https://coerced.example.com', client: 100 },
        leadingZero: { url: 'https://zero.example.com', client: '010' },
      },
    });
    const config = await load();

    expect(config.errors).toEqual([]);
    expect(config.systems.get('coerced')?.client).toBe('100');
    expect(config.systems.get('leadingZero')?.client).toBe('010');
  });

  it('rejects a number that is not a three digit client instead of padding it', async () => {
    await writeConfig({ systems: { wide: { url: 'https://wide.example.com', client: 1000 } } });
    const config = await load();

    expect(config.systems.has('wide')).toBe(false);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('three digit SAP client');
  });

  it('reports an unknown defaultSystem but still serves the configured ones', async () => {
    await writeConfig({
      defaultSystem: 'nope',
      systems: { dev: { url: 'https://dev.example.com', client: '100' } },
    });
    const config = await load();

    expect(config.errors.map((e) => e.message).join('\n')).toContain('defaultSystem "nope"');
    // Exactly one system remains, so it is an unambiguous default.
    expect(config.defaultSystem).toBe('dev');
  });

  it('lets a configured "default" system win over the SAP_* variables', async () => {
    await writeConfig({ systems: { default: { url: 'https://file.example.com', client: '100' } } });
    const config = await load(ENV_COMPLETE);

    expect(config.systems.get('default')?.url).toBe('https://file.example.com');
    expect(config.errors.map((e) => e.message).join('\n')).toContain('were ignored');
  });

  it('merges file systems and the environment default side by side', async () => {
    await writeConfig({ systems: { dev: { url: 'https://dev.example.com', client: '100' } } });
    const config = await load(ENV_COMPLETE);

    expect([...config.systems.keys()].toSorted()).toEqual(['default', 'dev']);
    expect(config.defaultSystem).toBe('default');
  });
});

describe('SAP Fiori tools discovery', () => {
  const fioriStore = {
    'https://fiori.example.com:44300/100': {
      name: 'FIORI_DEV',
      url: 'https://fiori.example.com:44300',
      client: '100',
      authenticationType: 'basic',
    },
    'https://cloud.example.com': {
      name: 'ABAP_CLOUD',
      url: 'https://cloud.example.com',
      authenticationType: 'reentranceTicket',
    },
  };

  it('imports basic-auth systems and routes them to the keychain', async () => {
    await writeFioriStore('.saptools', fioriStore);
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.get('FIORI_DEV')).toMatchObject({
      url: 'https://fiori.example.com:44300',
      client: '100',
      keychain: true,
    });
  });

  it('skips authentication types it cannot handle and says why', async () => {
    await writeFioriStore('.saptools', fioriStore);
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.has('ABAP_CLOUD')).toBe(false);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('reentranceTicket');
  });

  it('prefers .saptools over the legacy .fioritools location', async () => {
    await writeFioriStore('.fioritools', {
      a: { name: 'SHARED', url: 'https://legacy.example.com', client: '100' },
    });
    await writeFioriStore('.saptools', {
      a: { name: 'SHARED', url: 'https://current.example.com', client: '100' },
    });
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.get('SHARED')?.url).toBe('https://current.example.com');
  });

  it('marks imported systems with their origin', async () => {
    await writeFioriStore('.saptools', fioriStore);
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.get('FIORI_DEV')?.origin).toBe('fiori-tools');
  });

  it('lets a config entry override single settings without repeating the system', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'FIORI_DEV', url: 'https://fiori.example.com', client: '100' },
    });
    // Only the one setting that differs; url and client stay imported.
    await writeConfig({ importFioriSystems: true, systems: { FIORI_DEV: { allowSelfSigned: true } } });
    const config = await load();

    expect(config.errors).toEqual([]);
    expect(config.systems.get('FIORI_DEV')).toMatchObject({
      url: 'https://fiori.example.com',
      client: '100',
      keychain: true,
      allowSelfSigned: true,
      origin: 'fiori-tools',
    });
  });

  it('keeps the imported system when an override is invalid, and says so', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'FIORI_DEV', url: 'https://fiori.example.com', client: '100' },
    });
    await writeConfig({ importFioriSystems: true, systems: { FIORI_DEV: { client: 'nope' } } });
    const config = await load();

    // Losing access to the system over a typo in one setting would be worse
    // than ignoring the override.
    expect(config.systems.get('FIORI_DEV')).toMatchObject({ client: '100' });
    expect(config.errors.map((e) => e.message).join('\n')).toContain('was ignored, the imported settings are used');
  });

  it('still requires a url for a system that was not imported', async () => {
    await writeConfig({ importFioriSystems: true, systems: { ORPHAN: { allowSelfSigned: true } } });
    const config = await load();

    expect(config.systems.has('ORPHAN')).toBe(false);
    expect(config.errors.map((e) => e.message).join('\n')).toContain('Invalid system "ORPHAN"');
  });

  it('lets a fully declared config entry replace an imported one', async () => {
    await writeFioriStore('.saptools', {
      a: { name: 'FIORI_DEV', url: 'https://fiori.example.com', client: '100' },
    });
    await writeConfig({
      importFioriSystems: true,
      systems: { FIORI_DEV: { url: 'https://override.example.com', client: '200' } },
    });
    const config = await load();

    expect(config.systems.get('FIORI_DEV')).toMatchObject({
      url: 'https://override.example.com',
      client: '200',
    });
  });

  it('stays quiet when the store does not exist', async () => {
    await writeConfig({
      importFioriSystems: true,
      systems: { dev: { url: 'https://dev.example.com', client: '100' } },
    });
    const config = await load();

    expect(config.errors).toEqual([]);
    expect([...config.systems.keys()]).toEqual(['dev']);
  });

  it('ignores a corrupt store file rather than failing the whole load', async () => {
    await mkdir(join(homeDir, '.saptools'), { recursive: true });
    await writeFile(join(homeDir, '.saptools', 'systems.json'), '{ not json', 'utf8');
    await writeConfig({
      importFioriSystems: true,
      systems: { dev: { url: 'https://dev.example.com', client: '100' } },
    });
    const config = await load();

    expect(config.errors).toEqual([]);
    expect([...config.systems.keys()]).toEqual(['dev']);
  });

  it('also accepts a store without the "systems" wrapper', async () => {
    await mkdir(join(homeDir, '.saptools'), { recursive: true });
    await writeFile(
      join(homeDir, '.saptools', 'systems.json'),
      JSON.stringify({
        'https://flat.example.com/100': {
          name: 'FLAT',
          url: 'https://flat.example.com',
          client: '100',
        },
      }),
      'utf8',
    );
    await writeConfig({ importFioriSystems: true });
    const config = await load();

    expect(config.systems.get('FLAT')?.url).toBe('https://flat.example.com');
  });

  it('is off unless requested', async () => {
    await writeFioriStore('.saptools', fioriStore);
    await writeConfig({ systems: { dev: { url: 'https://dev.example.com', client: '100' } } });
    const config = await load();

    expect([...config.systems.keys()]).toEqual(['dev']);
  });
});

describe('fioriKeychainId', () => {
  it('matches the id scheme used by @sap-ux/store', () => {
    expect(fioriKeychainId('https://sap.example.com:44300', '100')).toBe('https://sap.example.com:44300/100');
    expect(fioriKeychainId('https://sap.example.com:44300/', '100')).toBe('https://sap.example.com:44300/100');
    expect(fioriKeychainId('  https://sap.example.com  ')).toBe('https://sap.example.com');
  });
});

describe('plain http warning', () => {
  const warnings: string[] = [];
  const httpWarnings = () => warnings.filter((message) => message.includes('plain http'));

  beforeEach(() => {
    warnings.length = 0;
    setLogSink((level, message) => {
      if (level === 'warning') warnings.push(message);
    });
  });

  afterEach(() => setLogSink(undefined));

  it('warns once for an http system in the configuration', async () => {
    await load({
      MCP_ABAP_ADT_CONFIG_JSON: JSON.stringify({ systems: { trial: { url: 'http://trial.example.com:50000' } } }),
    });

    expect(httpWarnings()).toHaveLength(1);
    expect(httpWarnings()[0]).toContain('"trial"');
  });

  it('warns for an http system imported from SAP Fiori tools', async () => {
    await writeFioriStore('.saptools', { a: { name: 'TRIAL', url: 'http://trial.example.com:50000', client: '001' } });

    await load({ SAP_IMPORT_FIORI_SYSTEMS: 'true' });

    expect(httpWarnings()).toHaveLength(1);
  });

  it('warns for an http system built from the SAP_* variables', async () => {
    await load({ ...ENV_COMPLETE, SAP_URL: 'http://sap.example.com:50000' });

    expect(httpWarnings()).toHaveLength(1);
  });

  it('stays quiet for https', async () => {
    await load(ENV_COMPLETE);

    expect(httpWarnings()).toHaveLength(0);
  });
});
