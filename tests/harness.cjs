const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.events = {};
    this.classList = { add() {}, remove() {} }; this.clientWidth = 900; this.value = '';
  }
  set innerHTML(value) { this.children = []; }
  append(...children) { this.children.push(...children); }
  addEventListener(name, callback) { this.events[name] = callback; }
  removeEventListener() {}
  setAttribute(name, value) { this[name] = value; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  remove() {} focus() {} select() {} click() {}
}
function harness(extra = {}) {
  const elements = new Map();
  const context = vm.createContext({
    document: {
      querySelector(selector) { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); },
      createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag),
      addEventListener() {}, removeEventListener() {}, body: new Element('body'),
    },
    window: { addEventListener() {} }, TextEncoder, Uint8Array, Blob, console,
    setTimeout, clearTimeout, requestAnimationFrame: callback => callback(), ...extra,
  });
  for (const file of ['csv.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { context, elements, run: code => vm.runInContext(code, context), json: code => JSON.parse(JSON.stringify(vm.runInContext(code, context))) };
}
module.exports = { harness, Element };
