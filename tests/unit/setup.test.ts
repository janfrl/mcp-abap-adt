import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setup } from '../../src/cli/setup.js';
import type { CliIo } from '../../src/cli/storeCredentials.js';

let workDir: string;
let rcDir: string;
let teamFile: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-setup-'));
  rcDir = join(workDir, 'home');
  await mkdir(rcDir);
  teamFile = join(workDir, 'team-systems.jsonc');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const TEAM = {
  defaultSystem: 'dev',
  systems: {
    dev: { url: 'https://dev.example.com', client: '100', keychain: true },
    qas: { url: 'https://qas.example.com', client: '200', keychain: true },
  },
};

function scriptedIo(answers: { line?: string[]; secret?: string[]; yesNo?: boolean[] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    line: async () => answers.line?.shift() ?? '',
    secret: async () => answers.secret?.shift() ?? '',
    yesNo: async () => answers.yesNo?.shift() ?? false,
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
  };
  return { io, out: () => out.join(''), err: () => err.join('') };
}

function fakeBackend() {
  const store = new Map<string, string>();
  return {
    store,
    backend: {
      getPassword: async (_service: string, account: string) => store.get(account) ?? null,
      setPassword: async (_service: string, account: string, secret: string) => void store.set(account, secret),
    },
  };
}

describe('setup --from', () => {
  it('onboards a fresh machine: rc file plus one password for all systems', async () => {
    // JSONC on purpose - the shared file should be allowed to carry comments.
    await writeFile(teamFile, `{\n  // our landscape\n  ${JSON.stringify(TEAM).slice(1)}`, 'utf8');
    const { backend, store } = fakeBackend();
    const { io, out } = scriptedIo({ line: ['TEAM_USER'], secret: ['pw'], yesNo: [true] });

    const code = await setup({ from: teamFile }, { io, backend, rcDir });

    expect(code).toBe(0);
    const rc = await readFile(join(rcDir, '.mcp-abap-adtrc'), 'utf8');
    expect(rc).toContain('defaultSystem="dev"');
    expect(rc).toContain('systems.dev.url="https://dev.example.com"');
    expect(rc).toContain('systems.qas.client="200"');
    // One password, two keychain entries, Fiori account convention.
    expect(JSON.parse(store.get('https://dev.example.com/100') ?? '')).toEqual({
      username: 'TEAM_USER',
      password: 'pw',
    });
    expect(store.has('https://qas.example.com/200')).toBe(true);
    expect(existsSync(join(rcDir, '.mcp-abap-adtrc.bak'))).toBe(false);
    expect(out()).toContain('added:');
    expect(out()).toContain('doctor');
  });

  it('keeps local settings on re-run and leaves a .bak behind', async () => {
    await writeFile(teamFile, JSON.stringify(TEAM), 'utf8');
    await writeFile(
      join(rcDir, '.mcp-abap-adtrc'),
      'defaultSystem="qas"\nsystems.dev.url="https://dev.example.com"\nsystems.dev.allowSelfSigned=true\n',
      'utf8',
    );
    const { backend } = fakeBackend();
    const { io } = scriptedIo();

    const code = await setup({ from: teamFile, skipCredentials: true }, { io, backend, rcDir });

    expect(code).toBe(0);
    const rc = await readFile(join(rcDir, '.mcp-abap-adtrc'), 'utf8');
    // The user's own default and their TLS exception survive the team list.
    expect(rc).toContain('defaultSystem="qas"');
    expect(rc).toContain('systems.dev.allowSelfSigned=true');
    expect(rc).toContain('systems.qas.url="https://qas.example.com"');
    expect(existsSync(join(rcDir, '.mcp-abap-adtrc.bak'))).toBe(true);
  });

  it('stores the password for the connection that will actually be used, not the one in the team file', async () => {
    // Local settings win the merge, so the effective dev system points at the
    // local url and client. The keychain entry is keyed by exactly those; one
    // written for the team file's url would leave the real connection without
    // a password while setup reports success.
    await writeFile(teamFile, JSON.stringify(TEAM), 'utf8');
    await writeFile(
      join(rcDir, '.mcp-abap-adtrc'),
      'systems.dev.url="https://local.example.com"\nsystems.dev.client="200"\n',
      'utf8',
    );
    const { backend, store } = fakeBackend();
    const { io, out } = scriptedIo({ line: ['someone'], secret: ['pw'], yesNo: [true] });

    const code = await setup({ from: teamFile }, { io, backend, rcDir });

    expect(code).toBe(0);
    expect(store.has('https://local.example.com/200')).toBe(true);
    expect(store.has('https://dev.example.com/100')).toBe(false);
    expect(store.has('https://qas.example.com/200')).toBe(true);
    expect(out()).toContain('https://local.example.com/200');
  });

  it('leaves a system alone whose local entry already names a password source', async () => {
    await writeFile(teamFile, JSON.stringify(TEAM), 'utf8');
    await writeFile(join(rcDir, '.mcp-abap-adtrc'), 'systems.dev.passwordEnv="SAP_DEV_PASSWORD"\n', 'utf8');
    const { backend, store } = fakeBackend();
    const { io } = scriptedIo({ line: ['someone'], secret: ['pw'], yesNo: [true] });

    const code = await setup({ from: teamFile }, { io, backend, rcDir });

    expect(code).toBe(0);
    expect(store.has('https://dev.example.com/100')).toBe(false);
    expect(store.has('https://qas.example.com/200')).toBe(true);
  });

  it('refuses anything that is not data', async () => {
    const tsFile = join(workDir, 'team.ts');
    await writeFile(tsFile, 'export default {}', 'utf8');
    const { io, err } = scriptedIo();

    const code = await setup({ from: tsFile }, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('data, not code');
  });

  it('refuses a team file that wants to extend other files', async () => {
    await writeFile(teamFile, JSON.stringify({ extends: ['github:evil/repo'], ...TEAM }), 'utf8');
    const { io, err } = scriptedIo();

    const code = await setup({ from: teamFile }, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('self-contained');
  });

  it('rejects an invalid team file with the offending field named', async () => {
    await writeFile(teamFile, JSON.stringify({ systems: { dev: { url: 'not-a-url' } } }), 'utf8');
    const { io, err } = scriptedIo();

    const code = await setup({ from: teamFile }, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('dev');
  });

  it('skips the keychain entirely with --skip-credentials', async () => {
    await writeFile(teamFile, JSON.stringify(TEAM), 'utf8');
    const { backend, store } = fakeBackend();
    const { io } = scriptedIo();

    const code = await setup({ from: teamFile, skipCredentials: true }, { io, backend, rcDir });

    expect(code).toBe(0);
    expect(store.size).toBe(0);
  });

  it('rejects a system name the rc file format cannot carry', async () => {
    // Measured: a dot nests, whitespace drops the line, digits build an array.
    await writeFile(teamFile, JSON.stringify({ systems: { 's4h.dev': { url: 'https://x.example.com' } } }), 'utf8');
    const { io, err } = scriptedIo();

    const code = await setup({ from: teamFile }, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('s4h.dev');
    expect(err()).toContain('rc file format');
  });

  it('enables the keychain for systems that name no credential source', async () => {
    // A team file exists for per-user credentials; its author should not need
    // to know a schema default to get working onboarding.
    await writeFile(
      teamFile,
      JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', client: '100' } } }),
      'utf8',
    );
    const { backend, store } = fakeBackend();
    const { io, out } = scriptedIo({ line: ['U'], secret: ['pw'], yesNo: [true] });

    const code = await setup({ from: teamFile }, { io, backend, rcDir });

    expect(code).toBe(0);
    expect(out()).toContain('keychain enabled:    dev');
    expect(store.has('https://dev.example.com/100')).toBe(true);
    expect(await readFile(join(rcDir, '.mcp-abap-adtrc'), 'utf8')).toContain('systems.dev.keychain=true');
  });

  it('says so instead of printing Done when nothing uses the keychain', async () => {
    await writeFile(
      teamFile,
      JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', passwordEnv: 'DEV_PW' } } }),
      'utf8',
    );
    const { backend, store } = fakeBackend();
    const { io, out } = scriptedIo();

    const code = await setup({ from: teamFile }, { io, backend, rcDir });

    expect(code).toBe(0);
    expect(out()).toContain('no password was stored');
    expect(store.size).toBe(0);
  });

  it('carries importFioriSystems into the rc file when the team file sets it', async () => {
    await writeFile(teamFile, JSON.stringify({ importFioriSystems: true, ...TEAM }), 'utf8');
    const { io } = scriptedIo();

    const code = await setup({ from: teamFile, skipCredentials: true }, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(0);
    expect(await readFile(join(rcDir, '.mcp-abap-adtrc'), 'utf8')).toContain('importFioriSystems=true');
  });

  it('explains itself without --from', async () => {
    const { io, err } = scriptedIo();

    const code = await setup({}, { io, backend: fakeBackend().backend, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('Usage:');
    expect(err()).toContain('no secrets');
  });
});
