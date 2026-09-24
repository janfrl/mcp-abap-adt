import { credentialSourceOf, defaultCredentialProviders } from '../auth/resolve.js';
import type { CredentialProvider, CredentialSource } from '../auth/types.js';
import type { ConfigError, ResolvedAppConfig, SystemOrigin } from '../config/schema.js';
import { SapConnection, type SapConnectionDeps } from './SapConnection.js';

/** Raised when a tool asks for a system that is not configured. */
export class UnknownSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownSystemError';
  }
}

/** Non-secret description of a configured system, safe to hand to a model. */
export interface SystemInfo {
  name: string;
  url: string;
  client?: string;
  language?: string;
  authType: string;
  credentialSource: CredentialSource | 'none';
  allowSelfSigned: boolean;
  allowFreeSql: boolean;
  isDefault: boolean;
  /** Where the system was defined, which is where a change has to be made. */
  origin: SystemOrigin;
}

export interface ConnectionRegistryDeps extends SapConnectionDeps {
  providers?: CredentialProvider[];
}

/** Owns one lazily created SapConnection per configured system. */
export class ConnectionRegistry {
  readonly #connections = new Map<string, SapConnection>();
  readonly #providers: CredentialProvider[];

  constructor(
    private readonly config: ResolvedAppConfig,
    private readonly deps: ConnectionRegistryDeps = {},
  ) {
    this.#providers = deps.providers ?? defaultCredentialProviders();
  }

  get defaultSystem(): string | undefined {
    return this.config.defaultSystem;
  }

  get configErrors(): ConfigError[] {
    return this.config.errors;
  }

  get systemNames(): string[] {
    return [...this.config.systems.keys()];
  }

  get(systemName?: string): SapConnection {
    const name = systemName ?? this.config.defaultSystem;
    if (!name) {
      throw new UnknownSystemError(
        `No system was given and no default system is configured. ${this.#available()} ` +
          'Pass the "system" argument, or set a default: mcp-abap-adt default <name>',
      );
    }

    const system = this.config.systems.get(name);
    if (!system) {
      throw new UnknownSystemError(`Unknown system "${name}". ${this.#available()}`);
    }

    let connection = this.#connections.get(name);
    if (!connection) {
      connection = new SapConnection(name, system, {
        fetch: this.deps.fetch,
        providers: this.#providers,
      });
      this.#connections.set(name, connection);
    }
    return connection;
  }

  listSystems(): SystemInfo[] {
    return [...this.config.systems].map(([name, system]) => ({
      name,
      url: system.url,
      client: system.client,
      language: system.language,
      authType: system.authType,
      credentialSource: credentialSourceOf(system, this.#providers) ?? 'none',
      allowSelfSigned: system.allowSelfSigned,
      allowFreeSql: system.allowFreeSql,
      isDefault: name === this.config.defaultSystem,
      origin: system.origin,
    }));
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.#connections.values()].map((connection) => connection.close()));
    this.#connections.clear();
  }

  #available(): string {
    const names = this.systemNames;
    return names.length ? `Configured systems: ${names.join(', ')}.` : 'No systems are configured.';
  }
}
