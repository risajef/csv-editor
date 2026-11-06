const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./harness.cjs');

test('import preserves incomplete records and reports their shape', () => {
  const app = harness();
  app.run(String.raw`loadText('a,b\n1,2\n3')`);
  assert.deepEqual(app.json('state.rows'), [['a','b'],['1','2'],['3']]);
  assert.match(app.run('validationMessage().text'), /Length mismatch/);
  assert.deepEqual(app.json(String.raw`parseCsv('a,b\n3', ',')`), [['a','b'],['3']]);
});

test('column insertion, deletion and movement preserve filter and sort identity', () => {
  const app = harness();
  app.run(String.raw`loadText('id,status\n1,ok\n2,bad'); state.filters=[{id:'f',enabled:true,column:1,operator:'equals',value:'ok'}]; state.sort={column:1,direction:'asc'}; insertColumn(1)`);
  assert.equal(app.run('state.filters[0].column'), 2);
  assert.equal(app.run('state.sort.column'), 2);
  assert.deepEqual(app.json('viewDataRowsOnly()[1]'), ['1','','ok']);
  app.run('deleteColumn(0)');
  assert.equal(app.run('state.filters[0].column'), 1);
  app.run('reorderColumn(1,0)');
  assert.equal(app.run('state.filters[0].column'), 0);
  assert.equal(app.run('state.sort.column'), 0);
  assert.deepEqual(app.json('viewDataRowsOnly()[1]'), ['ok','']);
  app.run('deleteColumn(0)');
  assert.equal(app.run('state.filters.length'), 0);
  assert.equal(app.run('state.sort'), null);
});

test('ragged rows keep cells in their columns through movement and insertion', () => {
  const app = harness();
  app.run(String.raw`loadText('a,b,c\nA,B'); reorderColumn(2,0)`);
  assert.deepEqual(app.json('state.rows'), [['c','a','b'],['','A','B']]);
  app.run(String.raw`loadText('a,b,c\nA'); insertColumn(2)`);
  assert.deepEqual(app.json('state.rows[1]'), ['A','','']);
  app.run('deleteColumn(0)');
  assert.deepEqual(app.json('state.rows[1]'), ['','']);
  app.run('transpose()');
  assert.deepEqual(app.json('state.rows'), [['b',''],['',''],['c','']]);
});

test('large exports avoid argument limits and preserve valid ZIP entries', () => {
  const app = harness();
  const bytes = app.run(`createXlsx(Array.from({length:3000},(_,i)=>[String(i)]))`);
  const buffer = Buffer.from(bytes);
  let offset = 0;
  let worksheet;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameSize = buffer.readUInt16LE(offset + 26);
    const name = buffer.subarray(offset + 30, offset + 30 + nameSize).toString();
    const data = buffer.subarray(offset + 30 + nameSize, offset + 30 + nameSize + size);
    if (name === 'xl/worksheets/sheet1.xml') worksheet = data.toString();
    offset += 30 + nameSize + size;
  }
  assert.equal((worksheet.match(/<row /g) || []).length, 3000);
  assert.match(worksheet, /<t>2999<\/t>/);
  app.run(`state.rows=Array.from({length:150000},()=>['x','y'])`);
  assert.equal(app.run('maxColumns()'), 2);
  assert.ok(app.run('currentViewMarkdown().endsWith("| x | y |")'));
});

test('table scans are linear and pagination bounds rendered cells, not export', () => {
  const app = harness();
  const visits = size => app.run(`state.rows=Array.from({length:${size}},()=>Array(5).fill('x')); state.filters=[];state.sort=null; var originalMax=maxColumns;var scans=0;maxColumns=()=>{scans+=state.rows.length;return originalMax();};renderTable();maxColumns=originalMax;scans`);
  const small = visits(100);
  const large = visits(200);
  assert.ok(large <= small * 2.1, `${small} → ${large}`);
  assert.equal(app.run('els.tableWrap.children[0].children[2].children.length'), 101);
  assert.equal(app.run('viewDataRowsOnly().length'), 200);
  app.run('state.page=1;renderTable()');
  assert.equal(app.run('els.tableWrap.children[0].children[2].children.length'), 100);
});

test('oversized imports preserve the current document and show a useful error', () => {
  const app = harness(); app.run(`loadText('id,value')`);
  assert.equal(app.run(`loadText('x'.repeat(LIMITS.text+1))`), false);
  assert.match(app.run('els.operation.textContent'), /5 MiB/);
  assert.deepEqual(app.json('state.rows'), [['id','value']]);
  assert.equal(app.run(`loadText(Array(502).fill('x').join(','))`), false);
  assert.match(app.run('els.operation.textContent'), /500 columns/);
});
