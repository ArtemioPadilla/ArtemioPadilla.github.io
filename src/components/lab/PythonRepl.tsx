import { useState, useRef, useEffect, useCallback } from "preact/hooks";

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.4/full/";

interface OutputLine {
  type: "stdout" | "stderr" | "info";
  text: string;
}

export default function PythonRepl() {
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState("Loading Python runtime...");
  const [running, setRunning] = useState(false);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const pyodideRef = useRef<any>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingMsg("Loading Pyodide...");
        const script = document.createElement("script");
        script.src = `${PYODIDE_CDN}pyodide.js`;
        script.async = true;
        await new Promise<void>((resolve, reject) => {
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Pyodide"));
          document.head.appendChild(script);
        });

        if (cancelled) return;
        setLoadingMsg("Initializing Python...");

        const pyodide = await (window as any).loadPyodide({
          indexURL: PYODIDE_CDN,
        });

        if (cancelled) return;
        setLoadingMsg("Loading NumPy...");
        await pyodide.loadPackage("numpy");

        if (cancelled) return;
        pyodideRef.current = pyodide;
        setLoading(false);
        setOutput([{ type: "info", text: `Python ${pyodide.version} ready (NumPy loaded)` }]);
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setOutput([{ type: "stderr", text: `Failed to load: ${err}` }]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const runCode = useCallback(async () => {
    const pyodide = pyodideRef.current;
    if (!pyodide || running) return;

    setRunning(true);
    const lines: OutputLine[] = [];

    pyodide.setStdout({
      batched: (text: string) => { lines.push({ type: "stdout", text }); },
    });
    pyodide.setStderr({
      batched: (text: string) => { lines.push({ type: "stderr", text }); },
    });

    try {
      const result = await pyodide.runPythonAsync(code);
      if (result !== undefined && result !== null) {
        lines.push({ type: "stdout", text: String(result) });
      }
    } catch (err: any) {
      lines.push({ type: "stderr", text: err.message || String(err) });
    }

    setOutput((prev) => [...prev, ...lines]);
    setRunning(false);
  }, [code, running]);

  const clearOutput = useCallback(() => {
    setOutput([]);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runCode();
    }
    // Tab inserts spaces
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = textareaRef.current;
      if (ta) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const val = ta.value;
        const newVal = val.substring(0, start) + "    " + val.substring(end);
        setCode(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 4;
        });
      }
    }
  }, [runCode]);

  if (loading) {
    return (
      <div class="repl-container flex items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-12">
        <div class="text-center">
          <div class="repl-pulse mx-auto mb-4 h-8 w-8 rounded-full"></div>
          <p class="text-sm text-[var(--color-text-muted)]">{loadingMsg}</p>
        </div>
      </div>
    );
  }

  return (
    <div class="repl-container overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">Python REPL</span>
          <span class="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={clearOutput}
            class="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
          >
            Clear
          </button>
          <button
            onClick={runCode}
            disabled={running}
            class="repl-run-btn rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
          >
            {running ? "Running..." : "Run"}
            {!running && <span class="ml-1 text-[10px] opacity-60">⌘↵</span>}
          </button>
        </div>
      </div>

      {/* Editor + Output split */}
      <div class="repl-split grid md:grid-cols-2">
        {/* Editor */}
        <div class="relative border-b border-[var(--color-border)] md:border-b-0 md:border-r">
          <div class="absolute top-2 left-3 text-[10px] font-medium tracking-wider text-[var(--color-text-muted)]/40 uppercase">
            Editor
          </div>
          <textarea
            ref={textareaRef}
            value={code}
            onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)}
            onKeyDown={handleKeyDown}
            class="repl-editor w-full resize-none bg-transparent px-4 pt-8 pb-4 font-mono text-sm leading-relaxed text-[var(--color-text)] outline-none"
            rows={14}
            spellcheck={false}
            autocorrect="off"
            autocapitalize="off"
          />
        </div>

        {/* Output */}
        <div class="relative">
          <div class="absolute top-2 left-3 text-[10px] font-medium tracking-wider text-[var(--color-text-muted)]/40 uppercase">
            Output
          </div>
          <div
            ref={outputRef}
            class="repl-output h-full min-h-[280px] overflow-auto px-4 pt-8 pb-4 font-mono text-sm leading-relaxed md:min-h-0"
          >
            {output.length === 0 ? (
              <p class="text-[var(--color-text-muted)]/40 italic">Output will appear here...</p>
            ) : (
              output.map((line, i) => (
                <div
                  key={i}
                  class={
                    line.type === "stderr"
                      ? "text-red-400"
                      : line.type === "info"
                        ? "text-[var(--color-primary)]"
                        : "repl-stdout"
                  }
                >
                  <pre class="whitespace-pre-wrap break-words">{line.text}</pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_CODE = `import numpy as np

# Generate a random matrix
A = np.random.randn(3, 3)
print("Random 3x3 matrix:")
print(np.round(A, 3))

# Eigenvalues
eigenvalues = np.linalg.eigvals(A)
print("\\nEigenvalues:")
print(np.round(eigenvalues, 3))
`;
