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
