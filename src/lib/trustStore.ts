import tls from 'node:tls';

import { logDebug } from './log.js';

export interface TrustStoreApi {
  getCACertificates(type: 'default' | 'bundled' | 'system'): string[];
  setDefaultCACertificates(certificates: string[]): void;
}

let loaded: boolean | undefined;

/** Tests flip the module-level memo between cases. */
export function resetTrustStoreForTests(): void {
  loaded = undefined;
}

/**
 * Makes this process trust what the operating system trusts, in addition to
 * Node's bundled CA list - the same effect as NODE_USE_SYSTEM_CA=1, applied
 * from inside.
 *
 * Node validates TLS against its own bundled list and ignores the OS store
 * unless told otherwise. On a company network, where the internal CA lives in
 * the OS store, that turned every system into a "TLS failure" until someone
 * discovered the environment variable - and MCP clients filter the
 * environment, so it had to be repeated in every client's env block. Loading
 * the store here removes that setup step entirely.
 *
 * This only ever widens trust to CAs the OS already accepts; it never
 * switches verification off. Skipped when NODE_USE_SYSTEM_CA already did the
 * same thing natively, and disabled by SAP_USE_SYSTEM_CA=false for anyone who
 * deliberately wants Node's bundled list only.
 */
export function ensureSystemTrustStore(env: NodeJS.ProcessEnv = process.env, api: TrustStoreApi = tls): boolean {
  if (loaded !== undefined) return loaded;

  // Node itself only honours the value 1; anything else (0, false, typo) left
  // the store unloaded, so this must not treat it as done.
  if (env.NODE_USE_SYSTEM_CA === '1') {
    loaded = true;
    return loaded;
  }
  const optOut = env.SAP_USE_SYSTEM_CA?.trim().toLowerCase();
  if (optOut === 'false' || optOut === '0' || optOut === 'no') {
    loaded = false;
    return loaded;
  }

  try {
    const system = api.getCACertificates('system');
    if (system.length === 0) {
      loaded = false;
      return loaded;
    }
    // On top of 'default', not 'bundled': the default list also carries the
    // NODE_EXTRA_CA_CERTS file, which replacing from 'bundled' would silently
    // drop - measured with a unique certificate before this was written.
    api.setDefaultCACertificates([...api.getCACertificates('default'), ...system]);
    logDebug(`trusting ${system.length} CA certificates from the operating system store`);
    loaded = true;
  } catch {
    // The APIs exist from Node 22.19, the engines floor; a failure here leaves Node's default list in place.
    loaded = false;
  }
  return loaded;
}
