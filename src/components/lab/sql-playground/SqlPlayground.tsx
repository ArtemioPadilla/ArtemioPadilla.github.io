import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import { PRESET_DATABASES } from "./presets";
import type { PresetQuery } from "./presets";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface QueryResult {
  columns: string[];
  values: unknown[][];
}

interface ExecutionResult {
  results: QueryResult[];
  rowsAffected: number;
  executionTimeMs: number;
  error: string | null;
  sql: string;
}

interface HistoryEntry {
  sql: string;
  timestamp: number;
  success: boolean;
  rowCount: number;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  pk: boolean;
}

type SortDirection = "asc" | "desc" | null;

interface SortState {
  column: number;
  direction: SortDirection;
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const SQL_JS_CDN = "https://sql.js.org/dist";
const MAX_HISTORY = 50;
const DEFAULT_QUERY = "SELECT sqlite_version() AS version;";

/* ──────────────────────────────────────
   SQL Keyword Highlighting (lightweight)
   ────────────────────────────────────── */

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP",
  "ALTER", "TABLE", "INTO", "VALUES", "SET", "JOIN", "INNER", "LEFT", "RIGHT",
  "OUTER", "ON", "AND", "OR", "NOT", "IN", "IS", "NULL", "AS", "ORDER", "BY",
  "GROUP", "HAVING", "LIMIT", "OFFSET", "UNION", "ALL", "DISTINCT", "CASE",
  "WHEN", "THEN", "ELSE", "END", "EXISTS", "BETWEEN", "LIKE", "ASC", "DESC",
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "INDEX", "UNIQUE", "DEFAULT",
  "CHECK", "CONSTRAINT", "INTEGER", "TEXT", "REAL", "BLOB", "WITH", "RECURSIVE",
  "OVER", "PARTITION", "WINDOW", "ROW", "ROWS", "RANGE", "PRECEDING", "FOLLOWING",
  "CURRENT", "UNBOUNDED", "RANK", "DENSE_RANK", "ROW_NUMBER", "LAG", "LEAD",
  "FIRST_VALUE", "LAST_VALUE", "NTH_VALUE", "NTILE", "COUNT", "SUM", "AVG",
  "MIN", "MAX", "AUTOINCREMENT", "IF", "REPLACE", "ABORT", "ROLLBACK",
  "TRANSACTION", "BEGIN", "COMMIT", "EXPLAIN", "QUERY", "PLAN", "PRAGMA",
  "VACUUM", "ATTACH", "DETACH",
]);

function highlightSQL(sql: string): preact.JSX.Element[] {
  const tokens: preact.JSX.Element[] = [];
  const regex = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|(--.*)|(\/\*[\s\S]*?\*\/)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\S)/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = regex.exec(sql)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(<span key={`ws-${lastIndex}`}>{sql.slice(lastIndex, match.index)}</span>);
    }
    const idx = match.index;
    if (match[1]) {
      tokens.push(<span key={`s-${idx}`} style={{ color: "var(--color-accent)" }}>{match[0]}</span>);
    } else if (match[2] || match[3]) {
      tokens.push(<span key={`c-${idx}`} style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>{match[0]}</span>);
    } else if (match[4]) {
      tokens.push(<span key={`n-${idx}`} style={{ color: "#e879f9" }}>{match[0]}</span>);
    } else if (match[5]) {
      const upper = match[0].toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        tokens.push(<span key={`k-${idx}`} style={{ color: "var(--color-primary)", fontWeight: "bold" }}>{match[0]}</span>);
      } else {
        tokens.push(<span key={`i-${idx}`}>{match[0]}</span>);
      }
    } else {
      tokens.push(<span key={`o-${idx}`}>{match[0]}</span>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < sql.length) {
    tokens.push(<span key={`end-${lastIndex}`}>{sql.slice(lastIndex)}</span>);
  }
  return tokens;
}

/* ──────────────────────────────────────
   CSV Export
   ────────────────────────────────────── */

function resultToCSV(result: QueryResult): string {
  const escape = (val: unknown): string => {
    const s = val === null || val === undefined ? "" : String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = result.columns.map(escape).join(",");
  const rows = result.values.map((row) => row.map(escape).join(","));
  return [header, ...rows].join("\n");
}

function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ──────────────────────────────────────
   Schema Extraction
   ────────────────────────────────────── */

function extractSchema(db: any): TableInfo[] {
  const tables: TableInfo[] = [];
  try {
    const result = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
    );
    if (result.length === 0) return tables;

    for (const row of result[0].values) {
      const tableName = row[0] as string;
      const colResult = db.exec(`PRAGMA table_info("${tableName}");`);
      if (colResult.length > 0) {
        const columns: ColumnInfo[] = colResult[0].values.map((col: unknown[]) => ({
          name: col[1] as string,
          type: (col[2] as string) || "ANY",
          notNull: col[3] === 1,
          pk: col[5] === 1,
        }));
        tables.push({ name: tableName, columns });
      }
    }
  } catch {
    // Schema query failed — return empty
  }
  return tables;
}

/* ──────────────────────────────────────
   Main Component
   ────────────────────────────────────── */

export default function SqlPlayground() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [schema, setSchema] = useState<TableInfo[]>([]);
  const [activePreset, setActivePreset] = useState<string>("employees");
  const [showSchema, setShowSchema] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showPresetQueries, setShowPresetQueries] = useState(false);
  const [sort, setSort] = useState<SortState>({ column: -1, direction: null });
  const [activeResultTab, setActiveResultTab] = useState(0);

  const dbRef = useRef<any>(null);
  const sqlJsRef = useRef<any>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* ── Load sql.js from CDN ──────── */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const script = document.createElement("script");
        script.src = `${SQL_JS_CDN}/sql-wasm.js`;
        script.async = true;
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load sql.js from CDN"));
          document.head.appendChild(script);
        });

        if (cancelled) return;

        const SQL = await (window as any).initSqlJs({
          locateFile: (file: string) => `${SQL_JS_CDN}/${file}`,
        });

        if (cancelled) return;

        sqlJsRef.current = SQL;
        const db = new SQL.Database();
        dbRef.current = db;

        // Load default preset
        const preset = PRESET_DATABASES.find((p) => p.id === "employees");
        if (preset && preset.ddl) {
          db.run(preset.ddl);
        }

        setSchema(extractSchema(db));
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Switch preset database ────── */

  const switchDatabase = useCallback((presetId: string) => {
    if (!sqlJsRef.current) return;

    const preset = PRESET_DATABASES.find((p) => p.id === presetId);
    if (!preset) return;

    // Close old DB and create fresh
    if (dbRef.current) {
      dbRef.current.close();
    }

    const db = new sqlJsRef.current.Database();
    dbRef.current = db;

    if (preset.ddl) {
      try {
        db.run(preset.ddl);
      } catch (err) {
        setResult({
          results: [],
          rowsAffected: 0,
          executionTimeMs: 0,
          error: `Failed to initialize database: ${err instanceof Error ? err.message : String(err)}`,
          sql: "",
        });
      }
    }

    setActivePreset(presetId);
    setSchema(extractSchema(db));
    setResult(null);
    setSort({ column: -1, direction: null });
    setActiveResultTab(0);

    // Set first preset query if available
    if (preset.queries.length > 0) {
      setQuery(preset.queries[0].sql);
    } else {
      setQuery(DEFAULT_QUERY);
    }
  }, []);

  /* ── Execute SQL ───────────────── */

  const executeQuery = useCallback((sql?: string) => {
    const db = dbRef.current;
    if (!db) return;

    const queryText = (sql ?? query).trim();
    if (!queryText) return;

    setExecuting(true);
    setSort({ column: -1, direction: null });
    setActiveResultTab(0);

    // Use setTimeout to let UI update with "executing" state
    setTimeout(() => {
      const startTime = performance.now();
      let execResult: ExecutionResult;

      try {
        const results: QueryResult[] = db.exec(queryText);
        const changes: number = db.getRowsModified();
        const elapsed = performance.now() - startTime;

        execResult = {
          results,
          rowsAffected: changes,
          executionTimeMs: elapsed,
          error: null,
          sql: queryText,
        };
      } catch (err) {
        const elapsed = performance.now() - startTime;
        execResult = {
          results: [],
          rowsAffected: 0,
          executionTimeMs: elapsed,
          error: err instanceof Error ? err.message : String(err),
          sql: queryText,
        };
      }

      setResult(execResult);
      setSchema(extractSchema(db));
      setExecuting(false);

      // Add to history
      const totalRows = execResult.results.reduce((sum, r) => sum + r.values.length, 0);
      setHistory((prev) => {
        const entry: HistoryEntry = {
          sql: queryText,
          timestamp: Date.now(),
          success: execResult.error === null,
          rowCount: totalRows + execResult.rowsAffected,
        };
        return [entry, ...prev].slice(0, MAX_HISTORY);
      });
    }, 10);
  }, [query]);

  /* ── Keyboard handler ──────────── */

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        executeQuery();
      }
    },
    [executeQuery]
  );

  /* ── Sort handler ──────────────── */

  const handleSort = useCallback((colIndex: number) => {
    setSort((prev) => {
      if (prev.column === colIndex) {
        if (prev.direction === "asc") return { column: colIndex, direction: "desc" };
        if (prev.direction === "desc") return { column: -1, direction: null };
      }
      return { column: colIndex, direction: "asc" };
    });
  }, []);

  const sortedValues = useCallback(
    (values: unknown[][]): unknown[][] => {
      if (sort.column < 0 || sort.direction === null) return values;
      const col = sort.column;
      const dir = sort.direction === "asc" ? 1 : -1;
      return [...values].sort((a, b) => {
        const va = a[col];
        const vb = b[col];
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    },
    [sort]
  );

  /* ── Load preset query ─────────── */

  const loadPresetQuery = useCallback((pq: PresetQuery) => {
    setQuery(pq.sql);
    setShowPresetQueries(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  /* ── Current preset data ───────── */

  const currentPreset = PRESET_DATABASES.find((p) => p.id === activePreset);

  /* ── Render ────────────────────── */

  if (loading) {
    return (
      <div class="flex flex-col items-center justify-center gap-4 rounded-lg border py-20"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div class="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
          style={{ borderColor: "var(--color-primary)", borderTopColor: "transparent" }} />
        <p style={{ color: "var(--color-text-muted)" }}>Loading SQLite engine...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div class="rounded-lg border p-8 text-center"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p class="mb-2 text-lg font-bold" style={{ color: "#ef4444" }}>Failed to load SQL engine</p>
        <p class="text-sm" style={{ color: "var(--color-text-muted)" }}>{loadError}</p>
        <button class="mt-4 rounded px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--color-primary)" }}
          onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  const activeResult = result?.results?.[activeResultTab];
  const totalRows = result?.results?.reduce((sum, r) => sum + r.values.length, 0) ?? 0;

  return (
    <div class="flex flex-col gap-4">
      {/* ── Database Selector ──────── */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>Database:</span>
        {PRESET_DATABASES.map((preset) => (
          <button
            key={preset.id}
            class="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: activePreset === preset.id ? "var(--color-primary)" : "var(--color-surface)",
              color: activePreset === preset.id ? "#fff" : "var(--color-text)",
              border: `1px solid ${activePreset === preset.id ? "var(--color-primary)" : "var(--color-border)"}`,
            }}
            onClick={() => switchDatabase(preset.id)}
            title={preset.description}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* ── Main Layout: Editor + Schema ── */}
      <div class="flex gap-4" style={{ minHeight: "320px" }}>
        {/* ── Editor Panel ──────────── */}
        <div class="flex flex-1 flex-col gap-2" style={{ minWidth: 0 }}>
          {/* Toolbar */}
          <div class="flex flex-wrap items-center gap-2">
            <button
              class="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
              onClick={() => executeQuery()}
              disabled={executing || !query.trim()}
            >
              {executing ? "Running..." : "Run (Ctrl+Enter)"}
            </button>
            <button
              class="rounded-md px-3 py-2 text-xs transition-colors"
              style={{
                background: showPresetQueries ? "var(--color-primary)" : "var(--color-surface)",
                color: showPresetQueries ? "#fff" : "var(--color-text)",
                border: `1px solid ${showPresetQueries ? "var(--color-primary)" : "var(--color-border)"}`,
              }}
              onClick={() => setShowPresetQueries(!showPresetQueries)}
            >
              Examples
            </button>
            <button
              class="rounded-md px-3 py-2 text-xs transition-colors"
              style={{
                background: showHistory ? "var(--color-primary)" : "var(--color-surface)",
                color: showHistory ? "#fff" : "var(--color-text)",
                border: `1px solid ${showHistory ? "var(--color-primary)" : "var(--color-border)"}`,
              }}
              onClick={() => setShowHistory(!showHistory)}
            >
              History ({history.length})
            </button>
            <button
              class="rounded-md px-3 py-2 text-xs md:hidden transition-colors"
              style={{
                background: showSchema ? "var(--color-primary)" : "var(--color-surface)",
                color: showSchema ? "#fff" : "var(--color-text)",
                border: `1px solid ${showSchema ? "var(--color-primary)" : "var(--color-border)"}`,
              }}
              onClick={() => setShowSchema(!showSchema)}
            >
              Schema
            </button>
          </div>

          {/* Preset Queries Dropdown */}
          {showPresetQueries && currentPreset && (
            <div class="rounded-lg border p-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
              <div class="mb-2 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Example queries for {currentPreset.name}:
              </div>
              <div class="flex flex-col gap-1">
                {currentPreset.queries.map((pq, i) => (
                  <button
                    key={i}
                    class="rounded px-3 py-2 text-left text-xs transition-colors hover:opacity-80"
                    style={{
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text)",
                    }}
                    onClick={() => loadPresetQuery(pq)}
                  >
                    <span class="font-medium" style={{ color: "var(--color-primary)" }}>{pq.label}</span>
                    <span style={{ color: "var(--color-text-muted)" }}> — {pq.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* History Panel */}
          {showHistory && (
            <div class="rounded-lg border p-3"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", maxHeight: "200px", overflowY: "auto" }}>
              <div class="mb-2 text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
                Query history:
              </div>
              {history.length === 0 ? (
                <p class="text-xs" style={{ color: "var(--color-text-muted)" }}>No queries yet.</p>
              ) : (
                <div class="flex flex-col gap-1">
                  {history.map((entry, i) => (
                    <button
                      key={i}
                      class="flex items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:opacity-80"
                      style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
                      onClick={() => {
                        setQuery(entry.sql);
                        setShowHistory(false);
                      }}
                    >
                      <span style={{ color: entry.success ? "var(--color-accent)" : "#ef4444", flexShrink: 0 }}>
                        {entry.success ? "OK" : "ERR"}
                      </span>
                      <span class="truncate" style={{
                        color: "var(--color-text)",
                        fontFamily: "var(--font-mono)",
                        maxWidth: "100%",
                      }}>
                        {entry.sql.length > 120 ? entry.sql.slice(0, 120) + "..." : entry.sql}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SQL Editor */}
          <div class="relative rounded-lg border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
            {/* Highlighted overlay */}
            <pre
              class="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words p-3 text-sm leading-relaxed"
              style={{
                fontFamily: "var(--font-mono)",
                color: "var(--color-text)",
                background: "transparent",
                margin: 0,
              }}
              aria-hidden="true"
            >
              {highlightSQL(query)}
            </pre>
            {/* Textarea (transparent text, caret visible) */}
            <textarea
              ref={textareaRef}
              class="w-full resize-y p-3 text-sm leading-relaxed"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--color-surface)",
                color: "transparent",
                caretColor: "var(--color-text)",
                border: "none",
                outline: "none",
                minHeight: "160px",
                maxHeight: "400px",
              }}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown as any}
              spellcheck={false}
              autocomplete="off"
              autocapitalize="off"
              placeholder="Type your SQL query here..."
            />
          </div>
        </div>

        {/* ── Schema Sidebar ──────── */}
        <div
          class={`flex-shrink-0 overflow-y-auto rounded-lg border ${showSchema ? "block" : "hidden"} md:block`}
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-surface)",
            width: "220px",
            maxHeight: "500px",
          }}
        >
          <div class="sticky top-0 border-b px-3 py-2"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <span class="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-heading)" }}>
              Schema
            </span>
          </div>
          {schema.length === 0 ? (
            <p class="p-3 text-xs" style={{ color: "var(--color-text-muted)" }}>No tables yet.</p>
          ) : (
            <div class="p-2">
              {schema.map((table) => (
                <SchemaTable key={table.name} table={table} onInsertName={(name: string) => {
                  setQuery((prev) => prev + name);
                  textareaRef.current?.focus();
                }} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Results Area ──────────── */}
      {result && (
        <div class="rounded-lg border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          {/* Stats bar */}
          <div class="flex flex-wrap items-center gap-3 border-b px-4 py-2"
            style={{ borderColor: "var(--color-border)" }}>
            {result.error ? (
              <span class="text-xs font-medium" style={{ color: "#ef4444" }}>Error</span>
            ) : (
              <>
                <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {totalRows > 0 && <><strong style={{ color: "var(--color-heading)" }}>{totalRows}</strong> row{totalRows !== 1 ? "s" : ""} returned</>}
                  {result.rowsAffected > 0 && totalRows > 0 && " | "}
                  {result.rowsAffected > 0 && <><strong style={{ color: "var(--color-heading)" }}>{result.rowsAffected}</strong> row{result.rowsAffected !== 1 ? "s" : ""} affected</>}
                  {totalRows === 0 && result.rowsAffected === 0 && "Query executed successfully"}
                </span>
                <span class="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {result.executionTimeMs < 1
                    ? "<1ms"
                    : `${result.executionTimeMs.toFixed(1)}ms`}
                </span>
              </>
            )}
            {/* Export CSV */}
            {activeResult && activeResult.values.length > 0 && (
              <button
                class="ml-auto rounded px-2 py-1 text-xs transition-colors"
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
                onClick={() => {
                  const csv = resultToCSV(activeResult);
                  downloadCSV(csv, `query-result-${Date.now()}.csv`);
                }}
              >
                Export CSV
              </button>
            )}
          </div>

          {/* Error display */}
          {result.error && (
            <div class="p-4">
              <pre class="whitespace-pre-wrap text-sm" style={{
                fontFamily: "var(--font-mono)",
                color: "#ef4444",
              }}>
                {result.error}
              </pre>
            </div>
          )}

          {/* Result set tabs (when multiple result sets) */}
          {result.results.length > 1 && (
            <div class="flex border-b px-2" style={{ borderColor: "var(--color-border)" }}>
              {result.results.map((_, i) => (
                <button
                  key={i}
                  class="px-3 py-1.5 text-xs font-medium transition-colors"
                  style={{
                    color: activeResultTab === i ? "var(--color-primary)" : "var(--color-text-muted)",
                    borderBottom: activeResultTab === i ? "2px solid var(--color-primary)" : "2px solid transparent",
                  }}
                  onClick={() => {
                    setActiveResultTab(i);
                    setSort({ column: -1, direction: null });
                  }}
                >
                  Result {i + 1} ({result.results[i].values.length} rows)
                </button>
              ))}
            </div>
          )}

          {/* Table */}
          {activeResult && activeResult.values.length > 0 && (
            <div class="overflow-x-auto" style={{ maxHeight: "400px", overflowY: "auto" }}>
              <table class="w-full text-left text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {activeResult.columns.map((col, i) => (
                      <th
                        key={i}
                        class="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-xs font-bold uppercase tracking-wider transition-colors hover:opacity-80"
                        style={{
                          color: "var(--color-heading)",
                          borderBottom: "2px solid var(--color-border)",
                          background: "var(--color-surface)",
                          position: "sticky",
                          top: 0,
                          zIndex: 1,
                        }}
                        onClick={() => handleSort(i)}
                      >
                        {col}
                        {sort.column === i && (
                          <span class="ml-1">{sort.direction === "asc" ? " ^" : " v"}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedValues(activeResult.values).map((row, ri) => (
                    <tr key={ri} class="transition-colors" style={{
                      borderBottom: "1px solid var(--color-border)",
                    }}>
                      {row.map((cell, ci) => (
                        <td key={ci} class="whitespace-nowrap px-3 py-1.5 text-xs"
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: cell === null ? "var(--color-text-muted)" : "var(--color-text)",
                            fontStyle: cell === null ? "italic" : "normal",
                          }}>
                          {cell === null ? "NULL" : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* No results message */}
          {!result.error && result.results.length === 0 && result.rowsAffected === 0 && (
            <div class="p-4 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
              Query executed successfully — no results to display.
            </div>
          )}
          {!result.error && result.results.length === 0 && result.rowsAffected > 0 && (
            <div class="p-4 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>
              {result.rowsAffected} row{result.rowsAffected !== 1 ? "s" : ""} affected.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────
   Schema Table Sub-component
   ────────────────────────────────────── */

function SchemaTable({ table, onInsertName }: { table: TableInfo; onInsertName: (name: string) => void }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div class="mb-2">
      <button
        class="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors hover:opacity-80"
        style={{ color: "var(--color-heading)" }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{ color: "var(--color-text-muted)", fontSize: "8px" }}>
          {expanded ? "v" : ">"}
        </span>
        <span
          class="cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onInsertName(table.name);
          }}
          title={`Click to insert "${table.name}"`}
          style={{ color: "var(--color-primary)" }}
        >
          {table.name}
        </span>
        <span class="ml-auto text-xs" style={{ color: "var(--color-text-muted)" }}>
          {table.columns.length}
        </span>
      </button>
      {expanded && (
        <div class="ml-4 mt-0.5">
          {table.columns.map((col) => (
            <div
              key={col.name}
              class="flex items-center gap-1 px-1 py-0.5 text-xs cursor-pointer hover:opacity-70"
              onClick={() => onInsertName(col.name)}
              title={`Click to insert "${col.name}"`}
            >
              {col.pk && <span style={{ color: "#eab308", fontSize: "8px" }}>PK</span>}
              <span style={{ color: "var(--color-text)" }}>{col.name}</span>
              <span class="ml-auto" style={{ color: "var(--color-text-muted)", fontSize: "10px" }}>
                {col.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
