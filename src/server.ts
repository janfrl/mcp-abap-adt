import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { SapConnection } from './connection/SapConnection.js';
import type { ConnectionRegistry } from './connection/registry.js';
import { return_error, type ToolResult } from './lib/result.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

import { handleCheckSyntax } from './handlers/handleCheckSyntax.js';
import { handleExecuteQuery } from './handlers/handleExecuteQuery.js';
import { handleGetAtcFindings } from './handlers/handleGetAtcFindings.js';
import { handleGetBehaviorDefinition } from './handlers/handleGetBehaviorDefinition.js';
import { handleGetCDSView } from './handlers/handleGetCDSView.js';
import { handleGetClass } from './handlers/handleGetClass.js';
import { handleGetFunction } from './handlers/handleGetFunction.js';
import { handleGetFunctionGroup } from './handlers/handleGetFunctionGroup.js';
import { handleGetInclude } from './handlers/handleGetInclude.js';
import { handleGetInterface } from './handlers/handleGetInterface.js';
import { handleGetPackage } from './handlers/handleGetPackage.js';
import { handleGetProgram } from './handlers/handleGetProgram.js';
import { handleGetServiceDefinition } from './handlers/handleGetServiceDefinition.js';
import { handleGetStructure } from './handlers/handleGetStructure.js';
import { handleGetSystemInfo } from './handlers/handleGetSystemInfo.js';
import { handleGetTable } from './handlers/handleGetTable.js';
import { handleGetTableContents } from './handlers/handleGetTableContents.js';
import { handleGetTransaction } from './handlers/handleGetTransaction.js';
import { handleGetTypeInfo } from './handlers/handleGetTypeInfo.js';
import { handleGetWhereUsed } from './handlers/handleGetWhereUsed.js';
import { handleListSystems } from './handlers/handleListSystems.js';
import { handleSearchObject } from './handlers/handleSearchObject.js';
import { setLogSink } from './lib/log.js';

/**
 * Ceiling for both row-returning tools. A model asking for millions of rows
 * would hurt the SAP system long before the answer became useful.
 */
const MAX_ROW_LIMIT = 5000;

/**
 * Ceiling for ATC findings. Unlike rows, findings are read by a model rather
 * than aggregated, and a variant firing thousands of times on one object says
 * "this object needs a different conversation", not "return everything".
 */
const MAX_FINDING_LIMIT = 1000;

/**
 * Ceiling for where-used hits, for the same reason. A widely used standard
 * object has hundreds: T100 answers with 735 usages once the grouping nodes
 * are filtered out, which is a signal to ask a narrower question rather than
 * something to page through.
 */
const MAX_USAGE_LIMIT = 1000;

/** Mixed into every ADT tool so a call can pick which system to talk to. */
const systemArgument = {
  system: z
    .string()
    .optional()
    .describe('Name of a configured SAP system (see ListSystems). Uses the default system when omitted.'),
};

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (connection: SapConnection, args: never) => Promise<ToolResult>;
}

/** Keeps each entry's schema and handler arguments checked against each other. */
function defineTool<Shape extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: Shape,
  handler: (connection: SapConnection, args: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>,
): ToolDefinition {
  return { name, description, inputSchema, handler };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  defineTool(
    'GetProgram',
    'Retrieve ABAP program source code',
    { program_name: z.string().describe('Name of the ABAP program') },
    handleGetProgram,
  ),
  defineTool(
    'GetClass',
    'Retrieve ABAP class source code',
    { class_name: z.string().describe('Name of the ABAP class') },
    handleGetClass,
  ),
  defineTool(
    'GetFunctionGroup',
    'Retrieve ABAP Function Group source code',
    { function_group: z.string().describe('Name of the function module') },
    handleGetFunctionGroup,
  ),
  defineTool(
    'GetFunction',
    'Retrieve ABAP Function Module source code',
    {
      function_name: z.string().describe('Name of the function module'),
      function_group: z.string().describe('Name of the function group'),
    },
    handleGetFunction,
  ),
  defineTool(
    'GetStructure',
    'Retrieve ABAP Structure',
    { structure_name: z.string().describe('Name of the ABAP Structure') },
    handleGetStructure,
  ),
  defineTool(
    'GetTable',
    'Retrieve ABAP table structure',
    { table_name: z.string().describe('Name of the ABAP table') },
    handleGetTable,
  ),
  defineTool(
    'GetTableContents',
    'Retrieve all columns of an ABAP table. Prefer ExecuteQuery when only some columns or rows are needed.',
    {
      table_name: z.string().describe('Name of the ABAP table'),
      max_rows: z.number().int().min(1).max(MAX_ROW_LIMIT).default(100).describe('Maximum number of rows to retrieve'),
    },
    handleGetTableContents,
  ),
  defineTool(
    'ExecuteQuery',
    'Run a read-only ABAP SQL SELECT against a SAP system and return the rows as CSV. ' +
      'Use this rather than GetTableContents whenever only some columns or rows are needed: ' +
      'projecting and filtering keeps the answer small. Aggregates such as COUNT(*) work too. ' +
      'Dialect notes: ABAP SQL, exactly one SELECT statement, no trailing semicolon, ' +
      'ASCENDING/DESCENDING instead of ASC/DESC, and no LIMIT clause - use maxRows instead.',
    {
      query: z
        .string()
        .describe("The SELECT statement, for example: SELECT carrid, connid FROM sflight WHERE carrid = 'LH'"),
      maxRows: z.number().int().min(1).max(MAX_ROW_LIMIT).default(100).describe('Maximum number of rows to return'),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(600_000)
        .optional()
        .describe(
          'Time budget for this query in milliseconds. Defaults to at least 60000, ' +
            'since queries run longer than metadata reads. Raise it for heavy joins or LIKE scans.',
        ),
    },
    handleExecuteQuery,
  ),
  defineTool(
    'GetSystemInfo',
    'Retrieve the SAP system release and installed software component versions (from CVERS), ' +
      'to check ABAP/SAP version compatibility before generating code.',
    {},
    handleGetSystemInfo,
  ),
  defineTool(
    'GetPackage',
    'Retrieve ABAP package details',
    { package_name: z.string().describe('Name of the ABAP package') },
    handleGetPackage,
  ),
  defineTool(
    'GetTypeInfo',
    'Retrieve ABAP type information',
    { type_name: z.string().describe('Name of the ABAP type') },
    handleGetTypeInfo,
  ),
  defineTool(
    'GetInclude',
    'Retrieve ABAP Include Source Code',
    { include_name: z.string().describe('Name of the ABAP Include') },
    handleGetInclude,
  ),
  defineTool(
    'SearchObject',
    'Search for ABAP objects using quick search',
    {
      query: z.string().describe('Search query string (use * wildcard for partial match)'),
      maxResults: z.number().default(100).describe('Maximum number of results to return'),
    },
    handleSearchObject,
  ),
  defineTool(
    'GetTransaction',
    'Retrieve ABAP transaction details',
    { transaction_name: z.string().describe('Name of the ABAP transaction') },
    handleGetTransaction,
  ),
  defineTool(
    'GetCDSView',
    'Retrieve CDS view (DDL source) source code',
    {
      cds_view_name: z.string().describe('Name of the CDS view (DDL source name, e.g. I_CURRENCY)'),
    },
    handleGetCDSView,
  ),
  defineTool(
    'GetInterface',
    'Retrieve ABAP interface source code',
    { interface_name: z.string().describe('Name of the ABAP interface') },
    handleGetInterface,
  ),
  defineTool(
    'GetBehaviorDefinition',
    'Retrieve RAP Behavior Definition (BDEF) source code (requires ~NW 7.54 / S/4HANA)',
    {
      behavior_definition_name: z.string().describe('Name of the RAP Behavior Definition (e.g. I_MY_ENTITY)'),
    },
    handleGetBehaviorDefinition,
  ),
  defineTool(
    'GetServiceDefinition',
    'Retrieve RAP Service Definition (SRVD) source code (requires ~NW 7.54 / S/4HANA)',
    {
      service_definition_name: z.string().describe('Name of the RAP Service Definition (e.g. Z_MY_SERVICE)'),
    },
    handleGetServiceDefinition,
  ),
  defineTool(
    'CheckSyntax',
    'Run a non-activating ABAP syntax check on source text you supply. What is checked is `source`, ' +
      'never what the system currently stores, and nothing is saved or activated. The named object only ' +
      'lends context, and it does not have to exist: SAP checks the supplied text either way. So this ' +
      'validates brand-new code just as well as an edit to an existing object - there is no need to find ' +
      'a real target object first.',
    {
      object_type: z.enum(['program', 'class', 'interface']).describe('Kind of the ABAP object source belongs to'),
      object_name: z
        .string()
        .describe(
          'Name to check the source as. It need not exist - an existing object lends its context (its ' +
            'type, includes and class hierarchy), an invented name still gets the text checked. Nothing ' +
            'is written to it either way.',
        ),
      source: z.string().describe('The ABAP source text to check (may differ from what is currently active)'),
    },
    handleCheckSyntax,
  ),
  defineTool(
    'GetWhereUsed',
    "Retrieve an ABAP object's where-used list (usage references) - the same list Eclipse ADT's " +
      'Ctrl+Shift+H shows. Use before changing or removing an object to see what depends on it.',
    {
      object_type: z.enum(['program', 'class', 'interface', 'table', 'cds_view']).describe('Kind of the object'),
      object_name: z.string().describe('Name of the ABAP object to find usages of'),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(MAX_USAGE_LIMIT)
        .default(100)
        .describe('Maximum number of usages to list. The real total is always reported, even when cut.'),
    },
    handleGetWhereUsed,
  ),
  defineTool(
    'GetAtcFindings',
    'Retrieve ABAP Test Cockpit (ATC) findings for one repository object - the quality rules a system ' +
      'actually enforces, which a syntax check does not reveal. Use it to see whether generated or ' +
      'proposed code violates the active check variant; findings carry a priority where 1 is the most ' +
      'severe. Note what this does on the server, since ADT offers no read-only way to run a check: the ' +
      'call creates an ATC worklist, a result container owned by the calling user that stays valid for ten ' +
      'days and is then removed by ATC housekeeping. No repository object, Customizing entry or business ' +
      'data is changed, and nothing is locked, activated or transported.',
    {
      object_type: z
        .enum(['program', 'class', 'interface', 'function_group', 'table', 'cds_view'])
        .describe('Kind of the object to check'),
      object_name: z.string().describe('Name of the ABAP object to retrieve ATC findings for'),
      check_variant: z
        .string()
        .optional()
        .describe(
          'Name of the ATC check variant to run. Defaults to the variant configured for the system ' +
            '(systemCheckVariant in the ATC customizing), which is what ADT itself uses. A variant this ' +
            'system does not offer is rejected with the names it does offer, rather than run: SAP would ' +
            'answer such a request by silently substituting its own default, and the findings would read ' +
            'as if they came from the variant that was asked for.',
        ),
      max_findings: z
        .number()
        .int()
        .min(1)
        .max(MAX_FINDING_LIMIT)
        .default(100)
        .describe('Maximum number of findings ATC should report (maximumVerdicts)'),
    },
    handleGetAtcFindings,
  ),
];

export function createServer(registry: ConnectionRegistry): McpServer {
  // Declaring the logging capability makes the SDK answer logging/setLevel on
  // its own and drop anything below the level the client asked for.
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { logging: {} } });

  // Diagnostics reach the client through the protocol, where a user can
  // actually see them, instead of only a log file they have to go find.
  // Failures are swallowed on purpose: a notification sent before the
  // handshake, or after the transport closed, must never break a tool call.
  setLogSink((level, message) => {
    void server.server.sendLoggingMessage({ level, logger: SERVER_NAME, data: message }).catch(() => undefined);
  });

  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: { ...tool.inputSchema, ...systemArgument } },
      async (args) => {
        const { system, ...rest } = (args ?? {}) as { system?: string };
        try {
          // Selecting an unknown system is a user mistake, not a protocol
          // failure, so it comes back as a readable tool error.
          return await tool.handler(registry.get(system), rest as never);
        } catch (error) {
          return return_error(error);
        }
      },
    );
  }

  server.registerTool(
    'ListSystems',
    {
      description:
        'List the configured SAP systems, which one is the default, and any configuration problems. Returns no credentials.',
      inputSchema: {},
    },
    async () => handleListSystems(registry),
  );

  return server;
}
