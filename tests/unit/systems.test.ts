import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliIo } from '../../src/cli/storeCredentials.js';
import { addSystem, removeSystem, setDefaultSystem } from '../../src/cli/systems.js';

let rcDir: string;
let rcPath: string;

beforeEach(async () => {
  rcDir = join(await mkdtemp(join(tmpdir(), 'mcp-abap-adt-systems-')), 'home');
  await mkdir(rcDir);
  rcPath = join(rcDir, '.mcp-abap-adtrc');
});

afterEach(async () => {
  await rm(join(rcDir, '..'), { recursive: true, force: true });
});

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

const EXISTING = 'defaultSystem="DEV100"\nsystems.DEV100.url="https://dev.example.com"\nsystems.DEV100.keychain=true\n';

const tty = { isTTY: true };

describe('add', () => {
  it('asks for the fields, writes the rc entry and stores the password', async () => {
    const { backend, store } = fakeBackend();
    // Fields first, then the username the credential step asks for.
    const { io, out } = scriptedIo({
      line: ['QAS200', 'https://qas.example.com:44300', '200', '', 'someone'],
      secret: ['pw'],
      yesNo: [true],
    });

    const code = await addSystem({}, { io, backend, rcDir, stdin: tty });

    expect(code).toBe(0);
    const rc = await readFile(rcPath, 'utf8');
    expect(rc).toContain('systems.QAS200.url="https://qas.example.com:44300"');
    expect(rc).toContain('systems.QAS200.client="200"');
    expect(rc).toContain('systems.QAS200.keychain=true');
    expect(rc).not.toContain('language');
    expect(JSON.parse(store.get('https://qas.example.com:44300/200') ?? '')).toMatchObject({ username: 'someone' });
    expect(out()).toContain('added "QAS200"');
    expect(out()).toContain('doctor');
  });

  it('takes the fields from flags and keeps the other systems', async () => {
    await writeFile(rcPath, EXISTING, 'utf8');
    const { io } = scriptedIo();

    const code = await addSystem(
      { name: 'QAS200', url: 'https://qas.example.com', client: '200', language: 'EN', skipCredentials: true },
      { io, backend: fakeBackend().backend, rcDir },
    );

    expect(code).toBe(0);
    const rc = await readFile(rcPath, 'utf8');
    expect(rc).toContain('defaultSystem="DEV100"');
    expect(rc).toContain('systems.DEV100.url="https://dev.example.com"');
    expect(rc).toContain('systems.QAS200.language="EN"');
    expect(existsSync(`${rcPath}.bak`)).toBe(true);
  });

  it('refuses a name the rc file cannot hold', async () => {
    const { io, err } = scriptedIo();

    const code = await addSystem(
      { name: 'my dev', url: 'https://x.example.com' },
      { io, backend: fakeBackend().backend, rcDir },
    );

    expect(code).toBe(2);
    expect(err()).toContain('cannot be a system name');
    expect(existsSync(rcPath)).toBe(false);
  });

  it('refuses an invalid url before writing anything', async () => {
    const { io, err } = scriptedIo();

    const code = await addSystem(
      { name: 'DEV100', url: 'not a url', client: '100' },
      { io, backend: fakeBackend().backend, rcDir },
    );

    expect(code).toBe(2);
    expect(err()).toContain('Not a valid system');
    expect(existsSync(rcPath)).toBe(false);
  });

  it('leaves an existing system alone unless replacing is confirmed', async () => {
    await writeFile(rcPath, EXISTING, 'utf8');
    const { io, out } = scriptedIo({ yesNo: [false] });

    const code = await addSystem(
      { name: 'DEV100', url: 'https://other.example.com' },
      { io, backend: fakeBackend().backend, rcDir, stdin: tty },
    );

    expect(code).toBe(0);
    expect(out()).toContain('Nothing changed');
    expect(await readFile(rcPath, 'utf8')).toBe(EXISTING);
  });

  it('does not prompt without a terminal: optional fields stay empty, required ones are demanded', async () => {
    const { io, err } = scriptedIo({ line: ['should-not-be-read'] });

    // Missing language, no terminal: written without one rather than waiting on a prompt nobody answers.
    expect(
      await addSystem(
        { name: 'QAS200', url: 'https://qas.example.com', client: '200', skipCredentials: true },
        { io, backend: fakeBackend().backend, rcDir, stdin: { isTTY: false } },
      ),
    ).toBe(0);
    expect(await readFile(rcPath, 'utf8')).toContain('systems.QAS200.client="200"');

    expect(
      await addSystem(
        { name: 'DEV100', skipCredentials: true },
        { io, backend: fakeBackend().backend, rcDir, stdin: {} },
      ),
    ).toBe(2);
    expect(err()).toContain('pass --url');
    expect(await addSystem({}, { io, backend: fakeBackend().backend, rcDir, stdin: {} })).toBe(2);
    expect(err()).toContain('Usage: mcp-abap-adt add');
  });
});

describe('remove', () => {
  it('drops the system, keeps the rest and the keychain entry, and warns about the default', async () => {
    await writeFile(rcPath, `${EXISTING}systems.QAS200.url="https://qas.example.com"\n`, 'utf8');
    const { io, out } = scriptedIo();

    const code = await removeSystem({ name: 'DEV100' }, { io, rcDir });

    expect(code).toBe(0);
    const rc = await readFile(rcPath, 'utf8');
    expect(rc).not.toContain('DEV100.url');
    expect(rc).toContain('systems.QAS200.url="https://qas.example.com"');
    expect(existsSync(`${rcPath}.bak`)).toBe(true);
    expect(out()).toContain('removed "DEV100"');
    expect(out()).toContain('keychain entry stays');
    expect(out()).toContain('was the default system');
  });

  it('names the systems it knows when the name is unknown', async () => {
    await writeFile(rcPath, EXISTING, 'utf8');
    const { io, err } = scriptedIo();

    const code = await removeSystem({ name: 'NOPE' }, { io, rcDir });

    expect(code).toBe(2);
    expect(err()).toContain('Systems there: DEV100');
    expect(err()).toContain('Fiori tools');
  });

  it('prints usage without a name', async () => {
    const { io, err } = scriptedIo();

    expect(await removeSystem({}, { io, rcDir })).toBe(2);
    expect(err()).toContain('Usage: mcp-abap-adt remove');
  });
});

describe('default', () => {
  const TWO = `${EXISTING}systems.QAS200.url="https://qas.example.com"\nsystems.QAS200.keychain=true\n`;

  it('shows the current default and the systems it could be', async () => {
    await writeFile(rcPath, TWO, 'utf8');
    const { io, out } = scriptedIo();

    expect(await setDefaultSystem({}, { io, rcDir })).toBe(0);
    expect(out()).toContain('Default system: DEV100');
    expect(out()).toContain('DEV100, QAS200');
  });

  it('sets a configured system as the default and keeps the rest of the rc file', async () => {
    await writeFile(rcPath, TWO, 'utf8');
    const { io, out } = scriptedIo();

    expect(await setDefaultSystem({ name: 'QAS200' }, { io, rcDir })).toBe(0);
    const rc = await readFile(rcPath, 'utf8');
    expect(rc).toContain('defaultSystem="QAS200"');
    expect(rc).not.toContain('defaultSystem="DEV100"');
    expect(rc).toContain('systems.DEV100.url="https://dev.example.com"');
    expect(existsSync(`${rcPath}.bak`)).toBe(true);
    expect(out()).toContain('now "QAS200"');
  });

  it('refuses a name that is not a configured system', async () => {
    await writeFile(rcPath, TWO, 'utf8');
    const { io, err } = scriptedIo();

    expect(await setDefaultSystem({ name: 'NOPE' }, { io, rcDir })).toBe(2);
    expect(err()).toContain('not a configured system');
    expect(err()).toContain('DEV100, QAS200');
    expect(await readFile(rcPath, 'utf8')).toBe(TWO);
  });
});
