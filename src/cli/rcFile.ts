import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, serialize } from 'rc9';

export const RC_FILE = '.mcp-abap-adtrc';

/** The same resolution rc9 uses when c12 reads the file back. */
export function defaultRcDir(): string {
  return process.env.XDG_CONFIG_HOME || homedir();
}

export function rcPathIn(dir: string): string {
  return join(dir, RC_FILE);
}

/**
 * rc9 flattens system names into dotted keys: a dot nests, whitespace breaks
 * the line, and an all-digit name turns `systems` into a sparse array.
 */
export function isRcSafeName(name: string): boolean {
  return /^[A-Za-z0-9_-]+$/u.test(name) && !/^\d+$/u.test(name);
}

export type RcConfig = Record<string, unknown>;

export async function readRc(path: string): Promise<{ config: RcConfig; existed: boolean }> {
  try {
    return { config: parse(await readFile(path, 'utf8')), existed: true };
  } catch {
    return { config: {}, existed: false };
  }
}

/** Keeps the previous version as .bak: the rc file is hand-editable state. */
export async function writeRc(path: string, config: RcConfig, existed: boolean): Promise<void> {
  if (existed) await copyFile(path, `${path}.bak`);
  await writeFile(path, `${serialize(config)}\n`, 'utf8');
}

export function rcSystems(config: RcConfig): Record<string, Record<string, unknown>> {
  return (config.systems as Record<string, Record<string, unknown>> | undefined) ?? {};
}
