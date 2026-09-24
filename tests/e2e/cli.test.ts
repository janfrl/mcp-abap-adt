import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
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

async function runCli(args: string[], entry = entryPoint) {
  try {
    const { stdout, stderr } = await run(process.execPath, [entry, ...args], {
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

  it('setup on an empty pipe prints usage and exits with 2', async () => {
    // execFile hands the child a pipe, not a terminal, so the paste route
    // refuses (the password prompts would read the same pipe) and explains itself.
    const { code, output } = await runCli(['setup']);

    expect(code).toBe(2);
    expect(output).toContain('Usage: mcp-abap-adt setup [--from');
  });

  it('rejects an unknown command instead of starting the server', async () => {
    const { code, output } = await runCli(['test']);

    expect(code).toBe(2);
    expect(output).toContain('Unknown command "test"');
    expect(output).toContain('Commands:');
  });

  it('suggests the command a typo was probably meant to be', async () => {
    const { code, output } = await runCli(['docter']);

    expect(code).toBe(2);
    expect(output).toContain('Did you mean "doctor"?');
  });

  it('accepts delete as another name for remove', async () => {
    const { code, output } = await runCli(['delete']);

    expect(code).toBe(2);
    expect(output).toContain('Usage: mcp-abap-adt remove');
  });

  it('prints the installed version', async () => {
    const { code, output } = await runCli(['--version']);

    expect(code).toBe(0);
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it('prints the command list for help', async () => {
    const { code, output } = await runCli(['help']);

    expect(code).toBe(0);
    expect(output).toContain('doctor');
    expect(output).toContain('add');
  });

  it('remove without a name prints usage and exits with 2', async () => {
    const { code, output } = await runCli(['remove']);

    expect(code).toBe(2);
    expect(output).toContain('Usage: mcp-abap-adt remove');
  });

  it('store-credentials without arguments prints usage naming the bulk mode', async () => {
    const { code, output } = await runCli(['store-credentials']);

    expect(code).toBe(2);
    expect(output).toContain('--all');
  });

  // npm installs the bin as a symlink; Windows needs privileges for file
  // symlinks, so a junction to dist/ stands in.
  it('runs main() when started through a link, the way npm installs the command', async () => {
    let linkedEntry = join(workDir, 'mcp-abap-adt');
    try {
      await symlink(entryPoint, linkedEntry, 'file');
    } catch {
      await symlink(dirname(entryPoint), join(workDir, 'dist-link'), 'junction');
      linkedEntry = join(workDir, 'dist-link', 'index.js');
    }

    const { code, output } = await runCli(['doctor'], linkedEntry);

    // Before the fix: exit 0 and no output at all.
    expect(code).toBe(1);
    expect(output).toContain('No SAP system is configured');
  });
});
