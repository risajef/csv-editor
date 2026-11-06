// Optional browser checks: install Puppeteer in the checkout or a parent directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const root = path.resolve(__dirname, '..');

(async () => {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const filename = path.resolve(root, `.${relative}`);
    if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end(); return; }
    try {
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(filename)] || 'application/octet-stream';
      response.setHeader('Content-Type', type);
      response.end(fs.readFileSync(filename));
    } catch { response.writeHead(404); response.end(); }
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    await page.click('#sample-data');
    assert.match(await page.$eval('#table-stats', element => element.textContent), /5\/5 data rows/);
    await page.focus('[data-column-handle="0"]');
    await page.keyboard.down('Alt'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Alt');
    assert.deepEqual(await page.evaluate(() => state.rows[0].slice(0, 2)), ['status', 'name']);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.columnHandle), '1');
    await page.focus('[data-resize-column="0"]');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.$eval('[data-resize-column="0"]', element => element.getAttribute('aria-valuenow')), '170');

    await page.evaluate(() => loadText('a,b\n1,2\n3,4'));
    await page.focus('[data-cell="1:0"]');
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await page.keyboard.type('changed');
    await page.click('[aria-label="Delete row 2"]');
    assert.deepEqual(await page.evaluate(() => state.rows), [['a','b'],['3','4']]);
    await page.click('#undo');
    assert.deepEqual(await page.evaluate(() => state.rows[1]), ['changed','2']);
    await page.focus('[data-cell="1:0"]');
    await page.keyboard.type('x'); await page.keyboard.press('Tab');
    await page.waitForFunction(() => !editRefreshPending);
    assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), '1:1');
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), '1:0');

    await page.evaluate(() => {
      loadText('v\nabc\nxyz');
      state.filters = [{id:'regex', enabled:true, column:0, operator:'regex', value:'^a'}];
      render();
    });
    await page.waitForFunction(() => !regexPending);
    assert.equal(await page.evaluate(() => currentViewCsv()), 'v\nabc');
    await page.evaluate(() => setFilter('regex', {value:'['}));
    await page.waitForFunction(() => !!regexError);
    assert.match(await page.$eval('#operation-status', element => element.textContent), /Invalid regex/);
    await page.evaluate(() => {
      loadText(`v\n${'a'.repeat(30)}!`);
      state.filters = [{id:'regex', enabled:true, column:0, operator:'regex', value:'^(a+)+$'}];
      render();
    });
    // The main thread can still service input while the worker is occupied.
    assert.equal(await page.evaluate(() => 2 + 2), 4);
    await page.waitForFunction(() => regexError.includes('1 second'), {timeout:5000});
    await page.evaluate(() => setFilter('regex', {enabled:false}));
    assert.equal(await page.$eval('#download-view', element => element.disabled), false);
    assert.deepEqual(errors, []);
    console.log(`Browser smoke passed: edit/click, Tab focus, keyboard move/resize, undo, regex results/errors/timeout (${await browser.version()}).`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
