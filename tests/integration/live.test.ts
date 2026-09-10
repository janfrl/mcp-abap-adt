import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadAppConfig } from '../../src/config/load.js';
import { ConnectionRegistry } from '../../src/connection/registry.js';
import type { SapConnection } from '../../src/connection/SapConnection.js';
import { createServer } from '../../src/server.js';

import { handleGetProgram } from '../../src/handlers/handleGetProgram.js';
import { handleGetClass } from '../../src/handlers/handleGetClass.js';
import { handleGetFunctionGroup } from '../../src/handlers/handleGetFunctionGroup.js';
import { handleGetFunction } from '../../src/handlers/handleGetFunction.js';
import { handleGetTable } from '../../src/handlers/handleGetTable.js';
import { handleGetSystemInfo } from '../../src/handlers/handleGetSystemInfo.js';
import { handleGetStructure } from '../../src/handlers/handleGetStructure.js';
import { handleGetTableContents } from '../../src/handlers/handleGetTableContents.js';
import { handleGetPackage } from '../../src/handlers/handleGetPackage.js';
import { handleGetInclude } from '../../src/handlers/handleGetInclude.js';
import { handleGetTypeInfo } from '../../src/handlers/handleGetTypeInfo.js';
import { handleGetInterface } from '../../src/handlers/handleGetInterface.js';
import { handleGetTransaction } from '../../src/handlers/handleGetTransaction.js';
import { handleSearchObject } from '../../src/handlers/handleSearchObject.js';
import { handleCheckSyntax } from '../../src/handlers/handleCheckSyntax.js';
import { handleGetWhereUsed } from '../../src/handlers/handleGetWhereUsed.js';
import { handleGetAtcFindings, type AtcObjectType } from '../../src/handlers/handleGetAtcFindings.js';
import type { ToolResult } from '../../src/lib/result.js';

/**
 * These tests talk to a real SAP system using the ambient configuration.
 * They are opt-in so that `npm test` stays green without SAP access:
 *
 *   RUN_INTEGRATION=1 npm test          (bash)
 *   $env:RUN_INTEGRATION='1'; npm test  (PowerShell)
 *
 * Set INTEGRATION_SYSTEM to target a specific configured system.
 */
const runLive = process.env.RUN_INTEGRATION === '1';

/**
 * ATC findings depend entirely on which check variant a system has configured
 * and on whether the object falls inside that variant's scope - SAP standard
 * code usually does not. An object that reliably produces findings is
 * therefore a property of one specific system, and naming one here would both
 * publish a system's internal object names and fail everywhere else. So it
 * comes from the environment: with ATC_OBJECT set, the suite insists on real
 * findings; without it, it checks only what holds on any system.
 *
 * The .env is read explicitly because these are not SAP_* variables that
 * loadAppConfig would pick up on its way past - and a gitignored .env is the
 * one place where a system's own object names can sit without travelling.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env beside the project: the ambient environment is all there is.
}

const atcObject = process.env.ATC_OBJECT?.trim();
const atcVariant = process.env.ATC_VARIANT?.trim() || undefined;
const atcObjectType = (process.env.ATC_OBJECT_TYPE?.trim() || 'class') as AtcObjectType;

let registry: ConnectionRegistry;
let connection: SapConnection;

function expectTextResult(result: ToolResult) {
  expect(result.content[0]?.text).toBeTruthy();
  // The custom message surfaces what SAP actually said on failure, instead of
  // just "true is not false" - that text is the only thing worth reading here.
  expect(result.isError, result.content[0]?.text).toBe(false);
  expect(result.content[0].type).toBe('text');
}

/**
 * A test timeout has to be looser than the transport timeout it wraps, or a
 * slow system answers into a test that has already given up - and "test timed
 * out in 5000ms" replaces whatever SAP was about to say. vitest defaults to
 * 5 s while a connection defaults to 60 s, which made ordinary reads fail at
 * random over a VPN. This is the outer bound; the ATC suite widens it further,
 * because ATC runs get a 120 s floor of their own.
 */
describe.skipIf(!runLive)('live ADT integration', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    // The hermetic-home setup hides the developer's real configuration from
    // the unit tests; this suite exists to use it, so it takes it back.
    const { AMBIENT_HOME_ENV } = await import('../setup/hermeticHome.js');
    for (const [name, value] of Object.entries(AMBIENT_HOME_ENV)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const config = await loadAppConfig();
    for (const error of config.errors) console.error(`${error.scope}: ${error.message}`);
    registry = new ConnectionRegistry(config);
    connection = registry.get(process.env.INTEGRATION_SYSTEM);
  });

  afterAll(async () => {
    await registry?.closeAll();
  });

  it('retrieves a program', async () => {
    expectTextResult(await handleGetProgram(connection, { program_name: 'RSABAPPROGRAM' }));
  });

  it('retrieves a class', async () => {
    expectTextResult(await handleGetClass(connection, { class_name: 'CL_WB_PGEDITOR_INITIAL_SCREEN' }));
  });

  it('retrieves a function group', async () => {
    expectTextResult(await handleGetFunctionGroup(connection, { function_group: 'WBABAP' }));
  });

  it('retrieves a function module', async () => {
    expectTextResult(
      await handleGetFunction(connection, {
        function_name: 'WB_PGEDITOR_INITIAL_SCREEN',
        function_group: 'WBABAP',
      }),
    );
  });

  it('retrieves a table', async () => {
    expectTextResult(await handleGetTable(connection, { table_name: 'DD02L' }));
  });

  it('retrieves system release and component info', async () => {
    const result = await handleGetSystemInfo(connection);
    console.log('\n=== GetSystemInfo ===\n' + result.content[0].text);
    expectTextResult(result);
    expect(result.content[0].text).toContain('RELEASE');
  });

  it('retrieves a structure', async () => {
    expectTextResult(await handleGetStructure(connection, { structure_name: 'SYST' }));
  });

  it('retrieves a package', async () => {
    expectTextResult(await handleGetPackage(connection, { package_name: 'SABP_TYPES' }));
  });

  it('retrieves an include', async () => {
    expectTextResult(await handleGetInclude(connection, { include_name: 'LWBABAPF00' }));
  });

  it('retrieves type info', async () => {
    expectTextResult(await handleGetTypeInfo(connection, { type_name: 'SYST_SUBRC' }));
  });

  it('retrieves an interface', async () => {
    expectTextResult(await handleGetInterface(connection, { interface_name: 'IF_T100_MESSAGE' }));
  });

  it('searches for an object', async () => {
    expectTextResult(await handleSearchObject(connection, { query: 'SYST' }));
  });

  it('retrieves a transaction', async () => {
    expectTextResult(await handleGetTransaction(connection, { transaction_name: 'SE93' }));
  });

  // Exercises the CSRF token and cookie round trip, which no GET-only test covers.
  it('retrieves table contents', async () => {
    expectTextResult(await handleGetTableContents(connection, { table_name: 'DD02L', max_rows: 5 }));
  });

  // This is the first live test that checks unsaved source rather than what is
  // active in the system - the two results below pin down that checkruns
  // actually evaluates `source`, not RSABAPPROGRAM's real (clean) source.
  describe('CheckSyntax', () => {
    it('reports no messages for syntactically valid source', async () => {
      const result = await handleCheckSyntax(connection, {
        object_type: 'program',
        object_name: 'RSABAPPROGRAM',
        source: 'REPORT rsabapprogram.\nDATA lv_text TYPE string.\nlv_text = |hello|.',
      });
      console.log('\n=== CheckSyntax (valid source) ===\n' + result.content[0].text);
      expectTextResult(result);
      expect(result.content[0].text).toBe('No syntax errors or warnings found.');
    });

    it('reports an error for a deliberately broken statement', async () => {
      const result = await handleCheckSyntax(connection, {
        object_type: 'program',
        object_name: 'RSABAPPROGRAM',
        source: 'REPORT rsabapprogram.\nDATA lv_text TYPE strong.',
      });
      console.log('\n=== CheckSyntax (broken source) ===\n' + result.content[0].text);
      expectTextResult(result);
      expect(result.content[0].text).toContain('[E]');
    });
  });

  // IF_T100_MESSAGE is implemented across the system, so a real answer must
  // be non-empty - the one thing a unit test against a fake response cannot
  // check, and exactly the endpoint-shape assumption this test exists to pin down.
  it('finds usages of a widely implemented standard interface', async () => {
    const result = await handleGetWhereUsed(connection, { object_type: 'interface', object_name: 'IF_T100_MESSAGE' });
    console.log('\n=== GetWhereUsed ===\n' + result.content[0].text);
    expectTextResult(result);
    expect(result.content[0].text).not.toBe('No usages found.');
  });

  /**
   * The one tool here that needs three requests rather than one, and the only
   * one that leaves anything behind: the worklist SAP creates in step one.
   * Both tests below run the whole chain, so a wrong path or a changed
   * response shape in any of the three shows up immediately.
   */
  describe('GetAtcFindings', { timeout: 300_000 }, () => {
    // Runs anywhere. RSABAPPROGRAM is SAP standard code and so most likely out
    // of scope for whatever variant a system has configured - which makes
    // "not checked" a perfectly good outcome. What is being pinned down is
    // that the customizing lookup, the worklist, the run and the read all work
    // and that the answer says which variant produced it.
    it('completes the worklist round trip and names the variant it used', async () => {
      const result = await handleGetAtcFindings(connection, {
        object_type: 'program',
        object_name: 'RSABAPPROGRAM',
      });
      console.log('\n=== GetAtcFindings (system default variant) ===\n' + result.content[0].text);
      expectTextResult(result);
      expect(result.content[0].text).toContain('Check variant:');
    });

    // The half a fake response cannot check: that real findings parse, and
    // that priority, line and message survive the trip.
    it.skipIf(!atcObject)(`reports findings for ${atcObject ?? 'ATC_OBJECT'}`, async () => {
      const result = await handleGetAtcFindings(connection, {
        object_type: atcObjectType,
        object_name: atcObject as string,
        check_variant: atcVariant,
      });
      console.log('\n=== GetAtcFindings (ATC_OBJECT) ===\n' + result.content[0].text);
      expectTextResult(result);
      expect(result.content[0].text).not.toContain('was not checked at all');
      expect(result.content[0].text).toMatch(/\[prio \d\]/u);
    });
  });

  // A field report claimed the freestyle endpoint rejects joins with "only one
  // SELECT statement is allowed". Reproduction against a current release shows
  // joins with tilde notation work; the report's system presumably differs.
  it('runs a join through the sql console', async () => {
    const { handleExecuteQuery } = await import('../../src/handlers/handleExecuteQuery.js');
    const result = await handleExecuteQuery(connection, {
      query: 'SELECT e070~trkorr, e071~obj_name FROM e070 INNER JOIN e071 ON e070~trkorr = e071~trkorr',
      maxRows: 3,
    });
    expectTextResult(result);
    expect(result.content[0].text).toContain('TRKORR');
  });

  /**
   * Every other test in this file calls a handler function directly, which
   * proves the ADT communication works but skips the MCP layer entirely: tool
   * registration, zod schema validation, and JSON-RPC (de)serialization. This
   * is the one test that goes through all of it - a real McpServer built by
   * the same `createServer` production uses, talking to a real MCP Client,
   * reaching this real SAP system. The transport is in-memory rather than
   * stdio, which is the only difference from how Claude Desktop or Claude Code
   * would actually connect; the protocol on top of it is identical.
   */
  describe('the four new tools over the real MCP protocol', { timeout: 300_000 }, () => {
    it('answers all four through a real MCP client', async () => {
      const client = new Client({ name: 'manual-verification', version: '1.0.0' });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), createServer(registry).connect(serverTransport)]);

      type ContentText = { content: Array<{ text: string }>; isError?: boolean };

      const systemInfo = (await client.callTool({ name: 'GetSystemInfo', arguments: {} })) as ContentText;
      console.log('\n=== GetSystemInfo (via MCP protocol) ===\n' + systemInfo.content[0].text);
      expect(systemInfo.isError).toBe(false);
      expect(systemInfo.content[0].text).toContain('RELEASE');

      const checkSyntax = (await client.callTool({
        name: 'CheckSyntax',
        arguments: {
          object_type: 'program',
          object_name: 'RSABAPPROGRAM',
          source: 'REPORT rsabapprogram.\nDATA lv_text TYPE strong.',
        },
      })) as ContentText;
      console.log('\n=== CheckSyntax (via MCP protocol) ===\n' + checkSyntax.content[0].text);
      expect(checkSyntax.isError).toBe(false);
      expect(checkSyntax.content[0].text).toContain('[E]');

      const whereUsed = (await client.callTool({
        name: 'GetWhereUsed',
        arguments: { object_type: 'interface', object_name: 'IF_T100_MESSAGE' },
      })) as ContentText;
      console.log('\n=== GetWhereUsed (via MCP protocol) ===\n' + whereUsed.content[0].text);
      expect(whereUsed.isError).toBe(false);
      expect(whereUsed.content[0].text).not.toBe('No usages found.');

      // Sent without check_variant on purpose: that path exercises the
      // customizing lookup as well, and it is how a model would call the tool
      // knowing nothing about the system's ATC configuration.
      const atcFindings = (await client.callTool({
        name: 'GetAtcFindings',
        arguments: { object_type: 'program', object_name: 'RSABAPPROGRAM' },
      })) as ContentText;
      console.log('\n=== GetAtcFindings (via MCP protocol) ===\n' + atcFindings.content[0].text);
      expect(atcFindings.isError).toBe(false);
      expect(atcFindings.content[0].text).toContain('Check variant:');

      await client.close();
    });
  });
});
