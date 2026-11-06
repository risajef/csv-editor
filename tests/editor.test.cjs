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
  assert.match(worksheet, /<t xml:space="preserve">2999<\/t>/);
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

test('CSV lexer diagnoses malformed quoting and preserves explicit empty records', () => {
  const app = harness();
  for (const [input, expected] of [
    ['h\n""', [['h'],['']]], ['h\n\n', [['h'],['']]], ['', []], ['\n', [['']]],
    ['a,b\r\n1,"a\r\nb"\r\n', [['a','b'],['1','a\r\nb']]],
  ]) {
    assert.deepEqual(app.json(`parseCsv(${JSON.stringify(input)}, ',')`), expected);
  }
  for (const invalid of ['a,b\n1,"two', 'a,b\n1,ab"c', 'a,b\n1,"x"junk']) {
    assert.throws(() => app.run(`parseCsv(${JSON.stringify(invalid)}, ',')`), /character/);
    app.run(`loadText('original')`);
    assert.equal(app.run(`loadText(${JSON.stringify(invalid)})`), false);
    assert.deepEqual(app.json('state.rows'), [['original']]);
  }
  for (const separator of [',',';','\t','|']) {
    const rows = [['a','b'],['x\ny','"quoted"'],['',''],['']];
    assert.deepEqual(app.json(`parseCsv(toCsv(${JSON.stringify(rows)},${JSON.stringify(separator)}),${JSON.stringify(separator)})`), rows);
  }
  assert.equal(app.run(String.raw`detectSeparator('a;b\n"x\n,y";z')`), ';');
  assert.deepEqual(app.json(String.raw`parseCsv('\uFEFFa;b\n"x;y";"a""b"',';')`), [['a','b'],['x;y','a"b']]);
});

test('regex matching is isolated, export waits, and stale workers are cancelled', () => {
  const workers = [];
  class Worker {
    constructor() { workers.push(this); }
    postMessage(data) { this.data = data; }
    terminate() { this.terminated = true; }
  }
  const app = harness({ Worker, URL });
  app.run(String.raw`document.baseURI='http://localhost/';loadText('v\nabc\nxyz');state.filters=[{id:'r',enabled:true,column:0,operator:'regex',value:'^a'}];renderTable()`);
  assert.equal(workers.length, 1);
  assert.throws(() => app.run('currentViewCsv()'), /Wait for regex/);
  assert.equal(app.run('els.downloadView.disabled'), true);
  workers[0].onmessage({data:{matches:[{id:'r',indices:[1]}]}});
  assert.equal(app.run('currentViewCsv()'), 'v\nabc');
  app.run(`setFilter('r',{value:'^x'})`);
  assert.equal(workers[0].terminated, true);
  workers[0].onmessage({data:{matches:[{id:'r',indices:[1]}]}});
  assert.throws(() => app.run('currentViewCsv()'), /Wait for regex/);
  workers[1].onmessage({data:{error:'Invalid regex: example'}});
  assert.match(app.run('els.operation.textContent'), /Invalid regex/);
  assert.throws(() => app.run('currentViewCsv()'), /Invalid regex/);
  app.run(`setFilter('r',{enabled:false})`);
  assert.equal(app.run('currentViewCsv()'), 'v\nabc\nxyz');
});

test('regex timeout terminates work and syntax failures are explicit', () => {
  const workers = [], timers = [];
  class Worker { constructor() { workers.push(this); } postMessage() {} terminate() { this.terminated = true; } }
  const app = harness({ Worker, URL, setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout() {} });
  app.run(String.raw`document.baseURI='http://localhost/';loadText('v\nabc');state.filters=[{id:'r',enabled:true,column:0,operator:'regex',value:'^(a+)+$'}];renderTable()`);
  timers.at(-1)();
  assert.equal(workers[0].terminated, true);
  assert.match(app.run('els.operation.textContent'), /1 second/);
  assert.throws(() => app.run('currentViewCsv()'), /1 second/);
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  let response;
  const self = { postMessage: value => { response = value; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../regex-worker.js'),'utf8'), { self });
  self.onmessage({data:{filters:[{id:'r',pattern:'[',values:['abc']}]}});
  assert.match(response.error, /Invalid regex/);
  self.onmessage({data:{filters:[{id:'r',pattern:'^a',values:['abc','xyz']}]}});
  assert.deepEqual(JSON.parse(JSON.stringify(response.matches)), [{id:'r',indices:[1]}]);
});

test('XLSX rejects unsupported characters with a cell address and preserves text', () => {
  const app = harness();
  for (const value of ['x\u0001y', '\uD800', '\uFFFF', 'x'.repeat(32768)]) {
    assert.throws(() => app.run(`createXlsx([['h'],[${JSON.stringify(value)}]])`), /Cell A2/);
  }
  const xml = app.run(String.raw`worksheetXml([[' a\r\n b & < 😀 _x0041_']])`);
  assert.match(xml, /xml:space="preserve"/);
  assert.match(xml, /&#13;\n/);
  assert.match(xml, /&amp; &lt; 😀 _x005F_x0041_/);
  app.run(String.raw`state.rows=[['h'],['bad\u0001']];downloadXlsx()`);
  assert.match(app.run('els.operation.textContent'), /Cell A2/);
});

test('numeric comparisons skip missing operands and sort blanks last in either direction', () => {
  const app = harness();
  app.run(`state.filters=[{enabled:true,column:0,operator:'gt',value:'-1'}]`);
  for (const value of ['', ' ', undefined, 'text']) assert.equal(app.run(`rowPassesFilters([${JSON.stringify(value)}])`), false);
  assert.equal(app.run(`rowPassesFilters(['0'])`), true);
  app.run(`state.filters[0].value=''`);
  assert.equal(app.run(`rowPassesFilters(['1'])`), false);
  app.run(`state.rows=[['n'],[''],['2'],['1']];state.filters=[];state.sort={column:0,direction:'asc'}`);
  assert.deepEqual(app.json('viewDataRowsOnly()'), [['n'],['1'],['2'],['']]);
  app.run(`state.sort.direction='desc'`);
  assert.deepEqual(app.json('viewDataRowsOnly()'), [['n'],['2'],['1'],['']]);
});
