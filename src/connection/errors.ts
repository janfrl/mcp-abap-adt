/** An ADT request that reached the server and came back with a non-2xx status. */
export class AdtHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly url: string,
    readonly headers?: Headers,
  ) {
    super(`ADT request failed with status ${status}: ${url}`);
    this.name = 'AdtHttpError';
  }
}

/** The request ran out of its time budget before SAP answered. */
export class AdtTimeoutError extends Error {
  constructor(
    readonly systemName: string,
    readonly path: string,
    readonly budgetMs: number,
  ) {
    // The message carries both knobs because it is all the user gets to see:
    // a bare "aborted due to timeout" told nobody how long the budget was,
    // let alone that it is configurable.
    super(
      `No answer from system "${systemName}" within ${budgetMs} ms (${path}). ` +
        'A long-running query may simply need more time: pass timeoutMs on the ExecuteQuery call, ' +
        `or raise it for this system: mcp-abap-adt config systems.${systemName}.timeoutMs 120000`,
    );
    this.name = 'AdtTimeoutError';
  }
}

/** Undici signals its timeout as a DOMException named TimeoutError, wrapped by ofetch. */
export function isTimeout(error: unknown, depth = 0): boolean {
  if (depth > 5 || !error || typeof error !== 'object') return false;
  if ((error as { name?: unknown }).name === 'TimeoutError') return true;
  return isTimeout((error as { cause?: unknown }).cause, depth + 1);
}

export function isHttpStatus(error: unknown, status: number): error is AdtHttpError {
  return error instanceof AdtHttpError && error.status === status;
}

/**
 * Like isHttpStatus, but looks through wrappers: the CSRF prime wraps its
 * failure in a plain Error whose cause is the real response, and the session
 * recovery has to see that response no matter how it arrives.
 */
export function findHttpStatus(error: unknown, status: number, depth = 0): AdtHttpError | undefined {
  if (depth > 5 || !error || typeof error !== 'object') return undefined;
  if (error instanceof AdtHttpError) {
    return error.status === status ? error : undefined;
  }
  return findHttpStatus((error as { cause?: unknown }).cause, status, depth + 1);
}

/**
 * ICF answers 401 and some server errors with a full HTML page - around 8 kB
 * including an embedded logo image. As an MCP error text that buries the one
 * fact it carries, so it is reduced to a line. The page title survives because
 * it is localized and names the reason ("Anmeldung fehlgeschlagen").
 * Returns undefined for anything that is not an HTML document, in particular
 * for ADT's XML exception bodies, which are worth keeping whole.
 */
export function summarizeHtmlPage(body: string): string | undefined {
  if (!/^\s*(?:<!doctype\b|<html[\s>])/iu.test(body)) return undefined;
  const title = /<title>([^<]*)<\/title>/iu.exec(body)?.[1]?.trim();
  return `SAP answered with an HTML page instead of an ADT response${title ? `: "${title}"` : ''}.`;
}

/** TLS handshake failures that a per-system `allowSelfSigned` would resolve. */
const SELF_SIGNED_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function findCertificateErrorCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 5) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && SELF_SIGNED_CODES.has(code)) return code;
  return findCertificateErrorCode((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * Certificate verification is on by default, which is a change from earlier
 * versions that disabled it unconditionally. Point the user at the opt-out
 * instead of letting undici's bare "fetch failed" reach them.
 */
export function describeTlsFailure(error: unknown, systemName: string): Error | undefined {
  const code = findCertificateErrorCode(error);
  if (!code) return undefined;
  // Both configuration surfaces are named because the message must be
  // actionable for someone who has no config file at all.
  return new Error(
    `TLS certificate verification failed for system "${systemName}" (${code}). ` +
      'A certificate from a company CA the operating system trusts is accepted automatically, so this one is not. ' +
      `If it is a self-signed sandbox, allow it explicitly: mcp-abap-adt config systems.${systemName}.allowSelfSigned true ` +
      '(or SAP_ALLOW_SELF_SIGNED=true if you configure the server through environment variables).',
    { cause: error },
  );
}
