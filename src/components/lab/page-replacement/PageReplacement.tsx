import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type Algorithm = "fifo" | "lru" | "optimal" | "clock";

interface FrameSnapshot {
  frames: (number | null)[];
  fault: boolean;
  replacedIndex: number;
  clockBits?: number[];
  clockPointer?: number;
}

interface SimResult {
  snapshots: FrameSnapshot[];
  totalFaults: number;
  hitRate: number;
}

/* ══════════════════════════════════════════════════════════
   Simulation Algorithms
   ══════════════════════════════════════════════════════════ */

function simulateFIFO(refString: number[], numFrames: number): SimResult {
  const frames: (number | null)[] = Array(numFrames).fill(null);
  const snapshots: FrameSnapshot[] = [];
  let faults = 0;
  let insertOrder: number[] = [];

  for (const page of refString) {
    if (frames.includes(page)) {
      snapshots.push({ frames: [...frames], fault: false, replacedIndex: -1 });
      continue;
    }
    faults++;
    let idx: number;
    if (frames.includes(null)) {
      idx = frames.indexOf(null);
    } else {
      const oldest = insertOrder.shift()!;
      idx = frames.indexOf(oldest);
    }
    frames[idx] = page;
    insertOrder.push(page);
    snapshots.push({ frames: [...frames], fault: true, replacedIndex: idx });
  }

  return { snapshots, totalFaults: faults, hitRate: refString.length ? ((refString.length - faults) / refString.length) * 100 : 0 };
}

function simulateLRU(refString: number[], numFrames: number): SimResult {
  const frames: (number | null)[] = Array(numFrames).fill(null);
  const snapshots: FrameSnapshot[] = [];
  let faults = 0;
  const lastUsed = new Map<number, number>();

  for (let t = 0; t < refString.length; t++) {
    const page = refString[t];
    if (frames.includes(page)) {
      lastUsed.set(page, t);
      snapshots.push({ frames: [...frames], fault: false, replacedIndex: -1 });
      continue;
    }
    faults++;
    let idx: number;
    if (frames.includes(null)) {
      idx = frames.indexOf(null);
    } else {
      let lruTime = Infinity;
      idx = 0;
      for (let fi = 0; fi < frames.length; fi++) {
        const used = lastUsed.get(frames[fi]!) ?? -1;
        if (used < lruTime) { lruTime = used; idx = fi; }
      }
    }
    frames[idx] = page;
    lastUsed.set(page, t);
    snapshots.push({ frames: [...frames], fault: true, replacedIndex: idx });
  }

  return { snapshots, totalFaults: faults, hitRate: refString.length ? ((refString.length - faults) / refString.length) * 100 : 0 };
}

function simulateOptimal(refString: number[], numFrames: number): SimResult {
  const frames: (number | null)[] = Array(numFrames).fill(null);
  const snapshots: FrameSnapshot[] = [];
  let faults = 0;

  for (let t = 0; t < refString.length; t++) {
    const page = refString[t];
    if (frames.includes(page)) {
      snapshots.push({ frames: [...frames], fault: false, replacedIndex: -1 });
      continue;
    }
    faults++;
    let idx: number;
    if (frames.includes(null)) {
      idx = frames.indexOf(null);
    } else {
      let farthest = -1;
      idx = 0;
      for (let fi = 0; fi < frames.length; fi++) {
        let nextUse = Infinity;
        for (let ft = t + 1; ft < refString.length; ft++) {
          if (refString[ft] === frames[fi]) { nextUse = ft; break; }
        }
        if (nextUse > farthest) { farthest = nextUse; idx = fi; }
      }
    }
    frames[idx] = page;
    snapshots.push({ frames: [...frames], fault: true, replacedIndex: idx });
  }

  return { snapshots, totalFaults: faults, hitRate: refString.length ? ((refString.length - faults) / refString.length) * 100 : 0 };
}

function simulateClock(refString: number[], numFrames: number): SimResult {
  const frames: (number | null)[] = Array(numFrames).fill(null);
  const bits: number[] = Array(numFrames).fill(0);
  const snapshots: FrameSnapshot[] = [];
  let faults = 0;
  let pointer = 0;

  for (const page of refString) {
    const existingIdx = frames.indexOf(page);
    if (existingIdx !== -1) {
      bits[existingIdx] = 1;
      snapshots.push({ frames: [...frames], fault: false, replacedIndex: -1, clockBits: [...bits], clockPointer: pointer });
      continue;
    }
    faults++;
    if (frames.includes(null)) {
      const idx = frames.indexOf(null);
      frames[idx] = page;
      bits[idx] = 1;
      snapshots.push({ frames: [...frames], fault: true, replacedIndex: idx, clockBits: [...bits], clockPointer: pointer });
      continue;
    }
    while (bits[pointer] === 1) {
      bits[pointer] = 0;
      pointer = (pointer + 1) % numFrames;
    }
    const idx = pointer;
    frames[idx] = page;
    bits[idx] = 1;
    pointer = (pointer + 1) % numFrames;
    snapshots.push({ frames: [...frames], fault: true, replacedIndex: idx, clockBits: [...bits], clockPointer: pointer });
  }

  return { snapshots, totalFaults: faults, hitRate: refString.length ? ((refString.length - faults) / refString.length) * 100 : 0 };
}

function runAlgorithm(algo: Algorithm, refString: number[], numFrames: number): SimResult {
  switch (algo) {
    case "fifo": return simulateFIFO(refString, numFrames);
    case "lru": return simulateLRU(refString, numFrames);
    case "optimal": return simulateOptimal(refString, numFrames);
    case "clock": return simulateClock(refString, numFrames);
  }
}

/* ══════════════════════════════════════════════════════════
   Clock Diagram (SVG)
   ══════════════════════════════════════════════════════════ */

function ClockDiagram({ frames, bits, pointer, numFrames }: { frames: (number | null)[]; bits: number[]; pointer: number; numFrames: number }) {
  const cx = 80;
  const cy = 80;
  const r = 55;

  return (
    <svg width="160" height="160" style={{ display: "block", margin: "0 auto" }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth="1" />
      {frames.map((f, i) => {
        const angle = (2 * Math.PI * i) / numFrames - Math.PI / 2;
        const fx = cx + r * Math.cos(angle);
        const fy = cy + r * Math.sin(angle);
        const isPtr = i === pointer;
        return (
          <g key={i}>
            <circle cx={fx} cy={fy} r={18} fill={isPtr ? "rgba(79,143,247,0.2)" : "var(--color-surface)"} stroke={isPtr ? "var(--color-primary)" : "var(--color-border)"} strokeWidth={isPtr ? 2 : 1} />
            <text x={fx} y={fy - 3} textAnchor="middle" fill="var(--color-heading)" fontSize="12" fontWeight="bold">{f !== null ? f : "-"}</text>
            <text x={fx} y={fy + 11} textAnchor="middle" fill={bits[i] ? "var(--color-accent)" : "var(--color-text-muted)"} fontSize="9">R={bits[i]}</text>
          </g>
        );
      })}
      {(() => {
        const angle = (2 * Math.PI * pointer) / numFrames - Math.PI / 2;
        const ax = cx + (r - 24) * Math.cos(angle);
        const ay = cy + (r - 24) * Math.sin(angle);
        return <line x1={cx} y1={cy} x2={ax} y2={ay} stroke="var(--color-primary)" strokeWidth="2" markerEnd="url(#clockArrow)" />;
      })()}
      <defs>
        <marker id="clockArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--color-primary)" />
        </marker>
      </defs>
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

const ALGO_LABELS: Record<Algorithm, string> = { fifo: "FIFO", lru: "LRU", optimal: "Optimal", clock: "Clock" };
const ALGO_LIST: Algorithm[] = ["fifo", "lru", "optimal", "clock"];

export default function PageReplacement() {
  const [refInput, setRefInput] = useState("7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1");
  const [numFrames, setNumFrames] = useState(3);
  const [algorithm, setAlgorithm] = useState<Algorithm>("fifo");
  const [result, setResult] = useState<SimResult | null>(null);
  const [currentStep, setCurrentStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(500);
  const [compareMode, setCompareMode] = useState(false);
  const playRef = useRef(false);

  const refString = useMemo(() => {
    return refInput.trim().split(/[\s,]+/).filter((s) => s !== "").map(Number).filter((n) => !isNaN(n));
  }, [refInput]);

  const simulate = useCallback(() => {
    const res = runAlgorithm(algorithm, refString, numFrames);
    setResult(res);
    setCurrentStep(-1);
    setPlaying(false);
    playRef.current = false;
  }, [algorithm, refString, numFrames]);

  const compareResults = useMemo(() => {
    if (!compareMode) return null;
    return ALGO_LIST.map((a) => ({ algo: a, result: runAlgorithm(a, refString, numFrames) }));
  }, [compareMode, refString, numFrames]);

  const stepForward = useCallback(() => {
    if (!result) return;
    setCurrentStep((prev) => Math.min(prev + 1, result.snapshots.length - 1));
  }, [result]);

  const stepBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, -1));
  }, []);

  useEffect(() => {
    if (!playing || !result) return;
    playRef.current = true;
    const interval = setInterval(() => {
      if (!playRef.current) { clearInterval(interval); return; }
      setCurrentStep((prev) => {
        const next = prev + 1;
        if (next >= result.snapshots.length) {
          playRef.current = false;
          setPlaying(false);
          return prev;
        }
        return next;
      });
    }, playSpeed);
    return () => { playRef.current = false; clearInterval(interval); };
  }, [playing, result, playSpeed]);

  const randomize = useCallback(() => {
    const len = 15 + Math.floor(Math.random() * 10);
    const pages = Array.from({ length: len }, () => Math.floor(Math.random() * 8));
    setRefInput(pages.join(" "));
    setResult(null);
    setCurrentStep(-1);
  }, []);

  const pill = (active: boolean) => ({
    borderRadius: "4px",
    padding: "4px 12px",
    fontSize: "12px",
    fontWeight: "600" as const,
    border: active ? "none" : "1px solid var(--color-border)",
    background: active ? "var(--color-primary)" : "transparent",
    color: active ? "#ffffff" : "var(--color-text-muted)",
    cursor: "pointer",
  });

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
    padding: "5px 10px",
    fontSize: "12px",
    color: "var(--color-text-muted)",
    background: "transparent",
    border: "1px solid var(--color-border)",
    cursor: "pointer",
  };

  const disabledBtn = (disabled: boolean) => ({
    ...btnOutline,
    opacity: disabled ? 0.3 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Input Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: "200px" }}>
          <label style={{ display: "block", fontSize: "11px", color: "var(--color-text-muted)", marginBottom: "4px" }}>
            Reference String (space or comma separated):
          </label>
          <input
            type="text"
            value={refInput}
            onInput={(e) => setRefInput((e.target as HTMLInputElement).value)}
            style={{
              width: "100%",
              borderRadius: "4px",
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              padding: "6px 12px",
              fontSize: "13px",
              color: "var(--color-text)",
              fontFamily: "monospace",
              outline: "none",
            }}
            placeholder="e.g. 7 0 1 2 0 3 0 4"
          />
        </div>
        <button onClick={randomize} style={btnOutline}>Random</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--color-text-muted)" }}>
          Frames:
          <input type="range" min={2} max={8} value={numFrames}
            onInput={(e) => { setNumFrames(Number((e.target as HTMLInputElement).value)); setResult(null); }}
            style={{ width: "80px" }} />
          <span style={{ color: "var(--color-heading)", fontWeight: "600", width: "12px" }}>{numFrames}</span>
        </label>

        <div style={{ display: "flex", gap: "4px" }}>
          {ALGO_LIST.map((key) => (
            <button key={key} onClick={() => { setAlgorithm(key); setResult(null); setCurrentStep(-1); }} style={pill(algorithm === key)}>
              {ALGO_LABELS[key]}
            </button>
          ))}
        </div>

        <button onClick={simulate} style={btnPrimary}>Simulate</button>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={compareMode} onChange={(e) => setCompareMode((e.target as HTMLInputElement).checked)} />
          Compare All
        </label>
      </div>

      {/* Single Algorithm View */}
      {result && !compareMode && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Playback */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button onClick={stepBack} disabled={currentStep <= -1} style={disabledBtn(currentStep <= -1)}>Prev</button>
            <button onClick={() => setPlaying(!playing)} style={{ ...btnPrimary, padding: "5px 14px", fontSize: "12px" }}>
              {playing ? "Pause" : "Play"}
            </button>
            <button onClick={stepForward} disabled={currentStep >= result.snapshots.length - 1} style={disabledBtn(currentStep >= result.snapshots.length - 1)}>Next</button>
            <span style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>
              Step {Math.max(0, currentStep + 1)} / {result.snapshots.length}
            </span>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--color-text-muted)", marginLeft: "auto" }}>
              Speed:
              <input type="range" min={100} max={1000} step={100} value={1100 - playSpeed}
                onInput={(e) => setPlaySpeed(1100 - Number((e.target as HTMLInputElement).value))}
                style={{ width: "60px" }} />
            </label>
          </div>

          {/* Access History Bar */}
          <div style={{ display: "flex", gap: "2px", flexWrap: "wrap" }}>
            {refString.map((page, i) => {
              const isActive = i === currentStep;
              const isPast = i <= currentStep;
              const isFault = isPast && i >= 0 && result.snapshots[i]?.fault;
              return (
                <div
                  key={i}
                  onClick={() => setCurrentStep(i)}
                  style={{
                    width: "26px",
                    height: "26px",
                    borderRadius: "3px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    fontFamily: "monospace",
                    fontWeight: isActive ? "700" : "400",
                    cursor: "pointer",
                    border: isActive ? "2px solid var(--color-primary)" : "1px solid var(--color-border)",
                    background: !isPast ? "var(--color-bg)" : isFault ? "rgba(239,68,68,0.15)" : "rgba(52,211,153,0.15)",
                    color: !isPast ? "var(--color-text-muted)" : isFault ? "#ef4444" : "var(--color-accent)",
                  }}
                >
                  {page}
                </div>
              );
            })}
          </div>

          {/* Frame Grid Table */}
          <div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
            <table style={{ fontSize: "12px", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <th style={{ padding: "4px 8px", textAlign: "left", color: "var(--color-text-muted)", position: "sticky", left: 0, background: "var(--color-surface)" }}>Ref</th>
                  {refString.map((p, i) => (
                    <th key={i} style={{
                      padding: "4px 6px",
                      minWidth: "28px",
                      textAlign: "center",
                      fontFamily: "monospace",
                      color: i <= currentStep && result.snapshots[i]?.fault ? "#ef4444" : i <= currentStep ? "var(--color-accent)" : "var(--color-text-muted)",
                      background: i === currentStep ? "rgba(79,143,247,0.12)" : "transparent",
                    }}>
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: numFrames }, (_, fi) => (
                  <tr key={fi} style={{ borderBottom: "1px solid rgba(39,39,42,0.3)" }}>
                    <td style={{ padding: "4px 8px", color: "var(--color-text-muted)", position: "sticky", left: 0, background: "var(--color-surface)" }}>F{fi}</td>
                    {refString.map((_, si) => {
                      if (si > currentStep) return <td key={si} style={{ padding: "4px 6px", textAlign: "center", color: "var(--color-text-muted)" }}>-</td>;
                      const snap = result.snapshots[si];
                      const val = snap.frames[fi];
                      const isReplaced = snap.fault && snap.replacedIndex === fi;
                      return (
                        <td key={si} style={{
                          padding: "4px 6px",
                          textAlign: "center",
                          fontFamily: "monospace",
                          background: isReplaced ? "rgba(239,68,68,0.2)" : si === currentStep ? "rgba(79,143,247,0.06)" : "transparent",
                          color: val !== null ? "var(--color-heading)" : "var(--color-text-muted)",
                        }}>
                          {val !== null ? val : "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "4px 8px", color: "var(--color-text-muted)", position: "sticky", left: 0, background: "var(--color-surface)" }}>Hit?</td>
                  {refString.map((_, si) => {
                    if (si > currentStep) return <td key={si} style={{ padding: "4px 6px" }} />;
                    const snap = result.snapshots[si];
                    return (
                      <td key={si} style={{ padding: "4px 6px", textAlign: "center", fontWeight: "700", color: snap.fault ? "#ef4444" : "var(--color-accent)" }}>
                        {snap.fault ? "F" : "H"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Clock Diagram + Stats side by side */}
          <div style={{ display: "grid", gridTemplateColumns: algorithm === "clock" && currentStep >= 0 ? "160px 1fr" : "1fr", gap: "12px", alignItems: "start" }}>
            {algorithm === "clock" && currentStep >= 0 && result.snapshots[currentStep]?.clockBits && (
              <div style={{ borderRadius: "8px", border: "1px solid var(--color-border)", background: "var(--color-surface)", padding: "10px" }}>
                <div style={{ fontSize: "10px", color: "var(--color-text-muted)", textAlign: "center", marginBottom: "4px", textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.05em" }}>Clock</div>
                <ClockDiagram
                  frames={result.snapshots[currentStep].frames}
                  bits={result.snapshots[currentStep].clockBits!}
                  pointer={result.snapshots[currentStep].clockPointer!}
                  numFrames={numFrames}
                />
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <div style={{ borderRadius: "6px", padding: "6px 12px", background: "rgba(239,68,68,0.12)", color: "#ef4444", fontSize: "12px", fontWeight: "600" }}>
                Page Faults: {result.totalFaults}
              </div>
              <div style={{ borderRadius: "6px", padding: "6px 12px", background: "rgba(52,211,153,0.12)", color: "#34d399", fontSize: "12px", fontWeight: "600" }}>
                Hit Rate: {result.hitRate.toFixed(1)}%
              </div>
              <div style={{ borderRadius: "6px", padding: "6px 12px", background: "rgba(245,158,11,0.12)", color: "#f59e0b", fontSize: "12px", fontWeight: "600" }}>
                Fault Rate: {(100 - result.hitRate).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compare Mode */}
      {compareMode && compareResults && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {/* Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
            {compareResults.map(({ algo, result: res }) => {
              const best = Math.min(...compareResults.map((c) => c.result.totalFaults));
              const isBest = res.totalFaults === best;
              return (
                <div key={algo} style={{
                  borderRadius: "8px",
                  border: `1px solid ${isBest ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: "var(--color-surface)",
                  padding: "12px",
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--color-heading)", marginBottom: "6px" }}>{ALGO_LABELS[algo]}</div>
                  <div style={{ fontSize: "28px", fontWeight: "700", color: "#ef4444" }}>{res.totalFaults}</div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-muted)" }}>page faults</div>
                  <div style={{ marginTop: "4px", fontSize: "12px", color: "var(--color-accent)", fontWeight: "600" }}>{res.hitRate.toFixed(1)}% hit rate</div>
                  {isBest && <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--color-accent)", fontWeight: "700", textTransform: "uppercase" }}>Best</div>}
                </div>
              );
            })}
          </div>

          {/* Bar Chart */}
          <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "120px", padding: "0 16px" }}>
            {compareResults.map(({ algo, result: res }, i) => {
              const maxF = Math.max(...compareResults.map((c) => c.result.totalFaults), 1);
              const h = (res.totalFaults / maxF) * 100;
              const colors = ["var(--color-primary)", "var(--color-accent)", "#f59e0b", "#a855f7"];
              return (
                <div key={algo} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "12px", color: "var(--color-heading)", fontWeight: "600" }}>{res.totalFaults}</span>
                  <div style={{ width: "100%", height: `${Math.max(h, 4)}%`, borderRadius: "4px 4px 0 0", background: colors[i] }} />
                  <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>{ALGO_LABELS[algo]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "var(--color-text-muted)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", background: "rgba(239,68,68,0.25)" }} /> Page Fault
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "2px", background: "rgba(52,211,153,0.25)" }} /> Hit
        </span>
      </div>
    </div>
  );
}
