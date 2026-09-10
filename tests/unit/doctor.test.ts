import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { doctor } from '../../src/cli/doctor.js';
import type { CliIo } from '../../src/cli/storeCredentials.js';

let workDir: string;
let configFile: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-doctor-'));
  configFile = join(workDir, 'config.json');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function collectingIo() {
  const out: string[] = [];
  const io: CliIo = {
    line: async () => '',
    secret: async () => '',
    yesNo: async () => false,
    out: (text) => void out.push(text),
    err: (text) => void out.push(text),
  };
  return { io, text: () => out.join('') };
}

const reachable: typeof globalThis.fetch = async () => new Response('logon', { status: 401 });
const down: typeof globalThis.fetch = async () => {
  throw new TypeError('fetch failed');
};
const tlsDown: typeof globalThis.fetch = async () => {
  throw Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('self-signed'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }),
  });
};
const accepting: typeof globalThis.fetch = async () => new Response('<discovery/>', { status: 200 });

describe('doctor', () => {
  it('reports a healthy landscape with exit code 0', async () => {
    await writeFile(
      configFile,
      JSON.stringify({
        defaultSystem: 'dev',
        systems: { dev: { url: 'https://dev.example.com', client: '100', username: 'U', password: 'P' } },
      }),
      'utf8',
    );
    const { io, text } = collectingIo();

    const code = await doctor({ configFile }, { io, probeFetch: reachable });

    expect(code).toBe(0);
    expect(text()).toContain('dev *');
    // The unauthenticated probe answers 401; the cell must not show a number
    // that reads like an error for a healthy system.
    expect(text()).toContain('reachable');
    expect(text()).not.toContain('reachable (401)');
    expect(text()).toContain('Everything checks out.');
    // Without --login the output says that credentials went untested.
    expect(text()).toContain('--login');
  });

  it('flags an unreachable host and exits with 1', async () => {
    await writeFile(
      configFile,
      JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', username: 'U', password: 'P' } } }),
      'utf8',
    );
    const { io, text } = collectingIo();

    const code = await doctor({ configFile }, { io, probeFetch: down });

    expect(code).toBe(1);
    expect(text()).toContain('unreachable');
    expect(text()).toContain('VPN');
  });

  it('points at allowSelfSigned when the probe fails on TLS', async () => {
    await writeFile(
      configFile,
      JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', username: 'U', password: 'P' } } }),
      'utf8',
    );
    const { io, text } = collectingIo();

    const code = await doctor({ configFile }, { io, probeFetch: tlsDown });

    expect(code).toBe(1);
    expect(text()).toContain('SELF_SIGNED_CERT_IN_CHAIN');
    expect(text()).toContain('allowSelfSigned');
  });

  it('blames the certificate only when the OS trust store is in effect', async () => {
    await writeFile(
      configFile,
      JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', username: 'U', password: 'P' } } }),
      'utf8',
    );
    const { io, text } = collectingIo();

    const code = await doctor({ configFile }, { io, probeFetch: tlsDown, ensureTrustStore: () => true });

    expect(code).toBe(1);
    expect(text()).toContain('TLS failure (SELF_SIGNED_CERT_IN_CHAIN)');
    expect(text()).toContain('not trusted even by your operating system');
    // With the store loaded, the environment variable is not the answer and
    // must not be offered as one.
    expect(text()).not.toContain('NODE_USE_SYSTEM_CA');
  });

  it('points at NODE_USE_SYSTEM_CA when the trust store could not be loaded', async () => {
    // Old Node without the runtime APIs, or an explicit opt-out: a company CA
    // then fails even though the certificate is fine, and telling the user to
    // switch verification off would be the wrong advice.
    await writeFile(
      configFile,
      JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', username: 'U', password: 'P' } } }),
      'utf8',
    );
    const { io, text } = collectingIo();

    const code = await doctor({ configFile }, { io, probeFetch: tlsDown, ensureTrustStore: () => false });

    expect(code).toBe(1);
    expect(text()).toContain('"NODE_USE_SYSTEM_CA": "1"');
    expect(text()).toContain('last resort');
    expect(text()).not.toContain('not trusted even by your operating system');
  });

  it('skips the logon for a system without any credential source', async () => {
    // credentialSource is the string 'none' there - a truthiness check once
    // sent doctor into a logon attempt that could only fail confusingly.
    await writeFile(configFile, JSON.stringify({ systems: { dev: { url: 'https://dev.example.com' } } }), 'utf8');
    const { io, text } = collectingIo();
    let loginAttempts = 0;
    const counting: typeof globalThis.fetch = async () => {
      loginAttempts += 1;
      return new Response('x', { status: 200 });
    };

    const code = await doctor({ configFile, login: true }, { io, probeFetch: reachable, loginFetch: counting });

    // Not attempted, and not "everything checks out" either: a system that
    // can never log on is a finding, whether or not --login was asked for.
    expect(code).toBe(1);
    expect(text()).toContain('skipped (no credentials)');
    expect(text()).toContain('cannot log on');
    expect(text()).not.toContain('Everything checks out');
    expect(loginAttempts).toBe(0);
  });

  it('checks whether the keychain actually holds an entry', async () => {
    await writeFile(
      configFile,
      JSON.stringify({
        systems: {
          stored: { url: 'https://a.example.com', client: '100', keychain: true },
          empty: { url: 'https://b.example.com', client: '200', keychain: true },
        },
      }),
      'utf8',
    );
    const { io, text } = collectingIo();
    const backend = {
      getPassword: async (_service: string, account: string) =>
        account === 'https://a.example.com/100' ? JSON.stringify({ username: 'U', password: 'P' }) : null,
      setPassword: async () => undefined,
    };

    const code = await doctor({ configFile }, { io, backend, probeFetch: reachable });

    expect(code).toBe(1);
    expect(text()).toContain('keychain ok');
    expect(text()).toContain('keychain entry MISSING');
  });

  it('makes exactly one logon attempt per system with --login', async () => {
    await writeFile(
      configFile,
      JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', username: 'U', password: 'P' } } }),
      'utf8',
    );
    const { io, text } = collectingIo();
    let attempts = 0;
    const rejecting: typeof globalThis.fetch = async () => {
      attempts += 1;
      return new Response('logon page', { status: 401 });
    };

    const code = await doctor({ configFile, login: true }, { io, probeFetch: reachable, loginFetch: rejecting });

    expect(code).toBe(1);
    expect(text()).toContain('rejected (401)');
    expect(attempts).toBe(1);
  });

  it('reports login ok when the credentials work', async () => {
    await writeFile(
      configFile,
      JSON.stringify({ systems: { dev: { url: 'https://dev.example.com', username: 'U', password: 'P' } } }),
      'utf8',
    );
    const { io, text } = collectingIo();

    const code = await doctor({ configFile, login: true }, { io, probeFetch: reachable, loginFetch: accepting });

    expect(code).toBe(0);
    expect(text()).toMatch(/ok\s*$/m);
  });

  it('lists configuration problems and exits with 1 when nothing is configured', async () => {
    await writeFile(configFile, JSON.stringify({}), 'utf8');
    const { io, text } = collectingIo();

    const code = await doctor({ configFile }, { io });

    expect(code).toBe(1);
    expect(text()).toContain('No SAP system is configured');
  });
});
