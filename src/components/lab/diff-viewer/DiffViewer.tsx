import { useState, useMemo, useCallback, useRef, useEffect } from "preact/hooks";
import type { JSX } from "preact";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface WordDiff {
  type: "add" | "remove" | "equal";
  text: string;
}

interface DiffLine {
  type: "add" | "remove" | "equal" | "modify";
  oldLine?: string;
  newLine?: string;
  oldLineNum?: number;
  newLineNum?: number;
  wordDiffs?: WordDiff[];
}

interface DiffOptions {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
}

interface DiffStats {
  additions: number;
  deletions: number;
  modifications: number;
  unchanged: number;
}

type ViewMode = "side-by-side" | "unified" | "inline";

/* ──────────────────────────────────────
   Diff Algorithm (LCS-based)
   ────────────────────────────────────── */

function normalizeLine(line: string, options: DiffOptions): string {
  let result = line;
  if (options.ignoreWhitespace) {
    result = result.replace(/\s+/g, " ").trim();
  }
  if (options.ignoreCase) {
    result = result.toLowerCase();
  }
  return result;
}

function computeLCS(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

function backtrackLCS(
  dp: number[][],
  a: string[],
  b: string[],
  i: number,
  j: number
): Array<{ type: "equal" | "remove" | "add"; aIdx?: number; bIdx?: number }> {
  const result: Array<{
    type: "equal" | "remove" | "add";
    aIdx?: number;
    bIdx?: number;
  }> = [];

  let ci = i;
  let cj = j;

  while (ci > 0 || cj > 0) {
    if (ci > 0 && cj > 0 && a[ci - 1] === b[cj - 1]) {
      result.push({ type: "equal", aIdx: ci - 1, bIdx: cj - 1 });
      ci--;
      cj--;
    } else if (cj > 0 && (ci === 0 || dp[ci][cj - 1] >= dp[ci - 1][cj])) {
      result.push({ type: "add", bIdx: cj - 1 });
      cj--;
    } else {
      result.push({ type: "remove", aIdx: ci - 1 });
      ci--;
    }
  }

  return result.reverse();
}

function computeWordDiff(oldLine: string, newLine: string): WordDiff[] {
  const oldWords = tokenizeWords(oldLine);
  const newWords = tokenizeWords(newLine);

  const dp = computeLCS(oldWords, newWords);
  const ops = backtrackLCS(dp, oldWords, newWords, oldWords.length, newWords.length);

  const wordDiffs: WordDiff[] = [];

  for (const op of ops) {
    if (op.type === "equal" && op.aIdx !== undefined) {
      wordDiffs.push({ type: "equal", text: oldWords[op.aIdx] });
    } else if (op.type === "remove" && op.aIdx !== undefined) {
      wordDiffs.push({ type: "remove", text: oldWords[op.aIdx] });
    } else if (op.type === "add" && op.bIdx !== undefined) {
      wordDiffs.push({ type: "add", text: newWords[op.bIdx] });
    }
  }

  return mergeAdjacentWordDiffs(wordDiffs);
}

function mergeAdjacentWordDiffs(diffs: WordDiff[]): WordDiff[] {
  if (diffs.length === 0) return diffs;

  const merged: WordDiff[] = [diffs[0]];
  for (let i = 1; i < diffs.length; i++) {
    const last = merged[merged.length - 1];
    if (last.type === diffs[i].type) {
      last.text += diffs[i].text;
    } else {
      merged.push({ ...diffs[i] });
    }
  }
  return merged;
}

function tokenizeWords(text: string): string[] {
  const tokens: string[] = [];
  const regex = /(\s+|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const aWords = tokenizeWords(a);
  const bWords = tokenizeWords(b);
  const dp = computeLCS(aWords, bWords);
  const lcsLen = dp[aWords.length][bWords.length];
  return (2 * lcsLen) / (aWords.length + bWords.length);
}

function computeDiff(
  original: string,
  modified: string,
  options: DiffOptions
): DiffLine[] {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");

  const MAX_LINES = 10000;
  const truncatedOld = oldLines.slice(0, MAX_LINES);
  const truncatedNew = newLines.slice(0, MAX_LINES);

  const normalizedOld = truncatedOld.map((l) => normalizeLine(l, options));
  const normalizedNew = truncatedNew.map((l) => normalizeLine(l, options));

  const dp = computeLCS(normalizedOld, normalizedNew);
  const ops = backtrackLCS(
    dp,
    normalizedOld,
    normalizedNew,
    normalizedOld.length,
    normalizedNew.length
  );

  const rawDiffs: DiffLine[] = [];

  for (const op of ops) {
    if (op.type === "equal" && op.aIdx !== undefined && op.bIdx !== undefined) {
      rawDiffs.push({
        type: "equal",
        oldLine: truncatedOld[op.aIdx],
        newLine: truncatedNew[op.bIdx],
        oldLineNum: op.aIdx + 1,
        newLineNum: op.bIdx + 1,
      });
    } else if (op.type === "remove" && op.aIdx !== undefined) {
      rawDiffs.push({
        type: "remove",
        oldLine: truncatedOld[op.aIdx],
        oldLineNum: op.aIdx + 1,
      });
    } else if (op.type === "add" && op.bIdx !== undefined) {
      rawDiffs.push({
        type: "add",
        newLine: truncatedNew[op.bIdx],
        newLineNum: op.bIdx + 1,
      });
    }
  }

  return detectModifications(rawDiffs);
}

function detectModifications(diffs: DiffLine[]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = 0;

  while (i < diffs.length) {
    if (diffs[i].type === "remove") {
      const removes: DiffLine[] = [];
      while (i < diffs.length && diffs[i].type === "remove") {
        removes.push(diffs[i]);
        i++;
      }
      const adds: DiffLine[] = [];
      while (i < diffs.length && diffs[i].type === "add") {
        adds.push(diffs[i]);
        i++;
      }

      const pairCount = Math.min(removes.length, adds.length);
      for (let p = 0; p < pairCount; p++) {
        const oldText = removes[p].oldLine ?? "";
        const newText = adds[p].newLine ?? "";
        const sim = similarity(oldText, newText);

        if (sim > 0.3) {
          result.push({
            type: "modify",
            oldLine: oldText,
            newLine: newText,
            oldLineNum: removes[p].oldLineNum,
            newLineNum: adds[p].newLineNum,
            wordDiffs: computeWordDiff(oldText, newText),
          });
        } else {
          result.push(removes[p]);
          result.push(adds[p]);
        }
      }

      for (let p = pairCount; p < removes.length; p++) {
        result.push(removes[p]);
      }
      for (let p = pairCount; p < adds.length; p++) {
        result.push(adds[p]);
      }
    } else {
      result.push(diffs[i]);
      i++;
    }
  }

  return result;
}

function computeStats(diffs: DiffLine[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  let modifications = 0;
  let unchanged = 0;

  for (const d of diffs) {
    switch (d.type) {
      case "add":
        additions++;
        break;
      case "remove":
        deletions++;
        break;
      case "modify":
        modifications++;
        break;
      case "equal":
        unchanged++;
        break;
    }
  }

  return { additions, deletions, modifications, unchanged };
}

function generateUnifiedDiffText(diffs: DiffLine[]): string {
  const lines: string[] = [];
  lines.push("--- original");
  lines.push("+++ modified");

  for (const d of diffs) {
    switch (d.type) {
      case "equal":
        lines.push(` ${d.oldLine ?? ""}`);
        break;
      case "remove":
        lines.push(`-${d.oldLine ?? ""}`);
        break;
      case "add":
        lines.push(`+${d.newLine ?? ""}`);
        break;
      case "modify":
        lines.push(`-${d.oldLine ?? ""}`);
        lines.push(`+${d.newLine ?? ""}`);
        break;
    }
  }

  return lines.join("\n");
}

/* ──────────────────────────────────────
   Presets
   ────────────────────────────────────── */

interface Preset {
  label: string;
  original: string;
  modified: string;
}

const PRESETS: Preset[] = [
  {
    label: "Simple text edit",
    original:
      "The quick brown fox jumps over the lazy dog.\nShe sells sea shells by the sea shore.\nPeter Piper picked a peck of pickled peppers.\nHow much wood would a woodchuck chuck?",
    modified:
      "The quick red fox leaps over the lazy dog.\nShe sells sea shells by the ocean shore.\nPeter Piper picked a peck of pickled peppers.\nHow much wood could a woodchuck chuck?",
  },
  {
    label: "Code refactoring",
    original: `function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
  return total;
}

function formatPrice(amount) {
  return "$" + amount.toFixed(2);
}`,
    modified: `function calculateTotal(items, taxRate = 0) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  return subtotal * (1 + taxRate);
}

function formatPrice(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}`,
  },
  {
    label: "JSON comparison",
    original: `{
  "name": "my-app",
  "version": "1.0.0",
  "description": "A sample application",
  "dependencies": {
    "express": "^4.17.1",
    "lodash": "^4.17.21"
  },
  "scripts": {
    "start": "node index.js",
    "test": "jest"
  }
}`,
    modified: `{
  "name": "my-app",
  "version": "2.0.0",
  "description": "A production-ready application",
  "dependencies": {
    "express": "^4.18.2",
    "lodash": "^4.17.21",
    "helmet": "^7.1.0"
  },
  "scripts": {
    "start": "node index.js",
    "test": "vitest",
    "build": "tsc && vite build"
  }
}`,
  },
  {
    label: "Config change",
    original: `server:
  host: localhost
  port: 3000
  debug: true

database:
  host: localhost
  port: 5432
  name: myapp_dev
  pool_size: 5

logging:
  level: debug
  format: text`,
    modified: `server:
  host: 0.0.0.0
  port: 8080
  debug: false

database:
  host: db.production.internal
  port: 5432
  name: myapp_prod
  pool_size: 20

logging:
  level: warn
  format: json

cache:
  enabled: true
  ttl: 3600`,
  },
];

/* ──────────────────────────────────────
   Icons (inline SVG for zero deps)
   ────────────────────────────────────── */

function SwapIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M7 16V4m0 0L3 8m4-4l4 4" />
      <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
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

function ClearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

/* ──────────────────────────────────────
   Rendering Helpers
   ────────────────────────────────────── */

const COLORS = {
  addBg: "rgba(52, 211, 153, 0.15)",
  addBorder: "rgba(52, 211, 153, 0.6)",
  addText: "rgba(52, 211, 153, 0.9)",
  removeBg: "rgba(239, 68, 68, 0.15)",
  removeBorder: "rgba(239, 68, 68, 0.6)",
  removeText: "rgba(239, 68, 68, 0.9)",
  modifyBg: "rgba(251, 191, 36, 0.1)",
  modifyBorder: "rgba(251, 191, 36, 0.5)",
  wordAdd: "rgba(52, 211, 153, 0.3)",
  wordRemove: "rgba(239, 68, 68, 0.3)",
} as const;

function renderWordDiffs(
  wordDiffs: WordDiff[],
  side: "old" | "new"
): JSX.Element {
  return (
    <span>
      {wordDiffs.map((wd, i) => {
        if (wd.type === "equal") {
          return <span key={i}>{wd.text}</span>;
        }
        if (wd.type === "remove" && side === "old") {
          return (
            <span
              key={i}
              style={{
                backgroundColor: COLORS.wordRemove,
                borderRadius: "2px",
                textDecoration: "line-through",
                textDecorationColor: COLORS.removeText,
              }}
            >
              {wd.text}
            </span>
          );
        }
        if (wd.type === "add" && side === "new") {
          return (
            <span
              key={i}
              style={{
                backgroundColor: COLORS.wordAdd,
                borderRadius: "2px",
              }}
            >
              {wd.text}
            </span>
          );
        }
        return null;
      })}
    </span>
  );
}

function renderWordDiffsUnified(wordDiffs: WordDiff[]): JSX.Element {
  return (
    <span>
      {wordDiffs.map((wd, i) => {
        if (wd.type === "equal") {
          return <span key={i}>{wd.text}</span>;
        }
        if (wd.type === "remove") {
          return (
            <span
              key={i}
              style={{
                backgroundColor: COLORS.wordRemove,
                borderRadius: "2px",
                textDecoration: "line-through",
                textDecorationColor: COLORS.removeText,
              }}
            >
              {wd.text}
            </span>
          );
        }
        if (wd.type === "add") {
          return (
            <span
              key={i}
              style={{
                backgroundColor: COLORS.wordAdd,
                borderRadius: "2px",
              }}
            >
              {wd.text}
            </span>
          );
        }
        return null;
      })}
    </span>
  );
}

function LineNumber({
  num,
  type,
}: {
  num?: number;
  type: DiffLine["type"];
}): JSX.Element {
  const color =
    type === "add"
      ? COLORS.addText
      : type === "remove"
        ? COLORS.removeText
        : type === "modify"
          ? "rgba(251, 191, 36, 0.7)"
          : "var(--color-text-muted)";

  return (
    <span
      class="inline-block w-[3ch] select-none text-right"
      style={{ color, opacity: num ? 1 : 0.3 }}
    >
      {num ?? " "}
    </span>
  );
}

function DiffPrefix({ type }: { type: DiffLine["type"] }): JSX.Element {
  const char =
    type === "add" ? "+" : type === "remove" ? "-" : type === "modify" ? "~" : " ";
  const color =
    type === "add"
      ? COLORS.addText
      : type === "remove"
        ? COLORS.removeText
        : type === "modify"
          ? "rgba(251, 191, 36, 0.7)"
          : "transparent";

  return (
    <span
      class="inline-block w-[2ch] select-none text-center font-bold"
      style={{ color }}
    >
      {char}
    </span>
  );
}

function lineStyle(type: DiffLine["type"]): Record<string, string> {
  switch (type) {
    case "add":
      return {
        backgroundColor: COLORS.addBg,
        borderLeft: `3px solid ${COLORS.addBorder}`,
      };
    case "remove":
      return {
        backgroundColor: COLORS.removeBg,
        borderLeft: `3px solid ${COLORS.removeBorder}`,
      };
    case "modify":
      return {
        backgroundColor: COLORS.modifyBg,
        borderLeft: `3px solid ${COLORS.modifyBorder}`,
      };
    default:
      return { borderLeft: "3px solid transparent" };
  }
}

/* ──────────────────────────────────────
   View Components
   ────────────────────────────────────── */

function SideBySideView({
  diffs,
  wordWrap,
}: {
  diffs: DiffLine[];
  wordWrap: boolean;
}): JSX.Element {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const handleScroll = useCallback(
    (source: "left" | "right") => {
      if (syncing.current) return;
      syncing.current = true;

      const from = source === "left" ? leftRef.current : rightRef.current;
      const to = source === "left" ? rightRef.current : leftRef.current;

      if (from && to) {
        to.scrollTop = from.scrollTop;
        to.scrollLeft = from.scrollLeft;
      }

      requestAnimationFrame(() => {
        syncing.current = false;
      });
    },
    []
  );

  const wrapStyle = wordWrap
    ? { whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const }
    : { whiteSpace: "pre" as const };

  return (
    <div class="grid grid-cols-2 divide-x divide-[var(--color-border)]">
      {/* Left (Original) */}
      <div
        ref={leftRef}
        class="overflow-auto"
        style={{ maxHeight: "500px" }}
        onScroll={() => handleScroll("left")}
      >
        <div class="px-1 py-1" style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}>
          {diffs.map((d, i) => {
            const showType = d.type === "add" ? "equal" : d.type;
            const isEmpty = d.type === "add";
            return (
              <div
                key={i}
                class="flex items-start gap-1 px-1"
                style={{
                  ...lineStyle(isEmpty ? "equal" : showType),
                  minHeight: "1.5em",
                  lineHeight: "1.5em",
                  opacity: isEmpty ? 0.3 : 1,
                  ...wrapStyle,
                }}
              >
                <LineNumber num={d.oldLineNum} type={isEmpty ? "equal" : showType} />
                <DiffPrefix type={isEmpty ? "equal" : showType} />
                <span class="flex-1" style={{ color: "var(--color-text)" }}>
                  {isEmpty ? (
                    ""
                  ) : d.type === "modify" && d.wordDiffs ? (
                    renderWordDiffs(d.wordDiffs, "old")
                  ) : (
                    d.oldLine ?? ""
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right (Modified) */}
      <div
        ref={rightRef}
        class="overflow-auto"
        style={{ maxHeight: "500px" }}
        onScroll={() => handleScroll("right")}
      >
        <div class="px-1 py-1" style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}>
          {diffs.map((d, i) => {
            const showType = d.type === "remove" ? "equal" : d.type;
            const isEmpty = d.type === "remove";
            return (
              <div
                key={i}
                class="flex items-start gap-1 px-1"
                style={{
                  ...lineStyle(isEmpty ? "equal" : showType),
                  minHeight: "1.5em",
                  lineHeight: "1.5em",
                  opacity: isEmpty ? 0.3 : 1,
                  ...wrapStyle,
                }}
              >
                <LineNumber num={d.newLineNum} type={isEmpty ? "equal" : showType} />
                <DiffPrefix type={isEmpty ? "equal" : showType} />
                <span class="flex-1" style={{ color: "var(--color-text)" }}>
                  {isEmpty ? (
                    ""
                  ) : d.type === "modify" && d.wordDiffs ? (
                    renderWordDiffs(d.wordDiffs, "new")
                  ) : (
                    d.newLine ?? d.oldLine ?? ""
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function UnifiedView({
  diffs,
  wordWrap,
}: {
  diffs: DiffLine[];
  wordWrap: boolean;
}): JSX.Element {
  const wrapStyle = wordWrap
    ? { whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const }
    : { whiteSpace: "pre" as const };

  const lines: JSX.Element[] = [];

  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];

    if (d.type === "equal") {
      lines.push(
        <div
          key={`eq-${i}`}
          class="flex items-start gap-1 px-1"
          style={{ ...lineStyle("equal"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
        >
          <LineNumber num={d.oldLineNum} type="equal" />
          <LineNumber num={d.newLineNum} type="equal" />
          <DiffPrefix type="equal" />
          <span class="flex-1" style={{ color: "var(--color-text)" }}>
            {d.oldLine ?? ""}
          </span>
        </div>
      );
    } else if (d.type === "remove") {
      lines.push(
        <div
          key={`rm-${i}`}
          class="flex items-start gap-1 px-1"
          style={{ ...lineStyle("remove"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
        >
          <LineNumber num={d.oldLineNum} type="remove" />
          <LineNumber num={undefined} type="remove" />
          <DiffPrefix type="remove" />
          <span class="flex-1" style={{ color: "var(--color-text)" }}>
            {d.oldLine ?? ""}
          </span>
        </div>
      );
    } else if (d.type === "add") {
      lines.push(
        <div
          key={`add-${i}`}
          class="flex items-start gap-1 px-1"
          style={{ ...lineStyle("add"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
        >
          <LineNumber num={undefined} type="add" />
          <LineNumber num={d.newLineNum} type="add" />
          <DiffPrefix type="add" />
          <span class="flex-1" style={{ color: "var(--color-text)" }}>
            {d.newLine ?? ""}
          </span>
        </div>
      );
    } else if (d.type === "modify") {
      lines.push(
        <div
          key={`mod-old-${i}`}
          class="flex items-start gap-1 px-1"
          style={{ ...lineStyle("remove"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
        >
          <LineNumber num={d.oldLineNum} type="remove" />
          <LineNumber num={undefined} type="remove" />
          <DiffPrefix type="remove" />
          <span class="flex-1" style={{ color: "var(--color-text)" }}>
            {d.wordDiffs ? renderWordDiffs(d.wordDiffs, "old") : d.oldLine ?? ""}
          </span>
        </div>
      );
      lines.push(
        <div
          key={`mod-new-${i}`}
          class="flex items-start gap-1 px-1"
          style={{ ...lineStyle("add"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
        >
          <LineNumber num={undefined} type="add" />
          <LineNumber num={d.newLineNum} type="add" />
          <DiffPrefix type="add" />
          <span class="flex-1" style={{ color: "var(--color-text)" }}>
            {d.wordDiffs ? renderWordDiffs(d.wordDiffs, "new") : d.newLine ?? ""}
          </span>
        </div>
      );
    }
  }

  return (
    <div class="overflow-auto" style={{ maxHeight: "500px" }}>
      <div class="px-1 py-1" style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}>
        {lines}
      </div>
    </div>
  );
}

function InlineView({
  diffs,
  wordWrap,
}: {
  diffs: DiffLine[];
  wordWrap: boolean;
}): JSX.Element {
  const wrapStyle = wordWrap
    ? { whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const }
    : { whiteSpace: "pre" as const };

  return (
    <div class="overflow-auto" style={{ maxHeight: "500px" }}>
      <div class="px-1 py-1" style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}>
        {diffs.map((d, i) => {
          if (d.type === "equal") {
            return (
              <div
                key={i}
                class="flex items-start gap-1 px-1"
                style={{ ...lineStyle("equal"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
              >
                <LineNumber num={d.newLineNum} type="equal" />
                <span class="flex-1" style={{ color: "var(--color-text)" }}>
                  {d.oldLine ?? ""}
                </span>
              </div>
            );
          }
          if (d.type === "modify" && d.wordDiffs) {
            return (
              <div
                key={i}
                class="flex items-start gap-1 px-1"
                style={{ ...lineStyle("modify"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
              >
                <LineNumber num={d.newLineNum} type="modify" />
                <span class="flex-1" style={{ color: "var(--color-text)" }}>
                  {renderWordDiffsUnified(d.wordDiffs)}
                </span>
              </div>
            );
          }
          if (d.type === "remove") {
            return (
              <div
                key={i}
                class="flex items-start gap-1 px-1"
                style={{ ...lineStyle("remove"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
              >
                <LineNumber num={d.oldLineNum} type="remove" />
                <span
                  class="flex-1"
                  style={{
                    color: "var(--color-text)",
                    textDecoration: "line-through",
                    textDecorationColor: COLORS.removeText,
                    opacity: 0.7,
                  }}
                >
                  {d.oldLine ?? ""}
                </span>
              </div>
            );
          }
          if (d.type === "add") {
            return (
              <div
                key={i}
                class="flex items-start gap-1 px-1"
                style={{ ...lineStyle("add"), minHeight: "1.5em", lineHeight: "1.5em", ...wrapStyle }}
              >
                <LineNumber num={d.newLineNum} type="add" />
                <span class="flex-1" style={{ color: "var(--color-text)" }}>
                  {d.newLine ?? ""}
                </span>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Main Component
   ────────────────────────────────────── */

export default function DiffViewer(): JSX.Element {
  const defaultPreset = PRESETS[0];

  const [originalText, setOriginalText] = useState(defaultPreset.original);
  const [modifiedText, setModifiedText] = useState(defaultPreset.modified);
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [hasCompared, setHasCompared] = useState(true);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const options = useMemo<DiffOptions>(
    () => ({ ignoreWhitespace, ignoreCase }),
    [ignoreWhitespace, ignoreCase]
  );

  const diffs = useMemo(() => {
    if (!hasCompared) return [];
    return computeDiff(originalText, modifiedText, options);
  }, [originalText, modifiedText, options, hasCompared]);

  const stats = useMemo(() => computeStats(diffs), [diffs]);

  const unifiedText = useMemo(() => generateUnifiedDiffText(diffs), [diffs]);

  const handleCopy = useCallback((text: string, label: string) => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopyFeedback(label);
      copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, []);

  const handleSwapStable = useCallback(() => {
    setOriginalText((prevOrig) => {
      setModifiedText(prevOrig);
      return modifiedText;
    });
  }, [modifiedText]);

  const handleClear = useCallback(() => {
    setOriginalText("");
    setModifiedText("");
    setHasCompared(false);
  }, []);

  const loadPreset = useCallback((e: JSX.TargetedEvent<HTMLSelectElement>) => {
    const index = parseInt(e.currentTarget.value, 10);
    if (isNaN(index) || index < 0) return;
    const preset = PRESETS[index];
    setOriginalText(preset.original);
    setModifiedText(preset.modified);
    setHasCompared(true);
  }, []);

  useEffect(() => {
    if (originalText || modifiedText) {
      setHasCompared(true);
    }
  }, [originalText, modifiedText]);

  const viewModes: { key: ViewMode; label: string }[] = [
    { key: "side-by-side", label: "Side by Side" },
    { key: "unified", label: "Unified" },
    { key: "inline", label: "Inline" },
  ];

  return (
    <div
      class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
      style={{ boxShadow: "0 0 0 1px var(--color-border)" }}
    >
      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">
            Diff Viewer
          </span>
          <span
            class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
            style={{
              borderColor: "rgba(79, 143, 247, 0.3)",
              color: "var(--color-primary)",
            }}
          >
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          {copyFeedback && (
            <span
              class="text-[10px] font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              {copyFeedback} copied
            </span>
          )}
        </div>
      </div>

      {/* Text Inputs */}
      <div class="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--color-border)] border-b border-[var(--color-border)]">
        {/* Original */}
        <div class="relative">
          <div
            class="absolute top-2 left-3 z-10 text-[10px] font-medium uppercase tracking-wider"
            style={{ color: "rgba(161, 161, 170, 0.4)" }}
          >
            Original
          </div>
          <textarea
            value={originalText}
            onInput={(e) =>
              setOriginalText((e.target as HTMLTextAreaElement).value)
            }
            class="w-full resize-none bg-transparent px-4 pt-8 pb-4 text-sm leading-relaxed text-[var(--color-text)] outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              caretColor: "var(--color-primary)",
              minHeight: "180px",
            }}
            rows={8}
            spellcheck={false}
            autocorrect="off"
            autocapitalize="off"
            placeholder="Paste original text here..."
          />
        </div>

        {/* Modified */}
        <div class="relative">
          <div
            class="absolute top-2 left-3 z-10 text-[10px] font-medium uppercase tracking-wider"
            style={{ color: "rgba(161, 161, 170, 0.4)" }}
          >
            Modified
          </div>
          <textarea
            value={modifiedText}
            onInput={(e) =>
              setModifiedText((e.target as HTMLTextAreaElement).value)
            }
            class="w-full resize-none bg-transparent px-4 pt-8 pb-4 text-sm leading-relaxed text-[var(--color-text)] outline-none"
            style={{
              fontFamily: "var(--font-mono)",
              caretColor: "var(--color-primary)",
              minHeight: "180px",
            }}
            rows={8}
            spellcheck={false}
            autocorrect="off"
            autocapitalize="off"
            placeholder="Paste modified text here..."
          />
        </div>
      </div>

      {/* Controls */}
      <div class="border-b border-[var(--color-border)] px-4 py-3">
        <div class="flex flex-wrap items-center gap-2">
          {/* View mode toggles */}
          <div class="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
            {viewModes.map((vm) => (
              <button
                key={vm.key}
                onClick={() => setViewMode(vm.key)}
                class="px-3 py-1.5 text-xs font-medium transition-all"
                style={{
                  backgroundColor:
                    viewMode === vm.key
                      ? "rgba(79, 143, 247, 0.15)"
                      : "transparent",
                  color:
                    viewMode === vm.key
                      ? "var(--color-primary)"
                      : "var(--color-text-muted)",
                  borderRight:
                    vm.key !== "inline"
                      ? "1px solid var(--color-border)"
                      : "none",
                }}
              >
                {vm.label}
              </button>
            ))}
          </div>

          {/* Action buttons */}
          <button
            onClick={handleSwapStable}
            class="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
            title="Swap original and modified"
          >
            <SwapIcon />
            Swap
          </button>

          <button
            onClick={handleClear}
            class="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
            title="Clear both inputs"
          >
            <ClearIcon />
            Clear
          </button>

          <button
            onClick={() => handleCopy(unifiedText, "Diff")}
            class="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
            title="Copy unified diff to clipboard"
          >
            <CopyIcon />
            Copy Diff
          </button>

          {/* Separator */}
          <div
            class="hidden sm:block h-5 w-px"
            style={{ backgroundColor: "var(--color-border)" }}
          />

          {/* Toggles */}
          <label class="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={ignoreWhitespace}
              onChange={() => setIgnoreWhitespace(!ignoreWhitespace)}
              class="accent-[var(--color-primary)]"
            />
            Ignore whitespace
          </label>

          <label class="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={ignoreCase}
              onChange={() => setIgnoreCase(!ignoreCase)}
              class="accent-[var(--color-primary)]"
            />
            Ignore case
          </label>

          <label class="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={wordWrap}
              onChange={() => setWordWrap(!wordWrap)}
              class="accent-[var(--color-primary)]"
            />
            Word wrap
          </label>
        </div>

        {/* Presets + Stats */}
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-2">
            <label class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Examples
            </label>
            <select
              onChange={loadPreset}
              class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
            >
              <option value="-1">Select an example...</option>
              {PRESETS.map((preset, i) => (
                <option key={i} value={i}>
                  {preset.label}
                </option>
              ))}
            </select>
          </div>

          {hasCompared && diffs.length > 0 && (
            <div class="flex flex-wrap items-center gap-2 text-xs">
              {stats.additions > 0 && (
                <span
                  class="rounded-full px-2 py-0.5 font-medium"
                  style={{
                    backgroundColor: COLORS.addBg,
                    color: COLORS.addText,
                  }}
                >
                  +{stats.additions} addition{stats.additions !== 1 ? "s" : ""}
                </span>
              )}
              {stats.deletions > 0 && (
                <span
                  class="rounded-full px-2 py-0.5 font-medium"
                  style={{
                    backgroundColor: COLORS.removeBg,
                    color: COLORS.removeText,
                  }}
                >
                  -{stats.deletions} deletion{stats.deletions !== 1 ? "s" : ""}
                </span>
              )}
              {stats.modifications > 0 && (
                <span
                  class="rounded-full px-2 py-0.5 font-medium"
                  style={{
                    backgroundColor: COLORS.modifyBg,
                    color: "rgba(251, 191, 36, 0.9)",
                  }}
                >
                  ~{stats.modifications} modification
                  {stats.modifications !== 1 ? "s" : ""}
                </span>
              )}
              <span class="text-[var(--color-text-muted)]">
                {stats.unchanged} unchanged
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Diff Output */}
      {hasCompared && diffs.length > 0 ? (
        <div>
          {/* Column headers for side-by-side */}
          {viewMode === "side-by-side" && (
            <div class="grid grid-cols-2 divide-x divide-[var(--color-border)] border-b border-[var(--color-border)]">
              <div class="px-3 py-1.5">
                <span
                  class="text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: COLORS.removeText }}
                >
                  Original
                </span>
              </div>
              <div class="px-3 py-1.5">
                <span
                  class="text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: COLORS.addText }}
                >
                  Modified
                </span>
              </div>
            </div>
          )}

          {viewMode === "side-by-side" && (
            <SideBySideView diffs={diffs} wordWrap={wordWrap} />
          )}
          {viewMode === "unified" && (
            <UnifiedView diffs={diffs} wordWrap={wordWrap} />
          )}
          {viewMode === "inline" && (
            <InlineView diffs={diffs} wordWrap={wordWrap} />
          )}
        </div>
      ) : (
        <div class="px-4 py-12 text-center">
          <p
            class="text-sm italic"
            style={{ color: "rgba(161, 161, 170, 0.4)" }}
          >
            {!originalText && !modifiedText
              ? "Paste two texts above to see their differences..."
              : "Texts are identical."}
          </p>
        </div>
      )}
    </div>
  );
}
