function normalize(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = normalize(value[key]);
        return out;
      }, {});
  }
  return value;
}

export function sameValue(a, b) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function buildDirtyPayload(current, original = {}) {
  return Object.entries(current || {}).reduce((payload, [key, value]) => {
    if (value === undefined) return payload;
    if (!sameValue(value, original?.[key])) payload[key] = value;
    return payload;
  }, {});
}

export function hasPayloadChanges(payload) {
  return Object.keys(payload || {}).length > 0;
}
