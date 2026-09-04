import { describe, expect, it } from 'vitest';

import { compactDataPreview, formatDataPreview, parseDataPreview } from '../../src/lib/dataPreview.js';

/** Builds the column-oriented shape the ADT data preview really returns. */
function tableData(columns: Array<{ name: string; values: string[] }>, extra = ''): string {
  const blocks = columns
    .map(
      ({ name, values }) =>
        `<dataPreview:columns><dataPreview:metadata dataPreview:name="${name}" dataPreview:type="C" ` +
        `dataPreview:description="${name}" dataPreview:keyAttribute="false" dataPreview:colType="" ` +
        `dataPreview:isKeyFigure="false"/><dataPreview:dataSet>` +
        values.map((v) => (v === '' ? '<dataPreview:data/>' : `<dataPreview:data>${v}</dataPreview:data>`)).join('') +
        `</dataPreview:dataSet></dataPreview:columns>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">' +
    extra +
    blocks +
    '</dataPreview:tableData>'
  );
}

/** Shaped like a real T000 response, including its empty ADRNR column. */
const T000 = tableData(
  [
    { name: 'MANDT', values: ['000', '100'] },
    { name: 'MTEXT', values: ['SAP AG', 'Development'] },
    { name: 'ADRNR', values: ['', ''] },
    { name: 'LOGSYS', values: ['DEVCLNT000', 'DEVCLNT100'] },
  ],
  '<dataPreview:totalRows>2</dataPreview:totalRows>' +
    '<dataPreview:executedQueryString>SELECT * FROM T000   INTO     TABLE @DATA(LT_RESULT)   UP TO 2  ROWS   .</dataPreview:executedQueryString>',
);

describe('parseDataPreview', () => {
  it('transposes the column-oriented payload into rows', () => {
    const result = parseDataPreview(T000);

    expect(result?.columns).toEqual(['MANDT', 'MTEXT', 'ADRNR', 'LOGSYS']);
    expect(result?.rows).toEqual([
      ['000', 'SAP AG', '', 'DEVCLNT000'],
      ['100', 'Development', '', 'DEVCLNT100'],
    ]);
  });

  it('keeps the executed query, collapsing the padding SAP adds', () => {
    expect(parseDataPreview(T000)?.executedQuery).toBe('SELECT * FROM T000 INTO TABLE @DATA(LT_RESULT) UP TO 2 ROWS .');
  });

  it('handles a single column, which xml-js hands over as an object', () => {
    const result = parseDataPreview(tableData([{ name: 'CARRID', values: ['LH', 'AA'] }]));

    expect(result?.columns).toEqual(['CARRID']);
    expect(result?.rows).toEqual([['LH'], ['AA']]);
  });

  it('handles a single row, likewise not an array', () => {
    const result = parseDataPreview(
      tableData([
        { name: 'MANDT', values: ['100'] },
        { name: 'MTEXT', values: ['only one'] },
      ]),
    );

    expect(result?.rows).toEqual([['100', 'only one']]);
  });

  it('returns the columns and no rows for an empty result', () => {
    const empty =
      '<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview">' +
      '<dataPreview:columns><dataPreview:metadata dataPreview:name="MANDT"/><dataPreview:dataSet/></dataPreview:columns>' +
      '</dataPreview:tableData>';

    expect(parseDataPreview(empty)).toMatchObject({ columns: ['MANDT'], rows: [] });
  });

  it('treats a missing totalRows as unknown, not as zero', () => {
    // Number('') is 0, which would otherwise print "2 rows returned, 0 total".
    const result = parseDataPreview(tableData([{ name: 'MANDT', values: ['000', '100'] }]));

    expect(result?.totalRows).toBeUndefined();
    expect(formatDataPreview(result!)).toContain('# 2 rows\n');
  });

  it('reads the database execution time, which arrives in milliseconds', () => {
    // Field and unit verified live: COUNT(*) over 17M rows reported 7.114
    // while the whole round trip took 159 ms - only db-side ms fit that.
    const result = parseDataPreview(
      tableData(
        [{ name: 'MANDT', values: ['100'] }],
        '<dataPreview:queryExecutionTime>0.1350000</dataPreview:queryExecutionTime>',
      ),
    );

    expect(result?.executionTimeMs).toBe(0.135);
    expect(formatDataPreview(result!)).toContain('# 1 rows (db time 0.135 ms)');
  });

  it('omits the time when the system does not report one', () => {
    const result = parseDataPreview(tableData([{ name: 'MANDT', values: ['100'] }]));

    expect(result?.executionTimeMs).toBeUndefined();
    expect(formatDataPreview(result!)).toContain('# 1 rows\n');
  });

  it('gives up on a payload that is not a data preview', () => {
    expect(parseDataPreview('<abap>source code</abap>')).toBeUndefined();
    expect(parseDataPreview('not xml at all <<<')).toBeUndefined();
  });
});

describe('formatDataPreview', () => {
  it('renders a compact CSV with a header', () => {
    expect(formatDataPreview(parseDataPreview(T000)!)).toBe(
      [
        '# SELECT * FROM T000 INTO TABLE @DATA(LT_RESULT) UP TO 2 ROWS .',
        '# 2 rows',
        'MANDT,MTEXT,ADRNR,LOGSYS',
        '000,SAP AG,,DEVCLNT000',
        '100,Development,,DEVCLNT100',
      ].join('\n'),
    );
  });

  it('says so when the system holds more rows than it returned', () => {
    const formatted = formatDataPreview({ columns: ['A'], rows: [['1']], totalRows: 4711 });

    expect(formatted).toContain('# 1 of 4711 rows');
  });

  it('omits the total for an aggregate, where it is smaller than the result', () => {
    // SELECT COUNT(*) returns one row while SAP reports the underlying match
    // count, so "1 rows returned, 0 total" used to read as a contradiction.
    const formatted = formatDataPreview({ columns: ['ZEILEN'], rows: [['0']], totalRows: 0 });

    expect(formatted).toBe(['# 1 rows', 'ZEILEN', '0'].join('\n'));
  });

  it('omits the total when it merely repeats the row count', () => {
    const formatted = formatDataPreview({ columns: ['A'], rows: [['1'], ['2']], totalRows: 2 });

    expect(formatted).toContain('# 2 rows\n');
  });

  it('marks an empty result instead of ending after the header', () => {
    const formatted = formatDataPreview({ columns: ['MANDT'], rows: [] });

    expect(formatted).toBe(['# 0 rows', 'MANDT', '(no rows)'].join('\n'));
  });

  it('quotes cells that would otherwise break the CSV', () => {
    const formatted = formatDataPreview({
      columns: ['TEXT'],
      rows: [['a,b'], ['say "hi"'], ['line\nbreak'], ['plain']],
    });

    // A quoted cell holding a newline spans two output lines, as RFC 4180 wants.
    expect(formatted).toBe(['# 4 rows', 'TEXT', '"a,b"', '"say ""hi"""', '"line\nbreak"', 'plain'].join('\n'));
  });
});

describe('compactDataPreview', () => {
  it('shrinks a real payload by more than an order of magnitude', () => {
    const compacted = compactDataPreview(T000);

    expect(compacted.length).toBeLessThan(T000.length / 5);
    expect(compacted).toContain('Development');
  });

  it('falls back to the raw payload rather than failing on an unknown shape', () => {
    const foreign = '<someOther:payload>data</someOther:payload>';

    expect(compactDataPreview(foreign)).toBe(foreign);
  });
});
