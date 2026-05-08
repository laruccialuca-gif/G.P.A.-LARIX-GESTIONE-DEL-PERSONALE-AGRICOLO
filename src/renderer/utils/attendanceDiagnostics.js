function ensureStore() {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!window.__attendanceDiag) {
    window.__attendanceDiag = {
      createdAt: new Date().toISOString(),
      counters: {},
      timings: {},
      values: {},
      events: [],
    };
  }

  return window.__attendanceDiag;
}

export function resetAttendanceDiag() {
  if (typeof window === 'undefined') {
    return;
  }

  window.__attendanceDiag = {
    createdAt: new Date().toISOString(),
    counters: {},
    timings: {},
    values: {},
    events: [],
  };
}

export function countAttendanceDiag(name, details = undefined) {
  const store = ensureStore();
  if (!store) {
    return 0;
  }

  const nextValue = (store.counters[name] || 0) + 1;
  store.counters[name] = nextValue;
  if (details) {
    store.events.push({
      type: 'count',
      name,
      at: new Date().toISOString(),
      details,
    });
  }
  return nextValue;
}

export function recordAttendanceTiming(name, durationMs, details = undefined) {
  const store = ensureStore();
  if (!store) {
    return;
  }

  const current = store.timings[name] || {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    minMs: null,
    lastMs: 0,
    slowCount: 0,
    slowSamples: [],
  };

  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  current.minMs = current.minMs === null ? durationMs : Math.min(current.minMs, durationMs);
  current.lastMs = durationMs;
  if (durationMs > 100) {
    current.slowCount += 1;
    if (current.slowSamples.length < 25) {
      current.slowSamples.push({
        ms: Math.round(durationMs * 100) / 100,
        details: details || null,
      });
    }
  }

  store.timings[name] = current;
}

export function setAttendanceDiagValue(name, value) {
  const store = ensureStore();
  if (!store) {
    return;
  }

  store.values[name] = value;
}

export function getAttendanceDiagSnapshot() {
  const store = ensureStore();
  return store ? JSON.parse(JSON.stringify(store)) : null;
}
