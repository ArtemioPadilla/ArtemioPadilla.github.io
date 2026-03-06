import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Vec2 {
  x: number;
  y: number;
}

interface Body {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  color: string;
  trail: Vec2[];
  name: string;
}

interface OrbitalParams {
  semiMajorAxis: number;
  eccentricity: number;
  period: number;
  velocity: number;
  distance: number;
  kineticEnergy: number;
  potentialEnergy: number;
  totalEnergy: number;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
  followId: number | null;
}

interface DragState {
  type: "place" | "slingshot" | "pan";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  bodyId?: number;
}

interface EnergyRecord {
  time: number;
  kinetic: number;
  potential: number;
  total: number;
}

type PresetName =
  | "earth-moon"
  | "solar-system"
  | "binary-star"
  | "figure-8"
  | "lagrange"
  | "slingshot";

interface PresetDef {
  label: string;
  bodies: Omit<Body, "id" | "trail">[];
  G: number;
  timeScale: number;
  cameraZoom?: number;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const FIXED_DT = 1 / 60;
const MAX_TRAIL = 1200;
const SOFTENING = 4;
const MAX_ENERGY_HISTORY = 300;

const BODY_COLORS = [
  "#f59e0b", "#4f8ff7", "#34d399", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316",
];

const PRESETS: Record<PresetName, PresetDef> = {
  "earth-moon": {
    label: "Earth-Moon",
    G: 800,
    timeScale: 1,
    bodies: [
      { x: 0, y: 0, vx: 0, vy: -2, mass: 500, radius: 18, color: "#4f8ff7", name: "Earth" },
      { x: 200, y: 0, vx: 0, vy: 42, mass: 6, radius: 6, color: "#a1a1aa", name: "Moon" },
    ],
  },
  "solar-system": {
    label: "Solar System",
    G: 1200,
    timeScale: 1,
    cameraZoom: 0.55,
    bodies: [
      { x: 0, y: 0, vx: 0, vy: 0, mass: 1500, radius: 22, color: "#f59e0b", name: "Sun" },
      { x: 80, y: 0, vx: 0, vy: 130, mass: 2, radius: 4, color: "#a1a1aa", name: "Mercury" },
      { x: 140, y: 0, vx: 0, vy: 98, mass: 5, radius: 6, color: "#f97316", name: "Venus" },
      { x: 200, y: 0, vx: 0, vy: 85, mass: 6, radius: 6, color: "#4f8ff7", name: "Earth" },
      { x: 300, y: 0, vx: 0, vy: 68, mass: 4, radius: 5, color: "#ef4444", name: "Mars" },
    ],
  },
  "binary-star": {
    label: "Binary Star",
    G: 1000,
    timeScale: 1,
    bodies: [
      { x: -80, y: 0, vx: 0, vy: -30, mass: 400, radius: 16, color: "#f59e0b", name: "Star A" },
      { x: 80, y: 0, vx: 0, vy: 30, mass: 400, radius: 16, color: "#ef4444", name: "Star B" },
    ],
  },
  "figure-8": {
    label: "Figure-8",
    G: 1000,
    timeScale: 0.8,
    bodies: [
      { x: -97.00, y: 0, vx: 0, vy: -47.0, mass: 200, radius: 10, color: "#4f8ff7", name: "Body 1" },
      { x: 97.00, y: 0, vx: 0, vy: -47.0, mass: 200, radius: 10, color: "#34d399", name: "Body 2" },
      { x: 0, y: 0, vx: 0, vy: 94.0, mass: 200, radius: 10, color: "#ef4444", name: "Body 3" },
    ],
  },
  lagrange: {
    label: "Lagrange Points",
    G: 1200,
    timeScale: 1,
    cameraZoom: 0.6,
    bodies: [
      { x: 0, y: 0, vx: 0, vy: 0, mass: 1500, radius: 22, color: "#f59e0b", name: "Sun" },
      { x: 220, y: 0, vx: 0, vy: 82, mass: 15, radius: 7, color: "#4f8ff7", name: "Planet" },
      { x: 250, y: 0, vx: 0, vy: 88, mass: 0.01, radius: 3, color: "#34d399", name: "L1" },
      { x: 190, y: 0, vx: 0, vy: 76, mass: 0.01, radius: 3, color: "#a855f7", name: "L2" },
      {
        x: 220 * Math.cos(Math.PI / 3), y: 220 * Math.sin(Math.PI / 3),
        vx: -82 * Math.sin(Math.PI / 3), vy: 82 * Math.cos(Math.PI / 3),
        mass: 0.01, radius: 3, color: "#ec4899", name: "L4",
      },
      {
        x: 220 * Math.cos(-Math.PI / 3), y: 220 * Math.sin(-Math.PI / 3),
        vx: -82 * Math.sin(-Math.PI / 3), vy: 82 * Math.cos(-Math.PI / 3),
        mass: 0.01, radius: 3, color: "#14b8a6", name: "L5",
      },
    ],
  },
  slingshot: {
    label: "Gravity Assist",
    G: 1000,
    timeScale: 1,
    cameraZoom: 0.7,
    bodies: [
      { x: 0, y: 0, vx: 0, vy: 0, mass: 1200, radius: 20, color: "#f59e0b", name: "Sun" },
      { x: 200, y: 0, vx: 0, vy: 77, mass: 300, radius: 14, color: "#4f8ff7", name: "Planet" },
      { x: -300, y: 200, vx: 50, vy: -25, mass: 0.1, radius: 3, color: "#34d399", name: "Probe" },
    ],
  },
};

/* ══════════════════════════════════════════════════════════
   Physics: Pure functions
   ══════════════════════════════════════════════════════════ */

function computeAccelerations(bodies: Body[], G: number): Vec2[] {
  const n = bodies.length;
  const acc: Vec2[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = bodies[j].x - bodies[i].x;
      const dy = bodies[j].y - bodies[i].y;
      const distSq = dx * dx + dy * dy + SOFTENING * SOFTENING;
      const dist = Math.sqrt(distSq);
      const force = G * bodies[i].mass * bodies[j].mass / (distSq * dist);

      acc[i].x += force * dx / bodies[i].mass;
      acc[i].y += force * dy / bodies[i].mass;
      acc[j].x -= force * dx / bodies[j].mass;
      acc[j].y -= force * dy / bodies[j].mass;
    }
  }
  return acc;
}

function velocityVerletStep(bodies: Body[], dt: number, G: number): void {
  const n = bodies.length;
  const acc = computeAccelerations(bodies, G);

  // Half-step velocity + full-step position
  for (let i = 0; i < n; i++) {
    bodies[i].vx += 0.5 * acc[i].x * dt;
    bodies[i].vy += 0.5 * acc[i].y * dt;
    bodies[i].x += bodies[i].vx * dt;
    bodies[i].y += bodies[i].vy * dt;
  }

  // Recompute accelerations at new positions
  const accNew = computeAccelerations(bodies, G);

  // Second half-step velocity
  for (let i = 0; i < n; i++) {
    bodies[i].vx += 0.5 * accNew[i].x * dt;
    bodies[i].vy += 0.5 * accNew[i].y * dt;
  }
}

function computeSystemEnergy(bodies: Body[], G: number): EnergyRecord {
  let kinetic = 0;
  let potential = 0;
  const n = bodies.length;

  for (let i = 0; i < n; i++) {
    kinetic += 0.5 * bodies[i].mass * (bodies[i].vx * bodies[i].vx + bodies[i].vy * bodies[i].vy);
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = bodies[j].x - bodies[i].x;
      const dy = bodies[j].y - bodies[i].y;
      const dist = Math.sqrt(dx * dx + dy * dy + SOFTENING * SOFTENING);
      potential -= G * bodies[i].mass * bodies[j].mass / dist;
    }
  }

  return { time: 0, kinetic, potential, total: kinetic + potential };
}

function computeCenterOfMass(bodies: Body[]): Vec2 {
  let totalMass = 0;
  let cx = 0;
  let cy = 0;
  for (const b of bodies) {
    totalMass += b.mass;
    cx += b.x * b.mass;
    cy += b.y * b.mass;
  }
  if (totalMass === 0) return { x: 0, y: 0 };
  return { x: cx / totalMass, y: cy / totalMass };
}

function computeOrbitalParams(body: Body, primary: Body, G: number): OrbitalParams {
  const dx = body.x - primary.x;
  const dy = body.y - primary.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const dvx = body.vx - primary.vx;
  const dvy = body.vy - primary.vy;
  const vel = Math.sqrt(dvx * dvx + dvy * dvy);

  const mu = G * (primary.mass + body.mass);
  const ke = 0.5 * vel * vel;
  const pe = -mu / dist;
  const totalE = ke + pe;

  // Specific orbital energy
  const sma = totalE < 0 ? -mu / (2 * totalE) : Infinity;

  // Angular momentum magnitude (2D cross product)
  const h = Math.abs(dx * dvy - dy * dvx);

  // Eccentricity
  let ecc = 0;
  if (sma > 0 && sma < Infinity) {
    const p = h * h / mu;
    ecc = Math.sqrt(Math.max(0, 1 - p / sma));
  } else {
    ecc = 1;
  }

  // Period (Kepler's third law)
  const period = sma < Infinity ? 2 * Math.PI * Math.sqrt(sma * sma * sma / mu) : Infinity;

  return {
    semiMajorAxis: sma,
    eccentricity: ecc,
    period,
    velocity: vel,
    distance: dist,
    kineticEnergy: ke * body.mass,
    potentialEnergy: pe * body.mass,
    totalEnergy: totalE * body.mass,
  };
}

/* ══════════════════════════════════════════════════════════
   Rendering helpers
   ══════════════════════════════════════════════════════════ */

function worldToScreen(wx: number, wy: number, cam: Camera, cw: number, ch: number): Vec2 {
  return {
    x: (wx - cam.x) * cam.zoom + cw / 2,
    y: (wy - cam.y) * cam.zoom + ch / 2,
  };
}

function screenToWorld(sx: number, sy: number, cam: Camera, cw: number, ch: number): Vec2 {
  return {
    x: (sx - cw / 2) / cam.zoom + cam.x,
    y: (sy - ch / 2) / cam.zoom + cam.y,
  };
}

function getCSSColor(canvas: HTMLCanvasElement, varName: string, fallback: string): string {
  return getComputedStyle(canvas).getPropertyValue(varName).trim() || fallback;
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function OrbitalMechanics() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energyCanvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const bodiesRef = useRef<Body[]>([]);
  const nextIdRef = useRef(0);
  const timeRef = useRef(0);

  const [playing, setPlaying] = useState(true);
  const [timeScale, setTimeScale] = useState(1);
  const [G, setG] = useState(800);
  const [trailLength, setTrailLength] = useState(600);
  const [showVelocity, setShowVelocity] = useState(false);
  const [showForce, setShowForce] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [preset, setPreset] = useState<PresetName>("earth-moon");
  const [bodyCount, setBodyCount] = useState(0);
  const [orbitalInfo, setOrbitalInfo] = useState<OrbitalParams | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1, followId: null });
  const [energyHistory, setEnergyHistory] = useState<EnergyRecord[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const playingRef = useRef(playing);
  const timeScaleRef = useRef(timeScale);
  const gRef = useRef(G);
  const trailLengthRef = useRef(trailLength);
  const showVelocityRef = useRef(showVelocity);
  const showForceRef = useRef(showForce);
  const selectedIdRef = useRef(selectedId);
  const cameraRef = useRef(camera);
  const dragRef = useRef(dragState);

  playingRef.current = playing;
  timeScaleRef.current = timeScale;
  gRef.current = G;
  trailLengthRef.current = trailLength;
  showVelocityRef.current = showVelocity;
  showForceRef.current = showForce;
  selectedIdRef.current = selectedId;
  cameraRef.current = camera;
  dragRef.current = dragState;

  /* ── Load preset ── */
  const loadPreset = useCallback((name: PresetName) => {
    const def = PRESETS[name];
    nextIdRef.current = 0;
    const bodies: Body[] = def.bodies.map((b) => ({
      ...b,
      id: nextIdRef.current++,
      trail: [],
    }));
    bodiesRef.current = bodies;
    timeRef.current = 0;
    setG(def.G);
    setTimeScale(def.timeScale);
    setPreset(name);
    setSelectedId(null);
    setOrbitalInfo(null);
    setEnergyHistory([]);
    setBodyCount(bodies.length);
    setCamera({
      x: 0,
      y: 0,
      zoom: def.cameraZoom ?? 1,
      followId: null,
    });
    setPlaying(true);
  }, []);

  /* ── Initialize ── */
  useEffect(() => {
    loadPreset("earth-moon");
  }, [loadPreset]);

  /* ── Select body → compute orbital params ── */
  useEffect(() => {
    if (selectedId === null) {
      setOrbitalInfo(null);
      return;
    }
    const bodies = bodiesRef.current;
    const body = bodies.find((b) => b.id === selectedId);
    if (!body) {
      setOrbitalInfo(null);
      return;
    }
    // Find the most massive other body as "primary"
    const primary = bodies
      .filter((b) => b.id !== selectedId)
      .sort((a, b) => b.mass - a.mass)[0];
    if (!primary) {
      setOrbitalInfo(null);
      return;
    }
    setOrbitalInfo(computeOrbitalParams(body, primary, G));
  }, [selectedId, bodyCount, G]);

  /* ── Delete selected body ── */
  const deleteSelected = useCallback(() => {
    if (selectedId === null) return;
    bodiesRef.current = bodiesRef.current.filter((b) => b.id !== selectedId);
    setSelectedId(null);
    setBodyCount(bodiesRef.current.length);
  }, [selectedId]);

  /* ── Canvas mouse handlers ── */
  const getCanvasCoords = useCallback((e: MouseEvent): Vec2 => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const findBodyAt = useCallback((wx: number, wy: number): Body | null => {
    const bodies = bodiesRef.current;
    const cam = cameraRef.current;
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      const dx = wx - b.x;
      const dy = wy - b.y;
      const hitRadius = Math.max(b.radius, 8 / cam.zoom);
      if (dx * dx + dy * dy < hitRadius * hitRadius) return b;
    }
    return null;
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sc = getCanvasCoords(e);
    const wc = screenToWorld(sc.x, sc.y, cameraRef.current, canvas.width, canvas.height);
    const hit = findBodyAt(wc.x, wc.y);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      // Middle-click or Alt+click → pan
      setDragState({ type: "pan", startX: sc.x, startY: sc.y, currentX: sc.x, currentY: sc.y });
      return;
    }

    if (hit) {
      // Click on body → start slingshot or select
      setSelectedId(hit.id);
      setDragState({
        type: "slingshot",
        startX: sc.x,
        startY: sc.y,
        currentX: sc.x,
        currentY: sc.y,
        bodyId: hit.id,
      });
    } else {
      // Click empty space → start placing a new body
      setDragState({
        type: "place",
        startX: sc.x,
        startY: sc.y,
        currentX: sc.x,
        currentY: sc.y,
      });
    }
  }, [getCanvasCoords, findBodyAt]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sc = getCanvasCoords(e);

    // Update hover state
    const wc = screenToWorld(sc.x, sc.y, cameraRef.current, canvas.width, canvas.height);
    const hit = findBodyAt(wc.x, wc.y);
    setHoveredId(hit ? hit.id : null);

    if (!dragRef.current) return;

    if (dragRef.current.type === "pan") {
      const dx = (sc.x - dragRef.current.currentX) / cameraRef.current.zoom;
      const dy = (sc.y - dragRef.current.currentY) / cameraRef.current.zoom;
      setCamera((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy, followId: null }));
    }

    setDragState((prev) => prev ? { ...prev, currentX: sc.x, currentY: sc.y } : null);
  }, [getCanvasCoords, findBodyAt]);

  const handleMouseUp = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dragRef.current) return;
    const drag = dragRef.current;
    const cam = cameraRef.current;
    const w = canvas.width;
    const h = canvas.height;

    if (drag.type === "place") {
      const dx = drag.currentX - drag.startX;
      const dy = drag.currentY - drag.startY;
      const wPos = screenToWorld(drag.startX, drag.startY, cam, w, h);
      const colorIdx = nextIdRef.current % BODY_COLORS.length;
      const newBody: Body = {
        id: nextIdRef.current++,
        x: wPos.x,
        y: wPos.y,
        vx: -dx * 0.5 / cam.zoom,
        vy: -dy * 0.5 / cam.zoom,
        mass: 10,
        radius: 6,
        color: BODY_COLORS[colorIdx],
        trail: [],
        name: `Body ${nextIdRef.current}`,
      };
      bodiesRef.current.push(newBody);
      setBodyCount(bodiesRef.current.length);
      setSelectedId(newBody.id);
    } else if (drag.type === "slingshot" && drag.bodyId !== undefined) {
      const dx = drag.currentX - drag.startX;
      const dy = drag.currentY - drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        const body = bodiesRef.current.find((b) => b.id === drag.bodyId);
        if (body) {
          body.vx += -dx * 0.3 / cam.zoom;
          body.vy += -dy * 0.3 / cam.zoom;
          body.trail = [];
        }
      }
    }

    setDragState(null);
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setCamera((prev) => ({
      ...prev,
      zoom: Math.max(0.05, Math.min(10, prev.zoom * factor)),
    }));
  }, []);

  /* ── Animation loop ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frameCounter = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      const cw = canvas.width / (window.devicePixelRatio || 1);
      const ch = canvas.height / (window.devicePixelRatio || 1);
      const cam = cameraRef.current;
      const bodies = bodiesRef.current;
      const tLen = trailLengthRef.current;

      // Physics step
      if (playingRef.current && bodies.length > 0) {
        const steps = Math.max(1, Math.round(timeScaleRef.current * 2));
        const subDt = FIXED_DT * timeScaleRef.current / steps;
        for (let s = 0; s < steps; s++) {
          velocityVerletStep(bodies, subDt, gRef.current);
        }
        timeRef.current += FIXED_DT * timeScaleRef.current;

        // Record trails
        for (const b of bodies) {
          b.trail.push({ x: b.x, y: b.y });
          if (b.trail.length > MAX_TRAIL) {
            b.trail.splice(0, b.trail.length - MAX_TRAIL);
          }
        }

        // Energy tracking (every 4 frames)
        frameCounter++;
        if (frameCounter % 4 === 0) {
          const energy = computeSystemEnergy(bodies, gRef.current);
          energy.time = timeRef.current;
          setEnergyHistory((prev) => {
            const next = [...prev, energy];
            return next.length > MAX_ENERGY_HISTORY ? next.slice(-MAX_ENERGY_HISTORY) : next;
          });
        }

        // Update orbital info for selected body (every 8 frames)
        if (frameCounter % 8 === 0 && selectedIdRef.current !== null) {
          const body = bodies.find((b) => b.id === selectedIdRef.current);
          if (body) {
            const primary = bodies
              .filter((b) => b.id !== selectedIdRef.current)
              .sort((a, b) => b.mass - a.mass)[0];
            if (primary) {
              setOrbitalInfo(computeOrbitalParams(body, primary, gRef.current));
            }
          }
        }
      }

      // Camera follow
      if (cam.followId !== null) {
        const target = bodies.find((b) => b.id === cam.followId);
        if (target) {
          cameraRef.current = { ...cam, x: target.x, y: target.y };
        }
      }

      // Clear
      const bgColor = getCSSColor(canvas, "--color-bg", "#09090b");
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, cw, ch);

      // Grid (subtle)
      const gridColor = getCSSColor(canvas, "--color-border", "#27272a");
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 0.5;
      const gridSize = 50 * cam.zoom;
      if (gridSize > 8) {
        const offX = ((-cam.x * cam.zoom + cw / 2) % gridSize + gridSize) % gridSize;
        const offY = ((-cam.y * cam.zoom + ch / 2) % gridSize + gridSize) % gridSize;
        ctx.beginPath();
        for (let gx = offX; gx < cw; gx += gridSize) {
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, ch);
        }
        for (let gy = offY; gy < ch; gy += gridSize) {
          ctx.moveTo(0, gy);
          ctx.lineTo(cw, gy);
        }
        ctx.stroke();
      }

      // Center of mass
      if (bodies.length > 1) {
        const com = computeCenterOfMass(bodies);
        const sc = worldToScreen(com.x, com.y, cameraRef.current, cw, ch);
        ctx.strokeStyle = getCSSColor(canvas, "--color-text-muted", "#a1a1aa");
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sc.x - 8, sc.y);
        ctx.lineTo(sc.x + 8, sc.y);
        ctx.moveTo(sc.x, sc.y - 8);
        ctx.lineTo(sc.x, sc.y + 8);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Trails
      for (const b of bodies) {
        const trailSlice = b.trail.slice(-tLen);
        if (trailSlice.length < 2) continue;
        ctx.lineWidth = 1;
        for (let i = 1; i < trailSlice.length; i++) {
          const alpha = i / trailSlice.length;
          ctx.strokeStyle = b.color + Math.round(alpha * 180).toString(16).padStart(2, "0");
          const p0 = worldToScreen(trailSlice[i - 1].x, trailSlice[i - 1].y, cameraRef.current, cw, ch);
          const p1 = worldToScreen(trailSlice[i].x, trailSlice[i].y, cameraRef.current, cw, ch);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        }
      }

      // Force vectors
      if (showForceRef.current && bodies.length > 1) {
        const accs = computeAccelerations(bodies, gRef.current);
        for (let i = 0; i < bodies.length; i++) {
          const b = bodies[i];
          const sc = worldToScreen(b.x, b.y, cameraRef.current, cw, ch);
          const fScale = 0.08 * cam.zoom;
          const fx = accs[i].x * b.mass * fScale;
          const fy = accs[i].y * b.mass * fScale;
          const len = Math.sqrt(fx * fx + fy * fy);
          if (len < 1) continue;
          ctx.strokeStyle = "#f59e0b";
          ctx.fillStyle = "#f59e0b";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sc.x, sc.y);
          ctx.lineTo(sc.x + fx, sc.y + fy);
          ctx.stroke();
          // Arrow head
          const angle = Math.atan2(fy, fx);
          ctx.beginPath();
          ctx.moveTo(sc.x + fx, sc.y + fy);
          ctx.lineTo(sc.x + fx - 6 * Math.cos(angle - 0.4), sc.y + fy - 6 * Math.sin(angle - 0.4));
          ctx.lineTo(sc.x + fx - 6 * Math.cos(angle + 0.4), sc.y + fy - 6 * Math.sin(angle + 0.4));
          ctx.closePath();
          ctx.fill();
        }
      }

      // Velocity vectors
      if (showVelocityRef.current) {
        for (const b of bodies) {
          const sc = worldToScreen(b.x, b.y, cameraRef.current, cw, ch);
          const vScale = 1.5 * cam.zoom;
          const vx = b.vx * vScale;
          const vy = b.vy * vScale;
          const len = Math.sqrt(vx * vx + vy * vy);
          if (len < 2) continue;
          ctx.strokeStyle = "#34d399";
          ctx.fillStyle = "#34d399";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(sc.x, sc.y);
          ctx.lineTo(sc.x + vx, sc.y + vy);
          ctx.stroke();
          const angle = Math.atan2(vy, vx);
          ctx.beginPath();
          ctx.moveTo(sc.x + vx, sc.y + vy);
          ctx.lineTo(sc.x + vx - 6 * Math.cos(angle - 0.4), sc.y + vy - 6 * Math.sin(angle - 0.4));
          ctx.lineTo(sc.x + vx - 6 * Math.cos(angle + 0.4), sc.y + vy - 6 * Math.sin(angle + 0.4));
          ctx.closePath();
          ctx.fill();
        }
      }

      // Bodies
      for (const b of bodies) {
        const sc = worldToScreen(b.x, b.y, cameraRef.current, cw, ch);
        const r = Math.max(2, b.radius * cam.zoom);

        // Glow for large bodies
        if (b.mass > 100) {
          const grad = ctx.createRadialGradient(sc.x, sc.y, r * 0.5, sc.x, sc.y, r * 2.5);
          grad.addColorStop(0, b.color + "40");
          grad.addColorStop(1, b.color + "00");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(sc.x, sc.y, r * 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Body circle
        ctx.fillStyle = b.color;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
        ctx.fill();

        // Selection ring
        if (b.id === selectedIdRef.current) {
          ctx.strokeStyle = getCSSColor(canvas, "--color-heading", "#ffffff");
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sc.x, sc.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Hover ring
        if (b.id === hoveredId && b.id !== selectedIdRef.current) {
          ctx.strokeStyle = getCSSColor(canvas, "--color-text-muted", "#a1a1aa");
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sc.x, sc.y, r + 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Name label
        if (cam.zoom > 0.3) {
          ctx.fillStyle = getCSSColor(canvas, "--color-text-muted", "#a1a1aa");
          ctx.font = `${Math.max(9, 11 * cam.zoom)}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(b.name, sc.x, sc.y + r + 14);
        }
      }

      // Drag feedback
      const drag = dragRef.current;
      if (drag) {
        if (drag.type === "place") {
          const dx = drag.currentX - drag.startX;
          const dy = drag.currentY - drag.startY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
            ctx.strokeStyle = "#34d399";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(drag.startX, drag.startY);
            ctx.lineTo(drag.currentX, drag.currentY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Preview body
            ctx.fillStyle = BODY_COLORS[nextIdRef.current % BODY_COLORS.length] + "80";
            ctx.beginPath();
            ctx.arc(drag.startX, drag.startY, 6 * cam.zoom, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (drag.type === "slingshot") {
          const dx = drag.currentX - drag.startX;
          const dy = drag.currentY - drag.startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            ctx.strokeStyle = "#ef4444";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(drag.startX, drag.startY);
            ctx.lineTo(drag.currentX, drag.currentY);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      animRef.current = requestAnimationFrame(render);
    };

    animRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [hoveredId]);

  /* ── Energy chart ── */
  useEffect(() => {
    const canvas = energyCanvasRef.current;
    if (!canvas || energyHistory.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = rect.width;
    const h = rect.height;
    const bgColor = getCSSColor(canvas, "--color-surface", "#111111");
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const data = energyHistory;
    let minE = Infinity;
    let maxE = -Infinity;
    for (const e of data) {
      minE = Math.min(minE, e.kinetic, e.potential, e.total);
      maxE = Math.max(maxE, e.kinetic, e.potential, e.total);
    }
    const range = maxE - minE || 1;
    const pad = 4;

    const drawLine = (key: keyof EnergyRecord, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
        const y = h - pad - ((data[i][key] as number - minE) / range) * (h - 2 * pad);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine("kinetic", "#4f8ff7");
    drawLine("potential", "#ef4444");
    drawLine("total", "#34d399");

    // Legend
    ctx.font = "9px Inter, sans-serif";
    const labels = [
      { text: "KE", color: "#4f8ff7" },
      { text: "PE", color: "#ef4444" },
      { text: "Total", color: "#34d399" },
    ];
    let lx = 6;
    for (const l of labels) {
      ctx.fillStyle = l.color;
      ctx.fillRect(lx, 4, 8, 8);
      ctx.fillStyle = getCSSColor(canvas, "--color-text-muted", "#a1a1aa");
      ctx.fillText(l.text, lx + 11, 12);
      lx += ctx.measureText(l.text).width + 20;
    }
  }, [energyHistory]);

  /* ── Step forward ── */
  const stepForward = useCallback(() => {
    const bodies = bodiesRef.current;
    if (bodies.length === 0) return;
    velocityVerletStep(bodies, FIXED_DT, gRef.current);
    timeRef.current += FIXED_DT;
    for (const b of bodies) {
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > MAX_TRAIL) b.trail.splice(0, b.trail.length - MAX_TRAIL);
    }
    setBodyCount((c) => c); // Trigger re-render
  }, []);

  /* ── Follow selected ── */
  const toggleFollow = useCallback(() => {
    if (selectedId === null) return;
    setCamera((prev) => ({
      ...prev,
      followId: prev.followId === selectedId ? null : selectedId,
    }));
  }, [selectedId]);

  /* ── Reset camera ── */
  const resetCamera = useCallback(() => {
    setCamera({ x: 0, y: 0, zoom: 1, followId: null });
  }, []);

  /* ── Format helpers ── */
  const fmt = (n: number, d = 1): string => {
    if (!isFinite(n)) return "Inf";
    if (Math.abs(n) > 9999) return n.toExponential(1);
    return n.toFixed(d);
  };

  /* ══════════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════════ */

  return (
    <div class="space-y-4">
      {/* ── Controls row ── */}
      <div class="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        {/* Presets */}
        <select
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)]"
          value={preset}
          onChange={(e) => loadPreset((e.target as HTMLSelectElement).value as PresetName)}
        >
          {Object.entries(PRESETS).map(([key, def]) => (
            <option key={key} value={key}>{def.label}</option>
          ))}
        </select>

        <div class="h-5 w-px bg-[var(--color-border)]" />

        {/* Playback */}
        <button
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          onClick={() => setPlaying(!playing)}
          title={playing ? "Pause" : "Play"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
          onClick={stepForward}
          disabled={playing}
          title="Step forward"
        >
          Step
        </button>

        <div class="h-5 w-px bg-[var(--color-border)]" />

        {/* Time scale */}
        <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          Speed
          <input
            type="range"
            min="0.1"
            max="5"
            step="0.1"
            value={timeScale}
            onInput={(e) => setTimeScale(parseFloat((e.target as HTMLInputElement).value))}
            class="w-20 accent-[var(--color-primary)]"
          />
          <span class="w-8 text-right font-mono text-[10px] text-[var(--color-text)]">{timeScale.toFixed(1)}x</span>
        </label>

        <div class="h-5 w-px bg-[var(--color-border)]" />

        {/* G */}
        <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          G
          <input
            type="range"
            min="100"
            max="5000"
            step="50"
            value={G}
            onInput={(e) => setG(parseFloat((e.target as HTMLInputElement).value))}
            class="w-16 accent-[var(--color-primary)]"
          />
          <span class="w-10 text-right font-mono text-[10px] text-[var(--color-text)]">{G}</span>
        </label>

        <div class="h-5 w-px bg-[var(--color-border)]" />

        {/* Trail length */}
        <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
          Trail
          <input
            type="range"
            min="0"
            max="1200"
            step="50"
            value={trailLength}
            onInput={(e) => setTrailLength(parseInt((e.target as HTMLInputElement).value, 10))}
            class="w-16 accent-[var(--color-primary)]"
          />
        </label>

        {/* Toggles */}
        <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={showVelocity}
            onChange={() => setShowVelocity(!showVelocity)}
            class="accent-[var(--color-primary)]"
          />
          Vel
        </label>
        <label class="flex items-center gap-1 text-xs text-[var(--color-text-muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={showForce}
            onChange={() => setShowForce(!showForce)}
            class="accent-[var(--color-primary)]"
          />
          Force
        </label>

        <div class="ml-auto flex items-center gap-1">
          <button
            class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-xs text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)]"
            onClick={resetCamera}
            title="Reset camera"
          >
            Reset Cam
          </button>
          <span class="text-[10px] font-mono text-[var(--color-text-muted)]">
            {bodyCount} bodies
          </span>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div class="relative overflow-hidden rounded-xl border border-[var(--color-border)]" style="height: 500px">
        <canvas
          ref={canvasRef}
          class="absolute inset-0 h-full w-full cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
        {/* Interaction hint */}
        <div class="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-[var(--color-bg)]/70 px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
          Click: place body | Drag body: slingshot | Scroll: zoom | Alt+drag: pan
        </div>
      </div>

      {/* ── Bottom panels ── */}
      <div class="grid gap-4 sm:grid-cols-2">
        {/* ── Orbital Info ── */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            Orbital Parameters
          </h3>
          {selectedId !== null && orbitalInfo ? (
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-xs text-[var(--color-text-muted)]">Selected</span>
                <span class="text-xs font-medium text-[var(--color-text)]">
                  {bodiesRef.current.find((b) => b.id === selectedId)?.name ?? "?"}
                </span>
              </div>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">Semi-major axis</span>
                  <span class="font-mono text-[var(--color-text)]">{fmt(orbitalInfo.semiMajorAxis)}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">Eccentricity</span>
                  <span class="font-mono text-[var(--color-text)]">{fmt(orbitalInfo.eccentricity, 3)}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">Period</span>
                  <span class="font-mono text-[var(--color-text)]">{fmt(orbitalInfo.period)}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">Velocity</span>
                  <span class="font-mono text-[var(--color-text)]">{fmt(orbitalInfo.velocity)}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">Distance</span>
                  <span class="font-mono text-[var(--color-text)]">{fmt(orbitalInfo.distance)}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">KE</span>
                  <span class="font-mono text-[var(--color-text)]">{fmt(orbitalInfo.kineticEnergy)}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">PE</span>
                  <span class="font-mono text-[var(--color-text)]">{fmt(orbitalInfo.potentialEnergy)}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-[var(--color-text-muted)]">Total E</span>
                  <span class="font-mono text-[var(--color-text)]">{fmt(orbitalInfo.totalEnergy)}</span>
                </div>
              </div>
              <div class="mt-2 flex gap-2">
                <button
                  class="rounded border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                  onClick={toggleFollow}
                >
                  {camera.followId === selectedId ? "Unfollow" : "Follow"}
                </button>
                <button
                  class="rounded border border-red-500/30 px-2 py-1 text-[10px] text-red-400 transition-colors hover:border-red-500 hover:text-red-300"
                  onClick={deleteSelected}
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <p class="text-xs text-[var(--color-text-muted)]">
              Click a body to view its orbital parameters relative to the most massive other body.
            </p>
          )}
        </div>

        {/* ── Energy Plot ── */}
        <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <h3 class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
            System Energy
          </h3>
          <div class="overflow-hidden rounded-lg border border-[var(--color-border)]" style="height: 120px">
            <canvas ref={energyCanvasRef} class="h-full w-full" />
          </div>
          {energyHistory.length > 1 && (
            <div class="mt-2 flex gap-4 text-[10px]">
              <span class="text-[var(--color-text-muted)]">
                KE: <span class="font-mono text-[#4f8ff7]">{fmt(energyHistory[energyHistory.length - 1].kinetic)}</span>
              </span>
              <span class="text-[var(--color-text-muted)]">
                PE: <span class="font-mono text-[#ef4444]">{fmt(energyHistory[energyHistory.length - 1].potential)}</span>
              </span>
              <span class="text-[var(--color-text-muted)]">
                Total: <span class="font-mono text-[#34d399]">{fmt(energyHistory[energyHistory.length - 1].total)}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
