import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInlineProvider } from '../../src/auth/providers/inline.js';
import { ConnectionRegistry } from '../../src/connection/registry.js';
import type { ResolvedAppConfig, ResolvedSystem } from '../../src/config/schema.js';
import { TOOL_DEFINITIONS, createServer } from '../../src/server.js';
import { logWarn, setLogSink } from '../../src/lib/log.js';
import { testSystem as system } from '../helpers/fakeConnection.js';

// The sink is module state that createServer sets; a test must not leave a
// closed server's sink behind for the next one.
afterEach(() => {
  setLogSink(undefined);
});

async function connectClient(config: Partial<ResolvedAppConfig> & { systems: Map<string, ResolvedSystem> }) {
  const resolved: ResolvedAppConfig = { errors: [], sources: [], ...config };
  const registry = new ConnectionRegistry(resolved, {
    providers: [createInlineProvider()],
    fetch: (async () => new Response('<abap>source</abap>', { status: 200 })) as unknown as typeof globalThis.fetch,
  });

  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), createServer(registry).connect(serverTransport)]);
  return client;
}

const singleSystem = { systems: new Map([['dev', system()]]), defaultSystem: 'dev' };

describe('tool surface', () => {
  it('exposes every ADT tool plus ListSystems', async () => {
    const client = await connectClient(singleSystem);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).toSorted();

    expect(names).toEqual([...TOOL_DEFINITIONS.map((tool) => tool.name), 'ListSystems'].toSorted());
    expect(tools).toHaveLength(22);
  });

  it('keeps the original tool names and required arguments', async () => {
    const client = await connectClient(singleSystem);

    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    expect(byName.GetProgram.inputSchema.required).toEqual(['program_name']);
    expect(byName.GetFunction.inputSchema.required).toEqual(['function_name', 'function_group']);
    // max_rows has a default, so it must not be required.
    expect(byName.GetTableContents.inputSchema.required).toEqual(['table_name']);
  });

  it('offers an optional system argument on every ADT tool', async () => {
    const client = await connectClient(singleSystem);

    const { tools } = await client.listTools();

    for (const tool of tools) {
      if (tool.name === 'ListSystems') continue;
      const properties = tool.inputSchema.properties as Record<string, unknown> | undefined;
      expect(properties, `${tool.name} has no properties`).toHaveProperty('system');
      expect(tool.inputSchema.required ?? []).not.toContain('system');
    }
  });
});

describe('tool calls', () => {
  it('routes a call to the default system', async () => {
    const client = await connectClient(singleSystem);

    const result = await client.callTool({
      name: 'GetProgram',
      arguments: { program_name: 'RSABAPPROGRAM' },
    });

    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: '<abap>source</abap>' }]);
  });

  it('reports an unknown system as a readable tool error', async () => {
    const client = await connectClient(singleSystem);

    const result = await client.callTool({
      name: 'GetProgram',
      arguments: { program_name: 'RSABAPPROGRAM', system: 'nope' },
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Unknown system "nope"');
    expect(text).toContain('Configured systems: dev');
  });

  it('rejects a missing required argument', async () => {
    const client = await connectClient(singleSystem);

    const result = await client.callTool({ name: 'GetProgram', arguments: {} });

    expect(result.isError).toBe(true);
  });
});

describe('ExecuteQuery over the protocol', () => {
  const twoRows =
    '<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">' +
    '<dataPreview:columns><dataPreview:metadata dataPreview:name="MANDT"/><dataPreview:dataSet>' +
    '<dataPreview:data>000</dataPreview:data><dataPreview:data>100</dataPreview:data>' +
    '</dataPreview:dataSet></dataPreview:columns></dataPreview:tableData>';

  async function client() {
    const registry = new ConnectionRegistry(
      { systems: new Map([['dev', system()]]), defaultSystem: 'dev', errors: [], sources: [] },
      {
        providers: [createInlineProvider()],
        // ExecuteQuery posts, so the connection primes a CSRF token first.
        fetch: (async () =>
          new Response(twoRows, {
            status: 200,
            headers: { 'x-csrf-token': 'TEST-TOKEN' },
          })) as unknown as typeof globalThis.fetch,
      },
    );
    const mcp = new Client({ name: 'test', version: '1.0.0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([mcp.connect(a), createServer(registry).connect(b)]);
    return mcp;
  }

  it('returns CSV rather than the ADT XML', async () => {
    const result = await (
      await client()
    ).callTool({
      name: 'ExecuteQuery',
      arguments: { query: 'SELECT mandt FROM t000' },
    });

    expect(result.isError).toBe(false);
    expect((result.content as Array<{ text: string }>)[0].text).toBe(['# 2 rows', 'MANDT', '000', '100'].join('\n'));
  });

  it('requires a query', async () => {
    const result = await (await client()).callTool({ name: 'ExecuteQuery', arguments: {} });

    expect(result.isError).toBe(true);
  });

  it.each([
    ['above the cap', 99_999],
    ['below one', 0],
  ])('rejects maxRows %s before the handler runs', async (_label, maxRows) => {
    const result = await (
      await client()
    ).callTool({
      name: 'ExecuteQuery',
      arguments: { query: 'SELECT mandt FROM t000', maxRows },
    });

    expect(result.isError).toBe(true);
  });

  it('caps GetTableContents the same way', async () => {
    const result = await (
      await client()
    ).callTool({
      name: 'GetTableContents',
      arguments: { table_name: 'T000', max_rows: 99_999 },
    });

    expect(result.isError).toBe(true);
  });
});

describe('logging over the protocol', () => {
  /** Collects notifications/message the server pushes to the client. */
  async function clientCollectingLogs() {
    const client = await connectClient(singleSystem);
    const seen: Array<{ level: string; data: unknown; logger?: string }> = [];
    client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
      seen.push(notification.params);
    });
    return { client, seen };
  }

  it('advertises the logging capability, so clients may set a level', async () => {
    const client = await connectClient(singleSystem);

    expect(client.getServerCapabilities()?.logging).toBeDefined();
  });

  it('accepts logging/setLevel', async () => {
    const client = await connectClient(singleSystem);

    await expect(client.setLoggingLevel('debug')).resolves.toBeDefined();
  });

  it('delivers a warning to the client rather than only to stderr', async () => {
    const { seen } = await clientCollectingLogs();

    logWarn('the session was replaced');
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(seen[0]).toMatchObject({ level: 'warning', logger: 'mcp-abap-adt', data: 'the session was replaced' });
  });

  it('honours the level the client asked for', async () => {
    const { client, seen } = await clientCollectingLogs();
    // "error" outranks "warning", so a warning must not be delivered.
    await client.setLoggingLevel('error');

    logWarn('should be filtered out');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(seen).toEqual([]);
  });
});

describe('ListSystems', () => {
  it('describes the systems without revealing credentials', async () => {
    const client = await connectClient({
      systems: new Map([
        ['dev', system({ password: 'top-secret' })],
        ['prd', system({ url: 'https://prd.example.com', password: 'other-secret' })],
      ]),
      defaultSystem: 'dev',
    });

    const result = await client.callTool({ name: 'ListSystems', arguments: {} });
    const text = (result.content as Array<{ text: string }>)[0].text;
    const payload = JSON.parse(text) as {
      defaultSystem: string;
      systems: Array<{ name: string; isDefault: boolean; credentialSource: string }>;
    };

    expect(payload.defaultSystem).toBe('dev');
    expect(payload.systems.map((entry) => entry.name)).toEqual(['dev', 'prd']);
    expect(payload.systems[0]).toMatchObject({ isDefault: true, credentialSource: 'inline' });
    expect(text).not.toContain('top-secret');
    expect(text).not.toContain('DEVELOPER');
  });

  it('still answers when the configuration is broken', async () => {
    const client = await connectClient({
      systems: new Map(),
      errors: [{ scope: 'global', message: 'No SAP system is configured.' }],
    });

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(22);

    const result = await client.callTool({ name: 'ListSystems', arguments: {} });
    expect((result.content as Array<{ text: string }>)[0].text).toContain('No SAP system is configured.');
  });
});
