/* Matching runs only in this disposable worker, never on the UI thread. */
self.onmessage = ({ data }) => {
  try {
    const matches = data.filters.map(filter => {
      if (filter.pattern.length > 1000) throw new Error('Regex limit: 1,000 characters.');
      const regex = new RegExp(filter.pattern);
      return { id: filter.id, indices: filter.values.flatMap((value, index) => regex.test(value) ? [index + 1] : []) };
    });
    self.postMessage({ matches });
  } catch (error) { self.postMessage({ error: `Invalid regex: ${error.message}` }); }
};
