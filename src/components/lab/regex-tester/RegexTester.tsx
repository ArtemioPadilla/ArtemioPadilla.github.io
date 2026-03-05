import { useState, useMemo, useCallback, useRef } from "preact/hooks";
import type { JSX } from "preact";

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const HIGHLIGHT_COLORS = [
  "rgba(79, 143, 247, 0.25)",
  "rgba(52, 211, 153, 0.25)",
  "rgba(251, 191, 36, 0.25)",
  "rgba(239, 68, 68, 0.25)",
  "rgba(168, 85, 247, 0.25)",
];

const HIGHLIGHT_BORDER_COLORS = [
  "rgba(79, 143, 247, 0.6)",
  "rgba(52, 211, 153, 0.6)",
  "rgba(251, 191, 36, 0.6)",
  "rgba(239, 68, 68, 0.6)",
  "rgba(168, 85, 247, 0.6)",
];

interface Preset {
  label: string;
  pattern: string;
  flags: string;
  testString: string;
}

const PRESETS: Preset[] = [
  {
    label: "Email",
    pattern: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
    flags: "g",
    testString:
      "Contact us at support@example.com or sales@company.co.uk.\nInvalid emails: @missing.com, no-at-sign.com\nAnother valid one: user.name+tag@domain.org",
  },
  {
    label: "URL",
    pattern: "https?://[\\w.-]+(?:\\.[a-z]{2,})(?:[/\\w.-]*)*(?:\\?[\\w=&.-]*)?",
    flags: "gi",
    testString:
      "Visit https://example.com or http://sub.domain.co.uk/path?q=1&lang=en\nNot a URL: ftp://files.example.com\nAnother: https://api.github.com/repos/user/repo",
  },
  {
    label: "IP Address",
    pattern: "\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b",
    flags: "g",
    testString:
      "Server IPs: 192.168.1.1, 10.0.0.255, 172.16.0.1\nInvalid: 999.999.999.999, 256.1.1.1\nLoopback: 127.0.0.1",
  },
  {
    label: "Date (YYYY-MM-DD)",
    pattern: "(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])",
    flags: "g",
    testString:
      "Start date: 2026-03-04\nEnd date: 2026-12-31\nInvalid: 2026-13-01, 2026-00-15\nAnother: 1999-06-15",
  },
  {
    label: "Phone Number",
    pattern: "(?:\\+1[-.\\s]?)?\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}",
    flags: "g",
    testString:
      "Call us: (555) 123-4567 or +1-800-555-0199\nMobile: 555.867.5309\nShort: 555-1234 (won't match)",
  },
  {
    label: "Hex Color",
    pattern: "#(?:[0-9a-fA-F]{3}){1,2}\\b",
    flags: "g",
    testString:
      "Colors: #ff0000, #00FF00, #0000ff\nShort form: #f00, #0f0, #00f\nInvalid: #xyz, #12345",
  },
];

interface ReferenceSection {
  title: string;
  items: Array<{ token: string; description: string }>;
}

const QUICK_REFERENCE: ReferenceSection[] = [
  {
    title: "Character Classes",
    items: [
      { token: ".", description: "Any character (except newline)" },
      { token: "\\d", description: "Digit [0-9]" },
      { token: "\\D", description: "Non-digit" },
      { token: "\\w", description: "Word char [a-zA-Z0-9_]" },
      { token: "\\W", description: "Non-word char" },
      { token: "\\s", description: "Whitespace" },
      { token: "\\S", description: "Non-whitespace" },
      { token: "[abc]", description: "Any of a, b, or c" },
      { token: "[^abc]", description: "Not a, b, or c" },
      { token: "[a-z]", description: "Range a to z" },
    ],
  },
  {
    title: "Quantifiers",
    items: [
      { token: "*", description: "0 or more" },
      { token: "+", description: "1 or more" },
      { token: "?", description: "0 or 1" },
      { token: "{n}", description: "Exactly n" },
      { token: "{n,}", description: "n or more" },
      { token: "{n,m}", description: "Between n and m" },
      { token: "*?", description: "0 or more (lazy)" },
      { token: "+?", description: "1 or more (lazy)" },
    ],
  },
  {
    title: "Anchors",
    items: [
      { token: "^", description: "Start of string/line" },
      { token: "$", description: "End of string/line" },
      { token: "\\b", description: "Word boundary" },
      { token: "\\B", description: "Non-word boundary" },
    ],
  },
  {
    title: "Groups & References",
    items: [
      { token: "(abc)", description: "Capture group" },
      { token: "(?:abc)", description: "Non-capturing group" },
      { token: "(?<name>abc)", description: "Named capture group" },
      { token: "\\1", description: "Back-reference to group 1" },
      { token: "(a|b)", description: "Alternation (a or b)" },
    ],
  },
  {
    title: "Lookahead & Lookbehind",
    items: [
      { token: "(?=abc)", description: "Positive lookahead" },
      { token: "(?!abc)", description: "Negative lookahead" },
      { token: "(?<=abc)", description: "Positive lookbehind" },
      { token: "(?<!abc)", description: "Negative lookbehind" },
    ],
  },
];

const FLAG_OPTIONS = [
  { flag: "g", label: "global", description: "Find all matches" },
  { flag: "i", label: "insensitive", description: "Case insensitive" },
  { flag: "m", label: "multiline", description: "^ and $ match line boundaries" },
  { flag: "s", label: "dotAll", description: ". matches newline" },
  { flag: "u", label: "unicode", description: "Unicode support" },
] as const;

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface MatchGroup {
  name: string;
  value: string;
}

interface MatchResult {
  index: number;
  fullMatch: string;
  start: number;
  end: number;
  groups: MatchGroup[];
}

interface HighlightSegment {
  text: string;
  isMatch: boolean;
  colorIndex: number;
}

/* ──────────────────────────────────────
   Helpers
   ────────────────────────────────────── */

function buildRegex(pattern: string, flags: string): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function getRegexError(pattern: string, flags: string): string | null {
  if (!pattern) return null;
  try {
    new RegExp(pattern, flags);
    return null;
  } catch (err: unknown) {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}

function extractMatches(regex: RegExp, testString: string): MatchResult[] {
  const results: MatchResult[] = [];
  const isGlobal = regex.global;
  const safeRegex = new RegExp(regex.source, regex.flags);

  let match = safeRegex.exec(testString);
  let iterations = 0;
  const maxIterations = 10000;

  while (match !== null && iterations < maxIterations) {
    iterations++;
    const groups: MatchGroup[] = [];

    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        groups.push({ name: `Group ${i}`, value: match[i] });
      }
    }

    if (match.groups) {
      for (const [name, value] of Object.entries(match.groups)) {
        if (value !== undefined) {
          const existingIndex = groups.findIndex(
            (g) => g.value === value && g.name.startsWith("Group ")
          );
          if (existingIndex !== -1) {
            groups[existingIndex].name = `${groups[existingIndex].name} (${name})`;
          }
        }
      }
    }

    results.push({
      index: results.length,
      fullMatch: match[0],
      start: match.index,
      end: match.index + match[0].length,
      groups,
    });

    if (!isGlobal) break;

    if (match[0].length === 0) {
      safeRegex.lastIndex = match.index + 1;
      if (safeRegex.lastIndex > testString.length) break;
    }

    match = safeRegex.exec(testString);
  }

  return results;
}

function buildHighlightSegments(
  testString: string,
  matches: MatchResult[]
): HighlightSegment[] {
  if (matches.length === 0) {
    return [{ text: testString, isMatch: false, colorIndex: 0 }];
  }

  const segments: HighlightSegment[] = [];
  let lastEnd = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.start > lastEnd) {
      segments.push({
        text: testString.slice(lastEnd, m.start),
        isMatch: false,
        colorIndex: 0,
      });
    }
    if (m.start >= lastEnd) {
      segments.push({
        text: testString.slice(m.start, m.end),
        isMatch: true,
        colorIndex: i % HIGHLIGHT_COLORS.length,
      });
      lastEnd = m.end;
    }
  }

  if (lastEnd < testString.length) {
    segments.push({
      text: testString.slice(lastEnd),
      isMatch: false,
      colorIndex: 0,
    });
  }

  return segments;
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.reject(new Error("Clipboard API not available"));
}

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function RegexTester() {
  const defaultPreset = PRESETS[0];

  const [pattern, setPattern] = useState(defaultPreset.pattern);
  const [flags, setFlags] = useState(parseFlagsToSet(defaultPreset.flags));
  const [testString, setTestString] = useState(defaultPreset.testString);
  const [replaceMode, setReplaceMode] = useState(false);
  const [replacePattern, setReplacePattern] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flagsString = useMemo(() => {
    return FLAG_OPTIONS.filter((f) => flags.has(f.flag)).map((f) => f.flag).join("");
  }, [flags]);

  const regexError = useMemo(() => getRegexError(pattern, flagsString), [pattern, flagsString]);

  const regex = useMemo(() => buildRegex(pattern, flagsString), [pattern, flagsString]);

  const matches = useMemo(() => {
    if (!regex || !testString) return [];
    return extractMatches(regex, testString);
  }, [regex, testString]);

  const highlightSegments = useMemo(
    () => buildHighlightSegments(testString, matches),
    [testString, matches]
  );

  const replaceResult = useMemo(() => {
    if (!regex || !replaceMode) return "";
    try {
      return testString.replace(regex, replacePattern);
    } catch {
      return "[Invalid replacement pattern]";
    }
  }, [regex, testString, replaceMode, replacePattern]);

  const toggleFlag = useCallback((flag: string) => {
    setFlags((prev) => {
      const next = new Set(prev);
      if (next.has(flag)) {
        next.delete(flag);
      } else {
        next.add(flag);
      }
      return next;
    });
  }, []);

  const loadPreset = useCallback((e: JSX.TargetedEvent<HTMLSelectElement>) => {
    const index = parseInt(e.currentTarget.value, 10);
    if (isNaN(index) || index < 0) return;
    const preset = PRESETS[index];
    setPattern(preset.pattern);
    setFlags(parseFlagsToSet(preset.flags));
    setTestString(preset.testString);
  }, []);

  const handleCopy = useCallback((text: string, label: string) => {
    copyToClipboard(text).then(() => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      setCopyFeedback(label);
      copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 2000);
    }).catch(() => {
      // Silently fail -- clipboard not available
    });
  }, []);

  return (
    <div class="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
         style={{ boxShadow: "0 0 0 1px var(--color-border)" }}>

      {/* Toolbar */}
      <div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2.5">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-[var(--color-text-muted)]">Regex Tester</span>
          <span class="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  borderColor: "rgba(79, 143, 247, 0.3)",
                  color: "var(--color-primary)",
                }}>
            beta
          </span>
        </div>
        <div class="flex items-center gap-2">
          {copyFeedback && (
            <span class="text-[10px] font-medium" style={{ color: "var(--color-accent)" }}>
              {copyFeedback} copied
            </span>
          )}
        </div>
      </div>

      {/* Pattern + Flags */}
      <div class="border-b border-[var(--color-border)] px-4 py-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* Regex input */}
          <div class="flex-1">
            <label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Pattern
            </label>
            <div class="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm"
                 style={{ fontFamily: "var(--font-mono)" }}>
              <span class="select-none text-[var(--color-text-muted)]">/</span>
              <input
                type="text"
                value={pattern}
                onInput={(e) => setPattern((e.target as HTMLInputElement).value)}
                class="flex-1 bg-transparent text-[var(--color-text)] outline-none"
                style={{ fontFamily: "var(--font-mono)" }}
                placeholder="Enter regex pattern..."
                spellcheck={false}
                autocorrect="off"
                autocapitalize="off"
              />
              <span class="select-none text-[var(--color-text-muted)]">/{flagsString}</span>
              <button
                onClick={() => handleCopy(`/${pattern}/${flagsString}`, "Regex")}
                class="ml-1 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
                title="Copy regex"
              >
                <CopyIcon />
              </button>
            </div>
            {regexError && (
              <p class="mt-1.5 text-xs" style={{ color: "rgba(239, 68, 68, 0.9)" }}>
                {regexError}
              </p>
            )}
          </div>

          {/* Flags */}
          <div>
            <label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
              Flags
            </label>
            <div class="flex gap-1">
              {FLAG_OPTIONS.map(({ flag, description }) => (
                <button
                  key={flag}
                  onClick={() => toggleFlag(flag)}
                  class="rounded-lg border px-2.5 py-1.5 font-mono text-xs font-semibold transition-all"
                  style={{
                    fontFamily: "var(--font-mono)",
                    borderColor: flags.has(flag) ? "var(--color-primary)" : "var(--color-border)",
                    backgroundColor: flags.has(flag) ? "rgba(79, 143, 247, 0.15)" : "transparent",
                    color: flags.has(flag) ? "var(--color-primary)" : "var(--color-text-muted)",
                  }}
                  title={description}
                >
                  {flag}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Preset selector */}
        <div class="mt-3 flex items-center gap-2">
          <label class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Presets
          </label>
          <select
            onChange={loadPreset}
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-xs text-[var(--color-text)] outline-none transition-colors hover:border-[var(--color-primary)]"
          >
            <option value="-1">Select a preset...</option>
            {PRESETS.map((preset, i) => (
              <option key={i} value={i}>{preset.label}</option>
            ))}
          </select>
          <span class="text-xs text-[var(--color-text-muted)]">
            {matches.length > 0
              ? `${matches.length} match${matches.length === 1 ? "" : "es"} found`
              : pattern && !regexError
                ? "No matches"
                : ""}
          </span>
        </div>
      </div>

      {/* Main content: Test string + Match results */}
      <div class="grid md:grid-cols-2">
        {/* Test string with highlights */}
        <div class="relative border-b border-[var(--color-border)] md:border-r md:border-b-0">
          <div class="absolute top-2 left-3 z-10 text-[10px] font-medium uppercase tracking-wider"
               style={{ color: "rgba(161, 161, 170, 0.4)" }}>
            Test String
          </div>
          <div class="relative min-h-[240px]">
            {/* Highlight overlay */}
            <pre
              class="pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words px-4 pt-8 pb-4 text-sm leading-relaxed"
              style={{ fontFamily: "var(--font-mono)", color: "transparent" }}
              aria-hidden="true"
            >
              {highlightSegments.map((seg, i) =>
                seg.isMatch ? (
                  <span
                    key={i}
                    style={{
                      backgroundColor: HIGHLIGHT_COLORS[seg.colorIndex],
                      borderBottom: `2px solid ${HIGHLIGHT_BORDER_COLORS[seg.colorIndex]}`,
                      borderRadius: "2px",
                      color: "var(--color-text)",
                    }}
                  >
                    {seg.text}
                  </span>
                ) : (
                  <span key={i} style={{ color: "var(--color-text)" }}>{seg.text}</span>
                )
              )}
            </pre>
            {/* Textarea */}
            <textarea
              value={testString}
              onInput={(e) => setTestString((e.target as HTMLTextAreaElement).value)}
              class="relative z-[1] w-full resize-none bg-transparent px-4 pt-8 pb-4 text-sm leading-relaxed outline-none"
              style={{
                fontFamily: "var(--font-mono)",
                color: "transparent",
                caretColor: "var(--color-primary)",
              }}
              rows={10}
              spellcheck={false}
              autocorrect="off"
              autocapitalize="off"
              placeholder="Enter test string..."
            />
          </div>
        </div>

        {/* Match results */}
        <div class="relative">
          <div class="absolute top-2 left-3 z-10 text-[10px] font-medium uppercase tracking-wider"
               style={{ color: "rgba(161, 161, 170, 0.4)" }}>
            Match Results
          </div>
          <div class="h-full min-h-[240px] overflow-auto px-4 pt-8 pb-4 md:min-h-0"
               style={{ maxHeight: "400px" }}>
            {matches.length === 0 ? (
              <p class="text-sm italic" style={{ color: "rgba(161, 161, 170, 0.4)" }}>
                {pattern && !regexError
                  ? "No matches found."
                  : "Matches will appear here..."}
              </p>
            ) : (
              <div class="space-y-3">
                {matches.map((m) => (
                  <div
                    key={m.index}
                    class="rounded-lg border border-[var(--color-border)] p-3"
                    style={{ backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)" }}
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="flex items-center gap-2">
                        <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{
                                backgroundColor: HIGHLIGHT_COLORS[m.index % HIGHLIGHT_COLORS.length],
                                color: "var(--color-heading)",
                              }}>
                          #{m.index + 1}
                        </span>
                        <code
                          class="text-sm font-semibold"
                          style={{
                            fontFamily: "var(--font-mono)",
                            color: "var(--color-heading)",
                          }}
                        >
                          {truncateMatch(m.fullMatch)}
                        </code>
                      </div>
                      <button
                        onClick={() => handleCopy(m.fullMatch, `Match ${m.index + 1}`)}
                        class="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
                        title="Copy match"
                      >
                        <CopyIcon />
                      </button>
                    </div>
                    <div class="mt-1 text-[11px] text-[var(--color-text-muted)]"
                         style={{ fontFamily: "var(--font-mono)" }}>
                      Position: {m.start}-{m.end}
                    </div>
                    {m.groups.length > 0 && (
                      <div class="mt-2 space-y-1">
                        {m.groups.map((g, gi) => (
                          <div key={gi} class="flex items-center gap-2 text-xs">
                            <span
                              class="rounded px-1.5 py-0.5 text-[10px]"
                              style={{
                                backgroundColor: HIGHLIGHT_COLORS[(gi + 1) % HIGHLIGHT_COLORS.length],
                                color: "var(--color-heading)",
                              }}
                            >
                              {g.name}
                            </span>
                            <code
                              class="text-[var(--color-text)]"
                              style={{ fontFamily: "var(--font-mono)" }}
                            >
                              {g.value}
                            </code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => {
                    const allMatches = matches.map((m) => m.fullMatch).join("\n");
                    handleCopy(allMatches, "All matches");
                  }}
                  class="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
                >
                  Copy All Matches
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Replace mode */}
      <div class="border-t border-[var(--color-border)] px-4 py-4">
        <div class="flex items-center gap-3">
          <button
            onClick={() => setReplaceMode(!replaceMode)}
            class="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all"
            style={{
              borderColor: replaceMode ? "var(--color-accent)" : "var(--color-border)",
              backgroundColor: replaceMode ? "rgba(52, 211, 153, 0.1)" : "transparent",
              color: replaceMode ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
          >
            <ReplaceIcon />
            Replace Mode
          </button>
        </div>
        {replaceMode && (
          <div class="mt-3 space-y-3">
            <div>
              <label class="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                Replace Pattern
              </label>
              <input
                type="text"
                value={replacePattern}
                onInput={(e) => setReplacePattern((e.target as HTMLInputElement).value)}
                class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]"
                style={{ fontFamily: "var(--font-mono)" }}
                placeholder="Replacement text (use $1, $2 for groups)..."
                spellcheck={false}
              />
            </div>
            <div>
              <div class="mb-1.5 flex items-center justify-between">
                <label class="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  Result
                </label>
                <button
                  onClick={() => handleCopy(replaceResult, "Result")}
                  class="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-heading)]"
                  title="Copy result"
                >
                  <CopyIcon />
                </button>
              </div>
              <pre
                class="overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm leading-relaxed text-[var(--color-text)]"
                style={{ fontFamily: "var(--font-mono)", maxHeight: "200px" }}
              >
                {replaceResult || (
                  <span style={{ color: "rgba(161, 161, 170, 0.4)" }}>
                    Replacement result will appear here...
                  </span>
                )}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Quick Reference */}
      <div class="border-t border-[var(--color-border)]">
        <button
          onClick={() => setShowReference(!showReference)}
          class="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-heading)]"
        >
          <span class="flex items-center gap-2">
            <ReferenceIcon />
            Quick Reference
          </span>
          <span
            class="transition-transform"
            style={{ transform: showReference ? "rotate(90deg)" : "rotate(0deg)" }}
          >
            &#9656;
          </span>
        </button>
        {showReference && (
          <div class="grid gap-4 border-t border-[var(--color-border)] px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_REFERENCE.map((section) => (
              <div key={section.title}>
                <h4 class="mb-2 text-xs font-semibold text-[var(--color-heading)]">
                  {section.title}
                </h4>
                <div class="space-y-1">
                  {section.items.map((item) => (
                    <div key={item.token} class="flex items-baseline gap-2 text-[11px]">
                      <code
                        class="shrink-0 rounded px-1 py-0.5 text-[var(--color-primary)]"
                        style={{
                          fontFamily: "var(--font-mono)",
                          backgroundColor: "rgba(79, 143, 247, 0.1)",
                        }}
                      >
                        {item.token}
                      </code>
                      <span class="text-[var(--color-text-muted)]">{item.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Small helpers
   ────────────────────────────────────── */

function parseFlagsToSet(flagsStr: string): Set<string> {
  return new Set(flagsStr.split(""));
}

function truncateMatch(text: string, maxLength = 60): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

/* ──────────────────────────────────────
   Icons (inline SVG for zero deps)
   ────────────────────────────────────── */

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function ReplaceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function ReferenceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
