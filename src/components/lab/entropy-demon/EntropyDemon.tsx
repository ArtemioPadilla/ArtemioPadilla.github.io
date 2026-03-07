import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ================================================================
   Types & Constants
   ================================================================ */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

interface EntropyRecord {
  time: number;
  entropy: number;
  tempLeft: number;
  tempRight: number;
}

const PARTICLE_COUNT = 40;
const PARTICLE_RADIUS = 4;
const DOOR_HEIGHT = 50;
const DOOR_OPEN_MS = 350;
const MAX_SPEED = 5;
const MIN_SPEED = 0.5;
const MAX_HISTORY = 300;
const LANDAUER_KT = 0.7;

/* ================================================================
   Physics Engine
   ================================================================ */

function createParticles(count: number, w: number, h: number): Particle[] {
  const particles: Particle[] = [];
  const halfW = w / 2;
  for (let i = 0; i < count; i++) {
    const side = Math.random() < 0.5 ? 0 : 1;
    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    const angle = Math.random() * Math.PI * 2;
    const margin = PARTICLE_RADIUS + 2;
    particles.push({
      x: side === 0
        ? margin + Math.random() * (halfW - margin * 2 - 4)
        : halfW + 4 + margin + Math.random() * (halfW - margin * 2 - 4),
      y: margin + Math.random() * (h - margin * 2),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: PARTICLE_RADIUS,
    });
  }
  return particles;
}

function particleSpeed(p: Particle): number {
  return Math.sqrt(p.vx * p.vx + p.vy * p.vy);
}

function speedToColor(speed: number): string {
  const t = Math.min(1, (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED));
  if (t < 0.5) {
    const s = t * 2;
    return `rgb(${Math.round(60 + s * 195)},${Math.round(100 + s * 155)},255)`;
  }
  const s = (t - 0.5) * 2;
  return `rgb(255,${Math.round(255 - s * 200)},${Math.round(255 - s * 220)})`;
}

function stepParticles(
  particles: Particle[],
  w: number,
  h: number,
  wallX: number,
  doorOpen: boolean,
): void {
  const doorTop = h / 2 - DOOR_HEIGHT / 2;
  const doorBottom = h / 2 + DOOR_HEIGHT / 2;
  const wallGap = 4;

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;

    // Boundary collisions
    if (p.y - p.radius < 0) { p.y = p.radius; p.vy = Math.abs(p.vy); }
    if (p.y + p.radius > h) { p.y = h - p.radius; p.vy = -Math.abs(p.vy); }
    if (p.x - p.radius < 0) { p.x = p.radius; p.vx = Math.abs(p.vx); }
    if (p.x + p.radius > w) { p.x = w - p.radius; p.vx = -Math.abs(p.vx); }

    // Wall collision
    const nearWall = Math.abs(p.x - wallX) < p.radius + wallGap;
    if (nearWall) {
      const inDoor = p.y > doorTop && p.y < doorBottom;
      if (!doorOpen || !inDoor) {
        if (p.x < wallX) {
          p.x = wallX - p.radius - wallGap;
          p.vx = -Math.abs(p.vx);
        } else {
          p.x = wallX + p.radius + wallGap;
          p.vx = Math.abs(p.vx);
        }
      }
    }
  }

  // Particle-particle collisions
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i];
      const b = particles[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = a.radius + b.radius;
      if (dist < minDist && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const dvx = a.vx - b.vx;
        const dvy = a.vy - b.vy;
        const dvDotN = dvx * nx + dvy * ny;
        if (dvDotN > 0) {
          a.vx -= dvDotN * nx;
          a.vy -= dvDotN * ny;
          b.vx += dvDotN * nx;
          b.vy += dvDotN * ny;
        }
        const overlap = (minDist - dist) / 2;
        a.x -= overlap * nx;
        a.y -= overlap * ny;
        b.x += overlap * nx;
        b.y += overlap * ny;
      }
    }
  }
}

function computeTemps(particles: Particle[], wallX: number): { left: number; right: number } {
  let leftKE = 0, rightKE = 0, leftN = 0, rightN = 0;
  for (const p of particles) {
    const ke = 0.5 * (p.vx * p.vx + p.vy * p.vy);
    if (p.x < wallX) { leftKE += ke; leftN++; } else { rightKE += ke; rightN++; }
  }
  return {
    left: leftN > 0 ? leftKE / leftN : 0,
    right: rightN > 0 ? rightKE / rightN : 0,
  };
}

function computeEntropy(particles: Particle[], wallX: number): number {
  const bins = 8;
  const leftCounts = new Float64Array(bins);
  const rightCounts = new Float64Array(bins);
  let leftN = 0, rightN = 0;
  for (const p of particles) {
    const s = particleSpeed(p);
    const bin = Math.min(bins - 1, Math.floor((s / MAX_SPEED) * bins));
    if (p.x < wallX) { leftCounts[bin]++; leftN++; } else { rightCounts[bin]++; rightN++; }
  }
  let entropy = 0;
  const addH = (counts: Float64Array, total: number) => {
    if (total === 0) return;
    for (let i = 0; i < bins; i++) {
      if (counts[i] > 0) {
        const pr = counts[i] / total;
        entropy -= pr * Math.log(pr);
      }
    }
  };
  addH(leftCounts, leftN);
  addH(rightCounts, rightN);
  // Positional entropy
  const total = particles.length;
  if (total > 0) {
    const pL = leftN / total;
    const pR = rightN / total;
    if (pL > 0) entropy -= pL * Math.log(pL);
    if (pR > 0) entropy -= pR * Math.log(pR);
  }
  return entropy;
}

/* ================================================================
   Rendering
   ================================================================ */

function drawSimulation(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  w: number,
  h: number,
  wallX: number,
  doorOpen: boolean,
): void {
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, w, h);

  // Chamber labels
  ctx.fillStyle = "rgba(228,228,231,0.06)";
  ctx.font = "bold 32px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("LEFT", wallX / 2, 34);
  ctx.fillText("RIGHT", wallX + (w - wallX) / 2, 34);

  // Wall
  const doorTop = h / 2 - DOOR_HEIGHT / 2;
  const doorBottom = h / 2 + DOOR_HEIGHT / 2;

  ctx.strokeStyle = "rgba(161,161,170,0.4)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(wallX, 0);
  ctx.lineTo(wallX, doorTop);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(wallX, doorBottom);
  ctx.lineTo(wallX, h);
  ctx.stroke();

  // Door
  if (doorOpen) {
    // Open glow
    const grad = ctx.createLinearGradient(wallX - 12, 0, wallX + 12, 0);
    grad.addColorStop(0, "rgba(52,211,153,0)");
    grad.addColorStop(0.5, "rgba(52,211,153,0.12)");
    grad.addColorStop(1, "rgba(52,211,153,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(wallX - 15, doorTop, 30, DOOR_HEIGHT);

    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(wallX, doorTop);
    ctx.lineTo(wallX, doorBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "#34d399";
    ctx.font = "bold 9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("OPEN", wallX, doorTop - 6);
  } else {
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wallX, doorTop);
    ctx.lineTo(wallX, doorBottom);
    ctx.stroke();
  }

  // Particles
  for (const p of particles) {
    const spd = particleSpeed(p);
    const color = speedToColor(spd);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Velocity trail
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Glow for fast particles
    if (spd > 3.5) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,80,80,0.12)`;
      ctx.fill();
    }
  }
}

function drawEntropyGraph(
  ctx: CanvasRenderingContext2D,
  history: EntropyRecord[],
  w: number,
  h: number,
): void {
  ctx.fillStyle = "#0c0c0e";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(161,161,170,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, w, h);

  if (history.length < 2) return;

  const pad = { left: 38, right: 8, top: 8, bottom: 22 };
  const gw = w - pad.left - pad.right;
  const gh = h - pad.top - pad.bottom;

  // Axes
  ctx.strokeStyle = "rgba(161,161,170,0.2)";
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, h - pad.bottom);
  ctx.lineTo(w - pad.right, h - pad.bottom);
  ctx.stroke();

  ctx.fillStyle = "rgba(228,228,231,0.4)";
  ctx.font = "8px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Time", w / 2, h - 4);
  ctx.save();
  ctx.translate(10, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Entropy", 0, 0);
  ctx.restore();

  // Compute ranges
  let eMin = Infinity, eMax = -Infinity;
  let tdMin = Infinity, tdMax = -Infinity;
  for (const r of history) {
    if (r.entropy < eMin) eMin = r.entropy;
    if (r.entropy > eMax) eMax = r.entropy;
    const td = Math.abs(r.tempLeft - r.tempRight);
    if (td < tdMin) tdMin = td;
    if (td > tdMax) tdMax = td;
  }
  const eRange = Math.max(0.1, eMax - eMin);
  const tdRange = Math.max(0.01, tdMax - tdMin);

  // Entropy line
  ctx.strokeStyle = "#4f8ff7";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const x = pad.left + (i / Math.max(1, history.length - 1)) * gw;
    const y = pad.top + (1 - (history[i].entropy - eMin) / eRange) * gh;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Temperature difference line
  ctx.strokeStyle = "#34d399";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  for (let i = 0; i < history.length; i++) {
    const td = Math.abs(history[i].tempLeft - history[i].tempRight);
    const x = pad.left + (i / Math.max(1, history.length - 1)) * gw;
    const y = pad.top + (1 - (td - tdMin) / tdRange) * gh;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Legend
  ctx.font = "8px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "#4f8ff7";
  ctx.fillText("Entropy", w - 10, 14);
  ctx.fillStyle = "#34d399";
  ctx.fillText("|dT|", w - 10, 26);
}

/* ================================================================
   Component
   ================================================================ */

export default function EntropyDemon() {
  const simRef = useRef<HTMLCanvasElement>(null);
  const graphRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const historyRef = useRef<EntropyRecord[]>([]);
  const animRef = useRef(0);
  const doorTimerRef = useRef(0);
  const frameRef = useRef(0);

  const [running, setRunning] = useState(true);
  const [doorOpen, setDoorOpen] = useState(false);
  const [doorMemory, setDoorMemory] = useState(0);
  const [tempLeft, setTempLeft] = useState(0);
  const [tempRight, setTempRight] = useState(0);
  const [entropy, setEntropy] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [simSize, setSimSize] = useState({ w: 600, h: 300 });

  const runRef = useRef(running);
  runRef.current = running;
  const doorRef = useRef(doorOpen);
  doorRef.current = doorOpen;
  const autoRef = useRef(autoPlay);
  autoRef.current = autoPlay;

  const setupCanvas = useCallback((canvas: HTMLCanvasElement | null, w: number, h: number) => {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
  }, []);

  const initialize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.min(Math.floor(w * 0.5), 320);
    setSimSize({ w, h });
    particlesRef.current = createParticles(PARTICLE_COUNT, w, h);
    historyRef.current = [];
    setDoorMemory(0);
    setDoorOpen(false);
    doorRef.current = false;
    frameRef.current = 0;
  }, []);

  const openDoor = useCallback(() => {
    if (doorRef.current) return;
    setDoorOpen(true);
    doorRef.current = true;
    setDoorMemory((m) => m + 1);
    doorTimerRef.current = Date.now();
  }, []);

  useEffect(() => {
    initialize();
    const onResize = () => initialize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [initialize]);

  useEffect(() => {
    setupCanvas(simRef.current, simSize.w, simSize.h);
    setupCanvas(graphRef.current, simSize.w, 140);
  }, [simSize, setupCanvas]);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); openDoor(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDoor]);

  // Animation loop
  useEffect(() => {
    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      if (!runRef.current) return;

      // Auto-close door
      if (doorRef.current && Date.now() - doorTimerRef.current > DOOR_OPEN_MS) {
        setDoorOpen(false);
        doorRef.current = false;
      }

      // Auto-play: clever demon
      if (autoRef.current && !doorRef.current) {
        const wallX = simSize.w / 2;
        const doorTop = simSize.h / 2 - DOOR_HEIGHT / 2;
        const doorBot = simSize.h / 2 + DOOR_HEIGHT / 2;
        for (const p of particlesRef.current) {
          const near = Math.abs(p.x - wallX) < 20 && p.y > doorTop && p.y < doorBot;
          if (!near) continue;
          const spd = particleSpeed(p);
          const fast = spd > (MAX_SPEED + MIN_SPEED) / 2;
          if ((fast && p.vx > 0 && p.x < wallX) || (!fast && p.vx < 0 && p.x > wallX)) {
            openDoor();
            break;
          }
        }
      }

      const { w, h } = simSize;
      const wallX = w / 2;
      stepParticles(particlesRef.current, w, h, wallX, doorRef.current);
      frameRef.current++;

      // Stats every 5 frames
      if (frameRef.current % 5 === 0) {
        const temps = computeTemps(particlesRef.current, wallX);
        const ent = computeEntropy(particlesRef.current, wallX);
        setTempLeft(temps.left);
        setTempRight(temps.right);
        setEntropy(ent);
        historyRef.current.push({
          time: frameRef.current,
          entropy: ent,
          tempLeft: temps.left,
          tempRight: temps.right,
        });
        if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
      }

      // Draw sim
      const simCtx = simRef.current?.getContext("2d");
      if (simRef.current && simCtx) {
        const dpr = window.devicePixelRatio || 1;
        simCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawSimulation(simCtx, particlesRef.current, w, h, wallX, doorRef.current);
      }

      // Draw graph
      const graphCtx = graphRef.current?.getContext("2d");
      if (graphRef.current && graphCtx) {
        const dpr = window.devicePixelRatio || 1;
        graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawEntropyGraph(graphCtx, historyRef.current, w, 140);
      }
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [simSize, openDoor]);

  const infoCost = doorMemory * LANDAUER_KT;

  const btn = (active: boolean, color = "var(--color-primary)") => ({
    padding: "6px 12px",
    borderRadius: "8px",
    border: `1px solid ${active ? color : "var(--color-border)"}`,
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : "var(--color-surface)",
    color: active ? color : "var(--color-text)",
    fontSize: "11px",
    fontWeight: 500 as const,
    cursor: "pointer" as const,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
        <button onClick={() => setRunning((r) => !r)} style={btn(running, running ? "#ef4444" : "#34d399")}>
          {running ? "Pause" : "Play"}
        </button>
        <button onClick={initialize} style={btn(false)}>Reset</button>
        <button onClick={openDoor} style={btn(doorOpen, "#34d399")}>
          {doorOpen ? "Door Open!" : "Open Door (Space)"}
        </button>
        <button onClick={() => setAutoPlay((a) => !a)} style={btn(autoPlay, "#a855f7")}>
          Auto-play: {autoPlay ? "ON" : "OFF"}
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: "8px" }}>
        <StatCard label="Left Temp" value={tempLeft.toFixed(2)} color="#4f8ff7" />
        <StatCard label="Right Temp" value={tempRight.toFixed(2)} color="#ef4444" />
        <StatCard label="Entropy" value={entropy.toFixed(3)} color="#34d399" />
        <StatCard label="Demon Memory" value={`${doorMemory} bits`} color="#a855f7" />
        <StatCard label="Info Cost" value={`${infoCost.toFixed(1)} kT`} color="#f59e0b" sub="Landauer" />
      </div>

      {/* Sim canvas */}
      <div
        ref={containerRef}
        onClick={openDoor}
        style={{
          position: "relative", overflow: "hidden", borderRadius: "12px",
          border: "1px solid var(--color-border)", cursor: "pointer",
        }}
      >
        <canvas ref={simRef} style={{ display: "block", width: "100%" }} />
        <div style={{
          position: "absolute", top: "8px", left: "50%", transform: "translateX(-50%)",
          fontSize: "10px", fontWeight: doorOpen ? 700 : 400,
          color: doorOpen ? "#34d399" : "var(--color-text-muted)", opacity: 0.8,
        }}>
          {doorOpen ? "DOOR OPEN" : "Click or press Space to open door"}
        </div>
        <div style={{
          position: "absolute", bottom: "6px", right: "8px",
          display: "flex", alignItems: "center", gap: "4px",
          fontSize: "8px", color: "var(--color-text-muted)", opacity: 0.7,
        }}>
          <span>Slow</span>
          <span style={{
            width: "40px", height: "6px", borderRadius: "3px",
            background: "linear-gradient(to right, #3c64ff, #ffffff, #ff4040)",
          }} />
          <span>Fast</span>
        </div>
      </div>

      {/* Entropy graph */}
      <div style={{ borderRadius: "12px", border: "1px solid var(--color-border)", overflow: "hidden" }}>
        <canvas ref={graphRef} style={{ display: "block", width: "100%" }} />
      </div>

      {/* Info */}
      <div style={{
        padding: "10px 14px", borderRadius: "10px",
        border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
        fontSize: "11px", lineHeight: "1.6", color: "var(--color-text-muted)",
      }}>
        <strong style={{ color: "var(--color-heading)" }}>Maxwell's Demon:</strong> Try to sort fast
        (hot) particles to the right and slow (cold) to the left by opening the door at the right
        moment. The 2nd law says entropy always increases, but the demon appears to violate it.
        Landauer's principle resolves the paradox: erasing the demon's memory costs at least kT ln(2)
        per bit, increasing total entropy.
      </div>
    </div>
  );
}

/* ================================================================
   Sub-component
   ================================================================ */

function StatCard({ label, value, color, sub }: {
  label: string; value: string; color: string; sub?: string;
}) {
  return (
    <div style={{
      padding: "8px 12px", borderRadius: "10px",
      border: "1px solid var(--color-border)", backgroundColor: "var(--color-surface)",
    }}>
      <div style={{ fontSize: "10px", color: "var(--color-text-muted)" }}>
        {label}
        {sub && <span style={{ marginLeft: "4px", fontSize: "8px", opacity: 0.6 }}>({sub})</span>}
      </div>
      <div style={{ fontSize: "14px", fontWeight: 700, fontFamily: "monospace", color, marginTop: "2px" }}>
        {value}
      </div>
    </div>
  );
}
