import convert from 'xml-js';

import type { SapConnection } from '../connection/SapConnection.js';
import { uriFragmentFields } from '../lib/adtUri.js';
import { asArray } from '../lib/dataPreview.js';
import { return_error, return_text, type ToolResult } from '../lib/result.js';

export type UsageObjectType = 'program' | 'class' | 'interface' | 'table' | 'cds_view';

/** The object's own ADT URI, not its /source/main - usageReferences addresses the repository object itself. */
const OBJECT_URI: Record<UsageObjectType, (name: string) => string> = {
  program: (name) => `/sap/bc/adt/programs/programs/${encodeURIComponent(name)}`,
  class: (name) => `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}`,
  interface: (name) => `/sap/bc/adt/oo/interfaces/${encodeURIComponent(name)}`,
  table: (name) => `/sap/bc/adt/ddic/tables/${encodeURIComponent(name)}`,
  cds_view: (name) => `/sap/bc/adt/ddic/ddl/sources/${encodeURIComponent(name.toUpperCase())}`,
};

function attr(node: any, ...names: string[]): string {
  const attrs = node?._attributes ?? {};
  for (const name of names) {
    if (typeof attrs[name] === 'string') return attrs[name];
  }
  return '';
}

interface UsageReference {
  uri: string;
  usageInformation: string;
  type: string;
  name: string;
  description: string;
  packageName: string;
}

interface UsageResult {
  references: UsageReference[];
  /** Grouping nodes dropped, reported so the filter stays auditable. */
  omitted: number;
}

/**
 * Returns undefined only when the expected root is missing entirely - an
 * unfamiliar response shape, not a real "nothing uses this object" answer.
 * Mirrors compactDataPreview's fallback: an unrecognised variant should cost
 * the caller detail, not the whole answer.
 *
 * SAP answers with a tree flattened into one list, and only the leaves are
 * usages: a package or function group appears as a grouping node for the hits
 * beneath it. The two are told apart by `usageInformation`, which only a real
 * usage carries - the type does not help, since a grouping node has one too
 * (`FUGR/F`). Measured on T100: 697 of 1432 entries were grouping nodes, and
 * a model reading the unfiltered list would count them as callers.
 *
 * `omitted` is carried out rather than discarded: were a system ever to leave
 * the attribute off a real hit, a silent filter would hide it, and a number
 * that suddenly matches the total is the visible symptom.
 */
function parseUsageReferences(xml: string): UsageResult | undefined {
  let parsed: any;
  try {
    parsed = convert.xml2js(xml, { compact: true });
  } catch {
    return undefined;
  }

  const result = parsed?.['usageReferences:usageReferenceResult'];
  if (!result) return undefined;

  const nodes = asArray(result['usageReferences:referencedObjects']?.['usageReferences:referencedObject']);
  const references: UsageReference[] = [];
  let omitted = 0;

  for (const node of nodes) {
    const usageInformation = attr(node, 'usageInformation', 'usageReferences:usageInformation');
    if (!usageInformation) {
      omitted += 1;
      continue;
    }

    const adtObject = node?.['usageReferences:adtObject'];
    const packageRef = adtObject?.['adtcore:packageRef'];
    const uri = attr(node, 'uri', 'usageReferences:uri', 'adtcore:uri');
    references.push({
      uri,
      usageInformation,
      // A hit inside a method has no type on its adtObject; ADT puts it in the
      // URI fragment instead (`#type=CLAS%2FOM;name=...`). Without this, every
      // such usage reads as type "?".
      type: attr(adtObject, 'adtcore:type') || uriFragmentFields(uri).type || '',
      name: attr(adtObject, 'adtcore:name'),
      description: attr(adtObject, 'adtcore:description'),
      packageName: attr(packageRef, 'adtcore:name'),
    });
  }

  return { references, omitted };
}

/**
 * The header states the real total before the list is cut, so a truncated
 * answer can never read as a shorter one - the same reason GetAtcFindings
 * names its total. A widely used object is where this matters: T100 answers
 * with 735 usages, which no model reads to the end and none should be told it
 * has seen in full.
 */
function formatUsageReferences(result: UsageResult, limit: number): string {
  const { references, omitted } = result;
  const grouping = omitted > 0 ? ` ${omitted} grouping nodes were omitted.` : '';
  if (references.length === 0) return `No usages found.${grouping}`;

  const shown = references.slice(0, limit);
  const counts = [`${references.length} usages`];
  if (omitted > 0) counts.push(`${omitted} grouping nodes omitted`);
  if (shown.length < references.length) counts.push(`showing the first ${shown.length}`);

  const lines = shown.map((r) => {
    const location = r.packageName ? `${r.name} (${r.packageName})` : r.name;
    return `${r.type || '?'} ${location} [${r.usageInformation}]: ${r.uri}`;
  });
  return [`${counts.join(', ')}:`, ...lines].join('\n');
}

/**
 * The ADT "where-used list", the same one Eclipse's Ctrl+Shift+H runs. Purely
 * a lookup against SAP's usage-reference index; the request body is fixed and
 * carries no content of its own, only the target `uri` as a query parameter.
 */
export async function handleGetWhereUsed(
  connection: SapConnection,
  args: { object_type: UsageObjectType; object_name: string; max_results?: number },
): Promise<ToolResult> {
  try {
    const uri = OBJECT_URI[args.object_type](args.object_name);
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<usagereferences:usageReferenceRequest xmlns:usagereferences="http://www.sap.com/adt/ris/usageReferences">
  <usagereferences:affectedObjects/>
</usagereferences:usageReferenceRequest>`;

    const response = await connection.request('/sap/bc/adt/repository/informationsystem/usageReferences', {
      method: 'POST',
      query: { uri },
      body,
      headers: { 'Content-Type': 'application/*', Accept: 'application/*' },
    });

    const result = parseUsageReferences(response.data);
    if (!result) return return_text(response.data);
    return return_text(formatUsageReferences(result, args.max_results ?? 100));
  } catch (error) {
    return return_error(error);
  }
}
