import { useState, useCallback, useRef, useEffect, useMemo } from "preact/hooks";
import type { JSX } from "preact";
import { parseMarkdown, countStats } from "./parser";
import type { Heading } from "./parser";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

type ViewMode = "split" | "editor" | "preview";

interface ToolbarAction {
  label: string;
  icon: string;
  prefix: string;
  suffix: string;
  block?: boolean;
}

/* ──────────────────────────────────────
   Preset Documents
   ────────────────────────────────────── */

const PRESETS: Record<string, { label: string; content: string }> = {
  readme: {
    label: "README Template",
    content: `# Project Name

> A brief description of what this project does and who it's for.

## Features

- Feature one
- Feature two
- Feature three

## Installation

\`\`\`bash
npm install my-project
\`\`\`

## Usage

\`\`\`javascript
import { something } from "my-project";

const result = something("hello");
console.log(result);
\`\`\`

## API Reference

| Parameter | Type     | Description                |
| :-------- | :------- | :------------------------- |
| \`api_key\` | \`string\` | **Required**. Your API key |
| \`id\`      | \`string\` | **Required**. Item ID      |

## Contributing

Pull requests are welcome. For major changes, please open an issue first.

## License

[MIT](https://choosealicense.com/licenses/mit/)`,
  },
  blog: {
    label: "Blog Post",
    content: `# How I Built a Markdown Parser from Scratch

*Published on March 5, 2026 — 8 min read*

---

## Introduction

Building a Markdown parser from scratch is a great way to understand **parsing** and **text processing**. In this post, I'll walk through the architecture and key decisions.

## The Two-Pass Approach

The parser uses two passes:

1. **Block-level tokenization** — identifies headings, code blocks, lists, tables, and paragraphs
2. **Inline parsing** — handles bold, italic, links, images, and code within each block

> "The best way to learn how something works is to build it yourself."

### Block Tokenizer

The block tokenizer reads line by line, matching patterns:

\`\`\`typescript
function tokenizeBlocks(input: string): Block[] {
  const lines = input.split("\\n");
  const blocks: Block[] = [];
  // ... pattern matching logic
  return blocks;
}
\`\`\`

### Inline Parser

The inline parser uses regex replacements in a specific order:

- Images before links (to avoid conflicts)
- Code before bold/italic (backticks are greedy)
- Bold+italic before bold before italic

## Security Considerations

Since we're rendering user input as HTML, security is **critical**:

- [x] HTML tag whitelist (only \`<br>\`, \`<hr>\`, \`<mark>\`, \`<sub>\`, \`<sup>\`, \`<kbd>\`, \`<abbr>\`)
- [x] URL sanitization (block \`javascript:\` and \`data:\` URIs)
- [x] Event handler stripping
- [ ] CSP headers (future improvement)

## Conclusion

Building from scratch forces you to think about ~~every~~ many edge cases. The result is a lightweight, secure parser that covers the most common Markdown features.

---

*Thanks for reading! Find me on [GitHub](https://github.com).*`,
  },
  api: {
    label: "API Documentation",
    content: `# Users API

Base URL: \`https://api.example.com/v1\`

## Authentication

All requests require an API key in the header:

\`\`\`
Authorization: Bearer YOUR_API_KEY
\`\`\`

---

## Endpoints

### List Users

\`\`\`
GET /users
\`\`\`

**Query Parameters:**

| Parameter  | Type     | Default | Description           |
| :--------- | :------- | :------ | :-------------------- |
| \`page\`     | \`number\` | \`1\`     | Page number           |
| \`per_page\` | \`number\` | \`20\`    | Items per page (1-100)|
| \`sort\`     | \`string\` | \`name\`  | Sort by field         |

**Response:**

\`\`\`json
{
  "data": [
    {
      "id": "usr_123",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "role": "admin"
    }
  ],
  "meta": {
    "page": 1,
    "total": 42
  }
}
\`\`\`

### Create User

\`\`\`
POST /users
\`\`\`

**Request Body:**

\`\`\`json
{
  "name": "John Smith",
  "email": "john@example.com",
  "role": "user"
}
\`\`\`

**Response:** \`201 Created\`

> **Note:** The \`role\` field accepts: \`admin\`, \`user\`, or \`viewer\`.

### Delete User

\`\`\`
DELETE /users/:id
\`\`\`

**Response:** \`204 No Content\`

---

## Error Codes

| Code | Description              |
| :--- | :----------------------- |
| 400  | Bad Request              |
| 401  | Unauthorized             |
| 404  | Not Found                |
| 429  | Rate Limit Exceeded      |
| 500  | Internal Server Error    |`,
  },
  cheatsheet: {
    label: "Syntax Cheat Sheet",
    content: `# Markdown Syntax Cheat Sheet

## Headings

# H1 Heading
## H2 Heading
### H3 Heading
#### H4 Heading
##### H5 Heading
###### H6 Heading

## Emphasis

**Bold text** and __also bold__

*Italic text* and _also italic_

***Bold and italic*** and ___also both___

~~Strikethrough~~

## Links & Images

[Link text](https://example.com)

![Alt text](https://via.placeholder.com/150 "Image title")

Auto-linked: https://example.com

## Lists

### Unordered
- Item one
- Item two
- Item three

### Ordered
1. First
2. Second
3. Third

### Task List
- [x] Completed task
- [ ] Incomplete task
- [x] Another done

## Code

Inline \`code\` with backticks.

\`\`\`javascript
function hello(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

\`\`\`python
def hello(name):
    return f"Hello, {name}!"
\`\`\`

## Blockquotes

> This is a blockquote.
>
> It can span multiple paragraphs.

> Nested quotes:
> > Like this one.

## Tables

| Left   | Center | Right  |
| :----- | :----: | -----: |
| L1     |   C1   |     R1 |
| L2     |   C2   |     R2 |
| L3     |   C3   |     R3 |

## Horizontal Rules

---

***

___

## HTML Tags

This has a <mark>highlighted</mark> word.

H<sub>2</sub>O is water.

E = mc<sup>2</sup>.

Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy.

Use <br> for a line break.

## Escape Characters

\\*Not italic\\*

\\# Not a heading

\\[Not a link\\]`,
  },
};

const DEFAULT_CONTENT = PRESETS.cheatsheet.content;

/* ──────────────────────────────────────
   Toolbar Config
   ────────────────────────────────────── */

const TOOLBAR_ACTIONS: ToolbarAction[] = [
  { label: "Bold", icon: "B", prefix: "**", suffix: "**" },
  { label: "Italic", icon: "I", prefix: "*", suffix: "*" },
  { label: "Strikethrough", icon: "~~S~~", prefix: "~~", suffix: "~~" },
  { label: "H1", icon: "H1", prefix: "# ", suffix: "", block: true },
  { label: "H2", icon: "H2", prefix: "## ", suffix: "", block: true },
  { label: "H3", icon: "H3", prefix: "### ", suffix: "", block: true },
  { label: "Link", icon: "[]", prefix: "[", suffix: "](url)" },
  { label: "Image", icon: "Img", prefix: "![alt](", suffix: ")" },
  { label: "Code", icon: "`", prefix: "`", suffix: "`" },
  { label: "Code Block", icon: "```", prefix: "```\n", suffix: "\n```", block: true },
  { label: "Quote", icon: ">", prefix: "> ", suffix: "", block: true },
  { label: "UL", icon: "- ", prefix: "- ", suffix: "", block: true },
  { label: "OL", icon: "1.", prefix: "1. ", suffix: "", block: true },
  { label: "Table", icon: "T", prefix: "| H1 | H2 | H3 |\n| --- | --- | --- |\n| ", suffix: " | b | c |", block: true },
  { label: "Rule", icon: "---", prefix: "\n---\n", suffix: "", block: true },
  { label: "Checkbox", icon: "[ ]", prefix: "- [ ] ", suffix: "", block: true },
];

/* ──────────────────────────────────────
   Main Component
   ────────────────────────────────────── */

export default function MarkdownPreview(): JSX.Element {
  const [markdown, setMarkdown] = useState(DEFAULT_CONTENT);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [showToc, setShowToc] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parseResult = useMemo(() => parseMarkdown(markdown), [markdown]);
  const stats = useMemo(() => countStats(markdown), [markdown]);

  /* ── Toolbar Action ── */

  const applyToolbarAction = useCallback(
    (action: ToolbarAction) => {
      const textarea = editorRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = markdown.slice(start, end);
      const before = markdown.slice(0, start);
      const after = markdown.slice(end);

      let newText: string;
      let cursorPos: number;

      if (action.block && selected === "") {
        // For block-level items with no selection, ensure we're on a new line
        const needsNewline = before.length > 0 && !before.endsWith("\n");
        const prefix = needsNewline ? "\n" + action.prefix : action.prefix;
        newText = before + prefix + (selected || "text") + action.suffix + after;
        cursorPos = before.length + prefix.length;
      } else {
        newText = before + action.prefix + (selected || "text") + action.suffix + after;
        cursorPos = start + action.prefix.length;
      }

      setMarkdown(newText);

      // Restore cursor position
      requestAnimationFrame(() => {
        textarea.focus();
        const selectEnd = selected
          ? cursorPos + selected.length
          : cursorPos + 4; // "text".length
        textarea.setSelectionRange(cursorPos, selectEnd);
      });
    },
    [markdown],
  );

  /* ── Tab Key Handler ── */

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = editorRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newText = markdown.slice(0, start) + "  " + markdown.slice(end);
        setMarkdown(newText);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    },
    [markdown],
  );

  /* ── Scroll Sync ── */

  const handleEditorScroll = useCallback(() => {
    const editor = editorRef.current;
    const preview = previewRef.current;
    const lineNums = lineNumbersRef.current;

    // Sync line numbers with editor scroll
    if (editor && lineNums) {
      lineNums.scrollTop = editor.scrollTop;
    }

    // Sync preview with editor scroll (split mode only)
    if (!editor || !preview || viewMode !== "split") return;
    const scrollRatio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
    preview.scrollTop = scrollRatio * (preview.scrollHeight - preview.clientHeight);
  }, [viewMode]);

  /* ── Copy / Download ── */

  const showCopyFeedback = useCallback((label: string) => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    setCopyFeedback(label);
    copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 2000);
  }, []);

  const copyHtml = useCallback(() => {
    if (typeof window === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(parseResult.html).then(() => {
      showCopyFeedback("HTML");
    }).catch(() => {});
  }, [parseResult.html, showCopyFeedback]);

  const copyMarkdown = useCallback(() => {
    if (typeof window === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(markdown).then(() => {
      showCopyFeedback("Markdown");
    }).catch(() => {});
  }, [markdown, showCopyFeedback]);

  const downloadMd = useCallback(() => {
    if (typeof window === "undefined") return;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "document.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [markdown]);

  /* ── Fullscreen ── */

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  /* ── Escape to exit fullscreen ── */
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  /* ── ToC Click ── */

  const scrollToHeading = useCallback(
    (id: string) => {
      const preview = previewRef.current;
      if (!preview) return;
      const target = preview.querySelector(`#${CSS.escape(id)}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setShowToc(false);
    },
    [],
  );

  /* ── Line Numbers ── */

  const lineCount = useMemo(() => markdown.split("\n").length, [markdown]);

  return (
    <div
      ref={containerRef}
      class={`md-preview-root ${isFullscreen ? "md-fullscreen" : ""}`}
    >
      {/* ── Top Bar ── */}
      <div class="md-topbar">
        <div class="md-topbar-left">
          {/* Presets */}
          <select
            class="md-select"
            onChange={(e) => {
              const key = (e.target as HTMLSelectElement).value;
              if (key && PRESETS[key]) {
                setMarkdown(PRESETS[key].content);
              }
            }}
            aria-label="Load preset document"
          >
            <option value="">Presets...</option>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>

          {/* ToC Toggle */}
          {parseResult.headings.length > 0 && (
            <button
              class="md-btn"
              onClick={() => setShowToc((prev) => !prev)}
              title="Table of Contents"
            >
              ToC
            </button>
          )}
        </div>

        <div class="md-topbar-center">
          {/* View Mode */}
          <div class="md-view-modes">
            <button
              class={`md-view-btn ${viewMode === "editor" ? "active" : ""}`}
              onClick={() => setViewMode("editor")}
              title="Editor only"
            >
              Edit
            </button>
            <button
              class={`md-view-btn ${viewMode === "split" ? "active" : ""}`}
              onClick={() => setViewMode("split")}
              title="Split view"
            >
              Split
            </button>
            <button
              class={`md-view-btn ${viewMode === "preview" ? "active" : ""}`}
              onClick={() => setViewMode("preview")}
              title="Preview only"
            >
              Preview
            </button>
          </div>
        </div>

        <div class="md-topbar-right">
          <button class="md-btn" onClick={copyMarkdown} title="Copy Markdown">
            Copy MD
          </button>
          <button class="md-btn" onClick={copyHtml} title="Copy HTML">
            Copy HTML
          </button>
          <button class="md-btn" onClick={downloadMd} title="Download .md file">
            Download
          </button>
          <button class="md-btn" onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}>
            {isFullscreen ? "Exit" : "Expand"}
          </button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      {viewMode !== "preview" && (
        <div class="md-toolbar">
          {TOOLBAR_ACTIONS.map((action) => (
            <button
              key={action.label}
              class="md-toolbar-btn"
              onClick={() => applyToolbarAction(action)}
              title={action.label}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}

      {/* ── ToC Dropdown ── */}
      {showToc && parseResult.headings.length > 0 && (
        <TocDropdown
          headings={parseResult.headings}
          onSelect={scrollToHeading}
          onClose={() => setShowToc(false)}
        />
      )}

      {/* ── Main Content Area ── */}
      <div class={`md-content md-content-${viewMode}`}>
        {/* Editor Pane */}
        {viewMode !== "preview" && (
          <div class="md-editor-pane">
            <div ref={lineNumbersRef} class="md-line-numbers" aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} class="md-line-num">
                  {i + 1}
                </div>
              ))}
            </div>
            <textarea
              ref={editorRef}
              class="md-textarea"
              value={markdown}
              onInput={(e) => setMarkdown((e.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown}
              onScroll={handleEditorScroll}
              spellcheck={false}
              aria-label="Markdown editor"
            />
          </div>
        )}

        {/* Preview Pane */}
        {viewMode !== "editor" && (
          <div
            ref={previewRef}
            class="md-preview-pane markdown-body"
            dangerouslySetInnerHTML={{ __html: parseResult.html }}
          />
        )}
      </div>

      {/* ── Footer Stats ── */}
      <div class="md-footer">
        <span>{stats.words} words</span>
        <span class="md-footer-sep">|</span>
        <span>{stats.characters} chars</span>
        <span class="md-footer-sep">|</span>
        <span>{stats.lines} lines</span>
        <span class="md-footer-sep">|</span>
        <span>~{stats.readingTimeMinutes} min read</span>
        {copyFeedback && (
          <>
            <span class="md-footer-sep">|</span>
            <span class="md-copy-feedback">Copied {copyFeedback}!</span>
          </>
        )}
      </div>

      <style>{STYLES}</style>
    </div>
  );
}

/* ──────────────────────────────────────
   Table of Contents Dropdown
   ────────────────────────────────────── */

function TocDropdown({
  headings,
  onSelect,
  onClose,
}: {
  headings: Heading[];
  onSelect: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div class="md-toc-overlay" onClick={onClose}>
      <div class="md-toc-panel" onClick={(e) => e.stopPropagation()}>
        <div class="md-toc-header">
          <span>Table of Contents</span>
          <button class="md-toc-close" onClick={onClose}>X</button>
        </div>
        <nav class="md-toc-nav">
          {headings.map((h) => (
            <button
              key={h.id}
              class={`md-toc-item md-toc-h${h.level}`}
              onClick={() => onSelect(h.id)}
            >
              {h.text}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Styles
   ────────────────────────────────────── */

const STYLES = `
/* ── Root Container ── */
.md-preview-root {
  position: relative;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--color-surface);
  min-height: 600px;
  max-height: 80vh;
}

.md-fullscreen {
  position: fixed !important;
  inset: 0;
  z-index: 9999;
  border-radius: 0;
  max-height: 100vh;
  min-height: 100vh;
}

/* ── Top Bar ── */
.md-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-surface) 80%, transparent);
  flex-wrap: wrap;
}

.md-topbar-left,
.md-topbar-center,
.md-topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.md-topbar-right {
  flex-wrap: wrap;
}

.md-select {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-sans);
}

.md-btn {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: var(--font-mono);
  transition: all 0.15s;
  white-space: nowrap;
}

.md-btn:hover {
  color: var(--color-heading);
  border-color: var(--color-primary);
}

.md-copy-feedback {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--color-accent);
  white-space: nowrap;
}

/* ── View Mode Buttons ── */
.md-view-modes {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.md-view-btn {
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: none;
  border-right: 1px solid var(--color-border);
  padding: 4px 12px;
  font-size: 11px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: all 0.15s;
}

.md-view-btn:last-child {
  border-right: none;
}

.md-view-btn.active {
  background: var(--color-primary);
  color: #fff;
}

.md-view-btn:hover:not(.active) {
  color: var(--color-heading);
}

/* ── Toolbar ── */
.md-toolbar {
  display: flex;
  gap: 2px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg);
  flex-wrap: wrap;
}

.md-toolbar-btn {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-family: var(--font-mono);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.md-toolbar-btn:hover {
  background: var(--color-surface);
  color: var(--color-heading);
  border-color: var(--color-border);
}

/* ── Content Area ── */
.md-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.md-content-split .md-editor-pane {
  width: 50%;
  border-right: 1px solid var(--color-border);
}

.md-content-split .md-preview-pane {
  width: 50%;
}

.md-content-editor .md-editor-pane {
  width: 100%;
}

.md-content-preview .md-preview-pane {
  width: 100%;
}

/* ── Editor Pane ── */
.md-editor-pane {
  display: flex;
  overflow: hidden;
  position: relative;
}

.md-line-numbers {
  width: 40px;
  min-width: 40px;
  padding: 12px 0;
  background: var(--color-bg);
  border-right: 1px solid var(--color-border);
  overflow: hidden;
  user-select: none;
  text-align: right;
  scrollbar-width: none;
}

.md-line-numbers::-webkit-scrollbar {
  display: none;
}

.md-line-num {
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 20px;
  color: var(--color-text-muted);
  opacity: 0.5;
  padding-right: 8px;
}

.md-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
  padding: 12px;
  tab-size: 2;
  overflow-y: auto;
}

.md-textarea::placeholder {
  color: var(--color-text-muted);
  opacity: 0.5;
}

/* ── Preview Pane ── */
.md-preview-pane {
  overflow-y: auto;
  padding: 16px 24px;
  background: var(--color-bg);
}

/* ── Markdown Body Styles (GitHub-like) ── */
.markdown-body {
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.7;
  color: var(--color-text);
  word-wrap: break-word;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  color: var(--color-heading);
  font-family: var(--font-heading);
  font-weight: 700;
  text-transform: uppercase;
  margin-top: 24px;
  margin-bottom: 12px;
  line-height: 1.3;
}

.markdown-body h1 {
  font-size: 28px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--color-border);
}

.markdown-body h2 {
  font-size: 22px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--color-border);
}

.markdown-body h3 { font-size: 18px; }
.markdown-body h4 { font-size: 16px; }
.markdown-body h5 { font-size: 14px; }
.markdown-body h6 { font-size: 13px; color: var(--color-text-muted); }

.markdown-body p {
  margin: 0 0 12px;
}

.markdown-body a {
  color: var(--color-primary);
  text-decoration: none;
}

.markdown-body a:hover {
  text-decoration: underline;
}

.markdown-body strong {
  color: var(--color-heading);
  font-weight: 600;
}

.markdown-body em {
  font-style: italic;
}

.markdown-body del {
  opacity: 0.6;
}

.markdown-body code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 6px;
}

.markdown-body .code-block-wrapper {
  position: relative;
  margin: 12px 0;
}

.markdown-body .code-lang {
  position: absolute;
  top: 0;
  right: 0;
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 0 8px 0 6px;
  border-bottom: 1px solid var(--color-border);
  border-left: 1px solid var(--color-border);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.markdown-body pre {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 0;
}

.markdown-body pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  line-height: 1.6;
}

.markdown-body blockquote {
  border-left: 3px solid var(--color-primary);
  margin: 12px 0;
  padding: 4px 16px;
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-surface) 50%, transparent);
  border-radius: 0 6px 6px 0;
}

.markdown-body blockquote p {
  margin: 4px 0;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 24px;
  margin: 8px 0;
}

.markdown-body li {
  margin: 4px 0;
}

.markdown-body li.task-item {
  list-style: none;
  margin-left: -24px;
}

.markdown-body li.task-item input[type="checkbox"] {
  margin-right: 6px;
  accent-color: var(--color-primary);
}

.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid var(--color-border);
  padding: 8px 12px;
}

.markdown-body th {
  background: var(--color-surface);
  color: var(--color-heading);
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.5px;
}

.markdown-body tr:nth-child(even) td {
  background: color-mix(in srgb, var(--color-surface) 30%, transparent);
}

.markdown-body hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 20px 0;
}

.markdown-body img {
  max-width: 100%;
  border-radius: 6px;
  margin: 8px 0;
}

.markdown-body mark {
  background: rgba(79, 143, 247, 0.2);
  color: var(--color-heading);
  padding: 1px 4px;
  border-radius: 3px;
}

.markdown-body kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 2px 6px;
  box-shadow: 0 1px 0 var(--color-border);
}

.markdown-body sub,
.markdown-body sup {
  font-size: 0.8em;
}

/* ── Footer ── */
.md-footer {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-top: 1px solid var(--color-border);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-muted);
  background: color-mix(in srgb, var(--color-surface) 80%, transparent);
  flex-wrap: wrap;
}

.md-footer-sep {
  opacity: 0.3;
}

.md-copy-feedback {
  color: var(--color-accent);
  font-weight: 600;
  animation: md-fade-in 0.2s ease-out;
}

@keyframes md-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ── ToC Overlay ── */
.md-toc-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  justify-content: flex-start;
  padding-top: 80px;
  padding-left: 12px;
}

.md-toc-panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  width: 280px;
  max-height: 400px;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
}

.md-toc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-heading);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.md-toc-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12px;
}

.md-toc-nav {
  display: flex;
  flex-direction: column;
  padding: 6px 0;
}

.md-toc-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: 13px;
  padding: 6px 14px;
  cursor: pointer;
  transition: background 0.1s;
}

.md-toc-item:hover {
  background: var(--color-bg);
  color: var(--color-primary);
}

.md-toc-h1 { padding-left: 14px; font-weight: 600; }
.md-toc-h2 { padding-left: 28px; }
.md-toc-h3 { padding-left: 42px; font-size: 12px; }
.md-toc-h4 { padding-left: 56px; font-size: 12px; color: var(--color-text-muted); }
.md-toc-h5 { padding-left: 70px; font-size: 11px; color: var(--color-text-muted); }
.md-toc-h6 { padding-left: 84px; font-size: 11px; color: var(--color-text-muted); }

/* ── Responsive ── */
@media (max-width: 768px) {
  .md-content-split {
    flex-direction: column;
  }

  .md-content-split .md-editor-pane,
  .md-content-split .md-preview-pane {
    width: 100%;
  }

  .md-content-split .md-editor-pane {
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    max-height: 40vh;
  }

  .md-content-split .md-preview-pane {
    max-height: 40vh;
  }

  .md-topbar {
    flex-wrap: wrap;
    gap: 6px;
  }

  .md-topbar-left,
  .md-topbar-center,
  .md-topbar-right {
    flex-wrap: wrap;
  }

  .md-toolbar {
    gap: 1px;
    padding: 4px 8px;
  }

  .md-toolbar-btn {
    padding: 3px 5px;
    font-size: 10px;
  }
}

/* ── Scrollbar Styling ── */
.md-textarea::-webkit-scrollbar,
.md-preview-pane::-webkit-scrollbar {
  width: 6px;
}

.md-textarea::-webkit-scrollbar-track,
.md-preview-pane::-webkit-scrollbar-track {
  background: transparent;
}

.md-textarea::-webkit-scrollbar-thumb,
.md-preview-pane::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.md-textarea::-webkit-scrollbar-thumb:hover,
.md-preview-pane::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}
`;
