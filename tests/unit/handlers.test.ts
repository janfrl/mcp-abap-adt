import { describe, expect, it } from 'vitest';

import type { SapConnection } from '../../src/connection/SapConnection.js';
import type { ToolResult } from '../../src/lib/result.js';
import { fakeConnection, type FakeResponse, type RecordedCall } from '../helpers/fakeConnection.js';

import { handleCheckSyntax } from '../../src/handlers/handleCheckSyntax.js';
import { handleExecuteQuery } from '../../src/handlers/handleExecuteQuery.js';
import { handleGetAtcFindings } from '../../src/handlers/handleGetAtcFindings.js';
import { handleGetBehaviorDefinition } from '../../src/handlers/handleGetBehaviorDefinition.js';
import { handleGetCDSView } from '../../src/handlers/handleGetCDSView.js';
import { handleGetClass } from '../../src/handlers/handleGetClass.js';
import { handleGetFunction } from '../../src/handlers/handleGetFunction.js';
import { handleGetFunctionGroup } from '../../src/handlers/handleGetFunctionGroup.js';
import { handleGetInclude } from '../../src/handlers/handleGetInclude.js';
import { handleGetInterface } from '../../src/handlers/handleGetInterface.js';
import { handleGetPackage } from '../../src/handlers/handleGetPackage.js';
import { handleGetProgram } from '../../src/handlers/handleGetProgram.js';
import { handleGetServiceDefinition } from '../../src/handlers/handleGetServiceDefinition.js';
import { handleGetStructure } from '../../src/handlers/handleGetStructure.js';
import { handleGetSystemInfo } from '../../src/handlers/handleGetSystemInfo.js';
import { handleGetTable } from '../../src/handlers/handleGetTable.js';
import { handleGetTableContents } from '../../src/handlers/handleGetTableContents.js';
import { handleGetTransaction } from '../../src/handlers/handleGetTransaction.js';
import { handleGetTypeInfo } from '../../src/handlers/handleGetTypeInfo.js';
import { handleGetWhereUsed } from '../../src/handlers/handleGetWhereUsed.js';
import { handleSearchObject } from '../../src/handlers/handleSearchObject.js';

const OK: FakeResponse = { body: '<source/>' };

function textOf(result: ToolResult): string {
  return result.content[0].text;
}

/** Runs a handler against a connection that answers everything with `OK`. */
async function callHandler(
  invoke: (connection: SapConnection) => Promise<ToolResult>,
  responder: (call: RecordedCall, index: number) => FakeResponse | Error = () => OK,
) {
  const { connection, calls } = fakeConnection(responder);
  const result = await invoke(connection);
  return { result, calls };
}

/**
 * The ADT paths are this server's contract with SAP: a typo in one is not
 * caught by types or by the connection tests, only by a live system. These
 * assertions pin every one of them down.
 */
describe('ADT paths', () => {
  const cases: Array<[string, (connection: SapConnection) => Promise<ToolResult>, string]> = [
    [
      'GetProgram',
      (c) => handleGetProgram(c, { program_name: 'ZFOO' }),
      '/sap/bc/adt/programs/programs/ZFOO/source/main',
    ],
    ['GetClass', (c) => handleGetClass(c, { class_name: 'ZCL_FOO' }), '/sap/bc/adt/oo/classes/ZCL_FOO/source/main'],
    [
      'GetInterface',
      (c) => handleGetInterface(c, { interface_name: 'ZIF_FOO' }),
      '/sap/bc/adt/oo/interfaces/ZIF_FOO/source/main',
    ],
    [
      'GetInclude',
      (c) => handleGetInclude(c, { include_name: 'ZINC' }),
      '/sap/bc/adt/programs/includes/ZINC/source/main',
    ],
    [
      'GetFunctionGroup',
      (c) => handleGetFunctionGroup(c, { function_group: 'ZFG' }),
      '/sap/bc/adt/functions/groups/ZFG/source/main',
    ],
    [
      'GetFunction',
      (c) => handleGetFunction(c, { function_name: 'Z_FM', function_group: 'ZFG' }),
      '/sap/bc/adt/functions/groups/ZFG/fmodules/Z_FM/source/main',
    ],
    [
      'GetStructure',
      (c) => handleGetStructure(c, { structure_name: 'ZST' }),
      '/sap/bc/adt/ddic/structures/ZST/source/main',
    ],
    ['GetTable', (c) => handleGetTable(c, { table_name: 'ZTAB' }), '/sap/bc/adt/ddic/tables/ZTAB/source/main'],
    [
      'GetCDSView',
      (c) => handleGetCDSView(c, { cds_view_name: 'i_currency' }),
      '/sap/bc/adt/ddic/ddl/sources/I_CURRENCY/source/main',
    ],
    ['GetTypeInfo', (c) => handleGetTypeInfo(c, { type_name: 'ZDOM' }), '/sap/bc/adt/ddic/domains/ZDOM/source/main'],
    [
      'GetBehaviorDefinition',
      (c) => handleGetBehaviorDefinition(c, { behavior_definition_name: 'z_ent' }),
      '/sap/bc/adt/bo/behaviordefinitions/Z_ENT/source/main',
    ],
    [
      'GetServiceDefinition',
      (c) => handleGetServiceDefinition(c, { service_definition_name: 'z_srv' }),
      '/sap/bc/adt/ddic/srvd/sources/Z_SRV/source/main',
    ],
  ];

  it.each(cases)('%s requests %s', async (_name, invoke, expectedPath) => {
    const { result, calls } = await callHandler(invoke);

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe(expectedPath);
    expect(calls[0].method).toBe('GET');
  });

  it('percent-encodes namespaced object names', async () => {
    const { calls } = await callHandler((c) => handleGetClass(c, { class_name: '/DMO/CL_FLIGHT' }));

    expect(calls[0].url.pathname).toBe('/sap/bc/adt/oo/classes/%2FDMO%2FCL_FLIGHT/source/main');
  });
});

describe('GetTable fallback for older systems', () => {
  it('falls back to the structures endpoint on 404', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetTable(c, { table_name: 'ZTAB' }),
      (call) => (call.url.pathname.includes('/tables/') ? { status: 404, body: 'not found' } : { body: '<struct/>' }),
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toBe('<struct/>');
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/sap/bc/adt/ddic/tables/ZTAB/source/main',
      '/sap/bc/adt/ddic/structures/ZTAB/source/main',
    ]);
  });

  it('does not fall back on other errors', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetTable(c, { table_name: 'ZTAB' }),
      () => ({ status: 500, body: 'boom' }),
    );

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('RAP endpoints missing on older systems', () => {
  it('explains a 404 for behavior definitions', async () => {
    const { result } = await callHandler(
      (c) => handleGetBehaviorDefinition(c, { behavior_definition_name: 'Z_ENT' }),
      () => ({ status: 404, body: '<exc/>' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('NW 7.54');
    expect(textOf(result)).toContain('Z_ENT');
  });

  it('explains a 404 for service definitions', async () => {
    const { result } = await callHandler(
      (c) => handleGetServiceDefinition(c, { service_definition_name: 'Z_SRV' }),
      () => ({ status: 404, body: '<exc/>' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('NW 7.54');
  });

  it('passes other failures through with the ADT body', async () => {
    const { result } = await callHandler(
      (c) => handleGetServiceDefinition(c, { service_definition_name: 'Z_SRV' }),
      () => ({ status: 401, body: 'Unauthorized' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Unauthorized');
    expect(textOf(result)).not.toContain('NW 7.54');
  });
});

describe('GetTypeInfo', () => {
  it('tries the data element endpoint when the name is not a domain', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetTypeInfo(c, { type_name: 'ZDE' }),
      (call) => (call.url.pathname.includes('/domains/') ? { status: 404, body: 'no' } : { body: '<de/>' }),
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toBe('<de/>');
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/sap/bc/adt/ddic/domains/ZDE/source/main',
      '/sap/bc/adt/ddic/dataelements/ZDE',
    ]);
  });

  it('reports the second failure when the name is neither', async () => {
    const { result } = await callHandler(
      (c) => handleGetTypeInfo(c, { type_name: 'NOPE' }),
      () => ({ status: 404, body: 'not a data element either' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('not a data element either');
  });
});

describe('GetTableContents', () => {
  it('posts the select statement with the row limit', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetTableContents(c, { table_name: 'dd02l', max_rows: 5 }),
      () => ({ body: '<rows/>' }),
    );

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/datapreview/freestyle');
    expect(calls[0].url.searchParams.get('rowNumber')).toBe('5');
    // The table name reaches SQL, so it must be upper-cased, not passed through.
    expect(calls[0].body).toBe('SELECT * FROM DD02L');
    expect(calls[0].headers['content-type']).toBe('text/plain');
  });

  it('defaults to 100 rows', async () => {
    const { calls } = await callHandler((c) => handleGetTableContents(c, { table_name: 'DD02L' }));

    expect(calls[0].url.searchParams.get('rowNumber')).toBe('100');
  });

  it('allows namespaced table names', async () => {
    const { calls } = await callHandler((c) => handleGetTableContents(c, { table_name: '/DMO/FLIGHT' }));

    expect(calls[0].body).toBe('SELECT * FROM /DMO/FLIGHT');
  });

  it.each([
    ['a semicolon', 'DD02L; DROP TABLE X'],
    ['a space', 'DD02L WHERE 1=1'],
    ['a quote', "DD02L'"],
    ['a dash', 'DD02L--'],
  ])('refuses a table name containing %s without contacting the system', async (_label, tableName) => {
    const { result, calls } = await callHandler((c) => handleGetTableContents(c, { table_name: tableName }));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid table name');
    expect(calls).toHaveLength(0);
  });
});

describe('ExecuteQuery', () => {
  const twoRows =
    '<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">' +
    '<dataPreview:totalRows>2</dataPreview:totalRows>' +
    '<dataPreview:columns><dataPreview:metadata dataPreview:name="MANDT"/><dataPreview:dataSet>' +
    '<dataPreview:data>000</dataPreview:data><dataPreview:data>100</dataPreview:data>' +
    '</dataPreview:dataSet></dataPreview:columns></dataPreview:tableData>';

  it('posts the query verbatim and returns CSV', async () => {
    const { connection, calls } = fakeConnection(() => ({ body: twoRows }));

    const result = await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000', maxRows: 5 });

    expect(result.isError).toBe(false);
    expect(textOf(result)).toBe(['# 2 rows', 'MANDT', '000', '100'].join('\n'));
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/datapreview/freestyle');
    expect(calls[0].url.searchParams.get('rowNumber')).toBe('5');
    expect(calls[0].body).toBe('SELECT mandt FROM t000');
  });

  it('accepts a common table expression', async () => {
    const { connection, calls } = fakeConnection(() => ({ body: twoRows }));

    await handleExecuteQuery(connection, { query: '  WITH +x AS ( SELECT mandt FROM t000 ) SELECT * FROM +x  ' });

    // The body is trimmed, otherwise ABAP SQL trips over the leading blanks.
    expect(calls[0].body).toBe('WITH +x AS ( SELECT mandt FROM t000 ) SELECT * FROM +x');
  });

  it.each([
    ['an update', 'UPDATE t000 SET mtext = @x'],
    ['a delete', 'delete from t000'],
    ['a semicolon', 'SELECT * FROM t000; SELECT * FROM t001'],
    ['nothing at all', '   '],
  ])('refuses %s without contacting the system', async (_label, query) => {
    const { connection, calls } = fakeConnection(() => ({ body: twoRows }));

    const result = await handleExecuteQuery(connection, { query });

    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('explains how to switch free SQL back on when it is disabled', async () => {
    const { connection, calls } = fakeConnection(() => ({ body: twoRows }), { system: { allowFreeSql: false } });

    const result = await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('allowFreeSql');
    expect(textOf(result)).toContain('SAP_ALLOW_FREE_SQL');
    expect(calls).toHaveLength(0);
  });

  describe('time budget', () => {
    /** Records what reaches connection.request without any HTTP machinery. */
    function recordingConnection(configTimeoutMs: number) {
      const options: Array<{ timeoutMs?: number }> = [];
      const connection = {
        name: 'dev',
        config: { allowFreeSql: true, timeoutMs: configTimeoutMs },
        request: (_path: string, requestOptions: { timeoutMs?: number }) => {
          options.push(requestOptions);
          return Promise.resolve({ status: 200, headers: new Headers(), data: twoRows });
        },
      } as unknown as SapConnection;
      return { connection, options };
    }

    it('grants queries at least a minute even when the system timeout is lower', async () => {
      const { connection, options } = recordingConnection(30_000);

      await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000' });

      expect(options[0].timeoutMs).toBe(60_000);
    });

    it('keeps a system timeout that is already higher', async () => {
      const { connection, options } = recordingConnection(120_000);

      await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000' });

      expect(options[0].timeoutMs).toBe(120_000);
    });

    it('lets the call itself decide, in both directions', async () => {
      const { connection, options } = recordingConnection(30_000);

      await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000', timeoutMs: 300_000 });
      await handleExecuteQuery(connection, { query: 'SELECT mandt FROM t000', timeoutMs: 5_000 });

      expect(options.map((entry) => entry.timeoutMs)).toEqual([300_000, 5_000]);
    });
  });

  it('surfaces a SAP syntax error rather than swallowing it', async () => {
    const { connection } = fakeConnection(() => ({ status: 400, body: 'Only one SELECT statement is allowed.' }));

    const result = await handleExecuteQuery(connection, { query: 'SELECT * FROM t000 UP TO 1 ROWS' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Only one SELECT statement is allowed');
  });
});

describe('GetSystemInfo', () => {
  it('posts the fixed CVERS query, unaffected by allowFreeSql', async () => {
    const { connection, calls } = fakeConnection(() => OK, { system: { allowFreeSql: false } });

    const result = await handleGetSystemInfo(connection);

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/datapreview/freestyle');
    expect(calls[0].body).toBe('SELECT COMPONENT, RELEASE, EXTRELEASE FROM CVERS ORDER BY COMPONENT');
  });
});

describe('CheckSyntax', () => {
  const oneError =
    '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun">' +
    '<chkrun:checkReport>' +
    '<chkrun:checkMessageList>' +
    '<chkrun:checkMessage chkrun:uri="/sap/bc/adt/programs/programs/ZFOO/source/main#start=3,7" ' +
    'chkrun:type="E" chkrun:shortText="Field &quot;LV_FOO&quot; is unknown."/>' +
    '</chkrun:checkMessageList>' +
    '</chkrun:checkReport>' +
    '</chkrun:checkRunReports>';

  it('posts the base64-encoded source against the object uri', async () => {
    const { result, calls } = await callHandler(
      (c) => handleCheckSyntax(c, { object_type: 'program', object_name: 'ZFOO', source: 'REPORT zfoo.' }),
      () => ({ body: '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"/>' }),
    );

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/checkruns');
    expect(calls[0].url.searchParams.get('reporters')).toBe('abapCheckRun');
    expect(calls[0].body).toContain('adtcore:uri="/sap/bc/adt/programs/programs/ZFOO/source/main"');
    expect(calls[0].body).toContain(Buffer.from('REPORT zfoo.').toString('base64'));
    expect(textOf(result)).toBe('No syntax errors or warnings found.');
  });

  it('builds the class and interface uris', async () => {
    const { calls: classCalls } = await callHandler(
      (c) => handleCheckSyntax(c, { object_type: 'class', object_name: 'ZCL_FOO', source: 'CLASS zcl_foo.' }),
      () => ({ body: '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"/>' }),
    );
    expect(classCalls[0].body).toContain('/sap/bc/adt/oo/classes/ZCL_FOO/source/main');

    const { calls: interfaceCalls } = await callHandler(
      (c) => handleCheckSyntax(c, { object_type: 'interface', object_name: 'ZIF_FOO', source: 'INTERFACE zif_foo.' }),
      () => ({ body: '<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"/>' }),
    );
    expect(interfaceCalls[0].body).toContain('/sap/bc/adt/oo/interfaces/ZIF_FOO/source/main');
  });

  it('parses a check message, recovering line and column from the uri fragment', async () => {
    const { result } = await callHandler(
      (c) => handleCheckSyntax(c, { object_type: 'program', object_name: 'ZFOO', source: 'REPORT zfoo. lv_foo = 1.' }),
      () => ({ body: oneError }),
    );

    expect(textOf(result)).toBe('[E] line 3, col 7: Field "LV_FOO" is unknown.');
  });
});

describe('GetWhereUsed', () => {
  const twoReferences =
    '<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences" ' +
    'xmlns:adtcore="http://www.sap.com/adt/core">' +
    '<usageReferences:referencedObjects>' +
    '<usageReferences:referencedObject uri="/sap/bc/adt/programs/programs/ZCALLER1" usageInformation="used">' +
    '<usageReferences:adtObject adtcore:name="ZCALLER1" adtcore:type="PROG/P" adtcore:description="Caller one">' +
    '<adtcore:packageRef adtcore:name="ZPKG1"/>' +
    '</usageReferences:adtObject>' +
    '</usageReferences:referencedObject>' +
    '<usageReferences:referencedObject uri="/sap/bc/adt/programs/programs/ZCALLER2" usageInformation="used">' +
    '<usageReferences:adtObject adtcore:name="ZCALLER2" adtcore:type="PROG/P">' +
    '<adtcore:packageRef adtcore:name="ZPKG2"/>' +
    '</usageReferences:adtObject>' +
    '</usageReferences:referencedObject>' +
    '</usageReferences:referencedObjects>' +
    '</usageReferences:usageReferenceResult>';

  it('posts the object uri and parses the referenced objects', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'class', object_name: 'ZCL_FOO' }),
      () => ({ body: twoReferences }),
    );

    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/repository/informationsystem/usageReferences');
    expect(calls[0].url.searchParams.get('uri')).toBe('/sap/bc/adt/oo/classes/ZCL_FOO');
    expect(textOf(result)).toBe(
      [
        '2 usages:',
        'PROG/P ZCALLER1 (ZPKG1) [used]: /sap/bc/adt/programs/programs/ZCALLER1',
        'PROG/P ZCALLER2 (ZPKG2) [used]: /sap/bc/adt/programs/programs/ZCALLER2',
      ].join('\n'),
    );
  });

  /**
   * SAP flattens a tree into this list, and only the leaves are usages: a
   * package or function group is a grouping node for the hits beneath it,
   * recognisable by carrying no `usageInformation`. Measured on T100, 697 of
   * 1432 entries were grouping nodes - which a model reading the unfiltered
   * list counts as callers.
   */
  it('drops grouping nodes and says how many', async () => {
    const withGroupingNode =
      '<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences" ' +
      'xmlns:adtcore="http://www.sap.com/adt/core">' +
      '<usageReferences:referencedObjects>' +
      // No usageInformation: a grouping node, and note it does carry a type,
      // so the type is not what tells the two apart.
      '<usageReferences:referencedObject uri="/sap/bc/adt/functions/groups/ZFG">' +
      '<usageReferences:adtObject adtcore:name="ZFG" adtcore:type="FUGR/F">' +
      '<adtcore:packageRef adtcore:name="ZPKG"/>' +
      '</usageReferences:adtObject>' +
      '</usageReferences:referencedObject>' +
      '<usageReferences:referencedObject uri="/sap/bc/adt/programs/programs/ZCALLER1" usageInformation="used">' +
      '<usageReferences:adtObject adtcore:name="ZCALLER1" adtcore:type="PROG/P">' +
      '<adtcore:packageRef adtcore:name="ZPKG1"/>' +
      '</usageReferences:adtObject>' +
      '</usageReferences:referencedObject>' +
      '</usageReferences:referencedObjects>' +
      '</usageReferences:usageReferenceResult>';

    const { result } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'table', object_name: 'ZTAB' }),
      () => ({ body: withGroupingNode }),
    );

    expect(textOf(result)).toBe(
      [
        '1 usages, 1 grouping nodes omitted:',
        'PROG/P ZCALLER1 (ZPKG1) [used]: /sap/bc/adt/programs/programs/ZCALLER1',
      ].join('\n'),
    );
    expect(textOf(result)).not.toContain('ZFG');
  });

  /** A hit inside a method carries its type in the URI fragment, not on adtObject. */
  it('recovers the type of a method hit from the uri fragment', async () => {
    const methodHit =
      '<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences" ' +
      'xmlns:adtcore="http://www.sap.com/adt/core">' +
      '<usageReferences:referencedObjects>' +
      '<usageReferences:referencedObject ' +
      'uri="/sap/bc/adt/oo/classes/zcl_foo/source/main#type=CLAS%2FOM;name=MEASURE_TIME;start=1" ' +
      'usageInformation="gradeDirect">' +
      '<usageReferences:adtObject adtcore:name="MEASURE_TIME">' +
      '<adtcore:packageRef adtcore:name="ZPKG"/>' +
      '</usageReferences:adtObject>' +
      '</usageReferences:referencedObject>' +
      '</usageReferences:referencedObjects>' +
      '</usageReferences:usageReferenceResult>';

    const { result } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'table', object_name: 'ZTAB' }),
      () => ({ body: methodHit }),
    );

    expect(textOf(result)).toContain('CLAS/OM MEASURE_TIME (ZPKG) [gradeDirect]');
    expect(textOf(result)).not.toContain('? MEASURE_TIME');
  });

  it('caps the list at max_results while still naming the real total', async () => {
    const { result } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'class', object_name: 'ZCL_FOO', max_results: 1 }),
      () => ({ body: twoReferences }),
    );

    expect(textOf(result)).toContain('2 usages, showing the first 1:');
    expect(textOf(result)).toContain('ZCALLER1');
    expect(textOf(result)).not.toContain('ZCALLER2');
  });

  it('builds the object uri per type', async () => {
    const cases: Array<[Parameters<typeof handleGetWhereUsed>[1], string]> = [
      [{ object_type: 'program', object_name: 'ZFOO' }, '/sap/bc/adt/programs/programs/ZFOO'],
      [{ object_type: 'interface', object_name: 'ZIF_FOO' }, '/sap/bc/adt/oo/interfaces/ZIF_FOO'],
      [{ object_type: 'table', object_name: 'ZTAB' }, '/sap/bc/adt/ddic/tables/ZTAB'],
      [{ object_type: 'cds_view', object_name: 'i_currency' }, '/sap/bc/adt/ddic/ddl/sources/I_CURRENCY'],
    ];

    const results = await Promise.all(
      cases.map(([args]) =>
        callHandler(
          (c) => handleGetWhereUsed(c, args),
          () => ({ body: twoReferences }),
        ),
      ),
    );

    results.forEach(({ calls }, index) => {
      expect(calls[0].url.searchParams.get('uri')).toBe(cases[index][1]);
    });
  });

  it('reports no usages without falling back to raw XML', async () => {
    const empty =
      '<usageReferences:usageReferenceResult xmlns:usageReferences="http://www.sap.com/adt/ris/usageReferences">' +
      '<usageReferences:referencedObjects/>' +
      '</usageReferences:usageReferenceResult>';

    const { result } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'table', object_name: 'ZUNUSED' }),
      () => ({ body: empty }),
    );

    expect(textOf(result)).toBe('No usages found.');
  });

  it('falls back to the raw XML for an unrecognised response shape', async () => {
    const { result } = await callHandler(
      (c) => handleGetWhereUsed(c, { object_type: 'table', object_name: 'ZTAB' }),
      () => ({ body: '<somethingElse/>' }),
    );

    expect(textOf(result)).toBe('<somethingElse/>');
  });
});

/** What /atc/variants answers: the names matching the `name` query pattern. */
const variantList = (names: string[]) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<nameditem:namedItemList xmlns:nameditem="http://www.sap.com/adt/nameditem">' +
  `<nameditem:totalItemCount>${names.length}</nameditem:totalItemCount>` +
  names
    .map(
      (name) =>
        `<nameditem:namedItem><nameditem:name>${name}</nameditem:name>` +
        '<nameditem:description/><nameditem:data/></nameditem:namedItem>',
    )
    .join('') +
  '</nameditem:namedItemList>';

/** Matches a name pattern the way SAP does for /atc/variants: exact, or a '*' suffix. */
function matching(pattern: string, offered: string[]): string[] {
  if (!pattern.endsWith('*')) return offered.filter((name) => name === pattern);
  const prefix = pattern.slice(0, -1);
  return offered.filter((name) => name.startsWith(prefix));
}

/** Indices shift as steps are added; the path is the stable handle. */
function only(calls: RecordedCall[], path: string): RecordedCall[] {
  return calls.filter((call) => call.url.pathname === path);
}

/**
 * Builders for the ATC fixtures. They sit out here because they capture
 * nothing from the suite below - and because the shape they assemble is the
 * point: the response nests three namespaces, its objects are
 * `atcobject:object` rather than `atcworklist:object`, and a finding's
 * location arrives in two different formats. Every fixture mirrors what a real
 * S/4HANA system answered, with the object and variant names replaced by the
 * placeholders this file uses elsewhere.
 */
const atcInfo = (type: string, description: string) =>
  '<atcinfo:info xmlns:atcinfo="http://www.sap.com/adt/atc/info">' +
  `<atcinfo:type>${type}</atcinfo:type><atcinfo:description>${description}</atcinfo:description>` +
  '</atcinfo:info>';

const atcRun = (infos: string) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<atcworklist:worklistRun xmlns:atcworklist="http://www.sap.com/adt/atc/worklist">' +
  '<atcworklist:worklistId>WL1</atcworklist:worklistId>' +
  `<atcworklist:infos>${infos}</atcworklist:infos>` +
  '</atcworklist:worklistRun>';

const atcWorklist = (objects: string) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<atcworklist:worklist atcworklist:id="WL1" atcworklist:timestamp="2026-09-01T14:46:46Z" ' +
  'atcworklist:usedObjectSet="99999999999999999999999999999999" atcworklist:objectSetIsComplete="true" ' +
  'xmlns:atcworklist="http://www.sap.com/adt/atc/worklist">' +
  '<atcworklist:objectSets><atcworklist:objectSet atcworklist:name="9" atcworklist:title="Last Check Run" ' +
  'atcworklist:kind="LAST_RUN"/></atcworklist:objectSets>' +
  `<atcworklist:objects>${objects}</atcworklist:objects><atcworklist:infos/></atcworklist:worklist>`;

const atcObjectXml = (attributes: string, findings: string) =>
  `<atcobject:object ${attributes} xmlns:atcobject="http://www.sap.com/adt/atc/object" ` +
  `xmlns:adtcore="http://www.sap.com/adt/core"><atcobject:findings>${findings}</atcobject:findings>` +
  '</atcobject:object>';

const atcFindingXml = (attributes: string) =>
  `<atcfinding:finding ${attributes} xmlns:atcfinding="http://www.sap.com/adt/atc/finding"/>`;

describe('GetAtcFindings', () => {
  const customizing =
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<atc:customizing xmlns:atc="http://www.sap.com/adt/atc"><properties>' +
    '<property name="ciCheckFlavour" value="true"/>' +
    '<property name="systemCheckVariant" value="ZSYSTEM_DEFAULT"/>' +
    '<property name="referencedVariant" value="ZREFERENCED"/>' +
    '</properties></atc:customizing>';

  const runStats = atcRun(atcInfo('FINDING_STATS', '0,1,0'));
  const runAborted = atcRun(
    atcInfo('TOOL_FAILURE', 'Execution of check seemingly aborted') + atcInfo('FINDING_STATS', '0,0,0'),
  );

  /** A report finding: the location carries "start=line,column". */
  const programObject = atcObjectXml(
    'adtcore:type="PROG" adtcore:name="ZFOO" adtcore:packageName="ZPKG"',
    atcFindingXml(
      'atcfinding:location="/sap/bc/adt/programs/programs/zfoo/source/main#start=8,0" ' +
        'atcfinding:priority="2" atcfinding:checkTitle="Analysis of WHERE Condition for SELECT" ' +
        'atcfinding:messageId="0001" atcfinding:messageTitle="Table ZTAB: No WHERE condition" ' +
        'atcfinding:exemptionKind=""',
    ),
  );

  /** A class finding: no column, and the method is named in the fragment. */
  const classObject = atcObjectXml(
    'adtcore:type="CLAS" adtcore:name="ZCL_FOO" adtcore:packageName="ZPKG"',
    atcFindingXml(
      'atcfinding:location="/sap/bc/adt/oo/classes/zcl_foo/source/main' +
        '#type=CLAS%2FOM;name=IF_OO_ADT_CLASSRUN%7eMAIN;start=32" ' +
        'atcfinding:priority="3" atcfinding:checkTitle="Extended Program Check (SLIN)" ' +
        'atcfinding:messageId="1700" atcfinding:messageTitle="Strings are not translated" ' +
        'atcfinding:exemptionKind=""',
    ) +
      atcFindingXml(
        'atcfinding:location="/sap/bc/adt/oo/classes/zcl_foo/source/main' +
          '#type=CLAS%2FOM;name=IF_OO_ADT_CLASSRUN%7eMAIN;start=48" ' +
          'atcfinding:priority="3" atcfinding:checkTitle="Extended Program Check (SLIN)" ' +
          'atcfinding:messageId="1713" atcfinding:messageTitle="Another one" ' +
          'atcfinding:exemptionKind="FPOS"',
      ),
  );

  /** Stands in for the variants this system offers, matched the way SAP does. */
  const OFFERED = ['ZVAR', 'ZSYSTEM_DEFAULT', 'ZREFERENCED', 'ZOTHER'];

  /** Routes by path, so a test does not depend on how many requests precede it. */
  function atcResponder(
    worklistXml: string,
    runXml = runStats,
    offered = OFFERED,
  ): (call: RecordedCall) => FakeResponse | Error {
    return (call) => {
      switch (call.url.pathname) {
        case '/sap/bc/adt/atc/variants':
          return { body: variantList(matching(call.url.searchParams.get('name') ?? '', offered)) };
        case '/sap/bc/adt/atc/customizing':
          return { body: customizing };
        case '/sap/bc/adt/atc/worklists':
          return { body: 'WL1' };
        case '/sap/bc/adt/atc/runs':
          return { body: runXml };
        case '/sap/bc/adt/atc/worklists/WL1':
          return { body: worklistXml };
        default:
          return new Error(`unexpected path ${call.url.pathname}`);
      }
    };
  }

  it('walks the steps in order, with the object uri in the run body', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZFOO', check_variant: 'ZVAR' }),
      atcResponder(atcWorklist(programObject)),
    );

    expect(result.isError).toBe(false);
    // An explicit variant needs no customizing lookup: validate, create, run, read.
    expect(calls.map((call) => call.url.pathname)).toEqual([
      '/sap/bc/adt/atc/variants',
      '/sap/bc/adt/atc/worklists',
      '/sap/bc/adt/atc/runs',
      '/sap/bc/adt/atc/worklists/WL1',
    ]);

    const [created] = only(calls, '/sap/bc/adt/atc/worklists');
    expect(created.method).toBe('POST');
    expect(created.url.searchParams.get('checkVariant')).toBe('ZVAR');

    const [run] = only(calls, '/sap/bc/adt/atc/runs');
    expect(run.method).toBe('POST');
    expect(run.url.searchParams.get('worklistId')).toBe('WL1');
    expect(run.body).toContain('adtcore:uri="/sap/bc/adt/programs/programs/ZFOO"');
    expect(run.body).toContain('maximumVerdicts="100"');

    const [read] = only(calls, '/sap/bc/adt/atc/worklists/WL1');
    expect(read.method).toBe('GET');
    expect(read.headers.accept).toBe('application/atc.worklist.v1+xml');
  });

  it('resolves the system check variant when none is given', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZFOO' }),
      atcResponder(atcWorklist(programObject)),
    );

    expect(only(calls, '/sap/bc/adt/atc/customizing')).toHaveLength(1);
    expect(only(calls, '/sap/bc/adt/atc/worklists')[0].url.searchParams.get('checkVariant')).toBe('ZSYSTEM_DEFAULT');
    expect(textOf(result)).toContain('Check variant: ZSYSTEM_DEFAULT (system default)');
  });

  /**
   * The defect this guards against: SAP answers a request for a variant it does
   * not offer by silently running its own default, so the findings come back
   * looking like the variant that was asked for. Measured against a live
   * system - an invented name and a name that exists but is not released for
   * general use both produced the default's eight findings on the same class.
   */
  it('refuses a variant the system does not offer, and names the near misses', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'class', object_name: 'ZCL_FOO', check_variant: 'ZVARIANT_X' }),
      atcResponder(atcWorklist(classObject)),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('"ZVARIANT_X" is not a check variant this system offers');
    expect(textOf(result)).toContain('silently running its own default');
    // The prefix search offers what the system really has under "ZVAR".
    expect(textOf(result)).toContain('ZVAR');

    // Nothing was created: the check runs before the worklist exists.
    expect(only(calls, '/sap/bc/adt/atc/worklists')).toHaveLength(0);
    expect(only(calls, '/sap/bc/adt/atc/runs')).toHaveLength(0);
  });

  it('recovers the line from a report location', async () => {
    const { result } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZFOO', check_variant: 'ZVAR' }),
      atcResponder(atcWorklist(programObject)),
    );

    expect(textOf(result)).toContain('PROG ZFOO (ZPKG), 1 findings:');
    expect(textOf(result)).toContain(
      '[prio 2] line 8 - Analysis of WHERE Condition for SELECT [0001]: Table ZTAB: No WHERE condition',
    );
    expect(textOf(result)).toContain('Findings by priority (1/2/3), as counted by ATC: 0/1/0');
  });

  it('recovers line and method from a class location, and marks an exemption', async () => {
    const { result } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'class', object_name: 'ZCL_FOO', check_variant: 'ZVAR' }),
      atcResponder(atcWorklist(classObject)),
    );

    expect(textOf(result)).toContain(
      '[prio 3] line 32 in IF_OO_ADT_CLASSRUN~MAIN - Extended Program Check (SLIN) [1700]: ' +
        'Strings are not translated',
    );
    expect(textOf(result)).toContain('[1713]: Another one (exempted: FPOS)');
  });

  /**
   * The distinction this tool exists to keep: SAP answers 200 with an empty
   * object list both for a name that does not exist and for an object outside
   * the variant's scope. Calling that "no findings" would tell a model that
   * unchecked code is clean.
   */
  it('says the object was not checked rather than reporting no findings', async () => {
    const { result } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZNOPE', check_variant: 'ZVAR' }),
      atcResponder(atcWorklist('')),
    );

    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain('was not checked at all');
    expect(textOf(result)).toContain('not the same as "no findings"');
  });

  it('reports no findings for an object that was checked and is clean', async () => {
    const clean = atcObjectXml('adtcore:type="PROG" adtcore:name="ZCLEAN" adtcore:packageName="ZPKG"', '');

    const { result } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZCLEAN', check_variant: 'ZVAR' }),
      atcResponder(atcWorklist(clean)),
    );

    expect(textOf(result)).toContain('PROG ZCLEAN (ZPKG): no findings.');
    expect(textOf(result)).not.toContain('was not checked');
  });

  it('leads with a tool failure, ahead of any count', async () => {
    const { result } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZFOO', check_variant: 'ZVAR' }),
      atcResponder(atcWorklist(''), runAborted),
    );

    const lines = textOf(result).split('\n');
    expect(lines[0]).toBe(
      'WARNING: ATC reported a tool failure, so this result may be incomplete: ' +
        'Execution of check seemingly aborted',
    );
  });

  it('names the referenced variant only when the failing one was the system default', async () => {
    const { result: fromDefault } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZFOO' }),
      atcResponder(atcWorklist(''), runAborted),
    );
    expect(textOf(fromDefault)).toContain('references ZREFERENCED, which this system does offer');

    const { result: fromExplicit } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZFOO', check_variant: 'ZVAR' }),
      atcResponder(atcWorklist(''), runAborted),
    );
    expect(textOf(fromExplicit)).not.toContain('HINT:');
  });

  /**
   * The ATC customizing names a referenced variant without regard to whether
   * it can be used: on the system this was built against it points at one ADT
   * itself refuses. Suggesting it unchecked sent the caller somewhere they
   * could not follow.
   */
  it('falls back to a generic hint when the referenced variant is not offered either', async () => {
    const withoutReferenced = ['ZSYSTEM_DEFAULT', 'ZOTHER'];

    const { result } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZFOO' }),
      atcResponder(atcWorklist(''), runAborted, withoutReferenced),
    );

    expect(textOf(result)).toContain('Pass check_variant with another variant this system offers.');
    expect(textOf(result)).not.toContain('ZREFERENCED');
  });

  /** SAP ignored maximumVerdicts on the tested release, so the cap is applied here too. */
  it('caps the list at max_findings while still naming the real total', async () => {
    const { result } = await callHandler(
      (c) =>
        handleGetAtcFindings(c, {
          object_type: 'class',
          object_name: 'ZCL_FOO',
          check_variant: 'ZVAR',
          max_findings: 1,
        }),
      atcResponder(atcWorklist(classObject)),
    );

    expect(textOf(result)).toContain('2 findings (showing 1):');
    expect(textOf(result)).toContain('[1700]');
    expect(textOf(result)).not.toContain('[1713]');
  });

  it('builds the object uri per type', async () => {
    const cases: Array<[Parameters<typeof handleGetAtcFindings>[1], string]> = [
      [{ object_type: 'program', object_name: 'ZFOO' }, '/sap/bc/adt/programs/programs/ZFOO'],
      [{ object_type: 'class', object_name: 'ZCL_FOO' }, '/sap/bc/adt/oo/classes/ZCL_FOO'],
      [{ object_type: 'interface', object_name: 'ZIF_FOO' }, '/sap/bc/adt/oo/interfaces/ZIF_FOO'],
      [{ object_type: 'function_group', object_name: 'ZFG_FOO' }, '/sap/bc/adt/functions/groups/ZFG_FOO'],
      [{ object_type: 'table', object_name: 'ZTAB' }, '/sap/bc/adt/ddic/tables/ZTAB'],
      [{ object_type: 'cds_view', object_name: 'z_view' }, '/sap/bc/adt/ddic/ddl/sources/Z_VIEW'],
    ];

    const results = await Promise.all(
      cases.map(([args]) =>
        callHandler(
          (c) => handleGetAtcFindings(c, { ...args, check_variant: 'ZVAR' }),
          atcResponder(atcWorklist(programObject)),
        ),
      ),
    );

    results.forEach(({ calls }, index) => {
      const [run] = only(calls, '/sap/bc/adt/atc/runs');
      expect(run.body).toContain(`adtcore:uri="${cases[index][1]}"`);
    });
  });

  it('explains itself when the system has no default variant to fall back on', async () => {
    const withoutVariant =
      '<atc:customizing xmlns:atc="http://www.sap.com/adt/atc"><properties>' +
      '<property name="ciCheckFlavour" value="true"/></properties></atc:customizing>';

    const { connection } = fakeConnection((call) =>
      call.url.pathname === '/sap/bc/adt/atc/customizing' ? { body: withoutVariant } : { body: 'WL1' },
    );

    const result = await handleGetAtcFindings(connection, { object_type: 'program', object_name: 'ZFOO' });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('no systemCheckVariant');
    expect(textOf(result)).toContain('Pass check_variant');
  });

  it('falls back to the raw XML for an unrecognised response shape', async () => {
    const { result } = await callHandler(
      (c) => handleGetAtcFindings(c, { object_type: 'program', object_name: 'ZFOO', check_variant: 'ZVAR' }),
      atcResponder('<somethingElse/>'),
    );

    expect(textOf(result)).toBe('<somethingElse/>');
  });
});

describe('GetPackage', () => {
  const nodeStructure = `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
    <DATA>
      <TREE_CONTENT>
        <SEU_ADT_REPOSITORY_OBJ_NODE>
          <OBJECT_TYPE>CLAS/OC</OBJECT_TYPE>
          <OBJECT_NAME>ZCL_FOO</OBJECT_NAME>
          <DESCRIPTION>A class</DESCRIPTION>
          <OBJECT_URI>/sap/bc/adt/oo/classes/zcl_foo</OBJECT_URI>
        </SEU_ADT_REPOSITORY_OBJ_NODE>
        <SEU_ADT_REPOSITORY_OBJ_NODE>
          <OBJECT_TYPE>DEVC/K</OBJECT_TYPE>
          <OBJECT_NAME>ZSUB</OBJECT_NAME>
        </SEU_ADT_REPOSITORY_OBJ_NODE>
      </TREE_CONTENT>
    </DATA>
  </asx:values>
</asx:abap>`;

  it('posts the node structure query and flattens the result', async () => {
    const { result, calls } = await callHandler(
      (c) => handleGetPackage(c, { package_name: 'ZPKG' }),
      () => ({ body: nodeStructure }),
    );

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/sap/bc/adt/repository/nodestructure');
    expect(calls[0].url.searchParams.get('parent_type')).toBe('DEVC/K');
    expect(calls[0].url.searchParams.get('parent_name')).toBe('ZPKG');
    expect(calls[0].url.searchParams.get('withShortDescriptions')).toBe('true');

    // Entries without a URI are not addressable and are dropped.
    expect(JSON.parse(textOf(result))).toEqual([
      {
        OBJECT_TYPE: 'CLAS/OC',
        OBJECT_NAME: 'ZCL_FOO',
        OBJECT_DESCRIPTION: 'A class',
        OBJECT_URI: '/sap/bc/adt/oo/classes/zcl_foo',
      },
    ]);
  });

  it('encodes a namespaced package name exactly once', async () => {
    const { calls } = await callHandler(
      (c) => handleGetPackage(c, { package_name: '/DMO/FLIGHT' }),
      () => ({ body: nodeStructure }),
    );

    // The raw value must arrive at SAP; double encoding used to break this.
    expect(calls[0].url.searchParams.get('parent_name')).toBe('/DMO/FLIGHT');
  });

  it('handles a package holding a single object', async () => {
    const single = nodeStructure.replace(
      /<SEU_ADT_REPOSITORY_OBJ_NODE>\s*<OBJECT_TYPE>DEVC[\S\s]*?<\/SEU_ADT_REPOSITORY_OBJ_NODE>/u,
      '',
    );
    const { result } = await callHandler(
      (c) => handleGetPackage(c, { package_name: 'ZPKG' }),
      () => ({ body: single }),
    );

    expect(JSON.parse(textOf(result))).toHaveLength(1);
  });

  it('returns an empty list for an empty package', async () => {
    const { result } = await callHandler(
      (c) => handleGetPackage(c, { package_name: 'ZPKG' }),
      () => ({
        body: '<?xml version="1.0"?><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values/></asx:abap>',
      }),
    );

    expect(JSON.parse(textOf(result))).toEqual([]);
  });
});

describe('query building', () => {
  it('SearchObject passes the query and result limit', async () => {
    const { calls } = await callHandler((c) => handleSearchObject(c, { query: 'ZCL_*', maxResults: 20 }));

    expect(calls[0].url.pathname).toBe('/sap/bc/adt/repository/informationsystem/search');
    expect(calls[0].url.searchParams.get('operation')).toBe('quickSearch');
    expect(calls[0].url.searchParams.get('query')).toBe('ZCL_*');
    expect(calls[0].url.searchParams.get('maxResults')).toBe('20');
  });

  it('SearchObject defaults to 100 results', async () => {
    const { calls } = await callHandler((c) => handleSearchObject(c, { query: 'ZCL_*' }));

    expect(calls[0].url.searchParams.get('maxResults')).toBe('100');
  });

  it('GetTransaction sends the object uri and both facets', async () => {
    const { calls } = await callHandler((c) => handleGetTransaction(c, { transaction_name: 'SE93' }));

    expect(calls[0].url.pathname).toBe('/sap/bc/adt/repository/informationsystem/objectproperties/values');
    expect(calls[0].url.searchParams.get('uri')).toBe('/sap/bc/adt/vit/wb/object_type/trant/object_name/SE93');
    expect(calls[0].url.searchParams.getAll('facet')).toEqual(['package', 'appl']);
  });
});

describe('failures reach the caller', () => {
  it('turns a network failure into a tool error rather than throwing', async () => {
    const { result } = await callHandler(
      (c) => handleGetProgram(c, { program_name: 'ZFOO' }),
      () => new Error('socket hang up'),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('socket hang up');
  });

  it('surfaces the ADT error body, which explains the problem', async () => {
    const { result } = await callHandler(
      (c) => handleGetProgram(c, { program_name: 'ZFOO' }),
      () => ({ status: 403, body: '<exc><localizedMessage>Not authorized</localizedMessage></exc>' }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Not authorized');
  });
});
