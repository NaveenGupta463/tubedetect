const _marks    = new Map();
const _measures = new Map();

export function perfMark(label) {
  _marks.set(label, performance.now());
}

export function perfMeasure(label) {
  const start = _marks.get(label);
  if (start == null) return null;
  const ms = +(performance.now() - start).toFixed(2);
  _marks.delete(label);
  _measures.set(label, ms);
  return ms;
}

export function getPerfReport() {
  return Object.fromEntries(_measures);
}

export function clearPerf() {
  _marks.clear();
  _measures.clear();
}
