import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import type { ExecutionTrace } from "./types";
import { TRACER_CODE } from "./tracer.py.ts";
import CodeEditor from "./CodeEditor";
import StepControls from "./StepControls";
import StackPanel from "./StackPanel";
import HeapPanel from "./HeapPanel";
import OutputPanel from "./OutputPanel";
import ArrowOverlay from "./ArrowOverlay";

const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.4/full/";

const AUTOPLAY_INTERVAL_MS = 500;

const EXAMPLE_PRESETS: { label: string; code: string }[] = [
  {
    label: "Linked List",
    code: `# Linked list traversal
class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

# Build: 1 -> 2 -> 3
n3 = Node(3)
n2 = Node(2, n3)
n1 = Node(1, n2)

# Traverse
current = n1
while current:
    print(current.val)
    current = current.next`,
  },
  {
    label: "Variables & Types",
    code: `# Basic variables and types
x = 42
y = 3.14
name = "Python"
is_fun = True
nothing = None

# Operations
result = x + int(y)
greeting = name + " is fun!"
print(greeting)
print(result)`,
  },
  {
    label: "List Operations",
    code: `# List operations
fruits = ["apple", "banana"]
fruits.append("cherry")
fruits.append("date")

# Iteration
for fruit in fruits:
    print(fruit)

# Pop
last = fruits.pop()
print("Popped:", last)
print("Remaining:", len(fruits))`,
  },
  {
    label: "Recursion",
    code: `# Factorial with recursion
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

result = factorial(5)
print("5! =", result)`,
  },
  {
    label: "Dictionary",
    code: `# Building and accessing a dictionary
scores = {}
scores["Alice"] = 95
scores["Bob"] = 87
scores["Charlie"] = 92

# Iterate
for name, score in scores.items():
    print(name, "scored", score)

# Access
best = max(scores, key=scores.get)
print("Top scorer:", best)`,
  },
  {
    label: "Class & Objects",
    code: `# Point class with methods
class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def distance_to(self, other):
        dx = self.x - other.x
        dy = self.y - other.y
        return (dx**2 + dy**2) ** 0.5

p1 = Point(0, 0)
p2 = Point(3, 4)
d = p1.distance_to(p2)
print("Distance:", d)`,
  },
];

const DEFAULT_CODE = EXAMPLE_PRESETS[0].code;

export default function PythonTutor() {
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState("Loading Python runtime...");
  const [running, setRunning] = useState(false);
  const [code, setCode] = useState(DEFAULT_CODE);
  const [trace, setTrace] = useState<ExecutionTrace | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const pyodideRef = useRef<any>(null);
  const memoryContainerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const playIntervalRef = useRef<number | null>(null);

  // Load Pyodide (without NumPy)
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

        // Inject tracer code
        setLoadingMsg("Setting up tracer...");
        pyodide.runPython(TRACER_CODE);

        pyodideRef.current = pyodide;
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setLoadingMsg(`Failed to load: ${err}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-play interval
  useEffect(() => {
    if (isPlaying && trace) {
      playIntervalRef.current = window.setInterval(() => {
        setStepIndex((prev) => {
          const next = prev + 1;
          if (next >= trace.steps.length) {
            setIsPlaying(false);
            return prev;
          }
          return next;
        });
      }, AUTOPLAY_INTERVAL_MS);
    }

    return () => {
      if (playIntervalRef.current !== null) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, trace]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!trace) return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setStepIndex((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          setStepIndex((prev) => Math.min(trace.steps.length - 1, prev + 1));
          break;
        case "Home":
          e.preventDefault();
          setStepIndex(0);
          break;
        case "End":
          e.preventDefault();
          setStepIndex(trace.steps.length - 1);
          break;
        case " ":
          e.preventDefault();
          setIsPlaying((prev) => !prev);
          break;
      }
    },
    [trace]
  );

  const visualize = useCallback(async () => {
    const pyodide = pyodideRef.current;
    if (!pyodide || running) return;

    setRunning(true);
    setIsPlaying(false);

    try {
      const resultJson = pyodide.runPython(
        `run_with_trace(${JSON.stringify(code)})`
      );
      const parsed: ExecutionTrace = JSON.parse(resultJson);
      setTrace(parsed);
      setStepIndex(0);
    } catch (err: any) {
      setTrace({
        code,
        steps: [],
        error: err.message || String(err),
      });
      setStepIndex(0);
    }

    setRunning(false);
  }, [code, running]);

  const backToEdit = useCallback(() => {
    setTrace(null);
    setStepIndex(0);
    setIsPlaying(false);
  }, []);

  const handleExampleChange = useCallback(
    (e: Event) => {
      const select = e.target as HTMLSelectElement;
      const preset = EXAMPLE_PRESETS.find((p) => p.label === select.value);
      if (preset) {
        setCode(preset.code);
        if (trace) {
          setTrace(null);
          setStepIndex(0);
          setIsPlaying(false);
        }
      }
    },
    [trace]
  );

  // Loading state
  if (loading) {
    return (
      <div class="tutor-container flex items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-12">
        <div class="text-center">
          <div class="tutor-pulse mx-auto mb-4 h-8 w-8 rounded-full" />
          <p class="text-sm text-[var(--color-text-muted)]">{loadingMsg}</p>
        </div>
      </div>
    );
  }

  const isTraceActive = trace !== null && trace.steps.length > 0;
  const currentStep = isTraceActive ? trace.steps[stepIndex] : null;
  const currentLine = currentStep?.lineNumber ?? null;
  const exceptionLine =
    currentStep?.event === "exception" ? currentStep.lineNumber : null;

  return (
    <div
      ref={rootRef}
      class="tutor-container overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Python Tutor
          </span>
          <span class="rounded-full border border-[var(--color-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          {/* Example selector */}
          <select
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)] outline-none"
            onChange={handleExampleChange}
            value={
              EXAMPLE_PRESETS.find((p) => p.code === code)?.label ?? ""
            }
          >
            <option value="" disabled>
              Examples...
            </option>
            {EXAMPLE_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>

          {isTraceActive ? (
            <button
              onClick={backToEdit}
              class="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)]/30 hover:text-[var(--color-heading)]"
            >
              Edit Code
            </button>
          ) : (
            <button
              onClick={visualize}
              disabled={running || !code.trim()}
              class="tutor-run-btn rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-50"
            >
              {running ? "Tracing..." : "Visualize"}
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {trace?.error && (
        <div class="border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-400">
          {trace.error}
        </div>
      )}

      {/* Main content */}
      <div class="grid md:grid-cols-[3fr_2fr]">
        {/* Code editor */}
        <div class="border-b border-[var(--color-border)] md:border-b-0 md:border-r">
          <div class="px-3 pt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]/40">
            Code
          </div>
          <div class="min-h-[280px]">
            <CodeEditor
              code={code}
              onCodeChange={setCode}
              currentLine={currentLine}
              exceptionLine={exceptionLine}
              isTraceActive={isTraceActive}
            />
          </div>
        </div>

        {/* Output panel */}
        <div class="relative">
          <div class="px-3 pt-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]/40">
            Output
          </div>
          <div class="min-h-[280px]">
            <OutputPanel
              stdout={currentStep?.stdout ?? ""}
              exceptionMsg={currentStep?.exceptionMsg}
            />
          </div>
        </div>
      </div>

      {/* Step controls (only when trace active) */}
      {isTraceActive && currentStep && (
        <>
          <div class="border-t border-[var(--color-border)]">
            <StepControls
              stepIndex={stepIndex}
              totalSteps={trace.steps.length}
              onStepChange={setStepIndex}
              isPlaying={isPlaying}
              onTogglePlay={() => setIsPlaying((prev) => !prev)}
              currentEvent={currentStep.event}
            />
          </div>

          {/* Stack + Heap memory layout */}
          <div class="border-t border-[var(--color-border)]">
            <div
              ref={memoryContainerRef}
              class="relative grid md:grid-cols-[35%_65%]"
            >
              <div class="border-b border-[var(--color-border)] md:border-b-0 md:border-r">
                <StackPanel stack={currentStep.stack} />
              </div>
              <div>
                <HeapPanel heap={currentStep.heap} />
              </div>
              <ArrowOverlay
                containerRef={memoryContainerRef}
                stepIndex={stepIndex}
              />
            </div>
          </div>
        </>
      )}

      {/* Keyboard hint */}
      {isTraceActive && (
        <div class="border-t border-[var(--color-border)] px-4 py-1.5 text-center text-[10px] text-[var(--color-text-muted)]/40">
          Arrow keys to step &middot; Space to play/pause &middot; Home/End to
          jump
        </div>
      )}

      <style>{`
        .tutor-pulse {
          background: var(--color-primary);
          animation: tutor-pulse-anim 1.5s ease-in-out infinite;
        }
        @keyframes tutor-pulse-anim {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        .tutor-run-btn {
          background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
        }
        .tutor-run-btn:hover:not(:disabled) {
          filter: brightness(1.1);
          box-shadow: 0 0 20px color-mix(in srgb, var(--color-primary) 40%, transparent);
        }
        .tutor-container:focus {
          outline: none;
        }
      `}</style>
    </div>
  );
}
