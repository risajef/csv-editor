const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function core() {
  const context = vm.createContext({ TextEncoder, Uint8Array });
  for (const file of ['csv.js', 'document.js', 'view.js', 'export.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return code => vm.runInContext(code, context);
}

test('document commands, projection and export work without browser globals', () => {
  const run = core();
  run(String.raw`var doc={rows:Csv.parseCsv('id,status\n1,ok\n2,bad',','),filters:[{id:'f',column:1,enabled:true,operator:'equals',value:'ok'}],sort:{column:1,direction:'asc'},colWidths:[160,160]};DocumentModel.insertColumn(doc,1)`);
  assert.equal(run('doc.filters[0].column'), 2);
  assert.equal(run('doc.sort.column'), 2);
  assert.equal(run(`Csv.toCsv(TableView.viewRows(doc.rows,doc.filters,doc.sort).map(item=>item.row),',')`), 'id,,status\n1,,ok');
  run('DocumentModel.reorderColumn(doc,2,0)');
  assert.equal(run(`Csv.toCsv(TableView.viewRows(doc.rows,doc.filters,doc.sort).map(item=>item.row),',')`), 'status,id,\nok,1,');
  assert.match(run('TableExport.toMarkdown(doc.rows)'), /\| status \| id \|  \|/);
  assert.ok(run('TableExport.createXlsx(doc.rows).length') > 2000);
});

test('history truncates older snapshots within its configured bounds', () => {
  const run = core();
  run(`var history=new DocumentHistory(3,12);for(const s of ['aa','bb','cc','dd'])history.remember(s)`);
  assert.equal(run('history.past.length'), 3);
  assert.equal(run(`history.undo('ee')`), 'dd');
  assert.equal(run(`history.redo('cc')`), 'ee');
  run(`history.remember('a large snapshot beyond budget')`);
  assert.equal(run('history.past.length'), 1);
  assert.equal(run('history.future.length'), 0);
});
