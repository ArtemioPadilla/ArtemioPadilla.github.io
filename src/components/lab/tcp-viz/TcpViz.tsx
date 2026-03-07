import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type PacketType = "SYN" | "SYN-ACK" | "ACK" | "DATA" | "FIN" | "FIN-ACK";
type ConnState = "CLOSED" | "SYN_SENT" | "SYN_RECEIVED" | "ESTABLISHED" | "FIN_WAIT" | "CLOSE_WAIT" | "TIME_WAIT";
type CcAlgorithm = "reno" | "cubic";
type Phase = "Slow Start" | "Congestion Avoidance" | "Fast Recovery" | "";

interface Packet {
  id: number;
  type: PacketType;
  seq: number;
  ack: number;
  fromClient: boolean;
  progress: number;
  dropped: boolean;
  retransmit: boolean;
}

interface LogEntry {
  id: number;
  message: string;
  type: "info" | "send" | "recv" | "drop" | "retransmit" | "phase";
}

interface CwndPoint {
  time: number;
  cwnd: number;
  event: string;
  phase: Phase;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const PACKET_COLORS: Record<PacketType, string> = {
  SYN: "#4f8ff7",
  "SYN-ACK": "#34d399",
  ACK: "#a855f7",
  DATA: "#f59e0b",
  FIN: "#ef4444",
  "FIN-ACK": "#ec4899",
};

const PHASE_COLORS: Record<Phase, string> = {
  "Slow Start": "#4f8ff7",
  "Congestion Avoidance": "#34d399",
  "Fast Recovery": "#f59e0b",
  "": "#a1a1aa",
};

/* ══════════════════════════════════════════════════════════
   Congestion Window Graph (Canvas)
   ══════════════════════════════════════════════════════════ */

function CwndGraph({
  renoPoints,
  cubicPoints,
  compareMode,
}: {
  renoPoints: CwndPoint[];
  cubicPoints: CwndPoint[];
  compareMode: boolean;
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
    const pad = { top: 20, right: 20, bottom: 28, left: 45 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const allPts = [...renoPoints, ...(compareMode ? cubicPoints : [])];
    if (allPts.length < 2) return;

    const maxTime = Math.max(...allPts.map((p) => p.time), 1);
    const maxCwnd = Math.max(...allPts.map((p) => p.cwnd), 4);

    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 0.5;
    ctx.fillStyle = "#a1a1aa";
    ctx.font = "10px Inter, sans-serif";
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + plotH * (1 - i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(W - pad.right, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(String(Math.round((maxCwnd * i) / 4)), pad.left - 5, y + 3);
    }

    ctx.textAlign = "center";
    ctx.fillText("Time (RTTs)", W / 2, H - 2);
    ctx.save();
    ctx.translate(10, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("cwnd (segments)", 0, 0);
    ctx.restore();

    function drawLine(c: CanvasRenderingContext2D, pts: CwndPoint[], color: string, label: string) {
      if (pts.length < 2) return;
      c.beginPath();
      c.strokeStyle = color;
      c.lineWidth = 2;
      for (let i = 0; i < pts.length; i++) {
        const x = pad.left + (pts[i].time / maxTime) * plotW;
        const y = pad.top + plotH * (1 - pts[i].cwnd / maxCwnd);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();

      for (const pt of pts) {
        if (pt.event === "drop") {
          const x = pad.left + (pt.time / maxTime) * plotW;
          const y = pad.top + plotH * (1 - pt.cwnd / maxCwnd);
          c.fillStyle = "#ef4444";
          c.beginPath();
          c.arc(x, y, 4, 0, Math.PI * 2);
          c.fill();
        }
      }

      if (compareMode) {
        const last = pts[pts.length - 1];
        const lx = pad.left + (last.time / maxTime) * plotW + 5;
        const ly = pad.top + plotH * (1 - last.cwnd / maxCwnd);
        c.fillStyle = color;
        c.font = "bold 10px Inter, sans-serif";
        c.textAlign = "left";
        c.fillText(label, lx, ly);
      }
    }

    drawLine(ctx, renoPoints, "#4f8ff7", "Reno");
    if (compareMode) drawLine(ctx, cubicPoints, "#34d399", "Cubic");
  }, [renoPoints, cubicPoints, compareMode]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "160px",
        borderRadius: "4px",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-muted)",
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function TcpViz() {
  const [connState, setConnState] = useState<ConnState>("CLOSED");
  const [packets, setPackets] = useState<Packet[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [seqClient, setSeqClient] = useState(1000);
  const [seqServer, setSeqServer] = useState(5000);
  const [speed, setSpeed] = useState(1);
  const [stepMode, setStepMode] = useState(false);
  const [compareMode, setCompareMode] = useState(false);

  const [renoCwnd, setRenoCwnd] = useState(1);
  const [renoSsthresh, setRenoSsthresh] = useState(16);
  const [renoPoints, setRenoPoints] = useState<CwndPoint[]>([{ time: 0, cwnd: 1, event: "init", phase: "Slow Start" }]);

  const [cubicCwnd, setCubicCwnd] = useState(1);
  const [cubicSsthresh, setCubicSsthresh] = useState(16);
  const [cubicPoints, setCubicPoints] = useState<CwndPoint[]>([{ time: 0, cwnd: 1, event: "init", phase: "Slow Start" }]);

  const [dataCount, setDataCount] = useState(0);
  const [windowBase, setWindowBase] = useState(0);
  const [phase, setPhase] = useState<Phase>("Slow Start");

  const nextId = useRef(0);
  const timeRef = useRef(0);
  const animRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);
  const waitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = useCallback((message: string, type: LogEntry["type"]) => {
    setLogs((prev) => [...prev.slice(-80), { id: nextId.current++, message, type }]);
  }, []);

  const waitForStep = useCallback((): Promise<void> => {
    if (!stepMode) return Promise.resolve();
    return new Promise((resolve) => {
      waitRef.current = resolve;
    });
  }, [stepMode]);

  const continueStep = useCallback(() => {
    if (waitRef.current) {
      const fn = waitRef.current;
      waitRef.current = null;
      fn();
    }
  }, []);

  const animatePacket = useCallback(
    (type: PacketType, seq: number, ack: number, fromClient: boolean, dropped = false, retransmit = false): Promise<void> => {
      return new Promise((resolve) => {
        const pkt: Packet = {
          id: nextId.current++,
          type, seq, ack, fromClient, progress: 0, dropped, retransmit,
        };
        setPackets((prev) => [...prev, pkt]);

        const label = `${type} seq=${seq} ack=${ack}${dropped ? " [DROP]" : ""}${retransmit ? " [RE]" : ""}`;
        addLog(
          `${fromClient ? "Client" : "Server"} -> ${fromClient ? "Server" : "Client"}: ${label}`,
          dropped ? "drop" : retransmit ? "retransmit" : "send"
        );

        const dur = 800 / speed;
        const start = performance.now();

        function step() {
          const p = Math.min(1, (performance.now() - start) / dur);
          setPackets((prev) => prev.map((pk) => (pk.id === pkt.id ? { ...pk, progress: p } : pk)));
          if (p < 1 && !cancelRef.current) {
            animRef.current = requestAnimationFrame(step);
          } else {
            if (!dropped) {
              addLog(`${fromClient ? "Server" : "Client"} received ${type}`, "recv");
            }
            setTimeout(() => {
              setPackets((prev) => prev.filter((pk) => pk.id !== pkt.id));
            }, 150);
            resolve();
          }
        }
        animRef.current = requestAnimationFrame(step);
      });
    },
    [speed, addLog]
  );

  const startConnection = useCallback(async () => {
    if (connState !== "CLOSED") return;
    cancelRef.current = false;
    setPackets([]);
    setLogs([]);
    setRenoPoints([{ time: 0, cwnd: 1, event: "init", phase: "Slow Start" }]);
    setCubicPoints([{ time: 0, cwnd: 1, event: "init", phase: "Slow Start" }]);
    setRenoCwnd(1);
    setRenoSsthresh(16);
    setCubicCwnd(1);
    setCubicSsthresh(16);
    setDataCount(0);
    setWindowBase(0);
    setPhase("Slow Start");
    timeRef.current = 0;

    const cSeq = 1000;
    const sSeq = 5000;
    setSeqClient(cSeq);
    setSeqServer(sSeq);

    addLog("--- 3-Way Handshake ---", "info");
    addLog("[Phase: Connection Setup]", "phase");

    setConnState("SYN_SENT");
    await animatePacket("SYN", cSeq, 0, true);
    if (cancelRef.current) return;
    await waitForStep();

    setConnState("SYN_RECEIVED");
    await animatePacket("SYN-ACK", sSeq, cSeq + 1, false);
    if (cancelRef.current) return;
    await waitForStep();

    setSeqClient(cSeq + 1);
    setSeqServer(sSeq + 1);
    await animatePacket("ACK", cSeq + 1, sSeq + 1, true);
    if (cancelRef.current) return;

    setConnState("ESTABLISHED");
    addLog("Connection ESTABLISHED", "info");
    addLog("[Phase: Slow Start]", "phase");
    setPhase("Slow Start");
  }, [connState, animatePacket, addLog, waitForStep]);

  const computeNewCwnd = useCallback(
    (algo: CcAlgorithm, currentCwnd: number, ssthresh: number): { cwnd: number; phase: Phase } => {
      if (algo === "reno") {
        if (currentCwnd < ssthresh) {
          return { cwnd: currentCwnd * 2, phase: "Slow Start" };
        }
        return { cwnd: currentCwnd + 1, phase: "Congestion Avoidance" };
      }
      if (currentCwnd < ssthresh) {
        return { cwnd: currentCwnd * 2, phase: "Slow Start" };
      }
      const increment = Math.max(1, Math.round(0.4 * Math.cbrt(currentCwnd)));
      return { cwnd: currentCwnd + increment, phase: "Congestion Avoidance" };
    },
    []
  );

  const sendData = useCallback(async () => {
    if (connState !== "ESTABLISHED") return;
    cancelRef.current = false;

    const newData = dataCount + 1;
    setDataCount(newData);
    timeRef.current += 1;

    const renoResult = computeNewCwnd("reno", renoCwnd, renoSsthresh);
    setRenoCwnd(renoResult.cwnd);
    setRenoPoints((prev) => [...prev, { time: timeRef.current, cwnd: renoResult.cwnd, event: "send", phase: renoResult.phase }]);

    const cubicResult = computeNewCwnd("cubic", cubicCwnd, cubicSsthresh);
    setCubicCwnd(cubicResult.cwnd);
    setCubicPoints((prev) => [...prev, { time: timeRef.current, cwnd: cubicResult.cwnd, event: "send", phase: cubicResult.phase }]);

    const currentPhase = renoResult.phase;
    if (currentPhase !== phase) {
      addLog(`[Phase: ${currentPhase}]`, "phase");
      setPhase(currentPhase);
    }

    await animatePacket("DATA", seqClient + newData, seqServer, true);
    if (cancelRef.current) return;
    await waitForStep();

    await animatePacket("ACK", seqServer, seqClient + newData + 1, false);
    if (cancelRef.current) return;

    setWindowBase(newData);
  }, [connState, seqClient, seqServer, renoCwnd, renoSsthresh, cubicCwnd, cubicSsthresh, dataCount, phase, animatePacket, addLog, waitForStep, computeNewCwnd]);

  const dropPacket = useCallback(async () => {
    if (connState !== "ESTABLISHED") return;
    cancelRef.current = false;

    const newData = dataCount + 1;
    setDataCount(newData);
    timeRef.current += 1;

    const newRenoSsthresh = Math.max(Math.floor(renoCwnd / 2), 1);
    setRenoSsthresh(newRenoSsthresh);
    setRenoCwnd(1);
    setRenoPoints((prev) => [...prev, { time: timeRef.current, cwnd: 1, event: "drop", phase: "Fast Recovery" }]);

    const newCubicSsthresh = Math.max(Math.floor(cubicCwnd * 0.7), 1);
    setCubicSsthresh(newCubicSsthresh);
    const cubicNew = Math.max(Math.floor(cubicCwnd * 0.7), 1);
    setCubicCwnd(cubicNew);
    setCubicPoints((prev) => [...prev, { time: timeRef.current, cwnd: cubicNew, event: "drop", phase: "Fast Recovery" }]);

    addLog("[Phase: Fast Recovery]", "phase");
    setPhase("Fast Recovery");
    addLog("Packet loss detected!", "info");

    await animatePacket("DATA", seqClient + newData, seqServer, true, true);
    if (cancelRef.current) return;

    addLog("Timeout! Retransmitting...", "info");
    timeRef.current += 1;
    setRenoPoints((prev) => [...prev, { time: timeRef.current, cwnd: 1, event: "retransmit", phase: "Slow Start" }]);
    setCubicPoints((prev) => [...prev, { time: timeRef.current, cwnd: cubicNew, event: "retransmit", phase: "Slow Start" }]);

    await animatePacket("DATA", seqClient + newData, seqServer, true, false, true);
    if (cancelRef.current) return;
    await waitForStep();

    await animatePacket("ACK", seqServer, seqClient + newData + 1, false);
    if (cancelRef.current) return;

    addLog(`Reno: ssthresh=${newRenoSsthresh}, cwnd=1 | Cubic: ssthresh=${newCubicSsthresh}, cwnd=${cubicNew}`, "info");
    addLog("[Phase: Slow Start]", "phase");
    setPhase("Slow Start");
    setWindowBase(newData);
  }, [connState, seqClient, seqServer, renoCwnd, cubicCwnd, dataCount, animatePacket, addLog, waitForStep]);

  const closeConnection = useCallback(async () => {
    if (connState !== "ESTABLISHED") return;
    cancelRef.current = false;

    addLog("--- Connection Teardown ---", "info");
    setConnState("FIN_WAIT");
    await animatePacket("FIN", seqClient + dataCount + 1, seqServer, true);
    if (cancelRef.current) return;

    await animatePacket("ACK", seqServer, seqClient + dataCount + 2, false);
    if (cancelRef.current) return;

    setConnState("CLOSE_WAIT");
    await animatePacket("FIN", seqServer, seqClient + dataCount + 2, false);
    if (cancelRef.current) return;

    await animatePacket("ACK", seqClient + dataCount + 2, seqServer + 1, true);
    if (cancelRef.current) return;

    setConnState("TIME_WAIT");
    addLog("Connection CLOSED", "info");
    setTimeout(() => setConnState("CLOSED"), 1200);
  }, [connState, seqClient, seqServer, dataCount, animatePacket, addLog]);

  const reset = useCallback(() => {
    cancelRef.current = true;
    cancelAnimationFrame(animRef.current);
    waitRef.current = null;
    setConnState("CLOSED");
    setPackets([]);
    setLogs([]);
    setRenoPoints([{ time: 0, cwnd: 1, event: "init", phase: "Slow Start" }]);
    setCubicPoints([{ time: 0, cwnd: 1, event: "init", phase: "Slow Start" }]);
    setRenoCwnd(1);
    setCubicCwnd(1);
    setDataCount(0);
    setPhase("Slow Start");
  }, []);

  const stateColor = connState === "ESTABLISHED" ? "#34d399"
    : connState === "CLOSED" ? "#a1a1aa"
    : "#f59e0b";

  const btn = (bg: string, disabled = false) => ({
    borderRadius: "4px",
    padding: "6px 14px",
    fontSize: "12px",
    fontWeight: "600" as const,
    color: "#ffffff",
    background: bg,
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  });

  const btnOutline = {
    borderRadius: "4px",
    padding: "6px 12px",
    fontSize: "12px",
    color: "var(--color-text-muted)",
    background: "transparent",
    border: "1px solid var(--color-border)",
    cursor: "pointer",
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        <button onClick={startConnection} disabled={connState !== "CLOSED"} style={btn("var(--color-primary)", connState !== "CLOSED")}>
          Connect
        </button>
        <button onClick={sendData} disabled={connState !== "ESTABLISHED"} style={btn("var(--color-accent)", connState !== "ESTABLISHED")}>
          Send Data
        </button>
        <button onClick={dropPacket} disabled={connState !== "ESTABLISHED"} style={btn("#f59e0b", connState !== "ESTABLISHED")}>
          Drop Packet
        </button>
        <button onClick={closeConnection} disabled={connState !== "ESTABLISHED"} style={btn("#ef4444", connState !== "ESTABLISHED")}>
          Close (FIN)
        </button>
        <button onClick={reset} style={btnOutline}>Reset</button>

        {waitRef.current && (
          <button onClick={continueStep} style={btn("#a855f7")}>Next Step</button>
        )}

        <div style={{ width: "1px", height: "20px", background: "var(--color-border)" }} />

        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--color-text-muted)" }}>
          Speed:
          <input type="range" min={0.5} max={3} step={0.5} value={speed}
            onInput={(e) => setSpeed(Number((e.target as HTMLInputElement).value))}
            style={{ width: "60px" }} />
          <span style={{ color: "var(--color-heading)", fontWeight: "600" }}>{speed}x</span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={stepMode} onChange={(e) => setStepMode((e.target as HTMLInputElement).checked)} />
          Step-by-step
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={compareMode} onChange={(e) => setCompareMode((e.target as HTMLInputElement).checked)} />
          Compare Reno/Cubic
        </label>
      </div>

      {/* State + Phase */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", fontSize: "12px" }}>
        <span style={{ color: "var(--color-text-muted)" }}>State:</span>
        <span style={{ borderRadius: "4px", padding: "2px 8px", fontWeight: "600", background: stateColor + "20", color: stateColor }}>
          {connState}
        </span>
        {phase && (
          <>
            <span style={{ color: "var(--color-text-muted)" }}>Phase:</span>
            <span style={{ borderRadius: "4px", padding: "2px 8px", fontWeight: "600", background: PHASE_COLORS[phase] + "20", color: PHASE_COLORS[phase] }}>
              {phase}
            </span>
          </>
        )}
        <span style={{ color: "var(--color-text-muted)" }}>
          Reno cwnd: <strong style={{ color: "#4f8ff7" }}>{renoCwnd}</strong> ssthresh: {renoSsthresh}
        </span>
        {compareMode && (
          <span style={{ color: "var(--color-text-muted)" }}>
            Cubic cwnd: <strong style={{ color: "#34d399" }}>{cubicCwnd}</strong> ssthresh: {cubicSsthresh}
          </span>
        )}
      </div>

      {/* Client-Server Diagram */}
      <div
        style={{
          position: "relative",
          borderRadius: "8px",
          border: "1px solid var(--color-border)",
          background: "var(--color-surface)",
          padding: "16px",
          minHeight: "260px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
          <div style={{ textAlign: "center", width: "80px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-heading)" }}>Client</div>
            <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>seq: {seqClient}</div>
          </div>
          <div style={{ textAlign: "center", width: "80px" }}>
            <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-heading)" }}>Server</div>
            <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>seq: {seqServer}</div>
          </div>
        </div>

        {/* Timeline lines */}
        <div style={{ position: "absolute", left: "56px", top: "60px", bottom: "16px", width: "2px", background: "var(--color-border)" }} />
        <div style={{ position: "absolute", right: "56px", top: "60px", bottom: "16px", width: "2px", background: "var(--color-border)" }} />

        {/* Packets */}
        {packets.map((pkt) => {
          const y = 70 + (pkt.id % 7) * 24;
          return (
            <div
              key={pkt.id}
              style={{
                position: "absolute",
                left: pkt.fromClient
                  ? `calc(56px + ${pkt.progress} * (100% - 112px))`
                  : `calc(100% - 56px - ${pkt.progress} * (100% - 112px))`,
                top: `${y}px`,
                transform: "translate(-50%, -50%)",
                opacity: pkt.dropped && pkt.progress > 0.5 ? 1 - (pkt.progress - 0.5) * 2 : 1,
                zIndex: 10,
              }}
            >
              <div
                style={{
                  borderRadius: "3px",
                  padding: "2px 6px",
                  fontSize: "10px",
                  fontWeight: "700",
                  color: "#ffffff",
                  whiteSpace: "nowrap",
                  background: PACKET_COLORS[pkt.type],
                  textDecoration: pkt.dropped ? "line-through" : "none",
                }}
              >
                {pkt.type} {pkt.seq}
                {pkt.retransmit && " (re)"}
              </div>
            </div>
          );
        })}

        {/* Sliding Window */}
        {connState === "ESTABLISHED" && (
          <div style={{ paddingTop: "80px" }}>
            <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
              Sliding Window (cwnd={renoCwnd}):
            </div>
            <div style={{ display: "flex", gap: "3px" }}>
              {Array.from({ length: Math.max(8, renoCwnd + windowBase + 1) }, (_, i) => {
                const inWindow = i >= windowBase && i < windowBase + renoCwnd;
                const sent = i < windowBase;
                return (
                  <div
                    key={i}
                    style={{
                      width: "28px",
                      height: "22px",
                      borderRadius: "3px",
                      fontSize: "10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "monospace",
                      background: sent ? "rgba(52,211,153,0.2)" : inWindow ? "rgba(79,143,247,0.2)" : "var(--color-bg)",
                      border: `1px solid ${inWindow ? "var(--color-primary)" : "var(--color-border)"}`,
                      color: sent ? "var(--color-accent)" : inWindow ? "var(--color-primary)" : "var(--color-text-muted)",
                    }}
                  >
                    {i}
                  </div>
                );
              }).slice(0, 12)}
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "4px", fontSize: "9px", color: "var(--color-text-muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "rgba(52,211,153,0.3)" }} />
                ACK'd
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "2px", background: "rgba(79,143,247,0.3)" }} />
                In Flight
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Congestion Window Graph */}
      {renoPoints.length > 1 && (
        <div>
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            Congestion Window over time:
            {compareMode && (
              <span>
                {" "}<span style={{ color: "#4f8ff7", fontWeight: "600" }}>Reno</span>{" vs "}
                <span style={{ color: "#34d399", fontWeight: "600" }}>Cubic</span>
              </span>
            )}
          </div>
          <CwndGraph renoPoints={renoPoints} cubicPoints={cubicPoints} compareMode={compareMode} />
        </div>
      )}

      {/* Log */}
      <div
        ref={logRef}
        style={{
          maxHeight: "160px",
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
          <span style={{ color: "var(--color-text-muted)" }}>Click "Connect" to start the 3-way handshake...</span>
        )}
        {logs.map((entry) => (
          <div
            key={entry.id}
            style={{
              padding: "1px 0",
              color:
                entry.type === "send" ? "var(--color-primary)"
                : entry.type === "recv" ? "var(--color-accent)"
                : entry.type === "drop" ? "#ef4444"
                : entry.type === "retransmit" ? "#f59e0b"
                : entry.type === "phase" ? "#a855f7"
                : "var(--color-text-muted)",
              fontWeight: entry.type === "phase" ? "700" : "400",
            }}
          >
            {entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}
