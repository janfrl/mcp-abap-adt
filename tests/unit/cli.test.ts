import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { interpretYesNo, promptYesNo } from '../../src/cli/prompt.js';
import { storeCredentials } from '../../src/cli/storeCredentials.js';

let workDir: string;
let configFile: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-cli-'));
  configFile = join(workDir, 'config.json');
  await writeFile(
    configFile,
    JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', client: '100' } } }),
    'utf8',
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(workDir, { recursive: true, force: true });
});

function captureStderr() {
  const written: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    written.push(String(chunk));
    return true;
  });
  return written;
}

describe('store-credentials argument handling', () => {
  it('prints usage and the known systems when --system is missing', async () => {
    const stderr = captureStderr();

    const code = await storeCredentials({ configFile });

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Usage: mcp-abap-adt store-credentials --system <name>');
    expect(stderr.join('')).toContain('dev');
  });

  it('rejects an unknown system before touching the keychain', async () => {
    const stderr = captureStderr();

    const code = await storeCredentials({ system: 'nope', configFile });

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unknown system "nope"');
  });
});

/** Terminal stand-in: scripted answers in, captured output out. */
function scriptedIo(answers: { line?: string[]; secret?: string[]; yesNo?: boolean[] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      line: async () => answers.line?.shift() ?? '',
      secret: async () => answers.secret?.shift() ?? '',
      yesNo: async () => answers.yesNo?.shift() ?? false,
      out: (text: string) => void out.push(text),
      err: (text: string) => void err.push(text),
    },
  };
}

function fakeBackend(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    backend: {
      getPassword: async (_service: string, account: string) => store.get(account) ?? null,
      setPassword: async (_service: string, account: string, secret: string) => void store.set(account, secret),
    },
  };
}

describe('store-credentials --all', () => {
  const threeSystems = {
    systems: {
      dev: { url: 'https://dev.example.com', client: '100', keychain: true },
      qas: { url: 'https://qas.example.com', client: '200', keychain: true },
      prd: { url: 'https://prd.example.com', client: '400' },
    },
  };

  it('asks for the password once and keeps each entry its own username', async () => {
    await writeFile(configFile, JSON.stringify(threeSystems), 'utf8');
    const { backend, store } = fakeBackend({
      'https://dev.example.com/100': JSON.stringify({ username: 'DEV_USER', password: 'old' }),
      'https://qas.example.com/200': JSON.stringify({ username: 'QAS_USER', password: 'old' }),
    });
    const { io, out } = scriptedIo({ secret: ['new-password'], yesNo: [true] });

    const code = await storeCredentials({ all: true, configFile }, { backend, io });

    expect(code).toBe(0);
    expect(JSON.parse(store.get('https://dev.example.com/100') ?? '')).toEqual({
      username: 'DEV_USER',
      password: 'new-password',
    });
    expect(JSON.parse(store.get('https://qas.example.com/200') ?? '')).toEqual({
      username: 'QAS_USER',
      password: 'new-password',
    });
    // prd has no "keychain": true, so --all leaves it alone.
    expect(store.has('https://prd.example.com/400')).toBe(false);
    // The summary names what is about to be written, before the confirmation.
    expect(out.join('')).toContain('DEV_USER @ https://dev.example.com/100');
  });

  it('asks once for systems without an entry, defaulting to the common username', async () => {
    await writeFile(configFile, JSON.stringify(threeSystems), 'utf8');
    const { backend, store } = fakeBackend({
      'https://dev.example.com/100': JSON.stringify({ username: 'SHARED', password: 'old' }),
    });
    // Empty answer takes the suggested default.
    const { io } = scriptedIo({ line: [''], secret: ['pw'], yesNo: [true] });

    const code = await storeCredentials({ all: true, configFile }, { backend, io });

    expect(code).toBe(0);
    expect(JSON.parse(store.get('https://qas.example.com/200') ?? '')).toMatchObject({ username: 'SHARED' });
  });

  it('rejects unknown names in --systems before touching anything', async () => {
    await writeFile(configFile, JSON.stringify(threeSystems), 'utf8');
    const { backend, store } = fakeBackend();
    const { io, err } = scriptedIo();

    const code = await storeCredentials({ systems: 'dev,nope', configFile }, { backend, io });

    expect(code).toBe(2);
    expect(err.join('')).toContain('nope');
    expect(store.size).toBe(0);
  });

  it('writes nothing when the confirmation is declined', async () => {
    await writeFile(configFile, JSON.stringify(threeSystems), 'utf8');
    const { backend, store } = fakeBackend();
    const { io } = scriptedIo({ line: ['U'], secret: ['pw'], yesNo: [false] });

    const code = await storeCredentials({ all: true, configFile }, { backend, io });

    expect(code).toBe(0);
    expect(store.size).toBe(0);
  });

  it('explains itself when no system uses the keychain', async () => {
    await writeFile(configFile, JSON.stringify({ systems: { prd: { url: 'https://prd.example.com' } } }), 'utf8');
    const { backend } = fakeBackend();
    const { io, err } = scriptedIo();

    const code = await storeCredentials({ all: true, configFile }, { backend, io });

    expect(code).toBe(2);
    expect(err.join('')).toContain('"keychain": true');
  });
});

describe('bulk safety', () => {
  const twoSystems = {
    systems: {
      dev: { url: 'https://dev.example.com', client: '100', keychain: true },
      qas: { url: 'https://qas.example.com', client: '200', keychain: true },
    },
  };

  it('lets an existing entry keep its username even against --username', async () => {
    // Documented: mixed-user landscapes stay intact; the flag only fills gaps.
    await writeFile(configFile, JSON.stringify(twoSystems), 'utf8');
    const { backend, store } = fakeBackend({
      'https://qas.example.com/200': JSON.stringify({ username: 'SAP_SUPPORT', password: 'old' }),
    });
    const { io } = scriptedIo({ secret: ['pw'], yesNo: [true] });

    const code = await storeCredentials({ all: true, username: 'DEVELOPER', configFile }, { backend, io });

    expect(code).toBe(0);
    expect(JSON.parse(store.get('https://qas.example.com/200') ?? '')).toMatchObject({ username: 'SAP_SUPPORT' });
    expect(JSON.parse(store.get('https://dev.example.com/100') ?? '')).toMatchObject({ username: 'DEVELOPER' });
  });

  it('marks entries that already exist in the summary', async () => {
    await writeFile(configFile, JSON.stringify(twoSystems), 'utf8');
    const { backend } = fakeBackend({
      'https://dev.example.com/100': JSON.stringify({ username: 'U', password: 'old' }),
    });
    const { io, out } = scriptedIo({ line: ['U'], secret: ['pw'], yesNo: [true] });

    await storeCredentials({ all: true, configFile }, { backend, io });

    const summary = out.join('');
    expect(summary).toContain('dev  ->  U @ https://dev.example.com/100  (replaces the existing entry)');
    expect(summary).not.toContain('qas.example.com/200  (replaces');
  });

  it('names entries the server will not read when --systems bypasses the keychain filter', async () => {
    await writeFile(
      configFile,
      JSON.stringify({
        systems: {
          dev: { url: 'https://dev.example.com', keychain: true },
          prd: { url: 'https://prd.example.com', password: 'inline' },
        },
      }),
      'utf8',
    );
    const { backend } = fakeBackend();
    const { io, err } = scriptedIo({ line: ['U'], secret: ['pw'], yesNo: [true] });

    const code = await storeCredentials({ systems: 'dev,prd', configFile }, { backend, io });

    expect(code).toBe(0);
    expect(err.join('')).toContain('"prd" has no "keychain": true');
  });
});

describe('prompts without a terminal', () => {
  it('promptYesNo takes the offered default instead of waiting forever', async () => {
    // vitest runs without a TTY - exactly the piped situation that once hung
    // after promptSecret had consumed the only stdin line.
    expect(process.stdin.isTTY).toBeFalsy();
    await expect(promptYesNo('proceed?', true)).resolves.toBe(true);
    await expect(promptYesNo('proceed?', false)).resolves.toBe(false);
  });
});

describe('interpretYesNo', () => {
  it('lets an empty answer take the offered default, in both directions', () => {
    expect(interpretYesNo('', true)).toBe(true);
    expect(interpretYesNo('', false)).toBe(false);
  });

  it('always honours an explicit answer over the default', () => {
    expect(interpretYesNo('n', true)).toBe(false);
    expect(interpretYesNo('no', true)).toBe(false);
    expect(interpretYesNo('y', false)).toBe(true);
    expect(interpretYesNo('Yes', false)).toBe(true);
  });

  it('treats anything unrecognisable as no', () => {
    expect(interpretYesNo('jein', true)).toBe(false);
  });
});
