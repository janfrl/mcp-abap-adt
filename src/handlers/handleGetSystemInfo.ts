import type { SapConnection } from '../connection/SapConnection.js';
import { compactDataPreview } from '../lib/dataPreview.js';
import { return_error, return_text, type ToolResult } from '../lib/result.js';

/**
 * CVERS answers "which release and software components" (UC3): the one fact
 * an LLM needs before it can tell a still-supported syntax from one that only
 * exists in a newer release. Fixed, not user-supplied, so this bypasses
 * `allowFreeSql` the same way GetTableContents does - that flag exists to gate
 * arbitrary queries, not a query the server author chose.
 */
const SYSTEM_INFO_QUERY = 'SELECT COMPONENT, RELEASE, EXTRELEASE FROM CVERS ORDER BY COMPONENT';

export async function handleGetSystemInfo(connection: SapConnection): Promise<ToolResult> {
  try {
    const response = await connection.request('/sap/bc/adt/datapreview/freestyle', {
      method: 'POST',
      body: SYSTEM_INFO_QUERY,
      query: { rowNumber: 500 },
      headers: { 'Content-Type': 'text/plain', Accept: 'application/xml, text/plain, */*' },
    });
    return return_text(compactDataPreview(response.data));
  } catch (error) {
    return return_error(error);
  }
}
