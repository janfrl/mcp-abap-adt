import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { config, SYSTEM_KEYS } from '../../src/cli/config.js';
import type { CliIo } from '../../src/cli/storeCredentials.js';
import { SystemConfigSchema } from '../../src/config/schema.js';

let rcDir: string;
let rcPath: string;

beforeEach(async () => {
  rcDir = join(await mkdtemp(join(tmpdir(), 'mcp-abap-adt-config-')), 'home');
  await mkdir(rcDir);
  rcPath = join(rcDir, '.mcp-abap-adtrc');
});

afterEach(async () => {
  await rm(join(rcDir, '..'), { recursive: true, force: true });
});

function collectingIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    line: async () => '',
    secret: async () => '',
    yesNo: async () => false,
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
  };
  return { io, out: () => out.join(''), err: () => err.join('') };
}

const RC =
  'defaultSystem="DEV100"\nsystems.DEV100.url="https://dev.example.com"\nsystems.DEV100.client="100"\nsystems.DEV100.keychain=true\n';

describe('config', () => {
  it('knows every system setting the schema has, except the password', () => {
    expect(Object.keys(SYSTEM_KEYS).toSorted()).toEqual(
      Object.keys(SystemConfigSchema.shape)
        .filter((key) => key !== 'password')
        .toSorted(),
    );
  });

  it('shows the effective configuration without arguments', async () => {
    await writeFile(rcPath, `${RC}systems.DEV100.language="EN"\n`, 'utf8');
    const { io, out } = collectingIo();

    expect(await config({}, { io, rcDir })).toBe(0);
    expect(out()).toContain('defaultSystem       DEV100');
    expect(out()).toContain('importFioriSystems  false');
    expect(out()).toMatch(/DEV100 \*\s+https:\/\/dev\.example\.com\s+100\s+config-file\s+keychain\s+language=EN/u);
    expect(out()).toContain(rcPath);
  });

  it('sets a global setting with the right type', async () => {
    await writeFile(rcPath, `importFioriSystems=true\n${RC}`, 'utf8');
    const { io, out } = collectingIo();

    expect(await config({ key: 'importFioriSystems', value: 'false' }, { io, rcDir })).toBe(0);
    expect(await readFile(rcPath, 'utf8')).toContain('importFioriSystems=false');
    expect(out()).toContain('importFioriSystems = false');
  });

  it('sets a system setting and keeps a client a string', async () => {
    await writeFile(rcPath, RC, 'utf8');
    const { io } = collectingIo();

    expect(await config({ key: 'systems.DEV100.client', value: '010' }, { io, rcDir })).toBe(0);
    expect(await config({ key: 'systems.DEV100.allowSelfSigned', value: 'yes' }, { io, rcDir })).toBe(0);
    const rc = await readFile(rcPath, 'utf8');
    expect(rc).toContain('systems.DEV100.client="010"');
    expect(rc).toContain('systems.DEV100.allowSelfSigned=true');
  });

  it('reads and unsets a single setting', async () => {
    await writeFile(rcPath, `${RC}systems.DEV100.language="EN"\n`, 'utf8');
    const { io, out } = collectingIo();

    expect(await config({ key: 'systems.DEV100.language' }, { io, rcDir })).toBe(0);
    expect(out()).toContain('"EN"');
    expect(await config({ key: 'systems.DEV100.language', unset: true }, { io, rcDir })).toBe(0);
    expect(await readFile(rcPath, 'utf8')).not.toContain('language');
  });

  it('undoes a value that would break the configuration', async () => {
    await writeFile(rcPath, RC, 'utf8');
    const { io, err } = collectingIo();

    expect(await config({ key: 'systems.DEV100.url', value: 'not a url' }, { io, rcDir })).toBe(2);
    expect(await config({ key: 'defaultSystem', value: 'NOPE' }, { io, rcDir })).toBe(2);
    expect(err()).toContain('Not changed');
    expect(await readFile(rcPath, 'utf8')).toBe(RC);
  });

  it('says when a source that takes precedence keeps the old value in effect', async () => {
    await writeFile(rcPath, `importFioriSystems=true\n${RC}`, 'utf8');
    const { io, out } = collectingIo();
    const env = { SAP_IMPORT_FIORI_SYSTEMS: 'true' };

    expect(await config({ key: 'importFioriSystems', value: 'false' }, { io, rcDir, env })).toBe(1);
    expect(await readFile(rcPath, 'utf8')).toContain('importFioriSystems=false');
    expect(out()).toContain('is true in effect');
    expect(out()).toContain('SAP_IMPORT_FIORI_SYSTEMS');
  });

  it('refuses a password, unknown settings and values of the wrong type', async () => {
    const { io, err } = collectingIo();

    expect(await config({ key: 'systems.DEV100.password', value: 'x' }, { io, rcDir })).toBe(2);
    expect(err()).toContain('store-credentials');
    expect(await config({ key: 'colour', value: 'x' }, { io, rcDir })).toBe(2);
    expect(err()).toContain('Unknown setting');
    expect(await config({ key: 'systems.DEV100.timeoutMs', value: 'soon' }, { io, rcDir })).toBe(2);
    expect(err()).toContain('whole number');
    expect(existsSync(rcPath)).toBe(false);
  });
});
