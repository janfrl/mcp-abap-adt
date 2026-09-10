import { z } from 'zod';

/**
 * Authentication methods a system can use. Only Basic authentication is
 * implemented today; on-premise ADT (`/sap/bc/adt`) is a plain ICF node and
 * does not accept OAuth bearer tokens, so an OAuth option would only ever
 * apply to the BTP ABAP Environment.
 */
export const AUTH_TYPES = ['basic'] as const;
export type AuthType = (typeof AUTH_TYPES)[number];

export const SystemConfigSchema = z.object({
  /** Base URL of the SAP system, e.g. https://vhcalnplci.dummy.nodomain:44300 */
  // A user:password@ part would be echoed by ListSystems and doctor, which
  // promise to show no credentials, and the connection drops it anyway.
  url: z.url().refine(
    (value) => {
      // A value z.url() already rejected is not this check's business.
      if (!URL.canParse(value)) return true;
      const parsed = new URL(value);
      return parsed.username === '' && parsed.password === '';
    },
    { message: 'must not carry a username or password - use "keychain": true or "passwordEnv" instead' },
  ),
  /**
   * Three digit SAP client. Omitted means the system's default client is used.
   *
   * A number is accepted as well as a string, because rc files coerce types and
   * would otherwise turn a written 100 into something the schema rejects. The
   * conversion is lossless for every valid client: rc9 only makes a number of a
   * value without a leading zero, and those survive String() unchanged, while
   * 010 and 000 stay strings. A number that is not three digits still fails
   * below rather than being padded into a different client.
   */
  client: z
    .union([z.string(), z.number().int().nonnegative()])
    .transform(String)
    .refine((value) => /^\d{3}$/.test(value), 'client must be a three digit SAP client, e.g. "100"')
    .optional(),
  /** Two letter logon language, e.g. "EN". */
  language: z.string().min(1).optional(),
  authType: z.enum(AUTH_TYPES).default('basic'),
  username: z.string().min(1).optional(),
  /** Plaintext password. Discouraged — prefer passwordEnv or keychain. */
  password: z.string().optional(),
  /** Name of an environment variable holding the password. */
  passwordEnv: z.string().min(1).optional(),
  /** Look the credentials up in the OS keychain (SAP Fiori tools compatible). */
  keychain: z.boolean().default(false),
  /** Accept self-signed / untrusted TLS certificates for this system only. */
  allowSelfSigned: z.boolean().default(false),
  /**
   * Allow the ExecuteQuery tool to run free SELECT statements against this
   * system. On by default: the alternative is GetTableContents, which reads
   * whole tables with SELECT *, so switching this off makes a model read more
   * data rather than less. Turn it off where any ad-hoc query is unwelcome.
   */
  allowFreeSql: z.boolean().default(true),
  // One minute rather than thirty seconds: a full GetTableContents or a heavy
  // join legitimately crosses 30s, and the cost of the higher ceiling is only
  // paid when a host hangs - failures still arrive as fast as ever.
  timeoutMs: z.number().int().positive().default(60_000),
});

export type SystemConfig = z.infer<typeof SystemConfigSchema>;
export type SystemConfigInput = z.input<typeof SystemConfigSchema>;

export const AppConfigFileSchema = z.object({
  /** Name of the system used when a tool call omits the `system` argument. */
  defaultSystem: z.string().optional(),
  /** Adopt systems saved by the SAP Fiori tools VS Code extension. */
  importFioriSystems: z.boolean().default(false),
  /**
   * Systems are validated one by one so a single malformed entry does not
   * take down the whole configuration.
   */
  systems: z.record(z.string(), z.unknown()).default({}),
});

export type AppConfigFile = z.input<typeof AppConfigFileSchema>;

/** Where a system's definition came from. Reported by ListSystems. */
export type SystemOrigin = 'config-file' | 'environment' | 'fiori-tools';

export interface ResolvedSystem extends SystemConfig {
  origin: SystemOrigin;
}

/** A non-fatal configuration problem, surfaced through ListSystems and stderr. */
export interface ConfigError {
  /** 'global' or `system:<name>` */
  scope: string;
  message: string;
}

export interface ResolvedAppConfig {
  defaultSystem?: string;
  systems: Map<string, ResolvedSystem>;
  errors: ConfigError[];
  /** Human readable list of the layers that contributed, for diagnostics. */
  sources: string[];
}
