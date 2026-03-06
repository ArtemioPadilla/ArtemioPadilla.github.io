import { useState, useCallback, useRef, useMemo } from "preact/hooks";
import type { JSX } from "preact";
import {
  getJsonPath,
  getValueType,
  computeStats,
  flattenJson,
  queryJsonPath,
  formatBytes,
} from "./json-utils";
import type { JsonStats, FlatEntry } from "./json-utils";
import { PRESETS } from "./presets";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

type ViewTab = "tree" | "table" | "code";

interface ParseResult {
  data: unknown;
  error: string | null;
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  string: "#34d399",
  number: "#60a5fa",
  boolean: "#fb923c",
  null: "#9ca3af",
  array: "#c084fc",
  object: "#fbbf24",
};

/* ──────────────────────────────────────
   Helpers
   ────────────────────────────────────── */

function tryParseJson(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { data: null, error: null };
  try {
    return { data: JSON.parse(trimmed), error: null };
  } catch (e: unknown) {
    const msg = e instanceof SyntaxError ? e.message : "Invalid JSON";
    return { data: null, error: msg };
  }
}

function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("Clipboard not available"));
}

function truncateValue(val: string, max: number): string {
  return val.length > max ? val.slice(0, max) + "..." : val;
}

/* ──────────────────────────────────────
   Main component
   ────────────────────────────────────── */

export default function JsonVisualizer(): JSX.Element {
  const [rawInput, setRawInput] = useState(PRESETS[0].json);
  const [activeTab, setActiveTab] = useState<ViewTab>("tree");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["$"]));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [jsonPathExpr, setJsonPathExpr] = useState("");
  const [tableFilter, setTableFilter] = useState("");
  const [tableSortAsc, setTableSortAsc] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsed = useMemo<ParseResult>(() => tryParseJson(rawInput), [rawInput]);

  const stats = useMemo<JsonStats | null>(() => {
    if (parsed.data == null) return null;
    return computeStats(parsed.data, rawInput);
  }, [parsed.data, rawInput]);

  const flatEntries = useMemo<FlatEntry[]>(() => {
    if (parsed.data == null) return [];
    return flattenJson(parsed.data);
  }, [parsed.data]);

  const jsonPathResults = useMemo(() => {
    if (!jsonPathExpr.trim() || parsed.data == null) return [];
    return queryJsonPath(parsed.data, jsonPathExpr);
  }, [jsonPathExpr, parsed.data]);

  const handleCopy = useCallback((text: string, label: string) => {
    copyText(text)
      .then(() => {
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        setCopyFeedback(label);
        copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 2000);
      })
      .catch(() => {});
  }, []);

  const handleFormat = useCallback(() => {
    if (parsed.data != null) {
      setRawInput(JSON.stringify(parsed.data, null, 2));
    }
  }, [parsed.data]);

  const handleMinify = useCallback(() => {
    if (parsed.data != null) {
      setRawInput(JSON.stringify(parsed.data));
    }
  }, [parsed.data]);

  const loadPreset = useCallback((e: JSX.TargetedEvent<HTMLSelectElement>) => {
    const idx = parseInt(e.currentTarget.value, 10);
    if (isNaN(idx) || idx < 0) return;
    setRawInput(PRESETS[idx].json);
    setExpanded(new Set(["$"]));
    setSelectedPath(null);
    setJsonPathExpr("");
    setTableFilter("");
  }, []);

  const toggleNode = useCallback((pathStr: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pathStr)) next.delete(pathStr);
      else next.add(pathStr);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (parsed.data == null) return;
    const all = new Set<string>();
    function walk(val: unknown, path: (string | number)[]): void {
      all.add(getJsonPath(path));
      if (Array.isArray(val)) {
        for (let i = 0; i < val.length; i++) walk(val[i], [...path, i]);
      } else if (val !== null && typeof val === "object") {
        for (const k of Object.keys(val as Record<string, unknown>))
          walk((val as Record<string, unknown>)[k], [...path, k]);
      }
    }
    walk(parsed.data, []);
    setExpanded(all);
  }, [parsed.data]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set(["$"]));
  }, []);

  const tabs: { key: ViewTab; label: string }[] = [
    { key: "tree", label: "Tree" },
    { key: "table", label: "Table" },
    { key: "code", label: "Code" },
  ];

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">JSON Visualizer</span>
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{ borderColor: "rgba(79, 143, 247, 0.3)", color: "var(--color-primary)" }}
          >
            beta
          </span>
        </div>
        {copyFeedback && (
          <span class="text-[10px] font-medium" style={{ color: "var(--color-accent)" }}>
            {copyFeedback} copied
          </span>
        )}
      </div>

      {/* Input area */}
      <div class="border-b border-[var(--color-border)] px-4 py-4">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            JSON Input
          </label>
          <div class="flex flex-wrap items-center gap-2">
            <select
              onChange={loadPreset}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
            >
              <option value="-1">Presets...</option>
              {PRESETS.map((p, i) => (
                <option key={i} value={i}>{p.label}</option>
              ))}
            </select>
            <button onClick={handleFormat} class={btnClass} title="Pretty-print">Format</button>
            <button onClick={handleMinify} class={btnClass} title="Minify">Minify</button>
            <button onClick={() => handleCopy(rawInput, "JSON")} class={btnClass} title="Copy JSON">
              <CopyIcon /> Copy
            </button>
          </div>
        </div>
        <textarea
          value={rawInput}
          onInput={(e) => setRawInput((e.target as HTMLTextAreaElement).value)}
          class="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm leading-relaxed text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
          style={{ fontFamily: "var(--font-mono)", minHeight: "100px", maxHeight: "300px" }}
          rows={5}
          spellcheck={false}
          placeholder='Paste JSON here, e.g. {"key": "value"}'
        />
        {parsed.error && (
          <p class="mt-2 text-xs" style={{ color: "#ef4444" }}>
            Parse error: {parsed.error}
          </p>
        )}
      </div>

      {/* JSONPath query bar */}
      <div class="border-b border-[var(--color-border)] px-4 py-3">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label class="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            JSONPath
          </label>
          <input
            type="text"
            value={jsonPathExpr}
            onInput={(e) => setJsonPathExpr((e.target as HTMLInputElement).value)}
            class="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
            style={{ fontFamily: "var(--font-mono)" }}
            placeholder="$.data.users[*].name  or  $..id"
            spellcheck={false}
          />
          {jsonPathResults.length > 0 && (
            <span class="text-[10px] text-[var(--color-text-muted)]">
              {jsonPathResults.length} match{jsonPathResults.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>
        {jsonPathResults.length > 0 && (
          <div
            class="mt-2 overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs"
            style={{ fontFamily: "var(--font-mono)", maxHeight: "120px" }}
          >
            {jsonPathResults.map((r, i) => (
              <div key={i} class="flex gap-2 py-0.5">
                <span style={{ color: "var(--color-primary)" }}>{r.path}</span>
                <span style={{ color: "var(--color-text-muted)" }}>:</span>
                <span style={{ color: TYPE_COLORS[getValueType(r.value)] ?? "var(--color-text)" }}>
                  {truncateValue(JSON.stringify(r.value), 80)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Content: tabs + stats layout */}
      {parsed.data != null && (
        <div class="flex flex-col lg:flex-row">
          {/* Main view area */}
          <div class="flex-1 min-w-0">
            {/* View tabs + tree controls */}
            <div class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
              <div class="flex overflow-hidden rounded-lg border border-[var(--color-border)]">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setActiveTab(t.key)}
                    class="px-3 py-1.5 text-xs font-medium transition-all"
                    style={{
                      backgroundColor: activeTab === t.key ? "rgba(79, 143, 247, 0.15)" : "transparent",
                      color: activeTab === t.key ? "var(--color-primary)" : "var(--color-text-muted)",
                      borderRight: t.key !== "code" ? "1px solid var(--color-border)" : "none",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {activeTab === "tree" && (
                <div class="flex items-center gap-1">
                  <button onClick={expandAll} class={btnClassSm}>Expand All</button>
                  <button onClick={collapseAll} class={btnClassSm}>Collapse All</button>
                </div>
              )}
              {activeTab === "table" && (
                <input
                  type="text"
                  value={tableFilter}
                  onInput={(e) => setTableFilter((e.target as HTMLInputElement).value)}
                  class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1 text-xs text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
                  placeholder="Filter paths or values..."
                  style={{ fontFamily: "var(--font-mono)" }}
                />
              )}
            </div>

            {/* View content */}
            <div style={{ maxHeight: "500px", overflow: "auto" }}>
              {activeTab === "tree" && (
                <TreeView
                  data={parsed.data}
                  expanded={expanded}
                  selectedPath={selectedPath}
                  onToggle={toggleNode}
                  onSelect={(p) => setSelectedPath(p)}
                  onCopyPath={(p) => handleCopy(p, "Path")}
                />
              )}
              {activeTab === "table" && (
                <TableView
                  entries={flatEntries}
                  filter={tableFilter}
                  sortAsc={tableSortAsc}
                  onToggleSort={() => setTableSortAsc((v) => !v)}
                  onCopyPath={(p) => handleCopy(p, "Path")}
                />
              )}
              {activeTab === "code" && (
                <CodeView data={parsed.data} />
              )}
            </div>
          </div>

          {/* Stats sidebar */}
          {stats && (
            <div class="shrink-0 border-t border-[var(--color-border)] lg:w-56 lg:border-t-0 lg:border-l">
              <StatsPanel stats={stats} />
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {parsed.data === null && !parsed.error && (
        <div class="px-4 py-12 text-center">
          <p class="text-sm italic" style={{ color: "rgba(161, 161, 170, 0.4)" }}>
            Paste valid JSON above to visualize it...
          </p>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────
   Shared button classes
   ────────────────────────────────────── */

const btnClass =
  "flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]";

const btnClassSm =
  "rounded-lg border border-[var(--color-border)] px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]";

/* ──────────────────────────────────────
   Tree View
   ────────────────────────────────────── */

function TreeView({
  data,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
  onCopyPath,
}: {
  data: unknown;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onCopyPath: (path: string) => void;
}) {
  return (
    <div class="px-2 py-2" style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}>
      <TreeNode
        keyName={null}
        value={data}
        path={[]}
        depth={0}
        expanded={expanded}
        selectedPath={selectedPath}
        onToggle={onToggle}
        onSelect={onSelect}
        onCopyPath={onCopyPath}
      />
    </div>
  );
}

function TreeNode({
  keyName,
  value,
  path,
  depth,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
  onCopyPath,
}: {
  keyName: string | number | null;
  value: unknown;
  path: (string | number)[];
  depth: number;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onCopyPath: (path: string) => void;
}) {
  const pathStr = getJsonPath(path);
  const type = getValueType(value);
  const isContainer = type === "object" || type === "array";
  const isExpanded = expanded.has(pathStr);
  const isSelected = selectedPath === pathStr;
  const childEntries = isContainer
    ? type === "array"
      ? (value as unknown[]).map((v, i) => ({ key: i, val: v }))
      : Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ key: k, val: v }))
    : [];
  const containerLabel =
    type === "array" ? `Array(${(value as unknown[]).length})` : `Object{${Object.keys(value as Record<string, unknown>).length}}`;

  return (
    <div style={{ marginLeft: depth > 0 ? "16px" : "0" }}>
      <div
        class="group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 transition-colors"
        style={{
          backgroundColor: isSelected ? "rgba(79, 143, 247, 0.1)" : "transparent",
        }}
        onClick={() => {
          onSelect(pathStr);
          if (isContainer) onToggle(pathStr);
        }}
        title={pathStr}
      >
        {/* Expand arrow */}
        {isContainer ? (
          <span
            class="inline-block w-3 text-center text-[10px] text-[var(--color-text-muted)]"
            style={{ transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0)" }}
          >
            &#9654;
          </span>
        ) : (
          <span class="inline-block w-3" />
        )}

        {/* Key */}
        {keyName !== null && (
          <>
            <span style={{ color: "var(--color-primary)" }}>
              {typeof keyName === "number" ? keyName : `"${keyName}"`}
            </span>
            <span style={{ color: "var(--color-text-muted)" }}>: </span>
          </>
        )}

        {/* Value / container label */}
        {isContainer ? (
          <span style={{ color: TYPE_COLORS[type], opacity: 0.8 }} class="text-[11px]">
            {containerLabel}
          </span>
        ) : (
          <span style={{ color: TYPE_COLORS[type] }}>
            {type === "string" ? `"${truncateValue(value as string, 60)}"` : String(value)}
          </span>
        )}

        {/* Type badge */}
        <span
          class="ml-1 rounded px-1 py-0 text-[9px] uppercase opacity-0 transition-opacity group-hover:opacity-100"
          style={{ backgroundColor: "rgba(79, 143, 247, 0.1)", color: TYPE_COLORS[type] }}
        >
          {type}
        </span>

        {/* Copy path button */}
        <button
          class="ml-auto rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ color: "var(--color-text-muted)" }}
          onClick={(e) => {
            e.stopPropagation();
            onCopyPath(pathStr);
          }}
          title={`Copy path: ${pathStr}`}
        >
          <CopyIcon size={10} />
        </button>
      </div>

      {/* Children */}
      {isContainer && isExpanded && childEntries.map((child) => (
        <TreeNode
          key={String(child.key)}
          keyName={child.key}
          value={child.val}
          path={[...path, child.key]}
          depth={depth + 1}
          expanded={expanded}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
          onCopyPath={onCopyPath}
        />
      ))}
    </div>
  );
}

/* ──────────────────────────────────────
   Table View
   ────────────────────────────────────── */

function TableView({
  entries,
  filter,
  sortAsc,
  onToggleSort,
  onCopyPath,
}: {
  entries: FlatEntry[];
  filter: string;
  sortAsc: boolean;
  onToggleSort: () => void;
  onCopyPath: (path: string) => void;
}) {
  const filtered = useMemo(() => {
    const term = filter.toLowerCase();
    let result = entries;
    if (term) {
      result = result.filter(
        (e) => e.path.toLowerCase().includes(term) || e.value.toLowerCase().includes(term) || e.type.includes(term)
      );
    }
    return sortAsc ? result : [...result].reverse();
  }, [entries, filter, sortAsc]);

  return (
    <div class="overflow-auto">
      <table class="w-full text-xs" style={{ fontFamily: "var(--font-mono)" }}>
        <thead>
          <tr class="border-b border-[var(--color-border)]">
            <th
              class="cursor-pointer px-3 py-2 text-left font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
              onClick={onToggleSort}
              title="Toggle sort order"
            >
              Path {sortAsc ? "↑" : "↓"}
            </th>
            <th class="px-3 py-2 text-left font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Value
            </th>
            <th class="px-3 py-2 text-left font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Type
            </th>
            <th class="w-8 px-1 py-2" />
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 500).map((entry) => (
            <tr key={entry.path} class="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[rgba(79,143,247,0.05)]">
              <td class="px-3 py-1.5" style={{ color: "var(--color-primary)", wordBreak: "break-all" }}>
                {entry.path}
              </td>
              <td class="px-3 py-1.5" style={{ color: TYPE_COLORS[entry.type] ?? "var(--color-text)", wordBreak: "break-all" }}>
                {truncateValue(entry.value, 100)}
              </td>
              <td class="px-3 py-1.5">
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] uppercase"
                  style={{ backgroundColor: "rgba(79, 143, 247, 0.1)", color: TYPE_COLORS[entry.type] }}
                >
                  {entry.type}
                </span>
              </td>
              <td class="px-1 py-1.5">
                <button
                  onClick={() => onCopyPath(entry.path)}
                  class="rounded p-0.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
                  title="Copy path"
                >
                  <CopyIcon size={10} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 500 && (
        <p class="px-3 py-2 text-[10px] text-[var(--color-text-muted)]">
          Showing first 500 of {filtered.length} entries
        </p>
      )}
      {filtered.length === 0 && (
        <p class="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">No matching entries</p>
      )}
    </div>
  );
}

/* ──────────────────────────────────────
   Code View (syntax-highlighted)
   ────────────────────────────────────── */

function CodeView({ data }: { data: unknown }) {
  const formatted = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const lines = useMemo(() => formatted.split("\n"), [formatted]);

  return (
    <div class="flex" style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}>
      {/* Line numbers */}
      <div
        class="shrink-0 select-none border-r border-[var(--color-border)] px-2 py-2 text-right"
        style={{ color: "var(--color-text-muted)", opacity: 0.4, minWidth: "3ch" }}
      >
        {lines.map((_, i) => (
          <div key={i} style={{ lineHeight: "1.6em" }}>{i + 1}</div>
        ))}
      </div>
      {/* Highlighted code */}
      <pre class="flex-1 overflow-auto px-3 py-2" style={{ lineHeight: "1.6em" }}>
        {lines.map((line, i) => (
          <div key={i}>{highlightJsonLine(line)}</div>
        ))}
      </pre>
    </div>
  );
}

function highlightJsonLine(line: string): JSX.Element {
  const parts: JSX.Element[] = [];
  let remaining = line;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // Leading whitespace
    const wsMatch = remaining.match(/^(\s+)/);
    if (wsMatch) {
      parts.push(<span key={keyIdx++}>{wsMatch[1]}</span>);
      remaining = remaining.slice(wsMatch[1].length);
      continue;
    }

    // Key in "key":
    const keyMatch = remaining.match(/^("(?:[^"\\]|\\.)*")\s*:/);
    if (keyMatch) {
      parts.push(
        <span key={keyIdx++} style={{ color: "var(--color-primary)" }}>{keyMatch[1]}</span>
      );
      parts.push(<span key={keyIdx++} style={{ color: "var(--color-text-muted)" }}>: </span>);
      remaining = remaining.slice(keyMatch[0].length);
      continue;
    }

    // String value
    const strMatch = remaining.match(/^("(?:[^"\\]|\\.)*")(,?)/);
    if (strMatch) {
      parts.push(<span key={keyIdx++} style={{ color: TYPE_COLORS.string }}>{strMatch[1]}</span>);
      if (strMatch[2]) parts.push(<span key={keyIdx++} style={{ color: "var(--color-text-muted)" }}>,</span>);
      remaining = remaining.slice(strMatch[0].length);
      continue;
    }

    // Number
    const numMatch = remaining.match(/^(-?\d+\.?\d*(?:[eE][+-]?\d+)?)(,?)/);
    if (numMatch) {
      parts.push(<span key={keyIdx++} style={{ color: TYPE_COLORS.number }}>{numMatch[1]}</span>);
      if (numMatch[2]) parts.push(<span key={keyIdx++} style={{ color: "var(--color-text-muted)" }}>,</span>);
      remaining = remaining.slice(numMatch[0].length);
      continue;
    }

    // Boolean
    const boolMatch = remaining.match(/^(true|false)(,?)/);
    if (boolMatch) {
      parts.push(<span key={keyIdx++} style={{ color: TYPE_COLORS.boolean }}>{boolMatch[1]}</span>);
      if (boolMatch[2]) parts.push(<span key={keyIdx++} style={{ color: "var(--color-text-muted)" }}>,</span>);
      remaining = remaining.slice(boolMatch[0].length);
      continue;
    }

    // Null
    const nullMatch = remaining.match(/^(null)(,?)/);
    if (nullMatch) {
      parts.push(<span key={keyIdx++} style={{ color: TYPE_COLORS.null }}>{nullMatch[1]}</span>);
      if (nullMatch[2]) parts.push(<span key={keyIdx++} style={{ color: "var(--color-text-muted)" }}>,</span>);
      remaining = remaining.slice(nullMatch[0].length);
      continue;
    }

    // Brackets / braces
    const bracketMatch = remaining.match(/^([{}\[\]],?)/);
    if (bracketMatch) {
      const bracket = bracketMatch[1].replace(",", "");
      const comma = bracketMatch[1].endsWith(",");
      parts.push(<span key={keyIdx++} style={{ color: "var(--color-text-muted)" }}>{bracket}</span>);
      if (comma) parts.push(<span key={keyIdx++} style={{ color: "var(--color-text-muted)" }}>,</span>);
      remaining = remaining.slice(bracketMatch[0].length);
      continue;
    }

    // Fallback: consume one char
    parts.push(<span key={keyIdx++} style={{ color: "var(--color-text)" }}>{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return <>{parts}</>;
}

/* ──────────────────────────────────────
   Stats Panel
   ────────────────────────────────────── */

function StatsPanel({ stats }: { stats: JsonStats }) {
  const typeEntries = Object.entries(stats.typeCounts).filter(([, count]) => count > 0);
  const maxCount = Math.max(...typeEntries.map(([, c]) => c), 1);

  return (
    <div class="px-4 py-3">
      <h3
        class="mb-3 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-heading)" }}
      >
        Statistics
      </h3>
      <div class="space-y-2 text-xs">
        <StatRow label="Size" value={formatBytes(stats.sizeBytes)} />
        <StatRow label="Nodes" value={String(stats.nodeCount)} />
        <StatRow label="Keys" value={String(stats.totalKeys)} />
        <StatRow label="Max depth" value={String(stats.maxDepth)} />
        <StatRow label="Arrays" value={String(stats.arrayCount)} />
        <StatRow label="Objects" value={String(stats.objectCount)} />
      </div>

      {/* Type distribution bar chart */}
      <h4
        class="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-heading)" }}
      >
        Type Distribution
      </h4>
      <div class="space-y-1.5">
        {typeEntries.map(([type, count]) => (
          <div key={type}>
            <div class="mb-0.5 flex items-center justify-between text-[10px]">
              <span style={{ color: TYPE_COLORS[type] ?? "var(--color-text)" }}>{type}</span>
              <span style={{ color: "var(--color-text-muted)" }}>{count}</span>
            </div>
            <div
              class="h-1.5 rounded-full"
              style={{ backgroundColor: "var(--color-border)" }}
            >
              <div
                class="h-1.5 rounded-full transition-all"
                style={{
                  width: `${(count / maxCount) * 100}%`,
                  backgroundColor: TYPE_COLORS[type] ?? "var(--color-text-muted)",
                  opacity: 0.7,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex items-center justify-between">
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span style={{ color: "var(--color-heading)", fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
}

/* ──────────────────────────────────────
   Icons
   ────────────────────────────────────── */

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
