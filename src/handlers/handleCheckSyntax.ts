import convert from 'xml-js';

import type { SapConnection } from '../connection/SapConnection.js';
import { asArray } from '../lib/dataPreview.js';
import { return_error, return_text, type ToolResult } from '../lib/result.js';

export type CheckableObjectType = 'program' | 'class' | 'interface';

/** The same URI shape GetProgram/GetClass/GetInterface already build. */
const SOURCE_PATH: Record<CheckableObjectType, (name: string) => string> = {
  program: (name) => `/sap/bc/adt/programs/programs/${encodeURIComponent(name)}/source/main`,
  class: (name) => `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/source/main`,
  interface: (name) => `/sap/bc/adt/oo/interfaces/${encodeURIComponent(name)}/source/main`,
};

interface CheckMessage {
  severity: string;
  line: number;
  offset: number;
  text: string;
}

/**
 * chkrun:checkMessage carries its position folded into the uri attribute as
 * "...#start=line,offset" rather than as separate line/offset attributes.
 */
function parseCheckMessages(xml: string): CheckMessage[] {
  const parsed = convert.xml2js(xml, { compact: true }) as any;
  const reports = asArray(parsed?.['chkrun:checkRunReports']?.['chkrun:checkReport']);

  return reports
    .flatMap((report: any) => asArray(report?.['chkrun:checkMessageList']?.['chkrun:checkMessage']))
    .map((message: any) => {
      const attrs = message?._attributes ?? {};
      const uri = typeof attrs['chkrun:uri'] === 'string' ? attrs['chkrun:uri'] : '';
      const position = /#start=(\d+),(\d+)/u.exec(uri);
      return {
        severity: String(attrs['chkrun:type'] ?? '?'),
        line: position ? Number(position[1]) : 0,
        offset: position ? Number(position[2]) : 0,
        text: String(attrs['chkrun:shortText'] ?? ''),
      };
    });
}

function formatCheckMessages(messages: CheckMessage[]): string {
  if (messages.length === 0) return 'No syntax errors or warnings found.';
  return messages.map((m) => `[${m.severity}] line ${m.line}, col ${m.offset}: ${m.text}`).join('\n');
}

/**
 * Runs SAP's own non-activating check-run (the same one the ABAP editor calls
 * on every keystroke) against source text supplied by the caller, not against
 * whatever is currently saved. Nothing is written or activated: the object
 * behind `object_name` only supplies syntax context (its type, its class
 * hierarchy, its used types), the text actually checked is `source`. POST is
 * required because ADT expects the source in the request body, exactly as
 * ExecuteQuery and GetTableContents already POST a read-only SELECT.
 */
export async function handleCheckSyntax(
  connection: SapConnection,
  args: { object_type: CheckableObjectType; object_name: string; source: string },
): Promise<ToolResult> {
  try {
    const uri = SOURCE_PATH[args.object_type](args.object_name);
    const content = Buffer.from(args.source, 'utf-8').toString('base64');
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<chkrun:checkObjectList xmlns:chkrun="http://www.sap.com/adt/checkrun" xmlns:adtcore="http://www.sap.com/adt/core">
  <chkrun:checkObject adtcore:uri="${uri}" chkrun:version="active">
    <chkrun:artifacts>
      <chkrun:artifact chkrun:contentType="text/plain; charset=utf-8" chkrun:uri="${uri}">
        <chkrun:content>${content}</chkrun:content>
      </chkrun:artifact>
    </chkrun:artifacts>
  </chkrun:checkObject>
</chkrun:checkObjectList>`;

    const response = await connection.request('/sap/bc/adt/checkruns', {
      method: 'POST',
      query: { reporters: 'abapCheckRun' },
      body,
      headers: { 'Content-Type': 'application/*', Accept: 'application/*' },
    });
    return return_text(formatCheckMessages(parseCheckMessages(response.data)));
  } catch (error) {
    return return_error(error);
  }
}
