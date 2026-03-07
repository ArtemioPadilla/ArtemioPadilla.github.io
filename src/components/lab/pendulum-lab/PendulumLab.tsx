import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ================================================================
   Types & Constants
   ================================================================ */

type PendulumMode = "single" | "double" | "triple";

interface PendulumState {
  angles: number[];
  angVels: number[];
  lengths: number[];
  masses: number[];
}

interface TrailPoint {
  x: number;
  y: number;
  speed: number;
  age: number;
}

const DT = 0.02;
const TRAIL_MAX = 800;
const STEPS_PER_FRAME = 4;

/* ================================================================
   RK4 Integration
   ================================================================ */

function singleDerivs(theta: number, omega: number, g: number, l: number, d: number) {
  return { dT: omega, dW: (-g / l) * Math.sin(theta) - d * omega };
}

function rk4Single(theta: number, omega: number, g: number, l: number, d: number, dt: number) {
  const k1 = singleDerivs(theta, omega, g, l, d);
  const k2 = singleDerivs(theta + k1.dT * dt / 2, omega + k1.dW * dt / 2, g, l, d);
  const k3 = singleDerivs(theta + k2.dT * dt / 2, omega + k2.dW * dt / 2, g, l, d);
  const k4 = singleDerivs(theta + k3.dT * dt, omega + k3.dW * dt, g, l, d);
  return {
    theta: theta + (dt / 6) * (k1.dT + 2 * k2.dT + 2 * k3.dT + k4.dT),
    omega: omega + (dt / 6) * (k1.dW + 2 * k2.dW + 2 * k3.dW + k4.dW),
  };
}

function doubleDerivs(
  t1: number, t2: number, w1: number, w2: number,
  m1: number, m2: number, l1: number, l2: number, g: number, d: number,
) {
  const dt = t1 - t2;
  const sinDt = Math.sin(dt);
  const cosDt = Math.cos(dt);
  const mt = m1 + m2;
  const den = 2 * mt - m2 * (1 + Math.cos(2 * dt));
  if (Math.abs(den) < 1e-12) return { dT1: w1, dT2: w2, dW1: 0, dW2: 0 };

  const dW1 = (-g * mt * Math.sin(t1)
    - m2 * g * Math.sin(t1 - 2 * t2)
    - 2 * sinDt * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cosDt))
    / (l1 * den) - d * w1;

  const dW2 = (2 * sinDt * (w1 * w1 * l1 * mt
    + g * mt * Math.cos(t1)
    + w2 * w2 * l2 * m2 * cosDt))
    / (l2 * den) - d * w2;

  return { dT1: w1, dT2: w2, dW1, dW2 };
}

function rk4Double(
  t1: number, t2: number, w1: number, w2: number,
  m1: number, m2: number, l1: number, l2: number, g: number, d: number, dt: number,
) {
  const k1 = doubleDerivs(t1, t2, w1, w2, m1, m2, l1, l2, g, d);
  const k2 = doubleDerivs(
    t1 + k1.dT1 * dt / 2, t2 + k1.dT2 * dt / 2,
    w1 + k1.dW1 * dt / 2, w2 + k1.dW2 * dt / 2, m1, m2, l1, l2, g, d);
  const k3 = doubleDerivs(
    t1 + k2.dT1 * dt / 2, t2 + k2.dT2 * dt / 2,
    w1 + k2.dW1 * dt / 2, w2 + k2.dW2 * dt / 2, m1, m2, l1, l2, g, d);
  const k4 = doubleDerivs(
    t1 + k3.dT1 * dt, t2 + k3.dT2 * dt,
    w1 + k3.dW1 * dt, w2 + k3.dW2 * dt, m1, m2, l1, l2, g, d);

  return {
    t1: t1 + (dt / 6) * (k1.dT1 + 2 * k2.dT1 + 2 * k3.dT1 + k4.dT1),
    t2: t2 + (dt / 6) * (k1.dT2 + 2 * k2.dT2 + 2 * k3.dT2 + k4.dT2),
    w1: w1 + (dt / 6) * (k1.dW1 + 2 * k2.dW1 + 2 * k3.dW1 + k4.dW1),
    w2: w2 + (dt / 6) * (k1.dW2 + 2 * k2.dW2 + 2 * k3.dW2 + k4.dW2),
  };
}

/* ================================================================
   Energy & Lyapunov
   ================================================================ */

function computeEnergy(state: PendulumState, mode: PendulumMode, g: number): { ke: number; pe: number } {
  const n = mode === "single" ? 1 : mode === "double" ? 2 : 3;
  let ke = 0, pe = 0, vx = 0, vy = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const l = state.lengths[i];
    const m = state.masses[i];
    const theta = state.angles[i];
    const omega = state.angVels[i];
    vx += l * omega * Math.cos(theta);
    vy -= l * omega * Math.sin(theta);
    y += l * Math.cos(theta);
    ke += 0.5 * m * (vx * vx + vy * vy);
    pe += -m * g * y;
  }
  const totalMassTimesLength = state.masses.slice(0, n).reduce((a, b) => a + b, 0) *
    state.lengths.slice(0, n).reduce((a, b) => a + b, 0);
  return { ke: Math.abs(ke), pe: pe + g * totalMassTimesLength };
}

function estimateLyapunov(s1: PendulumState, s2: PendulumState): number {
  let d2 = 0;
  for (let i = 0; i < s1.angles.length; i++) {
    const da = s1.angles[i] - s2.angles[i];
    const dw = s1.angVels[i] - s2.angVels[i];
    d2 += da * da + dw * dw;
  }
  return Math.sqrt(d2);
}

/* ================================================================
   Rendering
   ================================================================ */

function getBobPositions(
  state: PendulumState, mode: PendulumMode,
  pivotX: number, pivotY: number, ppm: number,
): { x: number; y: number }[] {
  const n = mode === "single" ? 1 : mode === "double" ? 2 : 3;
  const pos: { x: number; y: number }[] = [];
  let cx = pivotX, cy = pivotY;
  for (let i = 0; i < n; i++) {
    const l = state.lengths[i] * ppm;
    cx += l * Math.sin(state.angles[i]);
    cy += l * Math.cos(state.angles[i]);
    pos.push({ x: cx, y: cy });
  }
  return pos;
}

function speedHue(speed: number): string {
  const t = Math.min(1, speed / 15);
  const hue = (1 - t) * 200;
  return `hsl(${hue}, 85%, 55%)`;
}

function drawTrail(ctx: CanvasRenderingContext2D, trail: TrailPoint[]): void {
  for (let i = 1; i < trail.length; i++) {
    const alpha = Math.max(0, 1 - trail[i].age / TRAIL_MAX) * 0.7;
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.strokeStyle = speedHue(trail[i].speed);
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawPendulum(
  ctx: CanvasRenderingContext2D,
  state: PendulumState, mode: PendulumMode,
  pivotX: number, pivotY: number, ppm: number,
  rodColor: string, bobColor: string,
): void {
  const positions = getBobPositions(state, mode, pivotX, pivotY, ppm);
  let prevX = pivotX, prevY = pivotY;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    ctx.beginPath();
    ctx.moveTo(prevX, prevY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = rodColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    const r = 6 + state.masses[i] * 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = bobColor;
    ctx.fill();
    ctx.strokeStyle = rodColor;
    ctx.lineWidth = 1;
    ctx.stroke();
    prevX = p.x;
    prevY = p.y;
  }
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  state: PendulumState, state2: PendulumState | null,
  mode: PendulumMode,
  trail1: TrailPoint[], trail2: TrailPoint[],
  showTrail: boolean, showChaos: boolean,
  w: number, h: number,
): void {
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, w, h);

  const pivotX = w / 2;
  const pivotY = h * 0.18;
  const ppm = Math.min(w, h) * 0.18;

  if (showTrail && trail1.length > 1) drawTrail(ctx, trail1);
  if (showTrail && showChaos && state2 && trail2.length > 1) drawTrail(ctx, trail2);

  drawPendulum(ctx, state, mode, pivotX, pivotY, ppm, "#4f8ff7", "#34d399");
  if (showChaos && state2 && mode !== "single") {
    drawPendulum(ctx, state2, mode, pivotX, pivotY, ppm, "#ef4444", "#fbbf24");
  }

  // Pivot
  ctx.beginPath();
  ctx.arc(pivotX, pivotY, 5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fill();
}

/* ================================================================
   Component
   ================================================================ */

export default function PendulumLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef(0);
  const sizeRef = useRef({ w: 800, h: 500 });
  const stateRef = useRef<PendulumState>({
    angles: [Math.PI / 3, Math.PI / 4, Math.PI / 6],
    angVels: [0, 0, 0],
    lengths: [1.2, 1.0, 0.8],
    masses: [2, 1.5, 1],
  });
  const state2Ref = useRef<PendulumState | null>(null);
  const trail1Ref = useRef<TrailPoint[]>([]);
  const trail2Ref = useRef<TrailPoint[]>([]);
  const draggingRef = useRef({ bobIndex: -1, active: false });
  const runRef = useRef(true);
  const lyapRef = useRef(0);

  const [mode, setMode] = useState<PendulumMode>("double");
  const [running, setRunning] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [showChaos, setShowChaos] = useState(true);
  const [gravity, setGravity] = useState(9.81);
  const [damping, setDamping] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [energy, setEnergy] = useState({ ke: 0, pe: 0 });
  const [lyapunov, setLyapunov] = useState(0);

  const gravRef = useRef(gravity);
  gravRef.current = gravity;
  const dampRef = useRef(damping);
  dampRef.current = damping;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(rect.width);
    const h = Math.min(Math.floor(rect.width * 0.65), 550);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
    sizeRef.current = { w, h };
  }, []);

  const initState = useCallback((m: PendulumMode) => {
    stateRef.current = {
      angles: [Math.PI / 3, Math.PI / 4, Math.PI / 6],
      angVels: [0, 0, 0],
      lengths: [1.2, 1.0, 0.8],
      masses: [2, 1.5, 1],
    };
    trail1Ref.current = [];
    trail2Ref.current = [];
    lyapRef.current = 0;
    if (m !== "single") {
      state2Ref.current = {
        angles: [Math.PI / 3 + 0.001, Math.PI / 4, Math.PI / 6],
        angVels: [0, 0, 0],
        lengths: [1.2, 1.0, 0.8],
        masses: [2, 1.5, 1],
      };
    } else {
      state2Ref.current = null;
    }
  }, []);

  const stepSim = useCallback((currentMode: PendulumMode) => {
    const state = stateRef.current;
    const g = gravRef.current;
    const d = dampRef.current;
    const stepsCount = Math.round(STEPS_PER_FRAME * speedRef.current);

    for (let step = 0; step < stepsCount; step++) {
      if (currentMode === "single") {
        const r = rk4Single(state.angles[0], state.angVels[0], g, state.lengths[0], d, DT);
        state.angles[0] = r.theta;
        state.angVels[0] = r.omega;
      } else {
        const r = rk4Double(
          state.angles[0], state.angles[1], state.angVels[0], state.angVels[1],
          state.masses[0], state.masses[1], state.lengths[0], state.lengths[1], g, d, DT);
        state.angles[0] = r.t1;
        state.angles[1] = r.t2;
        state.angVels[0] = r.w1;
        state.angVels[1] = r.w2;

        if (currentMode === "triple") {
          const r3 = rk4Single(state.angles[2], state.angVels[2], g, state.lengths[2], d, DT);
          state.angles[2] = r3.theta;
          state.angVels[2] = r3.omega;
        }
      }

      // Step chaos comparison
      const s2 = state2Ref.current;
      if (s2 && currentMode !== "single") {
        const r2 = rk4Double(
          s2.angles[0], s2.angles[1], s2.angVels[0], s2.angVels[1],
          s2.masses[0], s2.masses[1], s2.lengths[0], s2.lengths[1], g, d, DT);
        s2.angles[0] = r2.t1;
        s2.angles[1] = r2.t2;
        s2.angVels[0] = r2.w1;
        s2.angVels[1] = r2.w2;

        if (currentMode === "triple") {
          const r3 = rk4Single(s2.angles[2], s2.angVels[2], g, s2.lengths[2], d, DT);
          s2.angles[2] = r3.theta;
          s2.angVels[2] = r3.omega;
        }
      }
    }
  }, []);

  // Animation loop
  useEffect(() => {
    resizeCanvas();
    initState(mode);

    const handleResize = () => resizeCanvas();
    window.addEventListener("resize", handleResize);

    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const state = stateRef.current;
      const pivotX = w / 2;
      const pivotY = h * 0.18;
      const ppm = Math.min(w, h) * 0.18;

      if (runRef.current && !draggingRef.current.active) {
        stepSim(mode);

        // Update trail
        const positions = getBobPositions(state, mode, pivotX, pivotY, ppm);
        const last = positions[positions.length - 1];
        const lastSpeed = Math.abs(state.angVels[positions.length - 1]) * state.lengths[positions.length - 1] * ppm;
        trail1Ref.current.push({ x: last.x, y: last.y, speed: lastSpeed, age: 0 });
        if (trail1Ref.current.length > TRAIL_MAX) trail1Ref.current.shift();
        for (const t of trail1Ref.current) t.age++;

        const s2 = state2Ref.current;
        if (s2 && mode !== "single") {
          const p2 = getBobPositions(s2, mode, pivotX, pivotY, ppm);
          const last2 = p2[p2.length - 1];
          const speed2 = Math.abs(s2.angVels[p2.length - 1]) * s2.lengths[p2.length - 1] * ppm;
          trail2Ref.current.push({ x: last2.x, y: last2.y, speed: speed2, age: 0 });
          if (trail2Ref.current.length > TRAIL_MAX) trail2Ref.current.shift();
          for (const t of trail2Ref.current) t.age++;

          // Lyapunov estimate
          const dist = estimateLyapunov(state, s2);
          lyapRef.current = dist > 1e-10 ? Math.log(dist / 0.001) : 0;
        }
      }

      drawScene(ctx, state, state2Ref.current, mode, trail1Ref.current, trail2Ref.current, showTrail, showChaos, w, h);

      // Update energy every 5 frames
      if (animRef.current % 5 === 0) {
        const e = computeEnergy(state, mode, gravRef.current);
        setEnergy(e);
        if (mode !== "single") setLyapunov(lyapRef.current);
      }
    };

    animRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, [mode, showTrail, showChaos, resizeCanvas, initState, stepSim]);

  useEffect(() => { runRef.current = running; }, [running]);

  const coords = useCallback((e: MouseEvent) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  }, []);

  const onDown = useCallback((e: MouseEvent) => {
    const c = coords(e);
    const { w, h } = sizeRef.current;
    const ppm = Math.min(w, h) * 0.18;
    const positions = getBobPositions(stateRef.current, mode, w / 2, h * 0.18, ppm);
    for (let i = positions.length - 1; i >= 0; i--) {
      const dist = Math.sqrt((c.x - positions[i].x) ** 2 + (c.y - positions[i].y) ** 2);
      if (dist < 20) {
        draggingRef.current = { bobIndex: i, active: true };
        return;
      }
    }
  }, [coords, mode]);

  const onMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current.active) return;
    const c = coords(e);
    const { w, h } = sizeRef.current;
    const ppm = Math.min(w, h) * 0.18;
    const idx = draggingRef.current.bobIndex;
    const state = stateRef.current;

    let ax = w / 2, ay = h * 0.18;
    for (let i = 0; i < idx; i++) {
      ax += state.lengths[i] * ppm * Math.sin(state.angles[i]);
      ay += state.lengths[i] * ppm * Math.cos(state.angles[i]);
    }
    state.angles[idx] = Math.atan2(c.x - ax, c.y - ay);
    state.angVels[idx] = 0;
    trail1Ref.current = [];
    trail2Ref.current = [];
  }, [coords]);

  const onUp = useCallback(() => {
    if (draggingRef.current.active) {
      draggingRef.current = { bobIndex: -1, active: false };
      const state = stateRef.current;
      if (mode !== "single" && state2Ref.current) {
        state2Ref.current = {
          ...state2Ref.current,
          angles: [state.angles[0] + 0.001, state.angles[1], state.angles[2]],
          angVels: [0, 0, 0],
        };
      }
    }
  }, [mode]);

  const handleReset = useCallback(() => initState(mode), [initState, mode]);

  const handleModeChange = useCallback((m: PendulumMode) => {
    setMode(m);
    initState(m);
  }, [initState]);

  const totalE = energy.ke + energy.pe;

  const btn = (active: boolean, color = "var(--color-primary)") => ({
    padding: "6px 12px", borderRadius: "8px",
    border: `1px solid ${active ? color : "var(--color-border)"}`,
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : "var(--color-surface)",
    color: active ? color : "var(--color-text-muted)",
    fontSize: "11px", fontWeight: 500 as const, cursor: "pointer" as const,
  });

  const modes: { key: PendulumMode; label: string }[] = [
    { key: "single", label: "Single" },
    { key: "double", label: "Double" },
    { key: "triple", label: "Triple" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Mode + energy */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
        <div style={{ display: "flex", gap: "6px" }}>
          {modes.map((m) => (
            <button key={m.key} onClick={() => handleModeChange(m.key)} style={btn(mode === m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "10px", color: "var(--color-text-muted)" }}>
          <span><Dot color="#ef4444" /> KE: {energy.ke.toFixed(2)}</span>
          <span><Dot color="#4f8ff7" /> PE: {energy.pe.toFixed(2)}</span>
          <span><Dot color="#facc15" /> Total: {totalE.toFixed(2)}</span>
          {mode !== "single" && (
            <span><Dot color="#a855f7" /> Lyapunov: {lyapunov.toFixed(3)}</span>
          )}
        </div>
      </div>

      {/* Controls row */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
        <button onClick={() => setRunning((r) => !r)} style={btn(running, running ? "#34d399" : "#facc15")}>
          {running ? "Pause" : "Play"}
        </button>
        <button onClick={handleReset} style={btn(false)}>Reset</button>
        <button onClick={() => setShowTrail((t) => !t)} style={btn(showTrail)}>
          Trail {showTrail ? "ON" : "OFF"}
        </button>
        {mode !== "single" && (
          <button onClick={() => setShowChaos((c) => !c)} style={btn(showChaos, "#ef4444")}>
            Chaos Compare {showChaos ? "ON" : "OFF"}
          </button>
        )}
      </div>

      {/* Sliders */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px",
        padding: "12px 14px", borderRadius: "12px",
        border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
      }}>
        <SliderControl label="Gravity" value={gravity} min={1} max={25} step={0.5}
          onChange={setGravity} display={`${gravity.toFixed(1)} m/s^2`} />
        <SliderControl label="Damping" value={damping} min={0} max={0.1} step={0.005}
          onChange={setDamping} display={damping.toFixed(3)} />
        <SliderControl label="Speed" value={speed} min={0.25} max={3} step={0.25}
          onChange={setSpeed} display={`${speed.toFixed(2)}x`} />
        <SliderControl label="L1" value={stateRef.current.lengths[0]} min={0.3} max={2.5} step={0.1}
          onChange={(v) => {
            stateRef.current.lengths[0] = v;
            if (state2Ref.current) state2Ref.current.lengths[0] = v;
            trail1Ref.current = []; trail2Ref.current = [];
          }}
          display={stateRef.current.lengths[0].toFixed(1)} />
        <SliderControl label="M1" value={stateRef.current.masses[0]} min={0.5} max={5} step={0.5}
          onChange={(v) => {
            stateRef.current.masses[0] = v;
            if (state2Ref.current) state2Ref.current.masses[0] = v;
          }}
          display={stateRef.current.masses[0].toFixed(1)} />
        {mode !== "single" && (
          <>
            <SliderControl label="L2" value={stateRef.current.lengths[1]} min={0.3} max={2.5} step={0.1}
              onChange={(v) => {
                stateRef.current.lengths[1] = v;
                if (state2Ref.current) state2Ref.current.lengths[1] = v;
                trail1Ref.current = []; trail2Ref.current = [];
              }}
              display={stateRef.current.lengths[1].toFixed(1)} />
            <SliderControl label="M2" value={stateRef.current.masses[1]} min={0.5} max={5} step={0.5}
              onChange={(v) => {
                stateRef.current.masses[1] = v;
                if (state2Ref.current) state2Ref.current.masses[1] = v;
              }}
              display={stateRef.current.masses[1].toFixed(1)} />
          </>
        )}
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{
        position: "relative", overflow: "hidden", borderRadius: "12px",
        border: "1px solid var(--color-border)",
      }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", cursor: "grab" }}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseUp={onUp}
          onMouseLeave={onUp}
        />
        <div style={{
          position: "absolute", bottom: "6px", left: "10px",
          fontSize: "9px", color: "var(--color-text-muted)", opacity: 0.6,
        }}>
          Drag bobs to set initial angle, release to simulate
        </div>
        {mode !== "single" && showChaos && (
          <div style={{
            position: "absolute", top: "8px", right: "10px",
            display: "flex", alignItems: "center", gap: "6px",
            padding: "4px 8px", borderRadius: "6px",
            backgroundColor: "rgba(9,9,11,0.7)", backdropFilter: "blur(4px)",
            fontSize: "9px", color: "var(--color-text-muted)",
          }}>
            <Dot color="#4f8ff7" /> Original
            <Dot color="#ef4444" /> +0.001 rad
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Sub-components
   ================================================================ */

function Dot({ color }: { color: string }) {
  return <span style={{
    display: "inline-block", width: "7px", height: "7px", borderRadius: "50%",
    backgroundColor: color, marginRight: "2px", verticalAlign: "middle",
  }} />;
}

function SliderControl({ label, value, min, max, step, onChange, display }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
        {label}: {display}
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
        style={{ width: "100%", accentColor: "var(--color-primary)" }}
      />
    </label>
  );
}
