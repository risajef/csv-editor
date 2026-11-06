const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('standalone HTML uses only shipped local assets in dependency order', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  for (const reference of references) {
    assert.ok(!reference.includes('..') && !reference.includes('://'), reference);
    assert.ok(fs.existsSync(path.join(root,reference)), reference);
  }
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('csv.js') < scripts.indexOf('app.js'));
  assert.ok(scripts.indexOf('document.js') < scripts.indexOf('app.js'));
  for (const file of ['view.js', 'export.js']) assert.ok(scripts.indexOf(file) >= 0 && scripts.indexOf(file) < scripts.indexOf('app.js'));
  assert.ok(fs.existsSync(path.join(root,'regex-worker.js')));
});
