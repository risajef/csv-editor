// Optional browser checks: install Puppeteer in the checkout or a parent directory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
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
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-editor-browser-'));
  async function downloaded(name) {
    const filename = path.join(artifacts, name);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (fs.existsSync(filename) && !fs.existsSync(`${filename}.crdownload`)) return fs.readFileSync(filename);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Download did not complete: ${name}`);
  }
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior:'allow', downloadPath:artifacts });
    const errors = [];
    const assetFailures = [];
    page.on("response", response => {
      if (response.status() >= 400 && ["document", "script", "stylesheet"].includes(response.request().resourceType())) assetFailures.push(response.url());
    });
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

    await page.evaluate(() => loadText('id,status\n1,ok\n2,bad'));
    await page.click('#add-filter');
    await page.focus('[data-filter-field="column"]');
    await page.select('[data-filter-field="column"]', '1');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.filterField), 'column');
    await page.type('[data-filter-field="value"]', 'ok');
    assert.equal(await page.evaluate(() => currentViewCsv()), 'id,status\n1,ok');
    await page.click('[data-filter-field="enabled"]');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.filterField), 'enabled');
    assert.equal(await page.evaluate(() => currentViewCsv()), 'id,status\n1,ok\n2,bad');
    await page.click('[aria-label="Delete filter on status"]');
    assert.equal(await page.$eval('#filters-list', element => element.textContent), 'No filters enabled.');

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
    // Native file input, UI filters/sort, pagination and actual downloads.
    const fixture = path.join(artifacts,'input.csv');
    fs.writeFileSync(fixture, 'id,status\n' + Array.from({length:205}, (_,i) => `${i+1},${(i+1)%2 === 0 ? 'ok' : 'bad'}`).join('\n'));
    await (await page.$('#file-input')).uploadFile(fixture);
    await page.waitForFunction(() => state.rows.length === 206);
    await page.click('#add-filter');
    await page.select('[data-filter-field="column"]','1');
    await page.type('[data-filter-field="value"]','ok');
    await page.click('[aria-label="Sort by id"]');
    await page.click('[aria-label="Sort by id"]');
    await page.click('#next-page');
    assert.equal(await page.evaluate(() => state.page), 1);
    assert.equal(await page.$$eval('tbody tr', rows => rows.length), 3); // header + 2 page rows
    await page.click('#download-view');
    const csv = (await downloaded('ideo-view.csv')).toString();
    assert.equal(csv.split('\n').length, 103);
    assert.ok(csv.startsWith('id,status\n204,ok\n') && csv.endsWith('2,ok'));
    assert.equal(await page.evaluate(() => state.dirty), true, 'Filtered download must retain the unsaved-document guard.');

    await page.evaluate(() => loadText('value\n' + Array.from({length:3000}, (_,i)=>String(i)).join('\n')));
    await page.click('#download-xlsx');
    const xlsx = await downloaded('ideo-view.xlsx');
    assert.equal(xlsx.readUInt32LE(0), 0x04034b50);
    assert.ok(xlsx.length > 200000);
    assert.equal(await page.evaluate(() => state.dirty), false);
    await page.evaluate(() => saveDraft());
    await page.reload();
    assert.equal(await page.evaluate(() => state.rows.length), 0);
    await page.click('#restore-draft');
    assert.equal(await page.evaluate(() => state.rows.length), 3001);
    assert.equal(await page.evaluate(() => state.rows[3000][0]), '2999');

    await page.setViewport({width:390, height:844, isMobile:true, hasTouch:true});
    await page.evaluate(() => loadText('a,b\n1,2'));
    const handle = await page.$('[data-resize-column="0"]');
    const bounds = await handle.boundingBox();
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    const initialWidth = await page.evaluate(() => colWidth(0));
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:x+30,y}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    assert.ok(await page.evaluate(() => colWidth(0)) > initialWidth);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

    assert.deepEqual(errors, []);
    assert.deepEqual(assetFailures, [], "Standalone app assets must load without the parent site.");
    console.log(`Browser smoke passed: file import, edit/click/Tab/filter focus, keyboard/touch controls, paginated CSV/XLSX downloads, draft reload, regex cancellation (${await browser.version()}).`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(artifacts, {recursive:true, force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
