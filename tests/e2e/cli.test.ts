import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HERMETIC_CHILD_ENV } from '../setup/hermeticHome.js';

const run = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const entryPoint = join(repoRoot, 'dist', 'index.js');

/**
 * The unit tests cover each command's flow with injected dependencies; what
 * they cannot cover is the dispatch itself - that `doctor` and `setup` as
 * positionals actually reach their modules through the built entry point.
 */
const built = existsSync(entryPoint);

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mcp-abap-adt-cli-e2e-'));
});

afterEach(async () => {
  // Windows holds a directory open a moment longer than the process that used
  // it, so a plain rm here reports EBUSY - and does it *after* the real
  // failure, burying it under a cleanup error. Retrying keeps the reported
  // failure the one that matters.
  await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function runCli(args: string[]) {
  try {
    const { stdout, stderr } = await run(process.execPath, [entryPoint, ...args], {
      cwd: workDir,
      // See HERMETIC_CHILD_ENV for what each entry is holding back.
      env: { ...HERMETIC_CHILD_ENV },
      timeout: 30_000,
    });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, output: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

/**
 * A test timeout has to be looser than the budget the test itself hands out,
 * or the assertion never gets to run: runCli allows the child 30 s, while
 * vitest defaults to 5 s. Spawning node and loading the built server is
 * normally under two seconds, but on a loaded machine it is not, and the
 * failure then reads "test timed out" plus an EBUSY from the cleanup - neither
 * of which says anything about the CLI.
 */
describe.skipIf(!built)('CLI dispatch through the built entry point', { timeout: 60_000 }, () => {
  it('doctor reports an empty configuration readably and exits with 1', async () => {
    const { code, output } = await runCli(['doctor']);

    expect(code).toBe(1);
    expect(output).toContain('No SAP system is configured');
    expect(output).toContain('finding');
  });

  it('setup without --from prints usage and exits with 2', async () => {
    const { code, output } = await runCli(['setup']);

    expect(code).toBe(2);
    expect(output).toContain('Usage: mcp-abap-adt setup --from');
  });

  it('store-credentials without arguments prints usage naming the bulk mode', async () => {
    const { code, output } = await runCli(['store-credentials']);

    expect(code).toBe(2);
    expect(output).toContain('--all');
  });
});
