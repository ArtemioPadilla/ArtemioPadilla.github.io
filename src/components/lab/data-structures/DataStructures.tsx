import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "preact/hooks";

import type {
  StructureType,
  AnimationStep,
  TreeNode,
  HeapData,
  HashTableData,
  ListNode,
  StackData,
  QueueData,
} from "./structures";

import {
  resetNodeIds,
  bstInsert,
  bstSearch,
  bstDelete,
  bstInOrder,
  avlInsert,
  avlDelete,
  heapCreate,
  heapInsert,
  heapExtract,
  heapSearch,
  hashTableCreate,
  hashTableInsert,
  hashTableSearch,
  hashTableDelete,
  listCreate,
  listInsertFront,
  listInsertBack,
  listDelete,
  listSearch,
  stackCreate,
  stackPush,
  stackPop,
  queueCreate,
  queueEnqueue,
  queueDequeue,
  layoutTree,
} from "./structures";

import {
  readThemeColors,
  renderTree,
  renderHeap,
  renderHashTable,
  renderLinkedList,
  renderStack,
  renderQueue,
} from "./renderers";
import type { ThemeColors, HighlightType } from "./renderers";

import {
  getPseudocode,
  getComplexity,
} from "./pseudocode";
import type { PseudocodeEntry, ComplexityInfo } from "./pseudocode";

/* ──────────────────────────────────────────────────
   Constants
   ────────────────────────────────────────────────── */

const STRUCTURE_OPTIONS: Array<{ value: StructureType; label: string }> = [
  { value: "bst", label: "Binary Search Tree" },
  { value: "avl", label: "AVL Tree" },
  { value: "min-heap", label: "Min Heap" },
  { value: "max-heap", label: "Max Heap" },
  { value: "hash-table", label: "Hash Table" },
  { value: "linked-list", label: "Linked List" },
  { value: "stack", label: "Stack" },
  { value: "queue", label: "Queue" },
];

interface OperationButton {
  label: string;
  op: string;
  needsValue: boolean;
}

function operationButtons(st: StructureType): OperationButton[] {
  switch (st) {
    case "bst":
    case "avl":
      return [
        { label: "Insert", op: "insert", needsValue: true },
        { label: "Delete", op: "delete", needsValue: true },
        { label: "Search", op: "search", needsValue: true },
        { label: "Traverse", op: "traverse", needsValue: false },
      ];
    case "min-heap":
    case "max-heap":
      return [
        { label: "Insert", op: "insert", needsValue: true },
        { label: "Extract", op: "extract", needsValue: false },
        { label: "Search", op: "search", needsValue: true },
      ];
    case "hash-table":
      return [
        { label: "Insert", op: "insert", needsValue: true },
        { label: "Delete", op: "delete", needsValue: true },
        { label: "Search", op: "search", needsValue: true },
      ];
    case "linked-list":
      return [
        { label: "Insert Front", op: "insert-front", needsValue: true },
        { label: "Insert Back", op: "insert-back", needsValue: true },
        { label: "Delete", op: "delete", needsValue: true },
        { label: "Search", op: "search", needsValue: true },
      ];
    case "stack":
      return [
        { label: "Push", op: "push", needsValue: true },
        { label: "Pop", op: "pop", needsValue: false },
      ];
    case "queue":
      return [
        { label: "Enqueue", op: "enqueue", needsValue: true },
        { label: "Dequeue", op: "dequeue", needsValue: false },
      ];
  }
}

/* ──────────────────────────────────────────────────
   Component
   ────────────────────────────────────────────────── */

export default function DataStructures() {
  // ── State ──
  const [structureType, setStructureType] = useState<StructureType>("bst");
  const [inputValue, setInputValue] = useState("42");
  const [speed, setSpeed] = useState(500); // ms per step
  const [showCode, setShowCode] = useState(true);
  const [statusMsg, setStatusMsg] = useState("");
  const [currentPseudo, setCurrentPseudo] = useState<PseudocodeEntry | null>(null);
  const [highlightLine, setHighlightLine] = useState(-1);
  const [currentComplexity, setCurrentComplexity] = useState<ComplexityInfo | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  // ── Data refs (mutable, not in React state to avoid re-renders during animation) ──
  const bstRootRef = useRef<TreeNode | null>(null);
  const avlRootRef = useRef<TreeNode | null>(null);
  const heapRef = useRef<HeapData>(heapCreate(false));
  const hashRef = useRef<HashTableData>(hashTableCreate(7));
  const listRef = useRef<ListNode | null>(listCreate());
  const stackRef = useRef<StackData>(stackCreate());
  const queueRef = useRef<QueueData>(queueCreate());

  // ── Canvas ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef(0);
  const animTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colorsRef = useRef<ThemeColors | null>(null);

  // ── Canvas sizing ──
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 400 });

  const updateCanvasSize = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.floor(Math.max(300, Math.min(500, window.innerHeight * 0.45)));
    setCanvasSize({ w, h });

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    }
  }, []);

  // ── Resize observer ──
  useEffect(() => {
    updateCanvasSize();
    const observer = new ResizeObserver(updateCanvasSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateCanvasSize]);

  // ── Theme colors ──
  useEffect(() => {
    function updateColors(): void {
      colorsRef.current = readThemeColors();
      renderCurrentState();
    }
    updateColors();
    const obs = new MutationObserver(updateColors);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, [structureType]);

  // ── Reset on structure change ──
  useEffect(() => {
    resetAllData();
    renderCurrentState();
  }, [structureType, canvasSize]);

  // ── Render current state (no highlights) ──
  const renderCurrentState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors = colorsRef.current ?? readThemeColors();
    const { w, h } = canvasSize;
    const empty = new Set<number>();

    switch (structureType) {
      case "bst":
        layoutTree(bstRootRef.current, w);
        renderTree(ctx, bstRootRef.current, w, h, colors, empty, "none", false);
        break;
      case "avl":
        layoutTree(avlRootRef.current, w);
        renderTree(ctx, avlRootRef.current, w, h, colors, empty, "none", true);
        break;
      case "min-heap":
      case "max-heap":
        renderHeap(ctx, heapRef.current, w, h, colors, empty, "none");
        break;
      case "hash-table":
        renderHashTable(ctx, hashRef.current, w, h, colors, empty, "none", -1);
        break;
      case "linked-list":
        renderLinkedList(ctx, listRef.current, w, h, colors, empty, "none");
        break;
      case "stack":
        renderStack(ctx, stackRef.current, w, h, colors, empty, "none");
        break;
      case "queue":
        renderQueue(ctx, queueRef.current, w, h, colors, empty, "none");
        break;
    }
  }, [structureType, canvasSize]);

  // ── Reset data ──
  function resetAllData(): void {
    resetNodeIds();
    bstRootRef.current = null;
    avlRootRef.current = null;
    heapRef.current = heapCreate(structureType === "max-heap");
    hashRef.current = hashTableCreate(7);
    listRef.current = listCreate();
    stackRef.current = stackCreate();
    queueRef.current = queueCreate();
    setStatusMsg("");
    setCurrentPseudo(null);
    setHighlightLine(-1);
    setCurrentComplexity(null);
  }

  // ── Animate steps ──
  function animateSteps(steps: AnimationStep[]): void {
    if (steps.length === 0) {
      renderCurrentState();
      return;
    }

    setIsAnimating(true);
    let idx = 0;

    function playStep(): void {
      if (idx >= steps.length) {
        setIsAnimating(false);
        setHighlightLine(-1);
        renderCurrentState();
        return;
      }

      const step = steps[idx];
      setStatusMsg(step.message);
      setHighlightLine(step.pseudocodeLine);

      // Render with highlights
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const colors = colorsRef.current ?? readThemeColors();
          const { w, h } = canvasSize;
          const hlIds = new Set(step.nodeIds);
          const hlType = step.type as HighlightType;

          switch (structureType) {
            case "bst":
              layoutTree(bstRootRef.current, w);
              renderTree(ctx, bstRootRef.current, w, h, colors, hlIds, hlType, false);
              break;
            case "avl":
              layoutTree(avlRootRef.current, w);
              renderTree(ctx, avlRootRef.current, w, h, colors, hlIds, hlType, true);
              break;
            case "min-heap":
            case "max-heap":
              renderHeap(ctx, heapRef.current, w, h, colors, hlIds, hlType);
              break;
            case "hash-table": {
              const bucket = step.type === "highlight" ? step.nodeIds[0] ?? -1 : -1;
              renderHashTable(ctx, hashRef.current, w, h, colors, hlIds, hlType, bucket);
              break;
            }
            case "linked-list":
              renderLinkedList(ctx, listRef.current, w, h, colors, hlIds, hlType);
              break;
            case "stack":
              renderStack(ctx, stackRef.current, w, h, colors, hlIds, hlType);
              break;
            case "queue":
              renderQueue(ctx, queueRef.current, w, h, colors, hlIds, hlType);
              break;
          }
        }
      }

      idx++;
      animTimeoutRef.current = setTimeout(playStep, speed);
    }

    playStep();
  }

  // ── Execute operation ──
  function executeOp(op: string): void {
    if (isAnimating) return;

    const val = parseInt(inputValue, 10);
    const btn = operationButtons(structureType).find((b) => b.op === op);
    if (btn?.needsValue && isNaN(val)) {
      setStatusMsg("Please enter a valid integer.");
      return;
    }

    const steps: AnimationStep[] = [];
    setCurrentPseudo(getPseudocode(structureType, op));
    setCurrentComplexity(getComplexity(structureType, op));

    switch (structureType) {
      case "bst":
        if (op === "insert") bstRootRef.current = bstInsert(bstRootRef.current, val, steps);
        else if (op === "delete") bstRootRef.current = bstDelete(bstRootRef.current, val, steps);
        else if (op === "search") bstSearch(bstRootRef.current, val, steps);
        else if (op === "traverse") bstInOrder(bstRootRef.current, steps);
        break;

      case "avl":
        if (op === "insert") avlRootRef.current = avlInsert(avlRootRef.current, val, steps);
        else if (op === "delete") avlRootRef.current = avlDelete(avlRootRef.current, val, steps);
        else if (op === "search") bstSearch(avlRootRef.current, val, steps);
        else if (op === "traverse") bstInOrder(avlRootRef.current, steps);
        break;

      case "min-heap":
      case "max-heap":
        if (op === "insert") heapRef.current = heapInsert(heapRef.current, val, steps);
        else if (op === "extract") {
          const res = heapExtract(heapRef.current, steps);
          heapRef.current = res.heap;
          if (res.extracted !== null) {
            steps.push({
              type: "done",
              nodeIds: [],
              message: `Extracted: ${res.extracted}`,
              pseudocodeLine: 1,
            });
          }
        } else if (op === "search") heapSearch(heapRef.current, val, steps);
        break;

      case "hash-table":
        if (op === "insert") hashRef.current = hashTableInsert(hashRef.current, val, steps);
        else if (op === "delete") hashRef.current = hashTableDelete(hashRef.current, val, steps);
        else if (op === "search") hashTableSearch(hashRef.current, val, steps);
        break;

      case "linked-list":
        if (op === "insert-front") listRef.current = listInsertFront(listRef.current, val, steps);
        else if (op === "insert-back") listRef.current = listInsertBack(listRef.current, val, steps);
        else if (op === "delete") listRef.current = listDelete(listRef.current, val, steps);
        else if (op === "search") listSearch(listRef.current, val, steps);
        break;

      case "stack":
        if (op === "push") stackRef.current = stackPush(stackRef.current, val, steps);
        else if (op === "pop") {
          const res = stackPop(stackRef.current, steps);
          stackRef.current = res.stack;
        }
        break;

      case "queue":
        if (op === "enqueue") queueRef.current = queueEnqueue(queueRef.current, val, steps);
        else if (op === "dequeue") {
          const res = queueDequeue(queueRef.current, steps);
          queueRef.current = res.queue;
        }
        break;
    }

    animateSteps(steps);
  }

  // ── Clear on structure change ──
  function handleStructureChange(value: string): void {
    if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
    setIsAnimating(false);
    setStructureType(value as StructureType);
  }

  // ── Reset ──
  function handleReset(): void {
    if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
    setIsAnimating(false);
    resetAllData();
    requestAnimationFrame(renderCurrentState);
  }

  // ── Random insert ──
  function handleRandomInsert(): void {
    if (isAnimating) return;
    const val = Math.floor(Math.random() * 100);
    setInputValue(String(val));
    const steps: AnimationStep[] = [];
    const op = structureType === "stack"
      ? "push"
      : structureType === "queue"
        ? "enqueue"
        : structureType === "linked-list"
          ? "insert-front"
          : "insert";

    setCurrentPseudo(getPseudocode(structureType, op));
    setCurrentComplexity(getComplexity(structureType, op));

    switch (structureType) {
      case "bst":
        bstRootRef.current = bstInsert(bstRootRef.current, val, steps);
        break;
      case "avl":
        avlRootRef.current = avlInsert(avlRootRef.current, val, steps);
        break;
      case "min-heap":
      case "max-heap":
        heapRef.current = heapInsert(heapRef.current, val, steps);
        break;
      case "hash-table":
        hashRef.current = hashTableInsert(hashRef.current, val, steps);
        break;
      case "linked-list":
        listRef.current = listInsertFront(listRef.current, val, steps);
        break;
      case "stack":
        stackRef.current = stackPush(stackRef.current, val, steps);
        break;
      case "queue":
        queueRef.current = queueEnqueue(queueRef.current, val, steps);
        break;
    }

    animateSteps(steps);
  }

  // ── Key handler ──
  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      const ops = operationButtons(structureType);
      if (ops.length > 0 && ops[0].needsValue) {
        executeOp(ops[0].op);
      }
    }
  }

  // ── Cleanup ──
  useEffect(() => {
    return () => {
      if (animTimeoutRef.current) clearTimeout(animTimeoutRef.current);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // ── Render ──
  const ops = operationButtons(structureType);

  return (
    <div class="space-y-4">
      {/* Main layout: Canvas + Controls */}
      <div class="flex flex-col lg:flex-row gap-4">
        {/* Canvas area */}
        <div
          ref={containerRef}
          class="flex-1 min-w-0 rounded-lg border overflow-hidden"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-bg)",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: `${canvasSize.w}px`,
              height: `${canvasSize.h}px`,
              display: "block",
            }}
          />
        </div>

        {/* Controls panel */}
        <div
          class="w-full lg:w-64 flex-shrink-0 rounded-lg border p-4 space-y-4"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface)",
          }}
        >
          {/* Structure selector */}
          <div>
            <label
              class="block text-xs font-semibold mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Structure
            </label>
            <select
              class="w-full rounded border px-2 py-1.5 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              value={structureType}
              onChange={(e) =>
                handleStructureChange((e.target as HTMLSelectElement).value)
              }
            >
              {STRUCTURE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Value input */}
          <div>
            <label
              class="block text-xs font-semibold mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Value
            </label>
            <input
              type="number"
              class="w-full rounded border px-2 py-1.5 text-sm"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg)",
                color: "var(--color-text)",
              }}
              value={inputValue}
              onInput={(e) =>
                setInputValue((e.target as HTMLInputElement).value)
              }
              onKeyDown={handleKeyDown}
              disabled={isAnimating}
            />
          </div>

          {/* Operation buttons */}
          <div class="space-y-2">
            {ops.map((btn) => (
              <button
                key={btn.op}
                class="w-full rounded px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: isAnimating
                    ? "var(--color-border)"
                    : "var(--color-primary)",
                  color: "#ffffff",
                  opacity: isAnimating ? 0.5 : 1,
                  cursor: isAnimating ? "not-allowed" : "pointer",
                }}
                onClick={() => executeOp(btn.op)}
                disabled={isAnimating}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Utility buttons */}
          <div class="flex gap-2">
            <button
              class="flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
                backgroundColor: "var(--color-bg)",
                opacity: isAnimating ? 0.5 : 1,
              }}
              onClick={handleRandomInsert}
              disabled={isAnimating}
            >
              Random
            </button>
            <button
              class="flex-1 rounded border px-2 py-1 text-xs font-medium transition-colors"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
                backgroundColor: "var(--color-bg)",
              }}
              onClick={handleReset}
            >
              Clear
            </button>
          </div>

          {/* Speed control */}
          <div>
            <label
              class="block text-xs font-semibold mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Speed: {speed < 200 ? "Fast" : speed < 600 ? "Normal" : "Slow"}
            </label>
            <input
              type="range"
              class="w-full"
              min={50}
              max={1000}
              step={50}
              value={speed}
              onInput={(e) =>
                setSpeed(parseInt((e.target as HTMLInputElement).value, 10))
              }
              style={{ accentColor: "var(--color-primary)" }}
            />
          </div>

          {/* Complexity info */}
          {currentComplexity && (
            <div
              class="rounded border p-3 text-xs space-y-1"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg)",
              }}
            >
              <div class="font-semibold" style={{ color: "var(--color-heading)" }}>
                Complexity
              </div>
              <div style={{ color: "var(--color-text-muted)" }}>
                Avg: <span style={{ color: "var(--color-accent)" }}>{currentComplexity.average}</span>
              </div>
              <div style={{ color: "var(--color-text-muted)" }}>
                Worst: <span style={{ color: "#ef4444" }}>{currentComplexity.worst}</span>
              </div>
              <div style={{ color: "var(--color-text-muted)" }}>
                Space: <span style={{ color: "var(--color-text)" }}>{currentComplexity.space}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      {statusMsg && (
        <div
          class="rounded border px-4 py-2 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-surface)",
            color: "var(--color-text)",
          }}
        >
          {statusMsg}
        </div>
      )}

      {/* Pseudocode panel */}
      <div>
        <button
          class="text-xs font-semibold mb-2 flex items-center gap-1"
          style={{ color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer" }}
          onClick={() => setShowCode(!showCode)}
        >
          <span style={{ display: "inline-block", transform: showCode ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
            &#9654;
          </span>
          Pseudocode
        </button>
        {showCode && currentPseudo && (
          <div
            class="rounded border p-4 font-mono text-xs leading-relaxed overflow-x-auto"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "var(--color-bg)",
            }}
          >
            <div
              class="mb-2 text-xs font-semibold"
              style={{ color: "var(--color-heading)", fontFamily: "var(--font-sans)" }}
            >
              {currentPseudo.operation}
            </div>
            {currentPseudo.lines.map((line, i) => {
              const isActive = highlightLine === i + 1;
              return (
                <div
                  key={i}
                  class="px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: isActive
                      ? "var(--color-primary)"
                      : "transparent",
                    color: isActive ? "#ffffff" : "var(--color-text-muted)",
                    fontWeight: isActive ? 600 : 400,
                    transition: "background-color 0.15s, color 0.15s",
                  }}
                >
                  <span style={{ color: isActive ? "rgba(255,255,255,0.5)" : "var(--color-border)", marginRight: "8px" }}>
                    {String(i + 1).padStart(2, " ")}
                  </span>
                  {line}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
