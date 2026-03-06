/* ──────────────────────────────────────
   JSON utility functions
   - Path resolution
   - Statistics computation
   - Flattening
   - JSONPath query
   ────────────────────────────────────── */

export interface JsonStats {
  totalKeys: number;
  maxDepth: number;
  typeCounts: Record<string, number>;
  sizeBytes: number;
  nodeCount: number;
  arrayCount: number;
  objectCount: number;
}

export interface FlatEntry {
  path: string;
  value: string;
  type: string;
}

export function getJsonPath(path: (string | number)[]): string {
  let result = "$";
  for (const seg of path) {
    if (typeof seg === "number") {
      result += `[${seg}]`;
    } else if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(seg)) {
      result += `.${seg}`;
    } else {
      result += `["${seg.replace(/"/g, '\\"')}"]`;
    }
  }
  return result;
}

export function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function computeStats(data: unknown, raw: string): JsonStats {
  const stats: JsonStats = {
    totalKeys: 0,
    maxDepth: 0,
    typeCounts: { string: 0, number: 0, boolean: 0, null: 0, array: 0, object: 0 },
    sizeBytes: new TextEncoder().encode(raw).length,
    nodeCount: 0,
    arrayCount: 0,
    objectCount: 0,
  };

  function walk(val: unknown, depth: number): void {
    stats.nodeCount++;
    if (depth > stats.maxDepth) stats.maxDepth = depth;
    const t = getValueType(val);
    stats.typeCounts[t] = (stats.typeCounts[t] ?? 0) + 1;

    if (Array.isArray(val)) {
      stats.arrayCount++;
      for (const item of val) {
        walk(item, depth + 1);
      }
    } else if (val !== null && typeof val === "object") {
      stats.objectCount++;
      const keys = Object.keys(val as Record<string, unknown>);
      stats.totalKeys += keys.length;
      for (const k of keys) {
        walk((val as Record<string, unknown>)[k], depth + 1);
      }
    }
  }

  walk(data, 0);
  return stats;
}

export function flattenJson(data: unknown): FlatEntry[] {
  const entries: FlatEntry[] = [];

  function walk(val: unknown, path: (string | number)[]): void {
    const t = getValueType(val);
    if (Array.isArray(val)) {
      if (val.length === 0) {
        entries.push({ path: getJsonPath(path), value: "[]", type: "array" });
      }
      for (let i = 0; i < val.length; i++) {
        walk(val[i], [...path, i]);
      }
    } else if (val !== null && typeof val === "object") {
      const keys = Object.keys(val as Record<string, unknown>);
      if (keys.length === 0) {
        entries.push({ path: getJsonPath(path), value: "{}", type: "object" });
      }
      for (const k of keys) {
        walk((val as Record<string, unknown>)[k], [...path, k]);
      }
    } else {
      entries.push({
        path: getJsonPath(path),
        value: val === null ? "null" : String(val),
        type: t,
      });
    }
  }

  walk(data, []);
  return entries;
}

export function queryJsonPath(data: unknown, expression: string): { path: string; value: unknown }[] {
  const results: { path: string; value: unknown }[] = [];
  const trimmed = expression.trim();

  if (!trimmed || trimmed === "$") {
    results.push({ path: "$", value: data });
    return results;
  }

  // Parse simple JSONPath expressions: $.key.sub[0].name, $..key (recursive descent)
  const isRecursive = trimmed.includes("..");

  if (isRecursive) {
    const keyMatch = trimmed.match(/\.\.\s*([a-zA-Z_$][a-zA-Z0-9_$]*|\*)$/);
    if (!keyMatch) return results;
    const searchKey = keyMatch[1];

    function recurse(val: unknown, path: (string | number)[]): void {
      if (val === null || typeof val !== "object") return;
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          if (searchKey === "*") {
            results.push({ path: getJsonPath([...path, i]), value: val[i] });
          }
          recurse(val[i], [...path, i]);
        }
      } else {
        const obj = val as Record<string, unknown>;
        for (const k of Object.keys(obj)) {
          if (searchKey === "*" || k === searchKey) {
            results.push({ path: getJsonPath([...path, k]), value: obj[k] });
          }
          recurse(obj[k], [...path, k]);
        }
      }
    }

    recurse(data, []);
    return results;
  }

  // Simple path traversal: $.users[0].name
  const segments = parsePathSegments(trimmed);
  if (!segments) return results;

  function traverse(val: unknown, segIdx: number, path: (string | number)[]): void {
    if (segIdx >= segments!.length) {
      results.push({ path: getJsonPath(path), value: val });
      return;
    }
    const seg = segments![segIdx];
    if (seg === "*") {
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) {
          traverse(val[i], segIdx + 1, [...path, i]);
        }
      } else if (val !== null && typeof val === "object") {
        for (const k of Object.keys(val as Record<string, unknown>)) {
          traverse((val as Record<string, unknown>)[k], segIdx + 1, [...path, k]);
        }
      }
    } else if (typeof seg === "number") {
      if (Array.isArray(val) && seg >= 0 && seg < val.length) {
        traverse(val[seg], segIdx + 1, [...path, seg]);
      }
    } else {
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        const obj = val as Record<string, unknown>;
        if (seg in obj) {
          traverse(obj[seg], segIdx + 1, [...path, seg]);
        }
      }
    }
  }

  traverse(data, 0, []);
  return results;
}

function parsePathSegments(expr: string): (string | number)[] | null {
  const segments: (string | number)[] = [];
  let rest = expr.startsWith("$") ? expr.slice(1) : expr;

  while (rest.length > 0) {
    if (rest.startsWith(".")) {
      rest = rest.slice(1);
      const m = rest.match(/^([a-zA-Z_$*][a-zA-Z0-9_$]*)/);
      if (m) {
        segments.push(m[1]);
        rest = rest.slice(m[1].length);
      } else {
        return null;
      }
    } else if (rest.startsWith("[")) {
      const end = rest.indexOf("]");
      if (end === -1) return null;
      const inner = rest.slice(1, end).trim();
      if (/^\d+$/.test(inner)) {
        segments.push(parseInt(inner, 10));
      } else if (inner.startsWith('"') && inner.endsWith('"')) {
        segments.push(inner.slice(1, -1));
      } else if (inner.startsWith("'") && inner.endsWith("'")) {
        segments.push(inner.slice(1, -1));
      } else if (inner === "*") {
        segments.push("*");
      } else {
        return null;
      }
      rest = rest.slice(end + 1);
    } else {
      return null;
    }
  }

  return segments;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
