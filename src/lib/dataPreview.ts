import convert from 'xml-js';

export interface DataPreviewResult {
  columns: string[];
  rows: string[][];
  /** Rows the system reports for the query, which can exceed the rows returned. */
  totalRows?: number;
  executedQuery?: string;
  /**
   * Database execution time in milliseconds. The unit was established
   * empirically: a COUNT(*) over 17 million rows reported 7.1 while the whole
   * HTTP round trip took 159 ms, which only database-side milliseconds fit.
   */
  executionTimeMs?: number;
}

/** xml-js compact mode collapses a single child to an object rather than an array. */
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node: unknown): string {
  const text = (node as { _text?: unknown } | null | undefined)?._text;
  if (typeof text === 'string') return text;
  // xml-js can hand back a number for numeric-looking content.
  return typeof text === 'number' || typeof text === 'boolean' ? String(text) : '';
}

/**
 * Reads the column-oriented XML the ADT data preview returns.
 *
 * The payload carries roughly 370 characters of metadata per column whether or
 * not the column holds anything, which is why callers reshape it before
 * handing it to a model.
 */
export function parseDataPreview(xml: string): DataPreviewResult | undefined {
  let parsed: any;
  try {
    parsed = convert.xml2js(xml, { compact: true });
  } catch {
    return undefined;
  }

  const table = parsed?.['dataPreview:tableData'];
  if (!table) return undefined;

  const columnNodes = asArray(table['dataPreview:columns']);
  if (columnNodes.length === 0) return undefined;

  const columns: string[] = [];
  const columnValues: string[][] = [];

  for (const node of columnNodes) {
    const name = node?.['dataPreview:metadata']?._attributes?.['dataPreview:name'];
    if (typeof name !== 'string') return undefined;
    columns.push(name);
    // An empty cell arrives as <dataPreview:data/>, which has no _text.
    columnValues.push(asArray(node?.['dataPreview:dataSet']?.['dataPreview:data']).map(textOf));
  }

  // The XML is column-oriented; rows are the transpose.
  const rowCount = Math.max(0, ...columnValues.map((values) => values.length));
  const rows: string[][] = [];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push(columnValues.map((values) => values[index] ?? ''));
  }

  // Number('') is 0, so an absent element must be treated as unknown rather
  // than as zero, which would read as "n rows returned, 0 total".
  const totalRowsText = textOf(table['dataPreview:totalRows']);
  const totalRows = totalRowsText === '' ? Number.NaN : Number(totalRowsText);
  const executedQuery = textOf(table['dataPreview:executedQueryString']).replace(/\s+/gu, ' ').trim();

  const executionTimeText = textOf(table['dataPreview:queryExecutionTime']);
  const executionTimeMs = executionTimeText === '' ? Number.NaN : Number(executionTimeText);

  return {
    columns,
    rows,
    totalRows: Number.isFinite(totalRows) ? totalRows : undefined,
    executedQuery: executedQuery || undefined,
    executionTimeMs: Number.isFinite(executionTimeMs) ? executionTimeMs : undefined,
  };
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Renders the result as CSV with a short header, a fraction of the XML's size. */
export function formatDataPreview(result: DataPreviewResult): string {
  const lines: string[] = [];
  if (result.executedQuery) lines.push(`# ${result.executedQuery}`);
  const returned = result.rows.length;
  // The total is only worth stating when it means "there is more than you got".
  // For an aggregate SAP reports the underlying match count, which is often
  // smaller than the one result row and then reads as a contradiction.
  const hasMore = result.totalRows !== undefined && result.totalRows > returned;
  // The execution time lets the caller judge before the next attempt whether
  // a query needs a tighter filter - it was asked for by exactly that reader.
  const took = result.executionTimeMs === undefined ? '' : ` (db time ${result.executionTimeMs} ms)`;
  lines.push(hasMore ? `# ${returned} of ${result.totalRows} rows${took}` : `# ${returned} rows${took}`);
  lines.push(result.columns.map(csvCell).join(','));
  if (returned === 0) {
    lines.push('(no rows)');
  } else {
    for (const row of result.rows) lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\n');
}

/**
 * Compacts a data preview response, falling back to the raw XML when the shape
 * is not the one we know. An unfamiliar variant from some other system should
 * cost the caller detail, not the whole answer.
 */
export function compactDataPreview(xml: string): string {
  const parsed = parseDataPreview(xml);
  return parsed ? formatDataPreview(parsed) : xml;
}
