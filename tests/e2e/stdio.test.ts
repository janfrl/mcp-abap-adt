import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HERMETIC_CHILD_ENV } from '../setup/hermeticHome.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entryPoint = join(repoRoot, 'dist', 'index.js');

/**
 * Drives the built server as a real subprocess over stdio. This is the only
 * test that covers what the in-memory transport cannot: the bin entry point,
 * command line arguments, and that nothing except JSON-RPC ever reaches
 * stdout - a single stray byte there corrupts the protocol.
 *
 * Requires a build, so it skips when dist is absent. CI builds first.
 */
const built = existsSync(entryPoint);

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-e2e-'));
});

afterEach(async () => {
  // Windows holds a directory open a moment longer than the process that used
  // it, so a plain rm reports EBUSY after the real failure and buries it.
  await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function startServer(args: string[] = []) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPoint, ...args],
    // A hermetic environment and working directory: the developer's own SAP_*
    // variables, .env and config file must not reach this server. See
    // HERMETIC_CHILD_ENV for what each entry is holding back.
    cwd: workDir,
    env: { ...HERMETIC_CHILD_ENV },
    stderr: 'pipe',
  });

  let stderr = '';
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(transport);
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  return { client, readStderr: () => stderr };
}

/** callTool's result type still includes a legacy shape without `content`. */
function firstText(result: Record<string, unknown>): string {
  const content = result.content as Array<{ text: string }> | undefined;
  if (!content?.length) throw new Error('the tool result carried no content');
  return content[0].text;
}

/**
 * 60 s rather than vitest's default 5 s, for the reason cli.test.ts sets out:
 * spawning node and completing the MCP handshake is fast until the machine is
 * busy, and a timeout here would report the clock rather than the server.
 */
describe.skipIf(!built)('server over stdio', { timeout: 60_000 }, () => {
  it('completes the MCP handshake and reports its real version', async () => {
    const { client } = await startServer();

    const info = client.getServerVersion();

    expect(info?.name).toBe('mcp-abap-adt');
    // Not the "0.1.0" that used to be hardcoded regardless of the release.
    expect(info?.version).toMatch(/^\d+\.\d+\.\d+/u);
    await client.close();
  });

  it('serves all tools even with nothing configured', async () => {
    const { client } = await startServer();

    const { tools } = await client.listTools();

    expect(tools).toHaveLength(22);
    await client.close();
  });

  it('explains the missing configuration instead of dying at startup', async () => {
    const { client } = await startServer();

    const listed = await client.callTool({ name: 'ListSystems', arguments: {} });
    const payload = JSON.parse(firstText(listed)) as {
      systems: unknown[];
      configErrors: Array<{ message: string }>;
    };

    expect(payload.systems).toEqual([]);
    expect(payload.configErrors.map((error) => error.message).join('\n')).toContain('No SAP system is configured');
    await client.close();
  });

  it('answers a tool call with a readable error rather than a protocol failure', async () => {
    const { client } = await startServer();

    const result = await client.callTool({ name: 'GetProgram', arguments: { program_name: 'RSABAPPROGRAM' } });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('no default system is configured');
    await client.close();
  });

  it('reads the config file given with --config and keeps diagnostics off stdout', async () => {
    const configFile = join(workDir, 'custom.json');
    await writeFile(
      configFile,
      JSON.stringify({
        defaultSystem: 'sandbox',
        systems: {
          sandbox: {
            url: 'https://sandbox.example.com:44300',
            client: '001',
            username: 'U',
            // Distinctive on purpose: the assertion below is only worth
            // anything if this string could actually show up in the output.
            password: 'top-secret',
          },
          broken: { url: 'https://broken.example.com', client: 'XX' },
        },
      }),
      'utf8',
    );

    const { client, readStderr } = await startServer(['--config', configFile]);

    const text = firstText(await client.callTool({ name: 'ListSystems', arguments: {} }));
    const payload = JSON.parse(text) as {
      defaultSystem: string;
      systems: Array<{ name: string; origin: string }>;
      configErrors: Array<{ scope: string }>;
    };

    expect(payload.defaultSystem).toBe('sandbox');
    expect(payload.systems).toEqual([
      expect.objectContaining({ name: 'sandbox', origin: 'config-file', credentialSource: 'inline' }),
    ]);
    expect(payload.configErrors.map((error) => error.scope)).toContain('system:broken');
    // Reaching this point already proves stdout carried only JSON-RPC, since
    // the client would have failed to parse the stream otherwise.
    expect(text).not.toContain('top-secret');

    await client.close();
    // The plaintext-password warning belongs on stderr, where it cannot
    // corrupt the protocol.
    expect(readStderr()).toContain('plaintext password');
  });

  /**
   * The command line is the file-free route, and readCliOverrides is not
   * exported. Driving the real process is the honest level for it: it covers
   * the parseArgs wiring as well as the parsing.
   */
  describe('command line overrides', () => {
    const twoSystems = JSON.stringify({
      systems: {
        alpha: { url: 'https://alpha.example.com', client: '100' },
        beta: { url: 'https://beta.example.com', client: '200' },
      },
    });

    it('takes whole systems from --config-json, with no file anywhere', async () => {
      const { client } = await startServer(['--config-json', twoSystems]);

      const payload = JSON.parse(firstText(await client.callTool({ name: 'ListSystems', arguments: {} }))) as {
        systems: Array<{ name: string; client: string }>;
      };

      expect(payload.systems.map((entry) => entry.name).toSorted()).toEqual(['alpha', 'beta']);
      // A number here would mean the JSON route lost the type it exists to keep.
      expect(payload.systems.every((entry) => entry.client === '100' || entry.client === '200')).toBe(true);
      await client.close();
    });

    it('picks the default with --default-system', async () => {
      const { client } = await startServer(['--config-json', twoSystems, '--default-system', 'beta']);

      const payload = JSON.parse(firstText(await client.callTool({ name: 'ListSystems', arguments: {} }))) as {
        defaultSystem: string;
      };

      expect(payload.defaultSystem).toBe('beta');
      await client.close();
    });

    it('reports malformed --config-json instead of refusing to start', async () => {
      const { client } = await startServer(['--config-json', '{ not json']);

      const payload = JSON.parse(firstText(await client.callTool({ name: 'ListSystems', arguments: {} }))) as {
        configErrors: Array<{ message: string }>;
      };

      expect(payload.configErrors.map((error) => error.message).join('\n')).toContain(
        '--config-json could not be read',
      );
      await client.close();
    });
  });
});
