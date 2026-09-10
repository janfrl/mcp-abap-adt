import convert from 'xml-js';

import type { SapConnection } from '../connection/SapConnection.js';
import { uriFragmentFields } from '../lib/adtUri.js';
import { asArray } from '../lib/dataPreview.js';
import { return_error, return_text, type ToolResult } from '../lib/result.js';

export type AtcObjectType = 'program' | 'class' | 'interface' | 'function_group' | 'table' | 'cds_view';

/**
 * The object's own ADT URI, the same shape GetWhereUsed builds - ATC addresses
 * the repository object, not its /source/main. Verified against a live system:
 * program, class, interface, function group and table are picked up; a DDL
 * source came back unchecked, which is a property of the check variant's scope
 * rather than of this URI, so the type stays offered and the "not checked"
 * answer below says so plainly.
 */
const OBJECT_URI: Record<AtcObjectType, (name: string) => string> = {
  program: (name) => `/sap/bc/adt/programs/programs/${encodeURIComponent(name)}`,
  class: (name) => `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}`,
  interface: (name) => `/sap/bc/adt/oo/interfaces/${encodeURIComponent(name)}`,
  function_group: (name) => `/sap/bc/adt/functions/groups/${encodeURIComponent(name)}`,
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

function textOf(node: any): string {
  const value = node?._text;
  return typeof value === 'string' ? value : '';
}

function parseXml(xml: string): any {
  try {
    return convert.xml2js(xml, { compact: true });
  } catch {
    return undefined;
  }
}

interface AtcFinding {
  priority: string;
  line: number;
  /** The sub-object a finding sits in, such as a method - absent for reports. */
  subObject: string;
  checkTitle: string;
  messageId: string;
  messageTitle: string;
  exemptionKind: string;
}

interface AtcObject {
  type: string;
  name: string;
  packageName: string;
  findings: AtcFinding[];
}

/**
 * `atcfinding:location` folds the position into a URI fragment, in two shapes
 * that a single-shape parser would silently drop half of:
 *
 *   .../source/main#start=8,0
 *   .../source/main#type=CLAS%2FOM;name=IF_OO_ADT_CLASSRUN%7eMAIN;start=32
 *
 * The second omits the column and names the sub-object, so only the line is
 * read and `name=` is worth keeping: "line 32" alone misleads in a class,
 * where the line is counted inside the method rather than in the file.
 */
function parseLocation(location: string): { line: number; subObject: string } {
  const fields = uriFragmentFields(location);
  const line = /^(\d+)/u.exec(fields.start ?? '');
  return { line: line ? Number(line[1]) : 0, subObject: fields.name ?? '' };
}

/**
 * Returns undefined only when the expected root is missing entirely - an
 * unfamiliar response shape rather than a real "nothing was found" answer, so
 * the caller can fall back to the raw XML the way GetWhereUsed does.
 */
function parseWorklist(xml: string): AtcObject[] | undefined {
  const worklist = parseXml(xml)?.['atcworklist:worklist'];
  if (!worklist) return undefined;

  return asArray(worklist['atcworklist:objects']?.['atcobject:object']).map((object: any) => ({
    type: attr(object, 'adtcore:type'),
    name: attr(object, 'adtcore:name'),
    packageName: attr(object, 'adtcore:packageName'),
    findings: asArray(object?.['atcobject:findings']?.['atcfinding:finding']).map((finding: any) => {
      const { line, subObject } = parseLocation(attr(finding, 'atcfinding:location'));
      return {
        priority: attr(finding, 'atcfinding:priority'),
        line,
        subObject,
        checkTitle: attr(finding, 'atcfinding:checkTitle'),
        messageId: attr(finding, 'atcfinding:messageId'),
        messageTitle: attr(finding, 'atcfinding:messageTitle'),
        exemptionKind: attr(finding, 'atcfinding:exemptionKind'),
      };
    }),
  }));
}

/**
 * The run answers with `atcinfo:info` entries. Two types matter: FINDING_STATS
 * carries SAP's own "p1,p2,p3" count, and TOOL_FAILURE means a check did not
 * complete. Reading the second one is not optional: without it an aborted run
 * is indistinguishable from a clean object, and reporting "no findings" for
 * code that was never checked is the one answer this tool must never give.
 */
function parseRunInfos(xml: string): { stats: string; failures: string[] } {
  const infos = asArray(parseXml(xml)?.['atcworklist:worklistRun']?.['atcworklist:infos']?.['atcinfo:info']);
  let stats = '';
  const failures: string[] = [];
  for (const info of infos) {
    const type = textOf(info?.['atcinfo:type']);
    const description = textOf(info?.['atcinfo:description']);
    if (type === 'FINDING_STATS') stats = description;
    else if (type === 'TOOL_FAILURE') failures.push(description);
  }
  return { stats, failures };
}

/** The variants this system offers under `pattern`, which may contain `*`. */
async function listAtcVariants(connection: SapConnection, pattern: string): Promise<string[]> {
  const response = await connection.request('/sap/bc/adt/atc/variants', {
    method: 'GET',
    query: { name: pattern },
    headers: { Accept: 'application/vnd.sap.adt.nameditems.v1+xml' },
  });
  return asArray(parseXml(response.data)?.['nameditem:namedItemList']?.['nameditem:namedItem'])
    .map((item: any) => textOf(item?.['nameditem:name']))
    .filter(Boolean);
}

function offers(variants: string[], variant: string): boolean {
  return variants.some((name) => name.toUpperCase() === variant.toUpperCase());
}

/**
 * SAP does not reject an unusable check variant. It silently substitutes its
 * own default and answers with that variant's findings, and nothing in the
 * response says which variant actually ran. Measured against a live system:
 * an invented name, a name that exists but is not released for general use,
 * and sending no name at all produced the identical eight findings on the same
 * class - while three genuinely offered variants produced 9, 8 and 0.
 *
 * Without this check the answer would name a variant that never executed,
 * which is the one failure this tool exists to prevent. ADT's own client
 * refuses the same names, and this is the list it goes by.
 *
 * Checked before the worklist is created, so an unusable variant also leaves
 * nothing behind on the server.
 */
async function assertVariantIsOffered(connection: SapConnection, variant: string): Promise<void> {
  if (offers(await listAtcVariants(connection, variant), variant)) return;

  // A prefix search turns the error into a "did you mean": a wrong variant is
  // usually a near miss of one the system really has.
  const nearby = await listAtcVariants(connection, `${variant.slice(0, 4)}*`);
  const help =
    nearby.length > 0
      ? ` Variants on this system starting with "${variant.slice(0, 4)}": ${nearby.slice(0, 10).join(', ')}.`
      : '';

  throw new Error(
    `"${variant}" is not a check variant this system offers - it may not exist, be inactive, or not be ` +
      'released for general use. SAP would answer such a request by silently running its own default ' +
      `instead, and the findings would read as if they came from "${variant}".${help}`,
  );
}

/**
 * What ADT itself uses for "Run ABAP Test Cockpit": the variant configured for
 * this system. There is no universal default - the property is customer
 * specific - so this is read rather than guessed, and reading it is a plain GET.
 *
 * `referencedVariant` comes along as the one useful thing to suggest when the
 * system variant turns out not to run: on a system configured for remote checks
 * the default is the remote variant, and this names the one behind it. It is
 * only a name, though - the customizing does not promise it can be used, so it
 * goes through assertVariantIsOffered's list like any other.
 */
async function readAtcCustomizing(
  connection: SapConnection,
): Promise<{ systemCheckVariant: string; referencedVariant: string }> {
  const response = await connection.request('/sap/bc/adt/atc/customizing', {
    method: 'GET',
    headers: { Accept: 'application/xml, application/*' },
  });
  const properties = asArray(parseXml(response.data)?.['atc:customizing']?.properties?.property);
  const valueOf = (name: string) =>
    attr(
      properties.find((property: any) => attr(property, 'name') === name),
      'value',
    );
  return { systemCheckVariant: valueOf('systemCheckVariant'), referencedVariant: valueOf('referencedVariant') };
}

function formatFinding(finding: AtcFinding): string {
  const where = finding.subObject ? `line ${finding.line} in ${finding.subObject}` : `line ${finding.line}`;
  const check = finding.messageId ? `${finding.checkTitle} [${finding.messageId}]` : finding.checkTitle;
  const exempted = finding.exemptionKind ? ` (exempted: ${finding.exemptionKind})` : '';
  return `[prio ${finding.priority || '?'}] ${where} - ${check}: ${finding.messageTitle}${exempted}`;
}

/**
 * `budget` is what is left of max_findings. The header keeps naming the real
 * total, so a truncated answer never reads as a shorter one: the model has to
 * be able to tell "8 findings, showing 2" from "2 findings".
 */
function formatObject(object: AtcObject, budget: number): string {
  const identity = `${object.type || '?'} ${object.name}${object.packageName ? ` (${object.packageName})` : ''}`;
  if (object.findings.length === 0) return `${identity}: no findings.`;

  const shown = object.findings.slice(0, Math.max(0, budget));
  const header =
    shown.length < object.findings.length
      ? `${identity}, ${object.findings.length} findings (showing ${shown.length}):`
      : `${identity}, ${object.findings.length} findings:`;
  return [header, ...shown.map(formatFinding)].join('\n');
}

interface AtcResult {
  objects: AtcObject[];
  variant: string;
  variantIsSystemDefault: boolean;
  referencedVariant: string;
  stats: string;
  failures: string[];
  objectType: AtcObjectType;
  objectName: string;
  maxFindings: number;
}

function formatResult(result: AtcResult): string {
  const lines: string[] = [];

  // A failure goes first, ahead of any count a reader could mistake for a clean
  // bill of health. Findings from the checks that did run are still reported
  // below it: a partial answer is worth more than none, as long as it says so.
  for (const failure of result.failures) {
    lines.push(`WARNING: ATC reported a tool failure, so this result may be incomplete: ${failure}`);
  }

  // A failing system default is a configuration fact the caller cannot guess
  // from a "no findings" answer, and it is the case where naming a candidate
  // actually helps - rather than silently switching variants, which would make
  // two identical calls answer differently depending on the system's mood.
  //
  // `referencedVariant` is only filled in once it has been confirmed to be a
  // variant this system offers. The customizing happily names one that is not:
  // on the system this was built against it references a variant ADT itself
  // refuses, so suggesting it unchecked sent the caller somewhere they could
  // not follow.
  if (result.failures.length > 0 && result.variantIsSystemDefault) {
    lines.push(
      result.referencedVariant
        ? `HINT: ${result.variant} is this system's default and it did not run to completion. Its ATC ` +
            `customizing references ${result.referencedVariant}, which this system does offer; pass that ` +
            'as check_variant to try it instead.'
        : `HINT: ${result.variant} is this system's default and it did not run to completion. Pass ` +
            'check_variant with another variant this system offers.',
    );
  }

  lines.push(`Check variant: ${result.variant}${result.variantIsSystemDefault ? ' (system default)' : ''}`);
  if (result.stats) {
    lines.push(`Findings by priority (1/2/3), as counted by ATC: ${result.stats.replaceAll(',', '/')}`);
  }
  lines.push('');

  if (result.objects.length === 0) {
    lines.push(
      `ATC returned no result for ${result.objectType} ${result.objectName}, which means the object was ` +
        'not checked at all. That is not the same as "no findings": either the name does not exist, or ' +
        `the object lies outside the scope of check variant ${result.variant}, or the check did not run.`,
    );
    return lines.join('\n');
  }

  let budget = result.maxFindings;
  for (const object of result.objects) {
    lines.push(formatObject(object, budget));
    budget -= Math.min(budget, object.findings.length);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * ATC findings for one repository object - the quality rules a system actually
 * enforces, which a syntax check alone does not reveal.
 *
 * Read-only in the sense this server promises: no ABAP repository object,
 * Customizing entry or business data is touched, nothing is locked, activated,
 * or written to a transport. It is worth being precise about what the three
 * requests do leave behind, because ADT offers no GET-only way to run a check.
 * The first one creates an ATC worklist: a result container with an id of its
 * own, owned by the calling user and reclaimed by SAP's ATC housekeeping. SAP
 * classifies that creation as a display operation itself -
 * CL_SATC_ADT_RES_WORKLIST runs the identical authority check for POST and for
 * GET, and it resolves to S_DEVELOP activity 03 (Display) or, failing that,
 * S_Q_ADM activity 16 (Execute). Neither 01 (Create) nor 02 (Change) appears
 * anywhere on that path, while the genuinely mutating ATC operations in the
 * same class do demand them.
 *
 * One worklist per call, deliberately: MCP clients may run tool calls in
 * parallel, and a shared container would let one call's run overwrite the
 * "Last Check Run" object set another call is about to read.
 */
export async function handleGetAtcFindings(
  connection: SapConnection,
  args: {
    object_type: AtcObjectType;
    object_name: string;
    check_variant?: string;
    max_findings?: number;
  },
): Promise<ToolResult> {
  try {
    const requested = args.check_variant?.trim();
    // Only read the customizing when there is a default to resolve; a caller
    // who named a variant should not pay for a request they do not need.
    const customizing = requested ? undefined : await readAtcCustomizing(connection);
    const variant = requested || customizing?.systemCheckVariant || '';
    if (!variant) {
      throw new Error(
        `System "${connection.name}" has no systemCheckVariant in its ATC customizing, so there is no ` +
          'default to fall back on. Pass check_variant with the name of an ATC check variant configured ' +
          'on this system.',
      );
    }

    await assertVariantIsOffered(connection, variant);

    const uri = OBJECT_URI[args.object_type](args.object_name);
    const maxFindings = args.max_findings ?? 100;

    // Step 1: the result container. Its id comes back as plain text.
    const worklist = await connection.request('/sap/bc/adt/atc/worklists', {
      method: 'POST',
      query: { checkVariant: variant },
      headers: { Accept: 'text/plain, */*' },
    });
    const worklistId = worklist.data.trim();
    if (!worklistId) {
      throw new Error(`SAP returned no ATC worklist id for check variant "${variant}".`);
    }

    // Step 2: run the variant's checks against the one object. maximumVerdicts
    // is what ADT sends, but it was observed not to cap anything: a run asking
    // for 2 still answered with all 8 findings. So it is sent for fidelity and
    // the limit is enforced again when formatting, or max_findings would be a
    // parameter that quietly does nothing.
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<atc:run maximumVerdicts="${maxFindings}" xmlns:atc="http://www.sap.com/adt/atc">
  <objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
        <adtcore:objectReference adtcore:uri="${uri}"/>
      </adtcore:objectReferences>
    </objectSet>
  </objectSets>
</atc:run>`;

    const run = await connection.request('/sap/bc/adt/atc/runs', {
      method: 'POST',
      query: { worklistId },
      body,
      headers: { 'Content-Type': 'application/xml', Accept: 'application/xml, application/*' },
    });
    const { stats, failures } = parseRunInfos(run.data);

    // Only worth a request when there is actually a failure to help with, and
    // only for the default path - a caller who named a variant chose it.
    const referenced = customizing?.referencedVariant ?? '';
    const usableReferenced =
      failures.length > 0 && referenced && offers(await listAtcVariants(connection, referenced), referenced)
        ? referenced
        : '';

    // Step 3: read what the run produced. The worklist answers from its
    // "Last Check Run" object set by default, which is exactly this run.
    const findings = await connection.request(`/sap/bc/adt/atc/worklists/${encodeURIComponent(worklistId)}`, {
      method: 'GET',
      headers: { Accept: 'application/atc.worklist.v1+xml' },
    });

    const objects = parseWorklist(findings.data);
    if (!objects) return return_text(findings.data);

    return return_text(
      formatResult({
        objects,
        variant,
        variantIsSystemDefault: !requested,
        referencedVariant: usableReferenced,
        stats,
        failures,
        objectType: args.object_type,
        objectName: args.object_name,
        maxFindings,
      }),
    );
  } catch (error) {
    return return_error(error);
  }
}
