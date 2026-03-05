import { useState, useMemo, useCallback, useEffect, useRef } from "preact/hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ValidationError {
  path: string;
  message: string;
  schemaPath: string;
  keyword: string;
}

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface ParseError {
  source: "data" | "schema";
  message: string;
  line?: number;
}

interface PresetExample {
  label: string;
  data: string;
  schema: string;
}

// ---------------------------------------------------------------------------
// Preset Examples
// ---------------------------------------------------------------------------

const PRESET_EXAMPLES: PresetExample[] = [
  {
    label: "User Profile",
    data: JSON.stringify(
      {
        name: "Jane Doe",
        email: "jane@example.com",
        age: 28,
        isActive: true,
      },
      null,
      2
    ),
    schema: JSON.stringify(
      {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        required: ["name", "email", "age"],
        properties: {
          name: { type: "string", minLength: 1 },
          email: { type: "string", format: "email" },
          age: { type: "integer", minimum: 0, maximum: 150 },
          isActive: { type: "boolean" },
        },
        additionalProperties: false,
      },
      null,
      2
    ),
  },
  {
    label: "API Response",
    data: JSON.stringify(
      {
        status: 200,
        data: {
          users: [
            { id: 1, username: "alice", role: "admin" },
            { id: 2, username: "bob", role: "editor" },
          ],
          total: 2,
          page: 1,
        },
      },
      null,
      2
    ),
    schema: JSON.stringify(
      {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        required: ["status", "data"],
        properties: {
          status: { type: "integer", enum: [200, 201, 204] },
          data: {
            type: "object",
            required: ["users", "total", "page"],
            properties: {
              users: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "username", "role"],
                  properties: {
                    id: { type: "integer" },
                    username: { type: "string", minLength: 1 },
                    role: { type: "string", enum: ["admin", "editor", "viewer"] },
                  },
                },
              },
              total: { type: "integer", minimum: 0 },
              page: { type: "integer", minimum: 1 },
            },
          },
        },
      },
      null,
      2
    ),
  },
  {
    label: "Config File",
    data: JSON.stringify(
      {
        appName: "my-app",
        version: "1.2.3",
        environment: "production",
        port: 3000,
        debug: false,
        logLevel: "info",
        database: {
          host: "db.example.com",
          port: 5432,
          name: "mydb",
        },
      },
      null,
      2
    ),
    schema: JSON.stringify(
      {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        required: ["appName", "version", "environment"],
        properties: {
          appName: {
            type: "string",
            pattern: "^[a-z][a-z0-9-]*$",
          },
          version: {
            type: "string",
            pattern: "^\\d+\\.\\d+\\.\\d+$",
          },
          environment: {
            type: "string",
            enum: ["development", "staging", "production"],
          },
          port: {
            type: "integer",
            minimum: 1,
            maximum: 65535,
            default: 8080,
          },
          debug: { type: "boolean", default: false },
          logLevel: {
            type: "string",
            enum: ["debug", "info", "warn", "error"],
            default: "info",
          },
          database: {
            type: "object",
            required: ["host", "port", "name"],
            properties: {
              host: { type: "string", format: "hostname" },
              port: { type: "integer", minimum: 1, maximum: 65535 },
              name: { type: "string", minLength: 1 },
            },
          },
        },
        additionalProperties: false,
      },
      null,
      2
    ),
  },
  {
    label: "Address Book",
    data: JSON.stringify(
      {
        contacts: [
          {
            name: "Alice Johnson",
            address: {
              street: "123 Main St",
              city: "Springfield",
              state: "IL",
              zip: "62701",
            },
            phone: "+1-555-0101",
          },
          {
            name: "Bob Smith",
            address: {
              street: "456 Oak Ave",
              city: "Portland",
              state: "OR",
              zip: "97201",
            },
            phone: "+1-555-0202",
          },
        ],
      },
      null,
      2
    ),
    schema: JSON.stringify(
      {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        required: ["contacts"],
        properties: {
          contacts: {
            type: "array",
            items: { $ref: "#/definitions/contact" },
          },
        },
        definitions: {
          address: {
            type: "object",
            required: ["street", "city", "state", "zip"],
            properties: {
              street: { type: "string" },
              city: { type: "string" },
              state: { type: "string", minLength: 2, maxLength: 2 },
              zip: { type: "string", pattern: "^\\d{5}(-\\d{4})?$" },
            },
          },
          contact: {
            type: "object",
            required: ["name", "address"],
            properties: {
              name: { type: "string", minLength: 1 },
              address: { $ref: "#/definitions/address" },
              phone: { type: "string", pattern: "^\\+?[\\d\\s-]+$" },
            },
          },
        },
      },
      null,
      2
    ),
  },
];

const DEFAULT_PRESET = PRESET_EXAMPLES[0];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractParseErrorLine(error: SyntaxError): number | undefined {
  const match = /position\s+(\d+)/i.exec(error.message);
  if (!match) return undefined;
  return undefined; // JSON.parse position is character-based, not reliable for line display
}

function getJsonParseErrorMessage(error: unknown): string {
  if (error instanceof SyntaxError) {
    return error.message;
  }
  return String(error);
}

function countLines(text: string): number {
  if (!text) return 1;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") count++;
  }
  return count;
}

function tryParseJson(text: string, source: "data" | "schema"): { value: unknown } | { error: ParseError } {
  if (!text.trim()) {
    return { error: { source, message: `${source === "data" ? "JSON data" : "JSON Schema"} is empty` } };
  }
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return {
      error: {
        source,
        message: getJsonParseErrorMessage(err),
        line: err instanceof SyntaxError ? extractParseErrorLine(err) : undefined,
      },
    };
  }
}

function tryFormatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LineNumbers({ count }: { count: number }) {
  const lines = useMemo(() => {
    const arr: number[] = [];
    for (let i = 1; i <= count; i++) arr.push(i);
    return arr;
  }, [count]);

  return (
    <div
      class="select-none pr-2 pt-3 pb-3 text-right text-xs leading-[1.5rem] text-[var(--color-text-muted)]"
      style={{ fontFamily: "var(--font-mono)", opacity: 0.4, minWidth: "2.5rem" }}
      aria-hidden="true"
    >
      {lines.map((n) => (
        <div key={n}>{n}</div>
      ))}
    </div>
  );
}

interface EditorPanelProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFormat: () => void;
  onClear: () => void;
  onCopy: () => void;
  copyFeedback: boolean;
  hasParseError: boolean;
}

function EditorPanel({
  label,
  value,
  onChange,
  onFormat,
  onClear,
  onCopy,
  copyFeedback,
  hasParseError,
}: EditorPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumberRef = useRef<HTMLDivElement>(null);
  const lineCount = useMemo(() => countLines(value), [value]);

  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumberRef.current) {
      lineNumberRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  return (
    <div class="flex flex-col">
      {/* Panel header */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span class="text-xs font-medium text-[var(--color-text-muted)]">{label}</span>
        <div class="flex items-center gap-1">
          <button
            onClick={onCopy}
            class="rounded-md px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
            title={`Copy ${label.toLowerCase()}`}
          >
            {copyFeedback ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={onFormat}
            class="rounded-md px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
            title="Format JSON"
          >
            Format
          </button>
          <button
            onClick={onClear}
            class="rounded-md px-2 py-1 text-[10px] font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
            title="Clear"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Editor area with line numbers */}
      <div class="relative flex overflow-hidden" style={{ minHeight: "300px" }}>
        <div
          ref={lineNumberRef}
          class="overflow-hidden border-r border-[var(--color-border)]"
          style={{ minWidth: "2.5rem" }}
        >
          <LineNumbers count={lineCount} />
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          onScroll={handleScroll}
          class="jv-textarea w-full flex-1 resize-none border-none bg-transparent p-3 text-xs leading-[1.5rem] text-[var(--color-text)] outline-none"
          style={{
            fontFamily: "var(--font-mono)",
            minHeight: "300px",
            caretColor: "var(--color-primary)",
            borderColor: hasParseError ? "#ef4444" : undefined,
          }}
          spellcheck={false}
          autocomplete="off"
          autocapitalize="off"
        />
      </div>
    </div>
  );
}

interface ValidationResultsPanelProps {
  result: ValidationResult | null;
  parseErrors: ParseError[];
  isValidating: boolean;
}

function ValidationResultsPanel({ result, parseErrors, isValidating }: ValidationResultsPanelProps) {
  if (isValidating) {
    return (
      <div class="flex items-center gap-2 px-4 py-3">
        <div class="jv-pulse h-3 w-3 rounded-full" />
        <span class="text-xs text-[var(--color-text-muted)]">Validating...</span>
      </div>
    );
  }

  if (parseErrors.length > 0) {
    return (
      <div class="space-y-2 px-4 py-3">
        {parseErrors.map((err, i) => (
          <div key={i} class="flex items-start gap-2">
            <span class="mt-0.5 text-sm" style={{ color: "#ef4444" }}>
              !
            </span>
            <div class="text-xs">
              <span class="font-semibold" style={{ color: "#ef4444" }}>
                {err.source === "data" ? "JSON Data" : "JSON Schema"} parse error
              </span>
              <p class="mt-0.5 text-[var(--color-text-muted)]">{err.message}</p>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!result) {
    return (
      <div class="px-4 py-3 text-xs text-[var(--color-text-muted)]">
        Click <strong>Validate</strong> or enable <strong>Auto-validate</strong> to check your JSON.
      </div>
    );
  }

  if (result.valid) {
    return (
      <div class="flex items-center gap-2 px-4 py-3">
        <span class="text-lg" style={{ color: "var(--color-accent)" }}>
          &#10003;
        </span>
        <span class="text-sm font-medium" style={{ color: "var(--color-accent)" }}>
          Valid! Data matches the schema.
        </span>
      </div>
    );
  }

  return (
    <div class="space-y-1 px-4 py-3">
      <div class="mb-2 flex items-center gap-2">
        <span class="text-lg" style={{ color: "#ef4444" }}>
          &#10007;
        </span>
        <span class="text-sm font-medium" style={{ color: "#ef4444" }}>
          {result.errors.length} error{result.errors.length !== 1 ? "s" : ""} found
        </span>
      </div>
      <div class="space-y-1.5">
        {result.errors.map((err, i) => (
          <div
            key={i}
            class="rounded-lg border px-3 py-2 text-xs"
            style={{
              borderColor: "rgba(239, 68, 68, 0.2)",
              background: "rgba(239, 68, 68, 0.05)",
            }}
          >
            <div class="flex items-start justify-between gap-2">
              <div class="flex-1">
                <span class="font-mono font-semibold text-[var(--color-heading)]">{err.path || "/"}</span>
                <span class="ml-2 text-[var(--color-text)]">{err.message}</span>
              </div>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  color: "#f87171",
                }}
              >
                {err.keyword}
              </span>
            </div>
            <div class="mt-1 text-[10px] text-[var(--color-text-muted)]">Schema: {err.schemaPath}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function JsonValidator() {
  const [jsonData, setJsonData] = useState(DEFAULT_PRESET.data);
  const [jsonSchema, setJsonSchema] = useState(DEFAULT_PRESET.schema);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [autoValidate, setAutoValidate] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [dataCopyFeedback, setDataCopyFeedback] = useState(false);
  const [schemaCopyFeedback, setSchemaCopyFeedback] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const validate = useCallback(async (data: string, schema: string) => {
    setIsValidating(true);
    const errors: ParseError[] = [];

    const dataResult = tryParseJson(data, "data");
    const schemaResult = tryParseJson(schema, "schema");

    if ("error" in dataResult) errors.push(dataResult.error);
    if ("error" in schemaResult) errors.push(schemaResult.error);

    if (errors.length > 0) {
      setParseErrors(errors);
      setResult(null);
      setIsValidating(false);
      return;
    }

    setParseErrors([]);

    try {
      const Ajv = (await import("ajv")).default;
      const addFormats = (await import("ajv-formats")).default;

      const ajv = new Ajv({ allErrors: true, verbose: true });
      addFormats(ajv);

      const parsedData = (dataResult as { value: unknown }).value;
      const parsedSchema = (schemaResult as { value: unknown }).value;

      const validateFn = ajv.compile(parsedSchema as Record<string, unknown>);
      const valid = validateFn(parsedData);

      if (valid) {
        setResult({ valid: true, errors: [] });
      } else {
        const validationErrors: ValidationError[] = (validateFn.errors ?? []).map((err) => ({
          path: err.instancePath || "/",
          message: err.message ?? "Unknown error",
          schemaPath: err.schemaPath ?? "",
          keyword: err.keyword ?? "unknown",
        }));
        setResult({ valid: false, errors: validationErrors });
      }
    } catch (err: unknown) {
      setParseErrors([
        {
          source: "schema",
          message: `Schema compilation error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
      setResult(null);
    }

    setIsValidating(false);
  }, []);

  // Auto-validate with debounce
  useEffect(() => {
    if (!autoValidate) return;

    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = window.setTimeout(() => {
      validate(jsonData, jsonSchema);
    }, 300);

    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [jsonData, jsonSchema, autoValidate, validate]);

  const handleValidateClick = useCallback(() => {
    validate(jsonData, jsonSchema);
  }, [jsonData, jsonSchema, validate]);

  const handlePresetChange = useCallback(
    (e: Event) => {
      const select = e.target as HTMLSelectElement;
      const preset = PRESET_EXAMPLES.find((p) => p.label === select.value);
      if (preset) {
        setJsonData(preset.data);
        setJsonSchema(preset.schema);
        setResult(null);
        setParseErrors([]);
      }
    },
    []
  );

  const handleFormatData = useCallback(() => {
    setJsonData((prev) => tryFormatJson(prev));
  }, []);

  const handleFormatSchema = useCallback(() => {
    setJsonSchema((prev) => tryFormatJson(prev));
  }, []);

  const handleClearData = useCallback(() => {
    setJsonData("");
    setResult(null);
    setParseErrors([]);
  }, []);

  const handleClearSchema = useCallback(() => {
    setJsonSchema("");
    setResult(null);
    setParseErrors([]);
  }, []);

  const handleCopyData = useCallback(async () => {
    const ok = await copyToClipboard(jsonData);
    if (ok) {
      setDataCopyFeedback(true);
      setTimeout(() => setDataCopyFeedback(false), 1500);
    }
  }, [jsonData]);

  const handleCopySchema = useCallback(async () => {
    const ok = await copyToClipboard(jsonSchema);
    if (ok) {
      setSchemaCopyFeedback(true);
      setTimeout(() => setSchemaCopyFeedback(false), 1500);
    }
  }, [jsonSchema]);

  const toggleAutoValidate = useCallback(() => {
    setAutoValidate((prev) => !prev);
  }, []);

  const errorCount = result ? result.errors.length : 0;
  const hasDataParseError = parseErrors.some((e) => e.source === "data");
  const hasSchemaParseError = parseErrors.some((e) => e.source === "schema");

  return (
    <div class="jv-container overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">JSON Schema Validator</span>
          <span class="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          <select
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none"
            onChange={handlePresetChange}
            value={PRESET_EXAMPLES.find((p) => p.data === jsonData && p.schema === jsonSchema)?.label ?? ""}
          >
            <option value="" disabled>
              Presets...
            </option>
            {PRESET_EXAMPLES.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Editor panels */}
      <div class="grid md:grid-cols-2">
        {/* JSON Data Panel */}
        <div class="border-b border-[var(--color-border)] md:border-b-0 md:border-r">
          <EditorPanel
            label="JSON Data"
            value={jsonData}
            onChange={setJsonData}
            onFormat={handleFormatData}
            onClear={handleClearData}
            onCopy={handleCopyData}
            copyFeedback={dataCopyFeedback}
            hasParseError={hasDataParseError}
          />
        </div>

        {/* JSON Schema Panel */}
        <div>
          <EditorPanel
            label="JSON Schema"
            value={jsonSchema}
            onChange={setJsonSchema}
            onFormat={handleFormatSchema}
            onClear={handleClearSchema}
            onCopy={handleCopySchema}
            copyFeedback={schemaCopyFeedback}
            hasParseError={hasSchemaParseError}
          />
        </div>
      </div>

      {/* Action bar */}
      <div class="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] px-4 py-3">
        <button
          onClick={handleValidateClick}
          disabled={isValidating}
          class="jv-validate-btn rounded-lg px-5 py-2 text-xs font-semibold text-white transition-all disabled:opacity-50"
        >
          {isValidating ? "Validating..." : "Validate"}
        </button>

        <button
          onClick={toggleAutoValidate}
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          style={{
            color: autoValidate ? "var(--color-accent)" : "var(--color-text-muted)",
            background: autoValidate ? "rgba(52, 211, 153, 0.1)" : "transparent",
          }}
        >
          <span
            class="inline-block h-2 w-2 rounded-full"
            style={{
              background: autoValidate ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
          />
          Auto-validate {autoValidate ? "ON" : "OFF"}
        </button>

        {errorCount > 0 && (
          <span
            class="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
            style={{
              background: "rgba(239, 68, 68, 0.15)",
              color: "#f87171",
            }}
          >
            {errorCount} error{errorCount !== 1 ? "s" : ""}
          </span>
        )}

        {result?.valid && (
          <span
            class="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
            style={{
              background: "rgba(52, 211, 153, 0.15)",
              color: "var(--color-accent)",
            }}
          >
            Valid
          </span>
        )}
      </div>

      {/* Validation results */}
      <div class="border-t border-[var(--color-border)]">
        <ValidationResultsPanel result={result} parseErrors={parseErrors} isValidating={isValidating} />
      </div>

      <style>{`
        .jv-container:focus-within {
          outline: none;
        }
        .jv-textarea {
          tab-size: 2;
        }
        .jv-textarea:focus {
          outline: none;
        }
        .jv-validate-btn {
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
        }
        .jv-validate-btn:hover:not(:disabled) {
          filter: brightness(1.1);
          box-shadow: 0 0 20px color-mix(in srgb, var(--color-primary) 40%, transparent);
        }
        .jv-pulse {
          background: var(--color-primary);
          animation: jv-pulse-anim 1.5s ease-in-out infinite;
        }
        @keyframes jv-pulse-anim {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}
