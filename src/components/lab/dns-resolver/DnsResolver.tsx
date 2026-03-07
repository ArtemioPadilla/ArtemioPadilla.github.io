import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type RecordType = "A" | "AAAA" | "CNAME" | "MX";
type ResolutionMode = "recursive" | "iterative";

interface DnsNode {
  id: string;
  label: string;
  x: number;
  y: number;
  description: string;
}

interface CacheEntry {
  domain: string;
  value: string;
  type: RecordType;
  ttl: number;
}

interface DnsStep {
  from: string;
  to: string;
  queryLabel: string;
  responseLabel: string;
  delay: number;
  bubble: string;
  cached?: boolean;
}

interface LogEntry {
  step: number;
  message: string;
  time: number;
  type: "query" | "response" | "info" | "cache";
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const NODES: DnsNode[] = [
  { id: "browser", label: "Browser", x: 60, y: 200, description: "User application" },
  { id: "os-cache", label: "OS Cache", x: 180, y: 80, description: "Local DNS cache" },
  { id: "resolver", label: "Recursive\nResolver", x: 320, y: 200, description: "ISP DNS server" },
  { id: "root", label: "Root\nServer", x: 500, y: 60, description: ". (root zone)" },
  { id: "tld", label: "TLD\nServer", x: 500, y: 200, description: ".com / .org / etc" },
  { id: "auth", label: "Authoritative\nServer", x: 500, y: 340, description: "Domain nameserver" },
];

const CONNECTIONS: [string, string][] = [
  ["browser", "os-cache"],
  ["browser", "resolver"],
  ["resolver", "root"],
  ["resolver", "tld"],
  ["resolver", "auth"],
];

function hashDomain(domain: string): number {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = ((h << 5) - h + domain.charCodeAt(i)) | 0;
  return h;
}

function generateRecord(domain: string, type: RecordType): string {
  const h = hashDomain(domain);
  switch (type) {
    case "A": {
      const a = ((h >> 24) & 0xff) || 93;
      const b = ((h >> 16) & 0xff) || 184;
      const c = ((h >> 8) & 0xff) || 216;
      const d = (h & 0xff) || 34;
      return `${Math.abs(a)}.${Math.abs(b)}.${Math.abs(c)}.${Math.abs(d)}`;
    }
    case "AAAA": {
      const seg = (n: number) => Math.abs(n & 0xffff).toString(16).padStart(4, "0");
      return `2001:0db8:${seg(h >> 16)}:${seg(h)}::${seg(h >> 8)}`;
    }
    case "CNAME":
      return `cdn.${domain}`;
    case "MX":
      return `10 mail.${domain}`;
  }
}

function parseDomain(d: string): { tld: string; sld: string; full: string } {
  const clean = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").trim();
  const parts = clean.split(".");
  const tld = parts.length >= 2 ? `.${parts[parts.length - 1]}` : ".com";
  const sld = parts.length >= 2 ? parts[parts.length - 2] : clean;
  return { tld, sld, full: clean || "example.com" };
}

function buildSteps(domain: string, recordType: RecordType, mode: ResolutionMode): DnsStep[] {
  const { tld, sld, full } = parseDomain(domain);
  const record = generateRecord(full, recordType);

  const cacheStep: DnsStep = {
    from: "browser", to: "os-cache",
    queryLabel: `${recordType} ${full}?`, responseLabel: "Cache MISS",
    delay: 1, bubble: "Checking local cache...",
  };

  if (mode === "recursive") {
    return [
      cacheStep,
      { from: "browser", to: "resolver", queryLabel: `${recordType} ${full}?`, responseLabel: "I'll look it up", delay: 5, bubble: "Forward to recursive resolver" },
      { from: "resolver", to: "root", queryLabel: `${recordType} ${full}?`, responseLabel: `Refer to ${tld} TLD`, delay: 25, bubble: `Root: I know ${tld} nameservers` },
      { from: "resolver", to: "tld", queryLabel: `${recordType} ${full}?`, responseLabel: `ns1.${sld}${tld}`, delay: 35, bubble: `TLD: Authoritative NS for ${sld}${tld}` },
      { from: "resolver", to: "auth", queryLabel: `${recordType} ${full}?`, responseLabel: record, delay: 20, bubble: `Auth: ${full} = ${record}` },
      { from: "resolver", to: "browser", queryLabel: record, responseLabel: "", delay: 3, bubble: `Final answer: ${record}` },
    ];
  }

  return [
    cacheStep,
    { from: "browser", to: "resolver", queryLabel: `${recordType} ${full}?`, responseLabel: "Ask root at 198.41.0.4", delay: 5, bubble: "Resolver gives hint" },
    { from: "browser", to: "root", queryLabel: `${recordType} ${full}?`, responseLabel: `Refer to ${tld} TLD`, delay: 25, bubble: `Root: Try ${tld} servers` },
    { from: "browser", to: "tld", queryLabel: `${recordType} ${full}?`, responseLabel: `ns1.${sld}${tld}`, delay: 35, bubble: `TLD: ns1.${sld}${tld}` },
    { from: "browser", to: "auth", queryLabel: `${recordType} ${full}?`, responseLabel: record, delay: 20, bubble: `Auth: ${record}` },
  ];
}

function buildCacheEntries(domain: string, recordType: RecordType): CacheEntry[] {
  const { tld, full } = parseDomain(domain);
  const record = generateRecord(full, recordType);
  return [
    { domain: full, value: record, type: recordType, ttl: 300 },
    { domain: `${tld} NS`, value: `a.gtld-servers.net`, type: "A" as RecordType, ttl: 172800 },
    { domain: `. NS`, value: `a.root-servers.net`, type: "A" as RecordType, ttl: 518400 },
  ];
}

/* ══════════════════════════════════════════════════════════
   Canvas Component
   ══════════════════════════════════════════════════════════ */

function NetworkCanvas({
  activeNode,
  packetFrom,
  packetTo,
  packetProgress,
  bubbleMap,
  highlightedNodes,
}: {
  activeNode: string;
  packetFrom: string;
  packetTo: string;
  packetProgress: number;
  bubbleMap: Record<string, string>;
  highlightedNodes: Set<string>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    const PRIMARY = "#4f8ff7";
    const ACCENT = "#34d399";
    const BORDER = "#27272a";
    const TEXT = "#e4e4e7";
    const MUTED = "#a1a1aa";
    const SURFACE = "#111111";

    ctx.clearRect(0, 0, W, H);

    const sX = W / 600;
    const sY = H / 420;
    const sc = Math.min(sX, sY);

    const scaled = NODES.map((n) => ({ ...n, sx: n.x * sX, sy: n.y * sY }));

    for (const [fId, tId] of CONNECTIONS) {
      const f = scaled.find((n) => n.id === fId)!;
      const t = scaled.find((n) => n.id === tId)!;
      ctx.strokeStyle = highlightedNodes.has(fId) && highlightedNodes.has(tId) ? PRIMARY + "60" : BORDER;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(f.sx, f.sy);
      ctx.lineTo(t.sx, t.sy);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const node of scaled) {
      const isActive = node.id === activeNode;
      const isVisited = highlightedNodes.has(node.id);
      const r = 30 * sc;

      ctx.beginPath();
      ctx.arc(node.sx, node.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? PRIMARY + "30" : isVisited ? ACCENT + "15" : SURFACE;
      ctx.fill();
      ctx.strokeStyle = isActive ? PRIMARY : isVisited ? ACCENT : BORDER;
      ctx.lineWidth = isActive ? 2.5 : 1;
      ctx.stroke();

      ctx.fillStyle = isActive ? "#ffffff" : isVisited ? ACCENT : TEXT;
      ctx.font = `bold ${11 * sc}px Inter, sans-serif`;
      ctx.textAlign = "center";
      const lines = node.label.split("\n");
      for (let li = 0; li < lines.length; li++) {
        ctx.fillText(lines[li], node.sx, node.sy + (li - (lines.length - 1) / 2) * 13 * sc);
      }

      ctx.fillStyle = MUTED;
      ctx.font = `${8 * sc}px Inter, sans-serif`;
      ctx.fillText(node.description, node.sx, node.sy + r + 12 * sc);

      if (bubbleMap[node.id]) {
        const bx = node.sx;
        const by = node.sy - r - 18 * sc;
        const text = bubbleMap[node.id];
        ctx.font = `${9 * sc}px Inter, sans-serif`;
        const tw = ctx.measureText(text).width + 12;
        const bh = 18 * sc;

        ctx.fillStyle = SURFACE;
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(bx - tw / 2, by - bh / 2, tw, bh, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = ACCENT;
        ctx.textAlign = "center";
        ctx.fillText(text, bx, by + 3 * sc);
      }
    }

    if (packetFrom && packetTo && packetProgress >= 0) {
      const f = scaled.find((n) => n.id === packetFrom);
      const t = scaled.find((n) => n.id === packetTo);
      if (f && t) {
        const px = f.sx + (t.sx - f.sx) * packetProgress;
        const py = f.sy + (t.sy - f.sy) * packetProgress;

        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT;
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
    }
  }, [activeNode, packetFrom, packetTo, packetProgress, bubbleMap, highlightedNodes]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "340px",
        borderRadius: "8px",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg)",
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function DnsResolver() {
  const [domain, setDomain] = useState("www.example.org");
  const [recordType, setRecordType] = useState<RecordType>("A");
  const [mode, setMode] = useState<ResolutionMode>("recursive");
  const [stepByStep, setStepByStep] = useState(false);
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [activeNode, setActiveNode] = useState("");
  const [packetFrom, setPacketFrom] = useState("");
  const [packetTo, setPacketTo] = useState("");
  const [packetProgress, setPacketProgress] = useState(-1);
  const [bubbleMap, setBubbleMap] = useState<Record<string, string>>({});
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalTime, setTotalTime] = useState(0);
  const [cacheEntries, setCacheEntries] = useState<CacheEntry[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);

  const cancelRef = useRef(false);
  const continueRef = useRef<(() => void) | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const animatePacket = useCallback(
    (from: string, to: string): Promise<void> =>
      new Promise((resolve) => {
        setPacketFrom(from);
        setPacketTo(to);
        const dur = 600;
        const start = performance.now();
        function frame() {
          const p = Math.min(1, (performance.now() - start) / dur);
          setPacketProgress(p);
          if (p < 1 && !cancelRef.current) {
            requestAnimationFrame(frame);
          } else {
            setPacketProgress(-1);
            resolve();
          }
        }
        requestAnimationFrame(frame);
      }),
    []
  );

  const waitForStep = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      setWaiting(true);
      continueRef.current = () => {
        setWaiting(false);
        resolve();
      };
    });
  }, []);

  const continueStep = useCallback(() => {
    if (continueRef.current) {
      continueRef.current();
      continueRef.current = null;
    }
  }, []);

  const resolve = useCallback(async () => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    setLogs([]);
    setBubbleMap({});
    setHighlightedNodes(new Set());
    setActiveNode("");
    setPacketFrom("");
    setPacketTo("");
    setPacketProgress(-1);
    setTotalTime(0);
    setCacheEntries([]);
    setCurrentStepIndex(-1);

    const steps = buildSteps(domain, recordType, mode);
    let cumTime = 0;
    const visited = new Set<string>();

    for (let si = 0; si < steps.length; si++) {
      if (cancelRef.current) break;
      const step = steps[si];
      cumTime += step.delay;
      setCurrentStepIndex(si);

      visited.add(step.from);
      setHighlightedNodes(new Set(visited));
      setActiveNode(step.from);

      setLogs((prev) => [
        ...prev,
        { step: si + 1, message: `${step.from} -> ${step.to}: ${step.queryLabel}`, time: cumTime, type: "query" },
      ]);

      setBubbleMap((prev) => ({ ...prev, [step.from]: step.queryLabel }));

      await animatePacket(step.from, step.to);
      if (cancelRef.current) break;

      visited.add(step.to);
      setHighlightedNodes(new Set(visited));
      setActiveNode(step.to);
      setBubbleMap((prev) => ({ ...prev, [step.to]: step.bubble }));

      if (step.responseLabel) {
        setLogs((prev) => [
          ...prev,
          { step: si + 1, message: `${step.to}: ${step.responseLabel}`, time: cumTime, type: "response" },
        ]);

        await animatePacket(step.to, step.from);
        if (cancelRef.current) break;
      }

      setTotalTime(cumTime);

      if (stepByStep && si < steps.length - 1) {
        await waitForStep();
        if (cancelRef.current) break;
      } else {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    if (!cancelRef.current) {
      const cache = buildCacheEntries(domain, recordType);
      setCacheEntries(cache);
      setLogs((prev) => [
        ...prev,
        { step: steps.length + 1, message: `Resolution complete in ${cumTime}ms`, time: cumTime, type: "info" },
      ]);
    }

    setPacketFrom("");
    setPacketTo("");
    setRunning(false);
    setWaiting(false);
  }, [domain, recordType, mode, running, stepByStep, animatePacket, waitForStep]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    continueRef.current = null;
    setRunning(false);
    setWaiting(false);
  }, []);

  const RECORD_TYPES: RecordType[] = ["A", "AAAA", "CNAME", "MX"];

  const inputStyle = {
    flex: "1",
    minWidth: "180px",
    borderRadius: "4px",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface)",
    padding: "6px 12px",
    fontSize: "13px",
    color: "var(--color-text)",
    outline: "none",
  };

  const btnPrimary = {
    borderRadius: "4px",
    padding: "6px 16px",
    fontSize: "13px",
    fontWeight: "600",
    color: "#ffffff",
    background: "var(--color-primary)",
    border: "none",
    cursor: "pointer",
  };

  const btnOutline = {
    borderRadius: "4px",
    padding: "6px 12px",
    fontSize: "12px",
    color: "var(--color-text-muted)",
    background: "transparent",
    border: "1px solid var(--color-border)",
    cursor: "pointer",
  };

  const pillActive = (active: boolean) => ({
    borderRadius: "4px",
    padding: "4px 10px",
    fontSize: "11px",
    fontWeight: "600",
    border: active ? "none" : "1px solid var(--color-border)",
    background: active ? "var(--color-primary)" : "transparent",
    color: active ? "#ffffff" : "var(--color-text-muted)",
    cursor: "pointer",
  });

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Controls Row 1 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          value={domain}
          onInput={(e) => setDomain((e.target as HTMLInputElement).value)}
          placeholder="Enter domain name..."
          style={inputStyle}
        />
        <button onClick={running ? cancel : resolve} style={{ ...btnPrimary, background: running ? "#ef4444" : "var(--color-primary)" }}>
          {running ? "Cancel" : "Resolve"}
        </button>
        {waiting && (
          <button onClick={continueStep} style={{ ...btnPrimary, background: "var(--color-accent)" }}>
            Next Step
          </button>
        )}
      </div>

      {/* Controls Row 2 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", marginRight: "4px" }}>Record:</span>
          {RECORD_TYPES.map((rt) => (
            <button key={rt} onClick={() => setRecordType(rt)} style={pillActive(recordType === rt)}>
              {rt}
            </button>
          ))}
        </div>

        <div style={{ width: "1px", height: "20px", background: "var(--color-border)" }} />

        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <span style={{ fontSize: "11px", color: "var(--color-text-muted)", marginRight: "4px" }}>Mode:</span>
          <button onClick={() => setMode("recursive")} style={pillActive(mode === "recursive")}>
            Recursive
          </button>
          <button onClick={() => setMode("iterative")} style={pillActive(mode === "iterative")}>
            Iterative
          </button>
        </div>

        <div style={{ width: "1px", height: "20px", background: "var(--color-border)" }} />

        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--color-text-muted)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={stepByStep}
            onChange={(e) => setStepByStep((e.target as HTMLInputElement).checked)}
          />
          Step-by-step
        </label>
      </div>

      {/* Network Diagram */}
      <NetworkCanvas
        activeNode={activeNode}
        packetFrom={packetFrom}
        packetTo={packetTo}
        packetProgress={packetProgress}
        bubbleMap={bubbleMap}
        highlightedNodes={highlightedNodes}
      />

      {/* Bottom panels */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        {/* Log Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Resolution Log
          </span>
          <div
            ref={logRef}
            style={{
              maxHeight: "180px",
              overflowY: "auto",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              padding: "10px",
              fontFamily: "monospace",
              fontSize: "11px",
            }}
          >
            {logs.length === 0 && (
              <span style={{ color: "var(--color-text-muted)" }}>Enter a domain and click Resolve...</span>
            )}
            {logs.map((entry, i) => (
              <div
                key={i}
                style={{
                  padding: "2px 0",
                  color:
                    entry.type === "query" ? "var(--color-primary)"
                    : entry.type === "response" ? "var(--color-accent)"
                    : entry.type === "cache" ? "#f59e0b"
                    : "var(--color-text-muted)",
                }}
              >
                <span style={{ color: "var(--color-text-muted)" }}>[{entry.time}ms]</span>{" "}
                {entry.message}
              </div>
            ))}
          </div>
        </div>

        {/* Cache Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ fontSize: "11px", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            DNS Cache
          </span>
          <div
            style={{
              maxHeight: "180px",
              overflowY: "auto",
              borderRadius: "8px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              padding: "10px",
              fontSize: "11px",
            }}
          >
            {cacheEntries.length === 0 ? (
              <span style={{ color: "var(--color-text-muted)" }}>Cache is empty. Resolve a domain to populate.</span>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "var(--color-heading)", fontSize: "10px", fontWeight: "600" }}>Name</th>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "var(--color-heading)", fontSize: "10px", fontWeight: "600" }}>Type</th>
                    <th style={{ textAlign: "left", padding: "3px 6px", color: "var(--color-heading)", fontSize: "10px", fontWeight: "600" }}>Value</th>
                    <th style={{ textAlign: "right", padding: "3px 6px", color: "var(--color-heading)", fontSize: "10px", fontWeight: "600" }}>TTL</th>
                  </tr>
                </thead>
                <tbody>
                  {cacheEntries.map((entry, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "3px 6px", fontFamily: "monospace", color: "var(--color-accent)" }}>{entry.domain}</td>
                      <td style={{ padding: "3px 6px", color: "var(--color-primary)" }}>{entry.type}</td>
                      <td style={{ padding: "3px 6px", fontFamily: "monospace", color: "var(--color-text)" }}>{entry.value}</td>
                      <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--color-text-muted)" }}>{entry.ttl}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Timing Summary */}
      {totalTime > 0 && (
        <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "var(--color-text-muted)" }}>
          <span>
            Total: <strong style={{ color: "var(--color-heading)" }}>{totalTime}ms</strong>
          </span>
          <span>
            Hops: <strong style={{ color: "var(--color-heading)" }}>{logs.filter((l) => l.type === "query").length}</strong>
          </span>
          <span>
            Record: <strong style={{ color: "var(--color-primary)" }}>{recordType}</strong>
          </span>
          <span>
            Mode: <strong style={{ color: "var(--color-accent)" }}>{mode}</strong>
          </span>
        </div>
      )}

      {/* Legend */}
      <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
        Simulated DNS resolution. In <strong>recursive</strong> mode, the resolver queries on behalf of the client. In <strong>iterative</strong> mode, the client follows referrals itself.
      </div>
    </div>
  );
}
