// Generate a representative workbook for independent ZIP/XML and reader checks.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
if (!process.argv[2]) throw new Error('Usage: node tests/workbook-fixture.cjs OUTPUT.xlsx');
const context = vm.createContext({ TextEncoder, Uint8Array });
vm.runInContext(fs.readFileSync(path.join(__dirname,'../export.js'),'utf8'), context);
const bytes = vm.runInContext(`TableExport.createXlsx([
  ['id','text'],
  ['00001',' a\\r\\nb & < 😀 '],
  ['=1+1','literal _x0041_'],
  ...Array.from({length:3000},(_,index)=>[String(index), 'value '+index])
])`,context);
fs.writeFileSync(process.argv[2],bytes);
console.log(`Wrote ${bytes.length} bytes to ${process.argv[2]}`);
