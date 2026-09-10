import { Agent, fetch as undiciFetch } from 'undici';

import { loadKeychainBackend } from '../auth/providers/keychain.js';
import { FIORI_KEYCHAIN_SERVICE, fioriKeychainId } from '../config/fiori.js';
import { loadAppConfig } from '../config/load.js';
import type { ResolvedSystem } from '../config/schema.js';
import { AdtHttpError, describeTlsFailure, findHttpStatus } from '../connection/errors.js';
import { SapConnection } from '../connection/SapConnection.js';
import { ConnectionRegistry } from '../connection/registry.js';
import { ensureSystemTrustStore } from '../lib/trustStore.js';
import { defaultIo, type CliDeps } from './storeCredentials.js';

export interface DoctorOptions {
  configFile?: string;
  /** Additionally make exactly one authenticated request per system. */
  login?: boolean;
}

export interface DoctorDeps extends CliDeps {
  /** Unauthenticated reachability probe; injected in tests. */
  probeFetch?: typeof globalThis.fetch;
  /** Handed to SapConnection for --login; injected in tests. */
  loginFetch?: typeof globalThis.fetch;
  /** Trust-store outcome; injected in tests, which must not depend on the host's CA store. */
  ensureTrustStore?: () => boolean;
}

const PROBE_TIMEOUT_MS = 10_000;

/**
 * The classification carries the machine-readable half; `label` is only for
 * the table cell. Findings counter and summary paragraphs key off the fields,
 * never off the display text - a reworded cell must not change the exit code.
 */
interface Reachability {
  ok: boolean;
  tlsFailed: boolean;
  label: string;
}

/**
 * Reachability without authentication: a GET carrying no Authorization header
 * cannot be attributed to any user, so it proves host, port and TLS without
 * ever touching a failed-logon counter. Any HTTP status - the 401 challenge
 * above all - counts as reachable. 401 and an anonymously readable 200 render
 * without the number: a healthy system must not wear a status that reads like
 * an error. Other statuses keep it, because there it is information - a 403
 * reliably means the host does not offer ADT to this user at all (a Gateway
 * hub, typically).
 */
async function probeReachability(system: ResolvedSystem, probeFetch?: typeof globalThis.fetch): Promise<Reachability> {
  const url = `${new URL(system.url).origin}/sap/bc/adt/discovery`;
  // The Agent is built even when a test injects its fetch, so the one branch
  // deciding certificate verification is exercised by every test run.
  const agent = new Agent({ connect: { rejectUnauthorized: !system.allowSelfSigned } });
  try {
    const doFetch = probeFetch ?? (undiciFetch as unknown as typeof globalThis.fetch);
    const response = await doFetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      dispatcher: agent,
    } as unknown as RequestInit);
    const label = response.status === 401 || response.status === 200 ? 'reachable' : `reachable (${response.status})`;
    return { ok: true, tlsFailed: false, label };
  } catch (error) {
    if (describeTlsFailure(error, 'probe')) {
      const code = /\(([A-Z_]+)\)/u.exec(describeTlsFailure(error, 'probe')?.message ?? '')?.[1] ?? 'TLS';
      return { ok: false, tlsFailed: true, label: `TLS failure (${code})` };
    }
    return { ok: false, tlsFailed: false, label: 'unreachable - host down, VPN not connected, or DNS unknown' };
  } finally {
    await agent.close().catch(() => undefined);
  }
}

/** Exactly one authenticated request; a fresh connection never retries a 401. */
async function probeLogin(name: string, system: ResolvedSystem, loginFetch?: typeof globalThis.fetch): Promise<string> {
  const connection = new SapConnection(name, system, loginFetch ? { fetch: loginFetch } : {});
  try {
    await connection.request('/sap/bc/adt/discovery');
    return 'ok';
  } catch (error) {
    if (findHttpStatus(error, 401)) return 'rejected (401) - wrong password or locked user';
    // Column-friendly: the status says enough, the URL is already in the row.
    if (error instanceof AdtHttpError) return `failed (${error.status})`;
    return `failed: ${error instanceof Error ? error.message.slice(0, 40) : String(error)}`;
  } finally {
    await connection.close().catch(() => undefined);
  }
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ');
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n');
}

/**
 * One table answering the questions that otherwise need four manual checks:
 * which systems exist, where their credentials come from, whether the keychain
 * actually holds an entry, and whether the host is reachable at all.
 *
 * Returns the process exit code: 0 when nothing needs attention.
 */
export async function doctor(options: DoctorOptions = {}, deps: DoctorDeps = {}): Promise<number> {
  const io = deps.io ?? defaultIo;
  const config = await loadAppConfig({ configFile: options.configFile });
  const registry = new ConnectionRegistry(config);
  const listed = registry.listSystems();

  // After loadAppConfig on purpose, so an opt-out arriving through a .env
  // file has been seen. When this returns false - old Node without the
  // runtime APIs, or the opt-out - a TLS failure cannot be blamed on the
  // certificate, and the advice below differs accordingly.
  const trustStoreLoaded = (deps.ensureTrustStore ?? ensureSystemTrustStore)();

  let findings = config.errors.length;

  // The keychain is only consulted for systems that use it, and its absence
  // (no native module) is a finding of its own rather than a crash.
  let backendError: string | undefined;
  const backend = await (async () => {
    if (deps.backend) return deps.backend;
    if (!listed.some((system) => system.credentialSource === 'keychain')) return undefined;
    try {
      return await loadKeychainBackend();
    } catch (error) {
      backendError = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  })();

  let sawTlsFailure = false;
  let sawMissingSource = false;

  const rows = await Promise.all(
    listed.map(async (entry) => {
      const system = config.systems.get(entry.name) as ResolvedSystem;

      // The keychain lookup and the network probe are independent; a keychain
      // read can cost an out-of-process call, so it overlaps the handshake.
      const [credentialStatus, reach] = await Promise.all([
        (async (): Promise<string> => {
          if (entry.credentialSource === 'none') {
            // A system with no password source cannot log on at all. That is
            // a finding in its own right, login probe or not: "skipped" used
            // to let such a system end in "Everything checks out".
            findings += 1;
            sawMissingSource = true;
            return 'NONE';
          }
          if (entry.credentialSource !== 'keychain') return entry.credentialSource;
          if (!backend) {
            findings += 1;
            return 'keychain unavailable';
          }
          const secret = await backend.getPassword(FIORI_KEYCHAIN_SERVICE, fioriKeychainId(entry.url, entry.client));
          if (!secret) findings += 1;
          return secret ? 'keychain ok' : 'keychain entry MISSING';
        })(),
        probeReachability(system, deps.probeFetch),
      ]);

      if (!reach.ok) findings += 1;
      if (reach.tlsFailed) sawTlsFailure = true;

      const row = [
        `${entry.name}${entry.isDefault ? ' *' : ''}`,
        entry.url,
        entry.client ?? '',
        entry.origin,
        credentialStatus,
        reach.label,
      ];

      if (options.login) {
        // 'none' is a real value here, not an absence: listSystems reports it
        // for a system with no credential source, and attempting a logon there
        // could only produce a confusing failure.
        if (entry.credentialSource !== 'none' && reach.ok) {
          const login = await probeLogin(entry.name, system, deps.loginFetch);
          if (login !== 'ok') findings += 1;
          row.push(login);
        } else {
          row.push(entry.credentialSource === 'none' ? 'skipped (no credentials)' : 'skipped');
        }
      }
      return row;
    }),
  );

  const headers = ['system', 'url', 'client', 'origin', 'credentials', 'reachability'];
  if (options.login) headers.push('login');

  if (rows.length > 0) {
    io.out(`${renderTable(headers, rows)}\n`);
    io.out('* = default system\n');
  }
  if (sawTlsFailure) {
    // Which advice is right depends on whether the OS trust store is in
    // effect - the certificate is only to blame when it is.
    io.out(
      trustStoreLoaded
        ? '\nThe OS trust store is loaded, so those certificates are not trusted even by your operating system.\n' +
            'Either have the CA installed, or accept it per system with "allowSelfSigned": true.\n' +
            'That switches verification off for the system, which is why it comes last.\n'
        : '\nThe OS trust store could not be loaded here (an older Node, or SAP_USE_SYSTEM_CA=false).\n' +
            'A certificate from your company CA then fails even though it is fine.\n' +
            'On older Node, put "NODE_USE_SYSTEM_CA": "1" into the env block of every MCP client.\n' +
            '"allowSelfSigned": true is the last resort, since it switches verification off.\n',
    );
  }
  if (sawMissingSource) {
    io.out(
      '\nA system with credentials NONE cannot log on: add "keychain": true to it and run store-credentials,\n' +
        'or name an environment variable in "passwordEnv".\n',
    );
  }
  if (backendError) io.out(`\nKeychain: ${backendError}\n`);
  if (config.errors.length > 0) {
    io.out('\nConfiguration problems:\n');
    for (const error of config.errors) io.out(`  [${error.scope}] ${error.message}\n`);
  }
  if (!options.login && rows.length > 0) {
    io.out('\nCredentials were not tested; add --login for exactly one logon attempt per system.\n');
  }

  io.out(findings === 0 ? '\nEverything checks out.\n' : `\n${findings} finding${findings === 1 ? '' : 's'}.\n`);
  return findings === 0 ? 0 : 1;
}
