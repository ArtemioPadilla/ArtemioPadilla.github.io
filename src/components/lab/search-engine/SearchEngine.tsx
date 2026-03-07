import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Page {
  id: number;
  title: string;
  content: string;
  x: number;
  y: number;
  pageRank: number;
}

interface Link {
  from: number;
  to: number;
}

interface IndexEntry {
  pageId: number;
  tf: number;
}

interface SearchResult {
  pageId: number;
  title: string;
  score: number;
  tfidf: number;
  pr: number;
}

interface CrawlState {
  active: boolean;
  visited: Set<number>;
  currentId: number | null;
}

type InteractionMode = "select" | "add-page" | "link-source" | "link-target";

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const NODE_R = 26;
const ARROW_SZ = 9;
const DAMPING = 0.85;
const PR_ITERATIONS = 20;

/* ══════════════════════════════════════════════════════════
   Preset Data
   ══════════════════════════════════════════════════════════ */

function makeSampleWeb(): { pages: Page[]; links: Link[] } {
  const pages: Page[] = [
    { id: 1, title: "Home", content: "Welcome to the web. Main homepage with links to all pages. Search engine optimization starts here.", x: 300, y: 180, pageRank: 0 },
    { id: 2, title: "About", content: "About us page. We build web applications and search technology. Team loves algorithms and data.", x: 130, y: 80, pageRank: 0 },
    { id: 3, title: "Blog", content: "Blog posts about search engines, web crawlers and information retrieval. PageRank algorithm explained.", x: 480, y: 80, pageRank: 0 },
    { id: 4, title: "Products", content: "Products include search tools, web analytics and data indexing solutions. Fast reliable technology.", x: 130, y: 300, pageRank: 0 },
    { id: 5, title: "Docs", content: "Technical documentation for search API. How to build inverted index. TF-IDF ranking explained.", x: 480, y: 300, pageRank: 0 },
    { id: 6, title: "Contact", content: "Contact us for search engine consulting. Email and phone information. We respond to web inquiries.", x: 300, y: 380, pageRank: 0 },
  ];
  const links: Link[] = [
    { from: 1, to: 2 }, { from: 1, to: 3 }, { from: 1, to: 4 },
    { from: 2, to: 1 }, { from: 2, to: 3 },
    { from: 3, to: 1 }, { from: 3, to: 5 },
    { from: 4, to: 1 }, { from: 4, to: 5 }, { from: 4, to: 6 },
    { from: 5, to: 3 }, { from: 5, to: 6 },
    { from: 6, to: 1 },
  ];
  return { pages, links };
}

/* ══════════════════════════════════════════════════════════
   Engine Functions
   ══════════════════════════════════════════════════════════ */

function tokenizeText(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 1);
}

function buildInvertedIndex(pages: Page[]): Map<string, IndexEntry[]> {
  const index = new Map<string, IndexEntry[]>();
  for (const page of pages) {
    const words = tokenizeText(page.title + " " + page.content);
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    const total = words.length || 1;
    for (const [word, count] of freq) {
      if (!index.has(word)) index.set(word, []);
      index.get(word)!.push({ pageId: page.id, tf: count / total });
    }
  }
  return index;
}

function computePageRank(pages: Page[], links: Link[]): Map<number, number> {
  const n = pages.length;
  if (n === 0) return new Map();
  const ids = pages.map((p) => p.id);
  let ranks = new Map<number, number>();
  for (const id of ids) ranks.set(id, 1 / n);

  const outDeg = new Map<number, number>();
  for (const id of ids) outDeg.set(id, 0);
  for (const link of links) outDeg.set(link.from, (outDeg.get(link.from) || 0) + 1);

  for (let iter = 0; iter < PR_ITERATIONS; iter++) {
    const newRanks = new Map<number, number>();
    for (const id of ids) newRanks.set(id, (1 - DAMPING) / n);
    for (const link of links) {
      const fromRank = ranks.get(link.from) || 0;
      const fromOut = outDeg.get(link.from) || 1;
      newRanks.set(link.to, (newRanks.get(link.to) || 0) + DAMPING * (fromRank / fromOut));
    }
    ranks = newRanks;
  }
  return ranks;
}

function searchPages(
  query: string,
  index: Map<string, IndexEntry[]>,
  pageRanks: Map<number, number>,
  pages: Page[],
): SearchResult[] {
  const queryTokens = tokenizeText(query);
  if (queryTokens.length === 0) return [];
  const n = pages.length || 1;
  const scores = new Map<number, { tfidf: number; pr: number }>();

  for (const token of queryTokens) {
    const entries = index.get(token);
    if (!entries) continue;
    const idf = Math.log(n / entries.length);
    for (const entry of entries) {
      const tfidf = entry.tf * idf;
      const pr = pageRanks.get(entry.pageId) || 1 / n;
      const prev = scores.get(entry.pageId) || { tfidf: 0, pr };
      scores.set(entry.pageId, { tfidf: prev.tfidf + tfidf, pr });
    }
  }

  const results: SearchResult[] = [];
  for (const [pageId, { tfidf, pr }] of scores) {
    const page = pages.find((p) => p.id === pageId);
    if (page) results.push({ pageId, title: page.title, score: tfidf * pr * 100, tfidf, pr });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

/* ══════════════════════════════════════════════════════════
   Drawing Helpers
   ══════════════════════════════════════════════════════════ */

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, thick: boolean) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const sx = x1 + NODE_R * Math.cos(angle);
  const sy = y1 + NODE_R * Math.sin(angle);
  const ex = x2 - NODE_R * Math.cos(angle);
  const ey = y2 - NODE_R * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = color;
  ctx.lineWidth = thick ? 2.5 : 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ARROW_SZ * Math.cos(angle - Math.PI / 6), ey - ARROW_SZ * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(ex - ARROW_SZ * Math.cos(angle + Math.PI / 6), ey - ARROW_SZ * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  page: Page,
  selected: boolean,
  crawlVisited: boolean,
  crawlCurrent: boolean,
  isLinkSrc: boolean,
  maxPR: number,
) {
  const sizeBoost = maxPR > 0 ? (page.pageRank / maxPR) * 6 : 0;
  const r = NODE_R + sizeBoost;

  ctx.beginPath();
  ctx.arc(page.x, page.y, r, 0, Math.PI * 2);

  if (crawlCurrent) ctx.fillStyle = "#f59e0b";
  else if (crawlVisited) ctx.fillStyle = "#34d399";
  else if (isLinkSrc) ctx.fillStyle = "#a855f7";
  else if (selected) ctx.fillStyle = "#4f8ff7";
  else ctx.fillStyle = "#111111";
  ctx.fill();

  ctx.strokeStyle = selected ? "#4f8ff7" : crawlVisited ? "#34d399" : "#27272a";
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.stroke();

  ctx.font = "bold 12px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = (crawlCurrent || crawlVisited) ? "#000" : "#ffffff";
  ctx.fillText(page.title.substring(0, 8), page.x, page.y - 4);

  if (page.pageRank > 0) {
    ctx.font = "10px Inter, sans-serif";
    ctx.fillStyle = (crawlCurrent || crawlVisited) ? "#333" : "#a1a1aa";
    ctx.fillText(`PR: ${page.pageRank.toFixed(3)}`, page.x, page.y + 11);
  }
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function SearchEngine() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [selectedPage, setSelectedPage] = useState<number | null>(null);
  const [mode, setMode] = useState<InteractionMode>("select");
  const [linkSource, setLinkSource] = useState<number | null>(null);
  const [dragging, setDragging] = useState<{ id: number; ox: number; oy: number } | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [invertedIndex, setInvertedIndex] = useState<Map<string, IndexEntry[]>>(new Map());
  const [pageRanks, setPageRanks] = useState<Map<number, number>>(new Map());
  const [crawl, setCrawl] = useState<CrawlState>({ active: false, visited: new Set(), currentId: null });
  const [indexed, setIndexed] = useState(false);
  const [tab, setTab] = useState<"graph" | "index">("graph");
  const nextId = useRef(10);

  useEffect(() => {
    const sample = makeSampleWeb();
    setPages(sample.pages);
    setLinks(sample.links);
    nextId.current = 10;
  }, []);

  useEffect(() => {
    const ranks = computePageRank(pages, links);
    setPageRanks(ranks);
    setPages((prev) => prev.map((p) => ({ ...p, pageRank: ranks.get(p.id) || 0 })));
  }, [links.length, pages.length]);

  useEffect(() => {
    if (selectedPage !== null) {
      const p = pages.find((pg) => pg.id === selectedPage);
      if (p) { setEditTitle(p.title); setEditContent(p.content); }
    }
  }, [selectedPage]);

  useEffect(() => {
    if (query.trim() && indexed) {
      setResults(searchPages(query, invertedIndex, pageRanks, pages));
    } else {
      setResults([]);
    }
  }, [query, invertedIndex, pageRanks, indexed]);

  /* ── Canvas Drawing ── */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const maxPR = Math.max(...pages.map((p) => p.pageRank), 0.001);

    for (const link of links) {
      const from = pages.find((p) => p.id === link.from);
      const to = pages.find((p) => p.id === link.to);
      if (!from || !to) continue;
      const isCrawlEdge = crawl.active && crawl.visited.has(link.from) && crawl.visited.has(link.to);
      drawArrow(ctx, from.x, from.y, to.x, to.y, isCrawlEdge ? "#34d399" : "#27272a", isCrawlEdge);
    }

    for (const page of pages) {
      drawNode(
        ctx, page,
        selectedPage === page.id,
        crawl.visited.has(page.id),
        crawl.currentId === page.id,
        mode === "link-target" && linkSource === page.id,
        maxPR,
      );
    }

    if (crawl.active && crawl.currentId !== null) {
      const cp = pages.find((p) => p.id === crawl.currentId);
      if (cp) {
        ctx.beginPath();
        ctx.arc(cp.x, cp.y - NODE_R - 10, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
      }
    }
  }, [pages, links, selectedPage, crawl, mode, linkSource]);

  useEffect(() => { draw(); }, [draw]);

  /* ── Crawl Animation ── */
  const startCrawl = useCallback(() => {
    if (pages.length === 0) return;
    const startNode = selectedPage ?? pages[0].id;
    setIndexed(false);

    const adjacency = new Map<number, number[]>();
    for (const link of links) {
      if (!adjacency.has(link.from)) adjacency.set(link.from, []);
      adjacency.get(link.from)!.push(link.to);
    }

    const order: number[] = [];
    const bfsVisited = new Set<number>();
    const bfsQueue = [startNode];
    bfsVisited.add(startNode);

    while (bfsQueue.length > 0) {
      const node = bfsQueue.shift()!;
      order.push(node);
      const neighbors = adjacency.get(node) || [];
      for (const nb of neighbors) {
        if (!bfsVisited.has(nb)) {
          bfsVisited.add(nb);
          bfsQueue.push(nb);
        }
      }
    }

    setCrawl({ active: true, visited: new Set([order[0]]), currentId: order[0] });

    let idx = 0;
    const step = () => {
      idx++;
      if (idx >= order.length) {
        setCrawl((prev) => ({ ...prev, active: false, currentId: null }));
        const indexedPages = pages.filter((p) => bfsVisited.has(p.id));
        setInvertedIndex(buildInvertedIndex(indexedPages));
        setIndexed(true);
        const ranks = computePageRank(pages, links);
        setPageRanks(ranks);
        setPages((prev) => prev.map((p) => ({ ...p, pageRank: ranks.get(p.id) || 0 })));
        return;
      }
      setCrawl({
        active: true,
        visited: new Set(order.slice(0, idx + 1)),
        currentId: order[idx],
      });
      setTimeout(step, 550);
    };
    setTimeout(step, 550);
  }, [pages, links, selectedPage]);

  /* ── Mouse Handlers ── */
  const getPageAt = useCallback((x: number, y: number): Page | null => {
    for (let i = pages.length - 1; i >= 0; i--) {
      const p = pages[i];
      if ((p.x - x) ** 2 + (p.y - y) ** 2 <= NODE_R * NODE_R) return p;
    }
    return null;
  }, [pages]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const page = getPageAt(x, y);

    if (mode === "add-page") {
      const id = nextId.current++;
      setPages((prev) => [...prev, { id, title: `Page ${id}`, content: "New page content.", x, y, pageRank: 0 }]);
      setSelectedPage(id);
      setMode("select");
      return;
    }

    if (mode === "link-source" && page) {
      setLinkSource(page.id);
      setMode("link-target");
      return;
    }

    if (mode === "link-target" && page && linkSource !== null && page.id !== linkSource) {
      if (!links.some((l) => l.from === linkSource && l.to === page.id)) {
        setLinks((prev) => [...prev, { from: linkSource, to: page.id }]);
      }
      setLinkSource(null);
      setMode("select");
      return;
    }

    if (mode === "select" && page) {
      setSelectedPage(page.id);
      setDragging({ id: page.id, ox: x - page.x, oy: y - page.y });
    } else if (mode === "select") {
      setSelectedPage(null);
    }
  }, [mode, getPageAt, linkSource, links]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setPages((prev) =>
      prev.map((p) =>
        p.id === dragging.id ? { ...p, x: e.clientX - rect.left - dragging.ox, y: e.clientY - rect.top - dragging.oy } : p
      )
    );
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  const updatePage = useCallback(() => {
    if (selectedPage === null) return;
    setPages((prev) => prev.map((p) => (p.id === selectedPage ? { ...p, title: editTitle, content: editContent } : p)));
  }, [selectedPage, editTitle, editContent]);

  const deletePage = useCallback(() => {
    if (selectedPage === null) return;
    setPages((prev) => prev.filter((p) => p.id !== selectedPage));
    setLinks((prev) => prev.filter((l) => l.from !== selectedPage && l.to !== selectedPage));
    setSelectedPage(null);
  }, [selectedPage]);

  const loadPreset = useCallback(() => {
    const sample = makeSampleWeb();
    setPages(sample.pages);
    setLinks(sample.links);
    setSelectedPage(null);
    setIndexed(false);
    setInvertedIndex(new Map());
    setResults([]);
    setQuery("");
    setCrawl({ active: false, visited: new Set(), currentId: null });
    nextId.current = 10;
  }, []);

  /* ── Render ── */
  const selectedPageData = pages.find((p) => p.id === selectedPage);
  const indexEntries = Array.from(invertedIndex.entries()).sort((a, b) => a[0].localeCompare(b[0])).slice(0, 50);

  const btn = (active: boolean) => ({
    borderRadius: "4px",
    padding: "5px 12px",
    fontSize: "12px",
    fontWeight: "600" as const,
    border: active ? "none" : "1px solid var(--color-border)",
    background: active ? "var(--color-primary)" : "var(--color-surface)",
    color: active ? "#ffffff" : "var(--color-text)",
    cursor: "pointer",
  });

  const btnOutline = {
    borderRadius: "4px",
    padding: "5px 12px",
    fontSize: "12px",
    color: "var(--color-text-muted)",
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    cursor: "pointer",
  };

  const tabStyle = (active: boolean) => ({
    borderRadius: "4px",
    padding: "4px 10px",
    fontSize: "12px",
    fontWeight: "600" as const,
    background: active ? "rgba(79,143,247,0.15)" : "transparent",
    color: active ? "var(--color-primary)" : "var(--color-text-muted)",
    border: "none",
    cursor: "pointer",
  });

  const panelStyle = {
    borderRadius: "10px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    padding: "14px",
  };

  const labelStyle = {
    fontSize: "10px",
    fontWeight: "600" as const,
    color: "var(--color-text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: "8px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
        <button onClick={() => { setMode("select"); setLinkSource(null); }} style={btn(mode === "select")}>Select</button>
        <button onClick={() => setMode("add-page")} style={btn(mode === "add-page")}>+ Page</button>
        <button onClick={() => { setMode("link-source"); setLinkSource(null); }} style={btn(mode === "link-source" || mode === "link-target")}>+ Link</button>
        <div style={{ width: "1px", height: "20px", background: "var(--color-border)", margin: "0 2px" }} />
        <button
          onClick={startCrawl}
          disabled={crawl.active}
          style={{ ...btnOutline, background: "var(--color-accent)", color: "#000000", fontWeight: "600", opacity: crawl.active ? 0.4 : 1 }}
        >
          Crawl
        </button>
        <button onClick={loadPreset} style={btnOutline}>Load Sample</button>
        {selectedPage !== null && (
          <button onClick={deletePage} style={{ ...btnOutline, color: "#ef4444", borderColor: "rgba(239,68,68,0.3)" }}>Delete</button>
        )}
        {(mode === "link-target") && <span style={{ fontSize: "11px", color: "var(--color-accent)" }}>Click target node...</span>}
        {(mode === "link-source") && <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Click source node...</span>}
        {(mode === "add-page") && <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Click canvas to place page...</span>}
      </div>

      {/* Main Layout */}
      <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "1fr 300px" }}>
        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px" }}>
            <button onClick={() => setTab("graph")} style={tabStyle(tab === "graph")}>Web Graph</button>
            <button onClick={() => setTab("index")} style={tabStyle(tab === "index")}>Inverted Index</button>
          </div>

          {tab === "graph" ? (
            <canvas
              ref={canvasRef}
              style={{
                height: "400px",
                width: "100%",
                cursor: mode === "add-page" ? "crosshair" : "default",
                borderRadius: "10px",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          ) : (
            <div style={{ height: "400px", overflow: "auto", ...panelStyle }}>
              {!indexed ? (
                <p style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Run "Crawl" first to build the inverted index.</p>
              ) : indexEntries.length === 0 ? (
                <p style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Index is empty.</p>
              ) : (
                <table style={{ width: "100%", fontSize: "11px", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <th style={{ padding: "4px 6px", textAlign: "left", fontWeight: "600", color: "var(--color-heading)" }}>Word</th>
                      <th style={{ padding: "4px 6px", textAlign: "left", fontWeight: "600", color: "var(--color-heading)" }}>Pages (TF)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {indexEntries.map(([word, entries]) => (
                      <tr key={word} style={{ borderBottom: "1px solid rgba(39,39,42,0.3)" }}>
                        <td style={{ padding: "3px 6px", fontFamily: "monospace", color: "var(--color-accent)" }}>{word}</td>
                        <td style={{ padding: "3px 6px", color: "var(--color-text-muted)" }}>
                          {entries.map((e) => {
                            const p = pages.find((pg) => pg.id === e.pageId);
                            return p ? `${p.title} (${e.tf.toFixed(2)})` : "";
                          }).filter(Boolean).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Search */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <input
              type="text"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              placeholder={indexed ? "Search indexed pages..." : "Crawl first to enable search"}
              disabled={!indexed}
              style={{
                borderRadius: "8px",
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                padding: "8px 12px",
                fontSize: "13px",
                color: "var(--color-text)",
                outline: "none",
                opacity: indexed ? 1 : 0.4,
              }}
            />
            {results.length > 0 && (
              <div style={panelStyle}>
                <div style={labelStyle}>Results ({results.length})</div>
                {results.map((r, i) => (
                  <div
                    key={r.pageId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: i < results.length - 1 ? "1px solid rgba(39,39,42,0.3)" : "none",
                    }}
                  >
                    <span style={{ fontSize: "13px", color: "var(--color-text)" }}>
                      <span style={{ color: "var(--color-text-muted)", marginRight: "6px" }}>#{i + 1}</span>
                      {r.title}
                    </span>
                    <div style={{ display: "flex", gap: "8px", fontSize: "10px", fontFamily: "monospace" }}>
                      <span style={{ color: "var(--color-primary)" }}>TF-IDF: {r.tfidf.toFixed(3)}</span>
                      <span style={{ color: "var(--color-accent)" }}>PR: {r.pr.toFixed(3)}</span>
                      <span style={{ color: "#f59e0b", fontWeight: "700" }}>{r.score.toFixed(4)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {/* Page Editor */}
          <div style={panelStyle}>
            <div style={labelStyle}>Page Editor</div>
            {selectedPageData ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onInput={(e) => setEditTitle((e.target as HTMLInputElement).value)}
                  onBlur={updatePage}
                  style={{
                    borderRadius: "4px",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg)",
                    padding: "6px 8px",
                    fontSize: "12px",
                    color: "var(--color-text)",
                    outline: "none",
                  }}
                />
                <label style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Content</label>
                <textarea
                  value={editContent}
                  onInput={(e) => setEditContent((e.target as HTMLTextAreaElement).value)}
                  onBlur={updatePage}
                  rows={5}
                  style={{
                    borderRadius: "4px",
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg)",
                    padding: "6px 8px",
                    fontSize: "12px",
                    color: "var(--color-text)",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
                <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                  PageRank: <span style={{ fontFamily: "monospace", color: "var(--color-primary)" }}>{selectedPageData.pageRank.toFixed(4)}</span>
                </div>
                <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
                  Out: {links.filter((l) => l.from === selectedPage).length} | In: {links.filter((l) => l.to === selectedPage).length}
                </div>
              </div>
            ) : (
              <p style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>Select a page to edit, or use "+ Page" to add one.</p>
            )}
          </div>

          {/* PageRank */}
          <div style={panelStyle}>
            <div style={labelStyle}>PageRank Scores</div>
            {pages.length === 0 ? (
              <p style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>No pages yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {[...pages].sort((a, b) => b.pageRank - a.pageRank).map((p) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: "11px", color: "var(--color-text)" }}>{p.title}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: "50px", height: "5px", borderRadius: "3px", background: "var(--color-border)" }}>
                        <div style={{ width: `${Math.min(100, p.pageRank * pages.length * 100)}%`, height: "100%", borderRadius: "3px", background: "var(--color-primary)" }} />
                      </div>
                      <span style={{ fontFamily: "monospace", fontSize: "10px", color: "var(--color-primary)", width: "38px", textAlign: "right" }}>{p.pageRank.toFixed(3)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* How It Works */}
          <div style={panelStyle}>
            <div style={labelStyle}>How It Works</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px", fontSize: "11px", color: "var(--color-text-muted)" }}>
              <p>1. Add pages (nodes) and links (directed edges)</p>
              <p>2. Click "Crawl" to traverse via BFS</p>
              <p>3. Crawler builds an inverted index (word-to-pages)</p>
              <p>4. PageRank: power iteration with d={DAMPING}</p>
              <p>5. Search ranked by TF-IDF * PageRank</p>
              <p>6. Node size scales with PageRank value</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
