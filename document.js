/* Bounded snapshots for reversible document commands. No browser dependencies. */
globalThis.DocumentHistory = class DocumentHistory {
  constructor(limit = 32, budget = 32 * 1024 * 1024) { this.limit = limit; this.budget = budget; this.past = []; this.future = []; }
  trim(stack) {
    let size = stack.reduce((sum, entry) => sum + entry.length * 2, 0);
    while (stack.length > 1 && (stack.length > this.limit || size > this.budget)) size -= stack.shift().length * 2;
  }
  remember(snapshot) { this.past.push(snapshot); this.trim(this.past); this.future = []; }
  undo(current) { if (!this.past.length) return null; this.future.push(current); this.trim(this.future); return this.past.pop(); }
  redo(current) { if (!this.future.length) return null; this.past.push(current); this.trim(this.past); return this.future.pop(); }
};
