import { useState, useCallback, useRef, useEffect, useMemo } from "preact/hooks";
import type { JSX } from "preact";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

type ViewMode = "split" | "editor" | "preview";

/* ──────────────────────────────────────
   Presets
   ────────────────────────────────────── */

const PRESETS: Record<string, { label: string; content: string }> = {
  basic: {
    label: "Basic HTML",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Basic Page</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      padding: 2rem;
      line-height: 1.6;
    }
    h1 { color: #58a6ff; margin-bottom: 1rem; }
    p { margin-bottom: 0.75rem; }
    a { color: #58a6ff; }
    code {
      background: #161b22;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: 'Fira Mono', monospace;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 1.5rem;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  <h1>Hello, World!</h1>
  <p>
    This is a basic HTML page with dark styling.
    Edit the source on the left to see changes <code>live</code>.
  </p>

  <div class="card">
    <h2 style="color:#58a6ff; margin-bottom:0.5rem;">Card Component</h2>
    <p>Style anything you want. No build step required.</p>
  </div>
</body>
</html>`,
  },

  bootstrap: {
    label: "With Bootstrap CDN",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bootstrap Demo</title>
  <link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
  />
</head>
<body class="bg-dark text-light py-5">
  <div class="container">
    <h1 class="mb-4">Bootstrap 5 Demo</h1>

    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="card bg-secondary text-white h-100">
          <div class="card-body">
            <h5 class="card-title">Card One</h5>
            <p class="card-text">Bootstrap grid + card components.</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card bg-info text-dark h-100">
          <div class="card-body">
            <h5 class="card-title">Card Two</h5>
            <p class="card-text">Loaded from CDN in the iframe.</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card bg-success text-white h-100">
          <div class="card-body">
            <h5 class="card-title">Card Three</h5>
            <p class="card-text">Fully sandboxed, safe preview.</p>
          </div>
        </div>
      </div>
    </div>

    <button class="btn btn-primary me-2" onclick="alert('It works!')">Primary</button>
    <button class="btn btn-outline-light">Outline</button>

    <div class="alert alert-warning mt-4" role="alert">
      ⚠️ Note: CDN resources load inside the iframe. Allow Scripts must be enabled.
    </div>
  </div>
</body>
</html>`,
  },

  tailwind: {
    label: "With Tailwind CDN",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Tailwind Demo</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-gray-950 text-gray-100 p-8 font-sans">
  <div class="max-w-2xl mx-auto">
    <h1 class="text-4xl font-bold mb-2 text-white">Tailwind CSS</h1>
    <p class="text-gray-400 mb-8">Loaded via CDN — utility classes work out of the box.</p>

    <div class="grid grid-cols-2 gap-4 mb-8">
      <div class="bg-indigo-600 rounded-xl p-6 shadow-lg">
        <h2 class="text-xl font-semibold mb-2">Box One</h2>
        <p class="text-indigo-200 text-sm">Tailwind grid + utilities.</p>
      </div>
      <div class="bg-emerald-600 rounded-xl p-6 shadow-lg">
        <h2 class="text-xl font-semibold mb-2">Box Two</h2>
        <p class="text-emerald-200 text-sm">Live preview as you type.</p>
      </div>
    </div>

    <button
      onclick="this.textContent = 'Clicked! ✓'"
      class="bg-white text-gray-900 font-semibold px-6 py-2 rounded-lg hover:bg-gray-200 transition"
    >
      Click me
    </button>
  </div>
</body>
</html>`,
  },

  animations: {
    label: "CSS Animations",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>CSS Animations</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0f;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: system-ui, sans-serif;
      color: #fff;
      gap: 3rem;
    }

    h1 {
      font-size: 1.5rem;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      opacity: 0.6;
    }

    .orbit-container {
      position: relative;
      width: 200px;
      height: 200px;
    }

    .sun {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 40px; height: 40px;
      border-radius: 50%;
      background: radial-gradient(circle, #ffd700, #ff8c00);
      box-shadow: 0 0 30px #ffd70088, 0 0 60px #ff8c0044;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { box-shadow: 0 0 30px #ffd70088, 0 0 60px #ff8c0044; }
      50% { box-shadow: 0 0 50px #ffd700cc, 0 0 90px #ff8c0077; }
    }

    .orbit {
      position: absolute;
      top: 50%; left: 50%;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.1);
      animation: rotate linear infinite;
    }

    .orbit:nth-child(2) {
      width: 80px; height: 80px;
      margin: -40px;
      animation-duration: 3s;
    }
    .orbit:nth-child(3) {
      width: 130px; height: 130px;
      margin: -65px;
      animation-duration: 6s;
    }
    .orbit:nth-child(4) {
      width: 190px; height: 190px;
      margin: -95px;
      animation-duration: 12s;
    }

    .planet {
      position: absolute;
      top: 0; left: 50%;
      border-radius: 50%;
      transform: translateX(-50%) translateY(-50%);
    }

    .orbit:nth-child(2) .planet { width: 10px; height: 10px; background: #64b5f6; box-shadow: 0 0 10px #64b5f6; }
    .orbit:nth-child(3) .planet { width: 14px; height: 14px; background: #ef5350; box-shadow: 0 0 12px #ef5350; }
    .orbit:nth-child(4) .planet { width: 18px; height: 18px; background: #ab47bc; box-shadow: 0 0 15px #ab47bc; }

    @keyframes rotate {
      from { transform: translate(-50%, -50%) rotate(0deg); }
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }

    .gradient-text {
      font-size: 2rem;
      font-weight: 800;
      background: linear-gradient(90deg, #64b5f6, #ef5350, #ab47bc, #64b5f6);
      background-size: 200%;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: shimmer 3s linear infinite;
    }

    @keyframes shimmer {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
  </style>
</head>
<body>
  <h1>CSS Animations</h1>

  <div class="orbit-container">
    <div class="sun"></div>
    <div class="orbit"><div class="planet"></div></div>
    <div class="orbit"><div class="planet"></div></div>
    <div class="orbit"><div class="planet"></div></div>
  </div>

  <div class="gradient-text">Pure CSS Magic ✦</div>
</body>
</html>`,
  },
};

const DEFAULT_CONTENT = PRESETS.basic.content;

/* ──────────────────────────────────────
   Main Component
   ────────────────────────────────────── */

export default function HtmlPreview(): JSX.Element {
  const [html, setHtml] = useState(DEFAULT_CONTENT);
  const [debouncedHtml, setDebouncedHtml] = useState(DEFAULT_CONTENT);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [fileNameFeedback, setFileNameFeedback] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileNameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Debounced Preview Update ── */

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedHtml(html);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [html]);

  /* ── Stats ── */

  const stats = useMemo(() => {
    const lines = html.split("\n").length;
    const chars = html.length;
    return { lines, chars };
  }, [html]);

  const lineCount = useMemo(() => html.split("\n").length, [html]);

  /* ── Tab Key Handler ── */

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = editorRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newText = html.slice(0, start) + "  " + html.slice(end);
        setHtml(newText);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    },
    [html],
  );

  /* ── Scroll Sync (editor ↔ line numbers) ── */

  const handleEditorScroll = useCallback(() => {
    const editor = editorRef.current;
    const lineNums = lineNumbersRef.current;
    if (editor && lineNums) {
      lineNums.scrollTop = editor.scrollTop;
    }
  }, []);

  /* ── Copy ── */

  const showCopyFeedback = useCallback((label: string) => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    setCopyFeedback(label);
    copyTimeoutRef.current = setTimeout(() => setCopyFeedback(null), 2000);
  }, []);

  const copyHtml = useCallback(() => {
    if (typeof window === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(html).then(() => {
      showCopyFeedback("HTML");
    }).catch(() => {});
  }, [html, showCopyFeedback]);

  /* ── Download ── */

  const downloadHtml = useCallback(() => {
    if (typeof window === "undefined") return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = loadedFileName ?? "index.html";
    a.click();
    URL.revokeObjectURL(url);
  }, [html, loadedFileName]);

  /* ── Load File ── */

  const handleLoadFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = evt.target?.result as string;
        if (typeof text === "string") {
          setHtml(text);
          setLoadedFileName(file.name);
          if (fileNameTimeoutRef.current) clearTimeout(fileNameTimeoutRef.current);
          setFileNameFeedback(file.name);
          fileNameTimeoutRef.current = setTimeout(() => setFileNameFeedback(null), 2000);
        }
      };
      reader.readAsText(file);
      input.value = "";
    },
    [],
  );

  /* ── Fullscreen ── */

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isFullscreen]);

  /* ── Preset Change ── */

  const handlePresetChange = useCallback((e: Event) => {
    const key = (e.target as HTMLSelectElement).value;
    if (key && PRESETS[key]) {
      setHtml(PRESETS[key].content);
      setLoadedFileName(null);
      setFileNameFeedback(null);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      class={`hp-root ${isFullscreen ? "hp-fullscreen" : ""}`}
    >
      {/* ── Top Bar ── */}
      <div class="md-topbar">
        <div class="md-topbar-left">
          <select
            class="md-select"
            onChange={handlePresetChange}
            aria-label="Load preset"
          >
            <option value="">Presets...</option>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        <div class="md-topbar-center">
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm"
            style="display:none"
            onChange={handleFileChange}
          />
          <button class="md-btn" onClick={handleLoadFile} title="Load .html file">
            Load File
          </button>
          <button class="md-btn" onClick={copyHtml} title="Copy HTML">
            Copy HTML
          </button>
          <button class="md-btn" onClick={downloadHtml} title="Download .html file">
            Download
          </button>
          <button
            class="md-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
          >
            {isFullscreen ? "Exit" : "Expand"}
          </button>
        </div>
      </div>

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
              value={html}
              onInput={(e) => setHtml((e.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown}
              onScroll={handleEditorScroll}
              spellcheck={false}
              aria-label="HTML editor"
            />
          </div>
        )}

        {/* Preview Pane — sandboxed iframe */}
        {viewMode !== "editor" && (
          <div class="hp-preview-pane">
            <iframe
              class="hp-iframe"
              sandbox="allow-scripts allow-same-origin"
              srcdoc={debouncedHtml}
              title="HTML Preview"
            />
          </div>
        )}
      </div>

      {/* ── Footer Stats ── */}
      <div class="md-footer">
        <span>{stats.lines} lines</span>
        <span class="md-footer-sep">|</span>
        <span>{stats.chars} chars</span>
        {loadedFileName && !fileNameFeedback && (
          <>
            <span class="md-footer-sep">|</span>
            <span class="hp-file-name">{loadedFileName}</span>
          </>
        )}
        {fileNameFeedback && (
          <>
            <span class="md-footer-sep">|</span>
            <span class="md-copy-feedback">Loaded {fileNameFeedback}</span>
          </>
        )}
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
   Styles
   ────────────────────────────────────── */

const STYLES = `
/* ── Root ── */
.hp-root {
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

.hp-fullscreen {
  position: fixed !important;
  inset: 0;
  z-index: 9999;
  border-radius: 0;
  max-height: 100vh;
  min-height: 100vh;
}

/* ── Re-use md-topbar, md-btn, md-select, md-view-modes, etc. ── */
/* These classes come from any colocated Markdown Preview or global styles; */
/* we redeclare them here so the component is self-contained. */

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

.md-content-split .hp-preview-pane {
  width: 50%;
}

.md-content-editor .md-editor-pane {
  width: 100%;
}

.md-content-preview .hp-preview-pane {
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

/* ── Preview Pane (iframe) ── */
.hp-preview-pane {
  overflow: hidden;
  background: #fff;
  display: flex;
  flex-direction: column;
}

.hp-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
  display: block;
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
  animation: hp-fade-in 0.2s ease-out;
}

.hp-file-name {
  color: var(--color-text-muted);
  font-style: italic;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes hp-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* ── Scrollbars ── */
.md-textarea::-webkit-scrollbar {
  width: 6px;
}

.md-textarea::-webkit-scrollbar-track {
  background: transparent;
}

.md-textarea::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.md-textarea::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-muted);
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .md-content-split {
    flex-direction: column;
  }

  .md-content-split .md-editor-pane,
  .md-content-split .hp-preview-pane {
    width: 100%;
  }

  .md-content-split .md-editor-pane {
    border-right: none;
    border-bottom: 1px solid var(--color-border);
    max-height: 40vh;
  }

  .md-content-split .hp-preview-pane {
    max-height: 40vh;
  }

  .md-topbar {
    flex-wrap: wrap;
    gap: 6px;
  }
}
`;
