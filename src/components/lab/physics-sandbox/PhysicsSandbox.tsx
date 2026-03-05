import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Vec2 {
  x: number;
  y: number;
}

type SimulationType =
  | "pendulum"
  | "spring"
  | "projectile"
  | "collisions"
  | "orbits";

interface SimulationTab {
  id: SimulationType;
  label: string;
  icon: string;
}

interface EnergyState {
  kinetic: number;
  potential: number;
  total: number;
}

interface PendulumState {
  mode: "simple" | "double";
  theta1: number;
  omega1: number;
  theta2: number;
  omega2: number;
  length1: number;
  length2: number;
  mass1: number;
  mass2: number;
  gravity: number;
  damping: number;
  trail1: Vec2[];
  trail2: Vec2[];
}

interface SpringState {
  orientation: "horizontal" | "vertical";
  displacement: number;
  velocity: number;
  springK: number;
  mass: number;
  damping: number;
  gravity: number;
  history: number[];
}

interface ProjectileState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  speed: number;
  gravity: number;
  airResistance: boolean;
  dragCoeff: number;
  trail: Vec2[];
  launched: boolean;
  landed: boolean;
  maxHeight: number;
  range: number;
  flightTime: number;
}

interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  color: string;
}

interface CollisionState {
  balls: Ball[];
  elasticity: number;
  gravityOn: boolean;
  gravity: number;
  nextId: number;
}

interface OrbitalBody {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  radius: number;
  color: string;
  trail: Vec2[];
}

interface OrbitState {
  centralMass: number;
  centralRadius: number;
  bodies: OrbitalBody[];
  nextId: number;
  gravitationalConstant: number;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const TABS: SimulationTab[] = [
  { id: "pendulum", label: "Pendulum", icon: "pendulum" },
  { id: "spring", label: "Spring", icon: "spring" },
  { id: "projectile", label: "Projectile", icon: "projectile" },
  { id: "collisions", label: "Collisions", icon: "collisions" },
  { id: "orbits", label: "Orbits", icon: "orbits" },
];

const FIXED_DT = 1 / 60;
const MAX_TRAIL = 2000;
const MAX_HISTORY = 300;

const BALL_COLORS = [
  "#4f8ff7",
  "#34d399",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

const ORBIT_COLORS = [
  "#4f8ff7",
  "#34d399",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
];

/* ══════════════════════════════════════════════════════════
   Physics: Pure functions
   ══════════════════════════════════════════════════════════ */

function simplePendulumAccel(
  theta: number,
  omega: number,
  g: number,
  L: number,
  b: number
): number {
  return -(g / L) * Math.sin(theta) - b * omega;
}

function doublePendulumAccel(
  t1: number,
  o1: number,
  t2: number,
  o2: number,
  m1: number,
  m2: number,
  L1: number,
  L2: number,
  g: number
): { alpha1: number; alpha2: number } {
  const dt = t1 - t2;
  const sinDt = Math.sin(dt);
  const cosDt = Math.cos(dt);
  const M = m1 + m2;

  const denom1 = L1 * (M - m2 * cosDt * cosDt);
  const denom2 = L2 * (M - m2 * cosDt * cosDt);

  const alpha1 =
    (-m2 * L1 * o1 * o1 * sinDt * cosDt +
      m2 * g * Math.sin(t2) * cosDt -
      m2 * L2 * o2 * o2 * sinDt -
      M * g * Math.sin(t1)) /
    denom1;

  const alpha2 =
    (m2 * L2 * o2 * o2 * sinDt * cosDt +
      M * g * Math.sin(t1) * cosDt +
      M * L1 * o1 * o1 * sinDt -
      M * g * Math.sin(t2)) /
    denom2;

  return { alpha1, alpha2 };
}

function springAccel(
  x: number,
  v: number,
  k: number,
  m: number,
  b: number
): number {
  return -(k / m) * x - (b / m) * v;
}


/* ══════════════════════════════════════════════════════════
   Default states
   ══════════════════════════════════════════════════════════ */

function defaultPendulum(): PendulumState {
  return {
    mode: "simple",
    theta1: Math.PI / 3,
    omega1: 0,
    theta2: Math.PI / 2,
    omega2: 0,
    length1: 150,
    length2: 120,
    mass1: 10,
    mass2: 8,
    gravity: 9.81,
    damping: 0.0,
    trail1: [],
    trail2: [],
  };
}

function defaultSpring(): SpringState {
  return {
    orientation: "horizontal",
    displacement: 80,
    velocity: 0,
    springK: 5,
    mass: 2,
    damping: 0.05,
    gravity: 9.81,
    history: [],
  };
}

function defaultProjectile(): ProjectileState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 45,
    speed: 25,
    gravity: 9.81,
    airResistance: false,
    dragCoeff: 0.01,
    trail: [],
    launched: false,
    landed: false,
    maxHeight: 0,
    range: 0,
    flightTime: 0,
  };
}

function defaultCollision(): CollisionState {
  return {
    balls: [
      {
        id: 1,
        x: 150,
        y: 200,
        vx: 3,
        vy: -1,
        radius: 20,
        mass: 4,
        color: BALL_COLORS[0],
      },
      {
        id: 2,
        x: 400,
        y: 200,
        vx: -2,
        vy: 1.5,
        radius: 25,
        mass: 6,
        color: BALL_COLORS[1],
      },
      {
        id: 3,
        x: 300,
        y: 100,
        vx: 1,
        vy: 2,
        radius: 15,
        mass: 2,
        color: BALL_COLORS[2],
      },
    ],
    elasticity: 1.0,
    gravityOn: false,
    gravity: 9.81,
    nextId: 4,
  };
}

function defaultOrbit(): OrbitState {
  return {
    centralMass: 5000,
    centralRadius: 25,
    bodies: [
      {
        id: 1,
        x: 0,
        y: -150,
        vx: 4.5,
        vy: 0,
        mass: 1,
        radius: 6,
        color: ORBIT_COLORS[0],
        trail: [],
      },
    ],
    nextId: 2,
    gravitationalConstant: 1,
  };
}

/* ══════════════════════════════════════════════════════════
   Drawing helpers
   ══════════════════════════════════════════════════════════ */

function getCssVar(name: string): string {
  if (typeof document === "undefined") return "#888";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  color: string,
  headSize: number = 8
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headSize * Math.cos(angle - Math.PI / 6),
    to.y - headSize * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    to.x - headSize * Math.cos(angle + Math.PI / 6),
    to.y - headSize * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawSpringZigzag(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  coils: number,
  amplitude: number,
  color: string
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const segments = coils * 2;
  const segLen = len / (segments + 2);

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);

  const startX = from.x + ux * segLen;
  const startY = from.y + uy * segLen;
  ctx.lineTo(startX, startY);

  for (let i = 0; i < segments; i++) {
    const cx = from.x + dx * ((i + 1 + 0.5) / (segments + 2));
    const cy = from.y + dy * ((i + 1 + 0.5) / (segments + 2));
    const sign = i % 2 === 0 ? 1 : -1;
    ctx.lineTo(cx + px * amplitude * sign, cy + py * amplitude * sign);
  }

  const endX = to.x - ux * segLen;
  const endY = to.y - uy * segLen;
  ctx.lineTo(endX, endY);
  ctx.lineTo(to.x, to.y);

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  trail: Vec2[],
  color: string,
  maxAlpha: number = 0.8
): void {
  if (trail.length < 2) return;
  for (let i = 1; i < trail.length; i++) {
    const alpha = (i / trail.length) * maxAlpha;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function PhysicsSandbox() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const accumulatorRef = useRef(0);
  const lastTimeRef = useRef(0);

  const [activeTab, setActiveTab] = useState<SimulationType>("pendulum");
  const [playing, setPlaying] = useState(true);
  const [speedMult, setSpeedMult] = useState(1);
  const [simTime, setSimTime] = useState(0);
  const [energy, setEnergy] = useState<EnergyState>({
    kinetic: 0,
    potential: 0,
    total: 0,
  });

  const [pendulum, setPendulum] = useState<PendulumState>(defaultPendulum);
  const [spring, setSpring] = useState<SpringState>(defaultSpring);
  const [projectile, setProjectile] = useState<ProjectileState>(
    defaultProjectile
  );
  const [collision, setCollision] = useState<CollisionState>(defaultCollision);
  const [orbit, setOrbit] = useState<OrbitState>(defaultOrbit);

  const pendRef = useRef(pendulum);
  const springRef = useRef(spring);
  const projRef = useRef(projectile);
  const collRef = useRef(collision);
  const orbitRef = useRef(orbit);
  const playingRef = useRef(playing);
  const speedRef = useRef(speedMult);
  const tabRef = useRef(activeTab);
  const simTimeRef = useRef(0);

  pendRef.current = pendulum;
  springRef.current = spring;
  projRef.current = projectile;
  collRef.current = collision;
  orbitRef.current = orbit;
  playingRef.current = playing;
  speedRef.current = speedMult;
  tabRef.current = activeTab;

  // Dragging state for pendulum
  const pendDragRef = useRef(false);
  // Dragging state for collisions (adding new balls)
  const collDragRef = useRef<{ startX: number; startY: number } | null>(null);
  // Dragging state for orbits (launching bodies)
  const orbitDragRef = useRef<{ startX: number; startY: number } | null>(null);

  /* ─────────────── Canvas sizing ─────────────── */

  const getCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return { w: 600, h: 400 };
    const rect = canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  /* ─────────────── Physics step functions ─────────────── */

  const stepPendulum = useCallback((dt: number) => {
    const s = { ...pendRef.current };

    if (s.mode === "simple") {
      // RK4 for simple pendulum
      const f = (theta: number, omega: number) =>
        simplePendulumAccel(theta, omega, s.gravity, s.length1, s.damping);

      const k1v = f(s.theta1, s.omega1);
      const k1x = s.omega1;
      const k2v = f(s.theta1 + (dt / 2) * k1x, s.omega1 + (dt / 2) * k1v);
      const k2x = s.omega1 + (dt / 2) * k1v;
      const k3v = f(s.theta1 + (dt / 2) * k2x, s.omega1 + (dt / 2) * k2v);
      const k3x = s.omega1 + (dt / 2) * k2v;
      const k4v = f(s.theta1 + dt * k3x, s.omega1 + dt * k3v);
      const k4x = s.omega1 + dt * k3v;

      s.theta1 += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
      s.omega1 += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);

      const { w, h } = getCanvasSize();
      const pivotX = w / 2;
      const pivotY = h * 0.15;
      const bobX = pivotX + s.length1 * Math.sin(s.theta1);
      const bobY = pivotY + s.length1 * Math.cos(s.theta1);
      s.trail1 = [...s.trail1, { x: bobX, y: bobY }];
      if (s.trail1.length > MAX_TRAIL) s.trail1 = s.trail1.slice(-MAX_TRAIL);
    } else {
      // RK4 for double pendulum
      type DPState = [number, number, number, number];

      const derivs = (st: DPState): DPState => {
        const [t1, o1, t2, o2] = st;
        const { alpha1, alpha2 } = doublePendulumAccel(
          t1, o1, t2, o2,
          s.mass1, s.mass2,
          s.length1, s.length2,
          s.gravity
        );
        return [
          o1,
          alpha1 - s.damping * o1,
          o2,
          alpha2 - s.damping * o2,
        ];
      };

      const state0: DPState = [s.theta1, s.omega1, s.theta2, s.omega2];

      const k1 = derivs(state0);
      const s2: DPState = [
        state0[0] + (dt / 2) * k1[0],
        state0[1] + (dt / 2) * k1[1],
        state0[2] + (dt / 2) * k1[2],
        state0[3] + (dt / 2) * k1[3],
      ];
      const k2 = derivs(s2);
      const s3: DPState = [
        state0[0] + (dt / 2) * k2[0],
        state0[1] + (dt / 2) * k2[1],
        state0[2] + (dt / 2) * k2[2],
        state0[3] + (dt / 2) * k2[3],
      ];
      const k3 = derivs(s3);
      const s4: DPState = [
        state0[0] + dt * k3[0],
        state0[1] + dt * k3[1],
        state0[2] + dt * k3[2],
        state0[3] + dt * k3[3],
      ];
      const k4 = derivs(s4);

      s.theta1 += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      s.omega1 += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      s.theta2 += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
      s.omega2 += (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]);

      const { w, h } = getCanvasSize();
      const pivotX = w / 2;
      const pivotY = h * 0.2;
      const x1 = pivotX + s.length1 * Math.sin(s.theta1);
      const y1 = pivotY + s.length1 * Math.cos(s.theta1);
      const x2 = x1 + s.length2 * Math.sin(s.theta2);
      const y2 = y1 + s.length2 * Math.cos(s.theta2);

      s.trail1 = [...s.trail1, { x: x1, y: y1 }];
      s.trail2 = [...s.trail2, { x: x2, y: y2 }];
      if (s.trail1.length > MAX_TRAIL) s.trail1 = s.trail1.slice(-MAX_TRAIL);
      if (s.trail2.length > MAX_TRAIL) s.trail2 = s.trail2.slice(-MAX_TRAIL);
    }

    pendRef.current = s;
    setPendulum(s);
  }, [getCanvasSize]);

  const stepSpring = useCallback((dt: number) => {
    const s = { ...springRef.current };

    // RK4 for spring
    const f = (x: number, v: number) => springAccel(x, v, s.springK, s.mass, s.damping);

    const k1v = f(s.displacement, s.velocity);
    const k1x = s.velocity;
    const k2v = f(s.displacement + (dt / 2) * k1x, s.velocity + (dt / 2) * k1v);
    const k2x = s.velocity + (dt / 2) * k1v;
    const k3v = f(s.displacement + (dt / 2) * k2x, s.velocity + (dt / 2) * k2v);
    const k3x = s.velocity + (dt / 2) * k2v;
    const k4v = f(s.displacement + dt * k3x, s.velocity + dt * k3v);
    const k4x = s.velocity + dt * k3v;

    s.displacement += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    s.velocity += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);

    s.history = [...s.history, s.displacement];
    if (s.history.length > MAX_HISTORY) s.history = s.history.slice(-MAX_HISTORY);

    springRef.current = s;
    setSpring(s);
  }, []);

  const stepProjectile = useCallback((dt: number) => {
    const s = { ...projRef.current };
    if (!s.launched || s.landed) return;

    const g = s.gravity;
    const scale = 12; // pixels per meter

    if (s.airResistance) {
      const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      const drag = s.dragCoeff * speed;
      s.vx -= drag * s.vx * dt;
      s.vy -= (g + drag * s.vy) * dt;
    } else {
      s.vy -= g * dt;
    }

    s.x += s.vx * dt * scale;
    s.y += s.vy * dt * scale;

    const heightMeters = s.y / scale;
    if (heightMeters > s.maxHeight) s.maxHeight = heightMeters;
    s.flightTime += dt;

    s.trail = [...s.trail, { x: s.x, y: s.y }];

    // Ground check
    if (s.y < 0 && s.flightTime > 0.05) {
      s.y = 0;
      s.landed = true;
      s.range = s.x / scale;
    }

    projRef.current = s;
    setProjectile(s);
  }, []);

  const stepCollision = useCallback((dt: number) => {
    const s = { ...collRef.current };
    const { w, h } = getCanvasSize();
    const balls = s.balls.map((b) => ({ ...b }));

    // Apply gravity
    if (s.gravityOn) {
      for (const b of balls) {
        b.vy += s.gravity * dt * 50;
      }
    }

    // Move balls
    for (const b of balls) {
      b.x += b.vx * dt * 60;
      b.y += b.vy * dt * 60;
    }

    // Wall collisions
    for (const b of balls) {
      if (b.x - b.radius < 0) {
        b.x = b.radius;
        b.vx = Math.abs(b.vx) * s.elasticity;
      }
      if (b.x + b.radius > w) {
        b.x = w - b.radius;
        b.vx = -Math.abs(b.vx) * s.elasticity;
      }
      if (b.y - b.radius < 0) {
        b.y = b.radius;
        b.vy = Math.abs(b.vy) * s.elasticity;
      }
      if (b.y + b.radius > h) {
        b.y = h - b.radius;
        b.vy = -Math.abs(b.vy) * s.elasticity;
      }
    }

    // Ball-ball collisions
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i];
        const b = balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius;

        if (dist < minDist && dist > 0) {
          // Overlap resolution
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          const totalMass = a.mass + b.mass;
          a.x -= nx * overlap * (b.mass / totalMass);
          a.y -= ny * overlap * (b.mass / totalMass);
          b.x += nx * overlap * (a.mass / totalMass);
          b.y += ny * overlap * (a.mass / totalMass);

          // Relative velocity
          const dvx = a.vx - b.vx;
          const dvy = a.vy - b.vy;
          const dvDotN = dvx * nx + dvy * ny;

          if (dvDotN > 0) {
            const e = s.elasticity;
            const impulse = ((1 + e) * dvDotN) / totalMass;

            a.vx -= impulse * b.mass * nx;
            a.vy -= impulse * b.mass * ny;
            b.vx += impulse * a.mass * nx;
            b.vy += impulse * a.mass * ny;
          }
        }
      }
    }

    s.balls = balls;
    collRef.current = s;
    setCollision(s);
  }, [getCanvasSize]);

  const stepOrbit = useCallback((dt: number) => {
    const s = { ...orbitRef.current };
    const G = s.gravitationalConstant;
    const M = s.centralMass;

    const bodies = s.bodies.map((b) => ({ ...b, trail: [...b.trail] }));

    // Verlet-like: compute accelerations and update
    for (const body of bodies) {
      const dx = -body.x;
      const dy = -body.y;
      const r = Math.sqrt(dx * dx + dy * dy);

      if (r < s.centralRadius + body.radius) {
        // Absorbed by central body - remove
        continue;
      }

      const a = (G * M) / (r * r);
      const ax = a * (dx / r);
      const ay = a * (dy / r);

      body.vx += ax * dt;
      body.vy += ay * dt;
      body.x += body.vx * dt;
      body.y += body.vy * dt;

      body.trail.push({ x: body.x, y: body.y });
      if (body.trail.length > MAX_TRAIL) {
        body.trail = body.trail.slice(-MAX_TRAIL);
      }
    }

    // Remove absorbed bodies
    s.bodies = bodies.filter((b) => {
      const r = Math.sqrt(b.x * b.x + b.y * b.y);
      return r >= s.centralRadius;
    });

    orbitRef.current = s;
    setOrbit(s);
  }, []);

  /* ─────────────── Energy calculations ─────────────── */

  const computeEnergy = useCallback(() => {
    const tab = tabRef.current;
    let ke = 0;
    let pe = 0;

    if (tab === "pendulum") {
      const p = pendRef.current;
      if (p.mode === "simple") {
        const v = p.omega1 * p.length1;
        ke = 0.5 * p.mass1 * v * v / 1000;
        pe = p.mass1 * p.gravity * p.length1 * (1 - Math.cos(p.theta1)) / 1000;
      } else {
        const v1 = p.omega1 * p.length1;
        const v2x =
          p.omega1 * p.length1 * Math.cos(p.theta1) +
          p.omega2 * p.length2 * Math.cos(p.theta2);
        const v2y =
          p.omega1 * p.length1 * Math.sin(p.theta1) +
          p.omega2 * p.length2 * Math.sin(p.theta2);
        ke =
          (0.5 * p.mass1 * v1 * v1 +
            0.5 * p.mass2 * (v2x * v2x + v2y * v2y)) /
          1000;
        pe =
          (p.mass1 * p.gravity * p.length1 * (1 - Math.cos(p.theta1)) +
            p.mass2 *
              p.gravity *
              (p.length1 * (1 - Math.cos(p.theta1)) +
                p.length2 * (1 - Math.cos(p.theta2)))) /
          1000;
      }
    } else if (tab === "spring") {
      const sp = springRef.current;
      ke = 0.5 * sp.mass * sp.velocity * sp.velocity / 100;
      pe = 0.5 * sp.springK * sp.displacement * sp.displacement / 100;
    } else if (tab === "projectile") {
      const pr = projRef.current;
      if (pr.launched) {
        const speed = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
        ke = 0.5 * speed * speed;
        pe = pr.gravity * (pr.y / 12);
      }
    } else if (tab === "collisions") {
      const c = collRef.current;
      for (const b of c.balls) {
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        ke += 0.5 * b.mass * speed * speed;
      }
      if (c.gravityOn) {
        const { h } = getCanvasSize();
        for (const b of c.balls) {
          pe += b.mass * c.gravity * (h - b.y) * 0.01;
        }
      }
    } else if (tab === "orbits") {
      const o = orbitRef.current;
      for (const b of o.bodies) {
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        ke += 0.5 * b.mass * speed * speed;
        const r = Math.sqrt(b.x * b.x + b.y * b.y);
        if (r > 0) {
          pe -= (o.gravitationalConstant * o.centralMass * b.mass) / r;
        }
      }
    }

    setEnergy({ kinetic: ke, potential: pe, total: ke + pe });
  }, [getCanvasSize]);

  /* ─────────────── Render functions ─────────────── */

  const renderPendulum = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const p = pendRef.current;
      const primary = getCssVar("--color-primary");
      const accent = getCssVar("--color-accent");
      const textMuted = getCssVar("--color-text-muted");
      const heading = getCssVar("--color-heading");

      if (p.mode === "simple") {
        const pivotX = w / 2;
        const pivotY = h * 0.15;
        const bobX = pivotX + p.length1 * Math.sin(p.theta1);
        const bobY = pivotY + p.length1 * Math.cos(p.theta1);

        // Trail
        drawTrail(ctx, p.trail1, accent);

        // Pivot
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, 5, 0, Math.PI * 2);
        ctx.fillStyle = textMuted;
        ctx.fill();

        // Rod
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY);
        ctx.lineTo(bobX, bobY);
        ctx.strokeStyle = heading;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Bob
        const bobRadius = 8 + p.mass1 * 0.8;
        ctx.beginPath();
        ctx.arc(bobX, bobY, bobRadius, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.fill();
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Angle arc
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, 30, Math.PI / 2 - p.theta1, Math.PI / 2);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Angle label
        const angleDeg = ((p.theta1 * 180) / Math.PI).toFixed(1);
        ctx.fillStyle = textMuted;
        ctx.font = "12px Inter, sans-serif";
        ctx.fillText(`${angleDeg}deg`, pivotX + 35, pivotY + 20);
      } else {
        const pivotX = w / 2;
        const pivotY = h * 0.2;
        const x1 = pivotX + p.length1 * Math.sin(p.theta1);
        const y1 = pivotY + p.length1 * Math.cos(p.theta1);
        const x2 = x1 + p.length2 * Math.sin(p.theta2);
        const y2 = y1 + p.length2 * Math.cos(p.theta2);

        // Trail for second bob (chaotic pattern)
        drawTrail(ctx, p.trail2, accent, 0.6);
        // Trail for first bob (dimmer)
        drawTrail(ctx, p.trail1, primary, 0.3);

        // Pivot
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, 5, 0, Math.PI * 2);
        ctx.fillStyle = textMuted;
        ctx.fill();

        // Rod 1
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = heading;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Bob 1
        const bob1Radius = 8 + p.mass1 * 0.6;
        ctx.beginPath();
        ctx.arc(x1, y1, bob1Radius, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.fill();
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Rod 2
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = heading;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Bob 2
        const bob2Radius = 8 + p.mass2 * 0.6;
        ctx.beginPath();
        ctx.arc(x2, y2, bob2Radius, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    },
    [getCanvasSize]
  );

  const renderSpring = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const s = springRef.current;
      const primary = getCssVar("--color-primary");
      const accent = getCssVar("--color-accent");
      const textMuted = getCssVar("--color-text-muted");
      const heading = getCssVar("--color-heading");

      if (s.orientation === "horizontal") {
        const wallX = 60;
        const centerY = h * 0.4;
        const restX = w / 2;
        const massX = restX + s.displacement;
        const massSize = 20 + s.mass * 4;

        // Wall
        ctx.beginPath();
        ctx.moveTo(wallX, centerY - 50);
        ctx.lineTo(wallX, centerY + 50);
        ctx.strokeStyle = heading;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Hatching
        for (let i = -50; i < 50; i += 10) {
          ctx.beginPath();
          ctx.moveTo(wallX, centerY + i);
          ctx.lineTo(wallX - 10, centerY + i + 10);
          ctx.strokeStyle = textMuted;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Equilibrium line
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(restX, centerY - 40);
        ctx.lineTo(restX, centerY + 40);
        ctx.strokeStyle = textMuted;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Spring
        drawSpringZigzag(
          ctx,
          { x: wallX, y: centerY },
          { x: massX - massSize / 2, y: centerY },
          8,
          15,
          textMuted
        );

        // Mass block
        ctx.fillStyle = primary;
        ctx.fillRect(
          massX - massSize / 2,
          centerY - massSize / 2,
          massSize,
          massSize
        );
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
          massX - massSize / 2,
          centerY - massSize / 2,
          massSize,
          massSize
        );

        // Force arrow
        const force = -s.springK * s.displacement;
        const forceScale = 0.3;
        if (Math.abs(force) > 0.5) {
          drawArrow(
            ctx,
            { x: massX, y: centerY - massSize / 2 - 15 },
            {
              x: massX + force * forceScale,
              y: centerY - massSize / 2 - 15,
            },
            "#ef4444",
            6
          );
          ctx.fillStyle = "#ef4444";
          ctx.font = "11px Inter, sans-serif";
          ctx.fillText(
            `F=${force.toFixed(1)}`,
            massX + force * forceScale * 0.5 - 15,
            centerY - massSize / 2 - 22
          );
        }

        // Position graph
        const graphTop = h * 0.65;
        const graphH = h * 0.3;
        const graphW = w - 80;
        const graphLeft = 40;

        ctx.strokeStyle = textMuted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(graphLeft, graphTop + graphH / 2);
        ctx.lineTo(graphLeft + graphW, graphTop + graphH / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(graphLeft, graphTop);
        ctx.lineTo(graphLeft, graphTop + graphH);
        ctx.stroke();

        // Label
        ctx.fillStyle = textMuted;
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText("Position vs Time", graphLeft + graphW / 2 - 40, graphTop - 5);

        // Plot history
        if (s.history.length > 1) {
          const maxVal = Math.max(
            ...s.history.map((v) => Math.abs(v)),
            1
          );
          ctx.beginPath();
          for (let i = 0; i < s.history.length; i++) {
            const x = graphLeft + (i / MAX_HISTORY) * graphW;
            const y =
              graphTop +
              graphH / 2 -
              (s.history[i] / maxVal) * (graphH / 2) * 0.9;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else {
        // Vertical spring
        const centerX = w * 0.4;
        const ceilingY = 40;
        const restY = h * 0.4;
        const massY = restY + s.displacement;
        const massSize = 20 + s.mass * 4;

        // Ceiling
        ctx.beginPath();
        ctx.moveTo(centerX - 50, ceilingY);
        ctx.lineTo(centerX + 50, ceilingY);
        ctx.strokeStyle = heading;
        ctx.lineWidth = 3;
        ctx.stroke();

        for (let i = -50; i < 50; i += 10) {
          ctx.beginPath();
          ctx.moveTo(centerX + i, ceilingY);
          ctx.lineTo(centerX + i + 10, ceilingY - 10);
          ctx.strokeStyle = textMuted;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Equilibrium line
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.moveTo(centerX - 40, restY);
        ctx.lineTo(centerX + 40, restY);
        ctx.strokeStyle = textMuted;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Spring
        drawSpringZigzag(
          ctx,
          { x: centerX, y: ceilingY },
          { x: centerX, y: massY - massSize / 2 },
          8,
          15,
          textMuted
        );

        // Mass
        ctx.beginPath();
        ctx.arc(centerX, massY, massSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.fill();
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Graph on the right side
        const graphLeft = w * 0.6;
        const graphW = w * 0.35;
        const graphTop = 60;
        const graphH = h - 100;

        ctx.strokeStyle = textMuted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(graphLeft + graphW / 2, graphTop);
        ctx.lineTo(graphLeft + graphW / 2, graphTop + graphH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(graphLeft, graphTop + graphH);
        ctx.lineTo(graphLeft + graphW, graphTop + graphH);
        ctx.stroke();

        ctx.fillStyle = textMuted;
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText("Pos vs Time", graphLeft + graphW / 2 - 30, graphTop - 5);

        if (s.history.length > 1) {
          const maxVal = Math.max(
            ...s.history.map((v) => Math.abs(v)),
            1
          );
          ctx.beginPath();
          for (let i = 0; i < s.history.length; i++) {
            const y = graphTop + graphH - (i / MAX_HISTORY) * graphH;
            const x =
              graphLeft +
              graphW / 2 +
              (s.history[i] / maxVal) * (graphW / 2) * 0.9;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    },
    [getCanvasSize]
  );

  const renderProjectile = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const p = projRef.current;
      const primary = getCssVar("--color-primary");
      const accent = getCssVar("--color-accent");
      const textMuted = getCssVar("--color-text-muted");
      const heading = getCssVar("--color-heading");

      const groundY = h - 40;
      const launchX = 60;

      // Ground
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(w, groundY);
      ctx.strokeStyle = textMuted;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Ground hatching
      for (let x = 0; x < w; x += 15) {
        ctx.beginPath();
        ctx.moveTo(x, groundY);
        ctx.lineTo(x + 8, groundY + 8);
        ctx.strokeStyle = textMuted;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (!p.launched) {
        // Show launch indicator
        const angleRad = (p.angle * Math.PI) / 180;
        const arrowLen = Math.min(p.speed * 3, 120);
        const endX = launchX + arrowLen * Math.cos(angleRad);
        const endY = groundY - arrowLen * Math.sin(angleRad);

        // Launch platform
        ctx.beginPath();
        ctx.arc(launchX, groundY, 6, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.fill();

        // Velocity arrow
        drawArrow(
          ctx,
          { x: launchX, y: groundY },
          { x: endX, y: endY },
          "#4f8ff7",
          10
        );

        // Angle arc
        ctx.beginPath();
        ctx.arc(launchX, groundY, 30, -angleRad, 0);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Label
        ctx.fillStyle = heading;
        ctx.font = "13px Inter, sans-serif";
        ctx.fillText(
          `${p.angle}deg @ ${p.speed.toFixed(1)} m/s`,
          launchX + 40,
          groundY - 10
        );
      } else {
        // Trail
        const trailScreen = p.trail.map((pt) => ({
          x: launchX + pt.x,
          y: groundY - pt.y,
        }));
        if (trailScreen.length > 1) {
          ctx.beginPath();
          ctx.setLineDash([4, 4]);
          for (let i = 0; i < trailScreen.length; i++) {
            if (i === 0) ctx.moveTo(trailScreen[i].x, trailScreen[i].y);
            else ctx.lineTo(trailScreen[i].x, trailScreen[i].y);
          }
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Ball
        const screenX = launchX + p.x;
        const screenY = groundY - p.y;
        ctx.beginPath();
        ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
        ctx.fillStyle = primary;
        ctx.fill();
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Velocity vector
        if (!p.landed) {
          const vScale = 3;
          drawArrow(
            ctx,
            { x: screenX, y: screenY },
            { x: screenX + p.vx * vScale, y: screenY - p.vy * vScale },
            "#4f8ff7",
            6
          );
        }

        // Stats
        ctx.fillStyle = heading;
        ctx.font = "13px Inter, sans-serif";
        const statsY = 30;
        ctx.fillText(
          `Max Height: ${p.maxHeight.toFixed(1)} m`,
          w - 220,
          statsY
        );
        ctx.fillText(
          `Range: ${p.range > 0 ? p.range.toFixed(1) : "..."} m`,
          w - 220,
          statsY + 20
        );
        ctx.fillText(
          `Time: ${p.flightTime.toFixed(2)} s`,
          w - 220,
          statsY + 40
        );
      }
    },
    [getCanvasSize]
  );

  const renderCollision = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const c = collRef.current;
      const heading = getCssVar("--color-heading");

      // Boundary
      ctx.strokeStyle = getCssVar("--color-border");
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);

      // Balls
      for (const b of c.balls) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Velocity vector
        const vLen = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (vLen > 0.2) {
          const scale = 10;
          drawArrow(
            ctx,
            { x: b.x, y: b.y },
            { x: b.x + b.vx * scale, y: b.y + b.vy * scale },
            "#4f8ff7",
            5
          );
        }

        // Mass label
        ctx.fillStyle = heading;
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${b.mass}`, b.x, b.y + 4);
        ctx.textAlign = "start";
      }

      // Drag preview
      if (collDragRef.current) {
        const start = collDragRef.current;
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.arc(start.startX, start.startY, 15, 0, Math.PI * 2);
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Momentum display
      let totalPx = 0;
      let totalPy = 0;
      let totalKE = 0;
      for (const b of c.balls) {
        totalPx += b.mass * b.vx;
        totalPy += b.mass * b.vy;
        totalKE += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy);
      }

      ctx.fillStyle = getCssVar("--color-text-muted");
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(
        `Momentum: (${totalPx.toFixed(1)}, ${totalPy.toFixed(1)})`,
        10,
        20
      );
      ctx.fillText(`|p| = ${Math.sqrt(totalPx * totalPx + totalPy * totalPy).toFixed(1)}`, 10, 35);
    },
    []
  );

  const renderOrbit = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const o = orbitRef.current;
      const heading = getCssVar("--color-heading");
      const textMuted = getCssVar("--color-text-muted");

      const cx = w / 2;
      const cy = h / 2;

      // Central body
      const gradient = ctx.createRadialGradient(
        cx - 3,
        cy - 3,
        0,
        cx,
        cy,
        o.centralRadius
      );
      gradient.addColorStop(0, "#fbbf24");
      gradient.addColorStop(0.7, "#f59e0b");
      gradient.addColorStop(1, "#d97706");
      ctx.beginPath();
      ctx.arc(cx, cy, o.centralRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Bodies
      for (const body of o.bodies) {
        const screenX = cx + body.x;
        const screenY = cy + body.y;

        // Trail
        const screenTrail = body.trail.map((p) => ({
          x: cx + p.x,
          y: cy + p.y,
        }));
        drawTrail(ctx, screenTrail, body.color, 0.5);

        // Body
        ctx.beginPath();
        ctx.arc(screenX, screenY, body.radius, 0, Math.PI * 2);
        ctx.fillStyle = body.color;
        ctx.fill();
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Velocity vector
        const vScale = 8;
        if (Math.sqrt(body.vx * body.vx + body.vy * body.vy) > 0.1) {
          drawArrow(
            ctx,
            { x: screenX, y: screenY },
            { x: screenX + body.vx * vScale, y: screenY + body.vy * vScale },
            "#4f8ff7",
            5
          );
        }
      }

      // Drag preview for launching
      if (orbitDragRef.current) {
        const start = orbitDragRef.current;
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.arc(start.startX, start.startY, 6, 0, Math.PI * 2);
        ctx.strokeStyle = heading;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Instructions
      ctx.fillStyle = textMuted;
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText("Click and drag to launch orbital body", 10, h - 15);
    },
    []
  );

  /* ─────────────── Main render loop ─────────────── */

  const render = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      // Clear
      ctx.clearRect(0, 0, w, h);

      const tab = tabRef.current;
      if (tab === "pendulum") renderPendulum(ctx, w, h);
      else if (tab === "spring") renderSpring(ctx, w, h);
      else if (tab === "projectile") renderProjectile(ctx, w, h);
      else if (tab === "collisions") renderCollision(ctx, w, h);
      else if (tab === "orbits") renderOrbit(ctx, w, h);
    },
    [renderPendulum, renderSpring, renderProjectile, renderCollision, renderOrbit]
  );

  /* ─────────────── Animation loop ─────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    lastTimeRef.current = performance.now();
    accumulatorRef.current = 0;

    const loop = (now: number) => {
      const elapsed = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      if (playingRef.current) {
        accumulatorRef.current += elapsed * speedRef.current;

        while (accumulatorRef.current >= FIXED_DT) {
          accumulatorRef.current -= FIXED_DT;

          const tab = tabRef.current;
          if (tab === "pendulum") stepPendulum(FIXED_DT);
          else if (tab === "spring") stepSpring(FIXED_DT);
          else if (tab === "projectile") stepProjectile(FIXED_DT);
          else if (tab === "collisions") stepCollision(FIXED_DT);
          else if (tab === "orbits") stepOrbit(FIXED_DT);

          simTimeRef.current += FIXED_DT;
        }

        computeEnergy();
        setSimTime(simTimeRef.current);
      }

      const { w, h } = getCanvasSize();
      render(ctx, w, h);

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [
    stepPendulum,
    stepSpring,
    stepProjectile,
    stepCollision,
    stepOrbit,
    computeEnergy,
    getCanvasSize,
    render,
  ]);

  /* ─────────────── Step (single frame) ─────────────── */

  const stepOnce = useCallback(() => {
    const tab = tabRef.current;
    if (tab === "pendulum") stepPendulum(FIXED_DT);
    else if (tab === "spring") stepSpring(FIXED_DT);
    else if (tab === "projectile") stepProjectile(FIXED_DT);
    else if (tab === "collisions") stepCollision(FIXED_DT);
    else if (tab === "orbits") stepOrbit(FIXED_DT);
    simTimeRef.current += FIXED_DT;
    setSimTime(simTimeRef.current);
    computeEnergy();
  }, [stepPendulum, stepSpring, stepProjectile, stepCollision, stepOrbit, computeEnergy]);

  /* ─────────────── Reset ─────────────── */

  const resetSim = useCallback(() => {
    simTimeRef.current = 0;
    setSimTime(0);
    setEnergy({ kinetic: 0, potential: 0, total: 0 });

    if (activeTab === "pendulum") {
      const d = defaultPendulum();
      d.mode = pendulum.mode;
      d.gravity = pendulum.gravity;
      d.damping = pendulum.damping;
      d.length1 = pendulum.length1;
      d.length2 = pendulum.length2;
      d.mass1 = pendulum.mass1;
      d.mass2 = pendulum.mass2;
      setPendulum(d);
      pendRef.current = d;
    } else if (activeTab === "spring") {
      const d = defaultSpring();
      d.springK = spring.springK;
      d.mass = spring.mass;
      d.damping = spring.damping;
      d.orientation = spring.orientation;
      setSpring(d);
      springRef.current = d;
    } else if (activeTab === "projectile") {
      const d = defaultProjectile();
      d.angle = projectile.angle;
      d.speed = projectile.speed;
      d.gravity = projectile.gravity;
      d.airResistance = projectile.airResistance;
      d.dragCoeff = projectile.dragCoeff;
      setProjectile(d);
      projRef.current = d;
    } else if (activeTab === "collisions") {
      const d = defaultCollision();
      d.elasticity = collision.elasticity;
      d.gravityOn = collision.gravityOn;
      setCollision(d);
      collRef.current = d;
    } else if (activeTab === "orbits") {
      const d = defaultOrbit();
      d.centralMass = orbit.centralMass;
      d.gravitationalConstant = orbit.gravitationalConstant;
      setOrbit(d);
      orbitRef.current = d;
    }
  }, [activeTab, pendulum, spring, projectile, collision, orbit]);

  /* ─────────────── Tab change ─────────────── */

  const switchTab = useCallback(
    (tab: SimulationType) => {
      setActiveTab(tab);
      simTimeRef.current = 0;
      setSimTime(0);
      setEnergy({ kinetic: 0, potential: 0, total: 0 });
      accumulatorRef.current = 0;
    },
    []
  );

  /* ─────────────── Canvas mouse interactions ─────────────── */

  const getCanvasPos = useCallback(
    (e: MouseEvent): Vec2 => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const tab = tabRef.current;

      if (tab === "pendulum") {
        pendDragRef.current = true;
      } else if (tab === "collisions") {
        // Check if clicking on existing ball
        const c = collRef.current;
        let hitBall = false;
        for (const b of c.balls) {
          const dx = pos.x - b.x;
          const dy = pos.y - b.y;
          if (Math.sqrt(dx * dx + dy * dy) < b.radius) {
            hitBall = true;
            break;
          }
        }
        if (!hitBall) {
          collDragRef.current = { startX: pos.x, startY: pos.y };
        }
      } else if (tab === "orbits") {
        const { w, h } = getCanvasSize();
        const cx = w / 2;
        const cy = h / 2;
        const dx = pos.x - cx;
        const dy = pos.y - cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r > orbitRef.current.centralRadius + 10) {
          orbitDragRef.current = { startX: pos.x, startY: pos.y };
        }
      }
    },
    [getCanvasPos, getCanvasSize]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const tab = tabRef.current;

      if (tab === "pendulum" && pendDragRef.current) {
        const { w, h } = getCanvasSize();
        const p = pendRef.current;
        const pivotX = w / 2;
        const pivotY = p.mode === "simple" ? h * 0.15 : h * 0.2;
        const angle = Math.atan2(pos.x - pivotX, pos.y - pivotY);
        const newP = { ...p, theta1: angle, omega1: 0, trail1: [], trail2: [] };
        pendRef.current = newP;
        setPendulum(newP);
      }
    },
    [getCanvasPos, getCanvasSize]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent) => {
      const pos = getCanvasPos(e);
      const tab = tabRef.current;

      if (tab === "pendulum") {
        pendDragRef.current = false;
      } else if (tab === "collisions" && collDragRef.current) {
        const start = collDragRef.current;
        const c = { ...collRef.current };
        const vx = (pos.x - start.startX) * 0.05;
        const vy = (pos.y - start.startY) * 0.05;
        const newBall: Ball = {
          id: c.nextId,
          x: start.startX,
          y: start.startY,
          vx,
          vy,
          radius: 12 + Math.random() * 15,
          mass: 2 + Math.floor(Math.random() * 8),
          color: BALL_COLORS[c.nextId % BALL_COLORS.length],
        };
        c.balls = [...c.balls, newBall];
        c.nextId++;
        collRef.current = c;
        setCollision(c);
        collDragRef.current = null;
      } else if (tab === "orbits" && orbitDragRef.current) {
        const start = orbitDragRef.current;
        const { w, h } = getCanvasSize();
        const cx = w / 2;
        const cy = h / 2;
        const o = { ...orbitRef.current };
        const vx = (pos.x - start.startX) * 0.03;
        const vy = (pos.y - start.startY) * 0.03;
        const newBody: OrbitalBody = {
          id: o.nextId,
          x: start.startX - cx,
          y: start.startY - cy,
          vx,
          vy,
          mass: 1,
          radius: 5 + Math.random() * 3,
          color: ORBIT_COLORS[o.nextId % ORBIT_COLORS.length],
          trail: [],
        };
        o.bodies = [...o.bodies, newBody];
        o.nextId++;
        orbitRef.current = o;
        setOrbit(o);
        orbitDragRef.current = null;
      }
    },
    [getCanvasPos, getCanvasSize]
  );

  /* ─────────────── Slider helper ─────────────── */

  const Slider = ({
    label,
    value,
    min,
    max,
    step,
    onChange,
    unit,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
    unit?: string;
  }) => (
    <div class="phy-slider">
      <div class="phy-slider-header">
        <span class="phy-slider-label">{label}</span>
        <span class="phy-slider-value">
          {value.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) =>
          onChange(parseFloat((e.target as HTMLInputElement).value))
        }
        class="phy-range"
      />
    </div>
  );

  /* ─────────────── Parameter panels ─────────────── */

  const renderPendulumParams = () => (
    <div class="phy-params-section">
      <div class="phy-toggle-group">
        <button
          class={`phy-toggle-btn ${pendulum.mode === "simple" ? "active" : ""}`}
          onClick={() => {
            const p = { ...pendulum, mode: "simple" as const, trail1: [], trail2: [] };
            setPendulum(p);
            pendRef.current = p;
          }}
        >
          Simple
        </button>
        <button
          class={`phy-toggle-btn ${pendulum.mode === "double" ? "active" : ""}`}
          onClick={() => {
            const p = { ...pendulum, mode: "double" as const, trail1: [], trail2: [] };
            setPendulum(p);
            pendRef.current = p;
          }}
        >
          Double
        </button>
      </div>
      <Slider
        label="Gravity"
        value={pendulum.gravity}
        min={0.5}
        max={30}
        step={0.1}
        unit="m/s2"
        onChange={(v) => {
          const p = { ...pendulum, gravity: v };
          setPendulum(p);
          pendRef.current = p;
        }}
      />
      <Slider
        label="Length 1"
        value={pendulum.length1}
        min={50}
        max={250}
        step={5}
        unit="px"
        onChange={(v) => {
          const p = { ...pendulum, length1: v, trail1: [], trail2: [] };
          setPendulum(p);
          pendRef.current = p;
        }}
      />
      <Slider
        label="Mass 1"
        value={pendulum.mass1}
        min={1}
        max={20}
        step={1}
        onChange={(v) => {
          const p = { ...pendulum, mass1: v };
          setPendulum(p);
          pendRef.current = p;
        }}
      />
      {pendulum.mode === "double" && (
        <>
          <Slider
            label="Length 2"
            value={pendulum.length2}
            min={30}
            max={200}
            step={5}
            unit="px"
            onChange={(v) => {
              const p = { ...pendulum, length2: v, trail1: [], trail2: [] };
              setPendulum(p);
              pendRef.current = p;
            }}
          />
          <Slider
            label="Mass 2"
            value={pendulum.mass2}
            min={1}
            max={20}
            step={1}
            onChange={(v) => {
              const p = { ...pendulum, mass2: v };
              setPendulum(p);
              pendRef.current = p;
            }}
          />
        </>
      )}
      <Slider
        label="Damping"
        value={pendulum.damping}
        min={0}
        max={0.5}
        step={0.01}
        onChange={(v) => {
          const p = { ...pendulum, damping: v };
          setPendulum(p);
          pendRef.current = p;
        }}
      />
      <p class="phy-hint">Drag on canvas to set angle</p>
    </div>
  );

  const renderSpringParams = () => (
    <div class="phy-params-section">
      <div class="phy-toggle-group">
        <button
          class={`phy-toggle-btn ${spring.orientation === "horizontal" ? "active" : ""}`}
          onClick={() => {
            const s = { ...spring, orientation: "horizontal" as const, history: [] };
            setSpring(s);
            springRef.current = s;
          }}
        >
          Horizontal
        </button>
        <button
          class={`phy-toggle-btn ${spring.orientation === "vertical" ? "active" : ""}`}
          onClick={() => {
            const s = { ...spring, orientation: "vertical" as const, history: [] };
            setSpring(s);
            springRef.current = s;
          }}
        >
          Vertical
        </button>
      </div>
      <Slider
        label="Spring k"
        value={spring.springK}
        min={0.5}
        max={20}
        step={0.5}
        unit="N/m"
        onChange={(v) => {
          const s = { ...spring, springK: v };
          setSpring(s);
          springRef.current = s;
        }}
      />
      <Slider
        label="Mass"
        value={spring.mass}
        min={0.5}
        max={10}
        step={0.5}
        unit="kg"
        onChange={(v) => {
          const s = { ...spring, mass: v };
          setSpring(s);
          springRef.current = s;
        }}
      />
      <Slider
        label="Damping"
        value={spring.damping}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => {
          const s = { ...spring, damping: v };
          setSpring(s);
          springRef.current = s;
        }}
      />
      <Slider
        label="Init. Displacement"
        value={spring.displacement}
        min={-120}
        max={120}
        step={5}
        unit="px"
        onChange={(v) => {
          const s = { ...spring, displacement: v, velocity: 0, history: [] };
          setSpring(s);
          springRef.current = s;
        }}
      />
    </div>
  );

  const renderProjectileParams = () => (
    <div class="phy-params-section">
      <Slider
        label="Angle"
        value={projectile.angle}
        min={5}
        max={85}
        step={1}
        unit="deg"
        onChange={(v) => {
          if (!projectile.launched) {
            const p = { ...projectile, angle: v };
            setProjectile(p);
            projRef.current = p;
          }
        }}
      />
      <Slider
        label="Velocity"
        value={projectile.speed}
        min={5}
        max={50}
        step={0.5}
        unit="m/s"
        onChange={(v) => {
          if (!projectile.launched) {
            const p = { ...projectile, speed: v };
            setProjectile(p);
            projRef.current = p;
          }
        }}
      />
      <Slider
        label="Gravity"
        value={projectile.gravity}
        min={1}
        max={20}
        step={0.1}
        unit="m/s2"
        onChange={(v) => {
          const p = { ...projectile, gravity: v };
          setProjectile(p);
          projRef.current = p;
        }}
      />
      <div class="phy-checkbox-row">
        <label class="phy-checkbox-label">
          <input
            type="checkbox"
            checked={projectile.airResistance}
            onChange={(e) => {
              const p = {
                ...projectile,
                airResistance: (e.target as HTMLInputElement).checked,
              };
              setProjectile(p);
              projRef.current = p;
            }}
          />
          Air Resistance
        </label>
      </div>
      {projectile.airResistance && (
        <Slider
          label="Drag Coeff"
          value={projectile.dragCoeff}
          min={0.001}
          max={0.1}
          step={0.001}
          onChange={(v) => {
            const p = { ...projectile, dragCoeff: v };
            setProjectile(p);
            projRef.current = p;
          }}
        />
      )}
      {!projectile.launched && (
        <button
          class="phy-action-btn"
          onClick={() => {
            const angleRad = (projectile.angle * Math.PI) / 180;
            const p = {
              ...projectile,
              launched: true,
              vx: projectile.speed * Math.cos(angleRad),
              vy: projectile.speed * Math.sin(angleRad),
              x: 0,
              y: 0,
              trail: [],
            };
            setProjectile(p);
            projRef.current = p;
          }}
        >
          Launch!
        </button>
      )}
    </div>
  );

  const renderCollisionParams = () => (
    <div class="phy-params-section">
      <Slider
        label="Elasticity"
        value={collision.elasticity}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => {
          const c = { ...collision, elasticity: v };
          setCollision(c);
          collRef.current = c;
        }}
      />
      <div class="phy-checkbox-row">
        <label class="phy-checkbox-label">
          <input
            type="checkbox"
            checked={collision.gravityOn}
            onChange={(e) => {
              const c = {
                ...collision,
                gravityOn: (e.target as HTMLInputElement).checked,
              };
              setCollision(c);
              collRef.current = c;
            }}
          />
          Gravity
        </label>
      </div>
      {collision.gravityOn && (
        <Slider
          label="Gravity"
          value={collision.gravity}
          min={1}
          max={30}
          step={0.5}
          unit="m/s2"
          onChange={(v) => {
            const c = { ...collision, gravity: v };
            setCollision(c);
            collRef.current = c;
          }}
        />
      )}
      <div class="phy-info-row">
        <span>Balls: {collision.balls.length}</span>
      </div>
      <p class="phy-hint">Click + drag on canvas to add a ball (drag direction = velocity)</p>
      {collision.balls.length > 0 && (
        <button
          class="phy-action-btn phy-action-secondary"
          onClick={() => {
            const c = {
              ...collision,
              balls: collision.balls.slice(0, -1),
            };
            setCollision(c);
            collRef.current = c;
          }}
        >
          Remove Last Ball
        </button>
      )}
    </div>
  );

  const renderOrbitParams = () => (
    <div class="phy-params-section">
      <Slider
        label="Central Mass"
        value={orbit.centralMass}
        min={1000}
        max={20000}
        step={500}
        onChange={(v) => {
          const o = { ...orbit, centralMass: v };
          setOrbit(o);
          orbitRef.current = o;
        }}
      />
      <Slider
        label="G Constant"
        value={orbit.gravitationalConstant}
        min={0.1}
        max={5}
        step={0.1}
        onChange={(v) => {
          const o = { ...orbit, gravitationalConstant: v };
          setOrbit(o);
          orbitRef.current = o;
        }}
      />
      <div class="phy-info-row">
        <span>Bodies: {orbit.bodies.length}</span>
      </div>
      <p class="phy-hint">Click + drag on canvas to launch a body (drag direction = velocity)</p>
      {orbit.bodies.length > 0 && (
        <button
          class="phy-action-btn phy-action-secondary"
          onClick={() => {
            const o = {
              ...orbit,
              bodies: orbit.bodies.slice(0, -1),
            };
            setOrbit(o);
            orbitRef.current = o;
          }}
        >
          Remove Last Body
        </button>
      )}
    </div>
  );

  /* ─────────────── Render ─────────────── */

  return (
    <div class="phy-sandbox">
      {/* Tab bar */}
      <div class="phy-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            class={`phy-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => switchTab(tab.id)}
          >
            <span class="phy-tab-icon">{renderTabIcon(tab.icon)}</span>
            <span class="phy-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      <div class="phy-main">
        {/* Canvas area */}
        <div class="phy-canvas-wrap">
          <canvas
            ref={canvasRef}
            class="phy-canvas"
            onMouseDown={handleMouseDown as any}
            onMouseMove={handleMouseMove as any}
            onMouseUp={handleMouseUp as any}
            onMouseLeave={() => {
              pendDragRef.current = false;
              collDragRef.current = null;
              orbitDragRef.current = null;
            }}
          />
        </div>

        {/* Side panel */}
        <div class="phy-sidebar">
          {/* Parameters */}
          <div class="phy-panel">
            <h3 class="phy-panel-title">Parameters</h3>
            {activeTab === "pendulum" && renderPendulumParams()}
            {activeTab === "spring" && renderSpringParams()}
            {activeTab === "projectile" && renderProjectileParams()}
            {activeTab === "collisions" && renderCollisionParams()}
            {activeTab === "orbits" && renderOrbitParams()}
          </div>

          {/* Energy */}
          <div class="phy-panel">
            <h3 class="phy-panel-title">Energy</h3>
            <div class="phy-energy">
              <div class="phy-energy-row">
                <span class="phy-energy-label">KE</span>
                <div class="phy-energy-bar-wrap">
                  <div
                    class="phy-energy-bar"
                    style={{
                      width: `${Math.min(
                        (energy.kinetic / Math.max(energy.total, 0.01)) * 100,
                        100
                      )}%`,
                      backgroundColor: "#4f8ff7",
                    }}
                  />
                </div>
                <span class="phy-energy-val">{energy.kinetic.toFixed(1)}</span>
              </div>
              <div class="phy-energy-row">
                <span class="phy-energy-label">PE</span>
                <div class="phy-energy-bar-wrap">
                  <div
                    class="phy-energy-bar"
                    style={{
                      width: `${Math.min(
                        (Math.abs(energy.potential) /
                          Math.max(Math.abs(energy.total), 0.01)) *
                          100,
                        100
                      )}%`,
                      backgroundColor: "#34d399",
                    }}
                  />
                </div>
                <span class="phy-energy-val">{energy.potential.toFixed(1)}</span>
              </div>
              <div class="phy-energy-row phy-energy-total">
                <span class="phy-energy-label">Total</span>
                <span class="phy-energy-val" style={{ color: "#f59e0b" }}>
                  {energy.total.toFixed(1)}
                </span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div class="phy-panel">
            <div class="phy-controls">
              <button
                class="phy-ctrl-btn"
                onClick={() => setPlaying(!playing)}
                title={playing ? "Pause" : "Play"}
              >
                {playing ? "\u23F8" : "\u25B6"}
              </button>
              <button
                class="phy-ctrl-btn"
                onClick={stepOnce}
                title="Step"
                disabled={playing}
              >
                \u23ED
              </button>
              <button class="phy-ctrl-btn" onClick={resetSim} title="Reset">
                \u21BA
              </button>
            </div>

            <div class="phy-speed">
              <span class="phy-speed-label">Speed</span>
              <select
                class="phy-speed-select"
                value={speedMult}
                onChange={(e) =>
                  setSpeedMult(
                    parseFloat((e.target as HTMLSelectElement).value)
                  )
                }
              >
                <option value="0.25">0.25x</option>
                <option value="0.5">0.5x</option>
                <option value="1">1x</option>
                <option value="2">2x</option>
                <option value="4">4x</option>
              </select>
            </div>

            <div class="phy-time">
              <span class="phy-time-label">Time</span>
              <span class="phy-time-val">{simTime.toFixed(2)}s</span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .phy-sandbox {
          border: 1px solid var(--color-border);
          border-radius: 12px;
          overflow: hidden;
          background: var(--color-surface);
        }

        .phy-tabs {
          display: flex;
          gap: 0;
          border-bottom: 1px solid var(--color-border);
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }

        .phy-tab {
          flex: 1;
          min-width: 0;
          padding: 10px 8px;
          border: none;
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 13px;
          font-family: var(--font-sans);
          transition: color 0.2s, background 0.2s;
          white-space: nowrap;
        }

        .phy-tab:hover {
          color: var(--color-heading);
          background: color-mix(in srgb, var(--color-primary) 8%, transparent);
        }

        .phy-tab.active {
          color: var(--color-primary);
          background: color-mix(in srgb, var(--color-primary) 12%, transparent);
          border-bottom: 2px solid var(--color-primary);
        }

        .phy-tab-icon {
          display: flex;
          align-items: center;
        }

        .phy-tab-label {
          font-weight: 500;
        }

        .phy-main {
          display: flex;
          flex-direction: column;
        }

        @media (min-width: 768px) {
          .phy-main {
            flex-direction: row;
          }
        }

        .phy-canvas-wrap {
          flex: 1;
          min-height: 350px;
          position: relative;
        }

        @media (min-width: 768px) {
          .phy-canvas-wrap {
            min-height: 450px;
          }
        }

        .phy-canvas {
          width: 100%;
          height: 100%;
          display: block;
          cursor: crosshair;
        }

        .phy-sidebar {
          width: 100%;
          border-top: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          gap: 0;
          overflow-y: auto;
          max-height: 400px;
        }

        @media (min-width: 768px) {
          .phy-sidebar {
            width: 240px;
            border-top: none;
            border-left: 1px solid var(--color-border);
            max-height: none;
          }
        }

        .phy-panel {
          padding: 12px 14px;
          border-bottom: 1px solid var(--color-border);
        }

        .phy-panel:last-child {
          border-bottom: none;
        }

        .phy-panel-title {
          font-family: var(--font-heading);
          font-size: 14px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--color-heading);
          margin: 0 0 10px 0;
          letter-spacing: 0.05em;
        }

        .phy-params-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .phy-slider {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .phy-slider-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .phy-slider-label {
          font-size: 11px;
          color: var(--color-text-muted);
          font-family: var(--font-sans);
        }

        .phy-slider-value {
          font-size: 11px;
          color: var(--color-heading);
          font-family: var(--font-mono);
        }

        .phy-range {
          width: 100%;
          height: 4px;
          -webkit-appearance: none;
          appearance: none;
          background: var(--color-border);
          border-radius: 2px;
          outline: none;
          cursor: pointer;
        }

        .phy-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }

        .phy-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-primary);
          cursor: pointer;
          border: 2px solid var(--color-surface);
        }

        .phy-toggle-group {
          display: flex;
          gap: 4px;
          margin-bottom: 4px;
        }

        .phy-toggle-btn {
          flex: 1;
          padding: 5px 8px;
          font-size: 11px;
          font-family: var(--font-sans);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          transition: all 0.2s;
        }

        .phy-toggle-btn:hover {
          color: var(--color-heading);
          border-color: var(--color-text-muted);
        }

        .phy-toggle-btn.active {
          background: color-mix(in srgb, var(--color-primary) 15%, transparent);
          color: var(--color-primary);
          border-color: var(--color-primary);
        }

        .phy-checkbox-row {
          display: flex;
          align-items: center;
        }

        .phy-checkbox-label {
          font-size: 12px;
          color: var(--color-text);
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          font-family: var(--font-sans);
        }

        .phy-checkbox-label input {
          accent-color: var(--color-primary);
        }

        .phy-hint {
          font-size: 10px;
          color: var(--color-text-muted);
          margin: 0;
          font-style: italic;
          font-family: var(--font-sans);
        }

        .phy-info-row {
          font-size: 11px;
          color: var(--color-text-muted);
          font-family: var(--font-sans);
        }

        .phy-action-btn {
          padding: 6px 12px;
          font-size: 12px;
          font-family: var(--font-sans);
          font-weight: 600;
          border: none;
          border-radius: 6px;
          background: var(--color-primary);
          color: #fff;
          cursor: pointer;
          transition: opacity 0.2s;
          width: 100%;
        }

        .phy-action-btn:hover {
          opacity: 0.85;
        }

        .phy-action-secondary {
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text-muted);
        }

        .phy-action-secondary:hover {
          border-color: var(--color-text-muted);
          color: var(--color-heading);
          opacity: 1;
        }

        .phy-energy {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .phy-energy-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .phy-energy-label {
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--color-text-muted);
          width: 32px;
          flex-shrink: 0;
        }

        .phy-energy-bar-wrap {
          flex: 1;
          height: 6px;
          background: var(--color-border);
          border-radius: 3px;
          overflow: hidden;
        }

        .phy-energy-bar {
          height: 100%;
          border-radius: 3px;
          transition: width 0.1s;
          min-width: 1px;
        }

        .phy-energy-val {
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--color-heading);
          min-width: 40px;
          text-align: right;
        }

        .phy-energy-total {
          border-top: 1px solid var(--color-border);
          padding-top: 4px;
          margin-top: 2px;
          justify-content: space-between;
        }

        .phy-controls {
          display: flex;
          gap: 6px;
          justify-content: center;
        }

        .phy-ctrl-btn {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--color-border);
          border-radius: 8px;
          background: transparent;
          color: var(--color-heading);
          cursor: pointer;
          font-size: 16px;
          transition: all 0.2s;
        }

        .phy-ctrl-btn:hover {
          background: color-mix(in srgb, var(--color-primary) 12%, transparent);
          border-color: var(--color-primary);
          color: var(--color-primary);
        }

        .phy-ctrl-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .phy-speed {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 8px;
        }

        .phy-speed-label {
          font-size: 11px;
          color: var(--color-text-muted);
          font-family: var(--font-sans);
        }

        .phy-speed-select {
          padding: 3px 6px;
          font-size: 11px;
          font-family: var(--font-mono);
          background: var(--color-bg);
          color: var(--color-heading);
          border: 1px solid var(--color-border);
          border-radius: 4px;
          cursor: pointer;
        }

        .phy-time {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 6px;
        }

        .phy-time-label {
          font-size: 11px;
          color: var(--color-text-muted);
          font-family: var(--font-sans);
        }

        .phy-time-val {
          font-size: 13px;
          font-family: var(--font-mono);
          color: var(--color-heading);
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   Tab icon SVGs (inline, no deps)
   ══════════════════════════════════════════════════════════ */

function renderTabIcon(icon: string) {
  const size = 16;
  const color = "currentColor";

  switch (icon) {
    case "pendulum":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2">
          <circle cx="12" cy="4" r="2" />
          <line x1="12" y1="6" x2="18" y2="18" />
          <circle cx="18" cy="18" r="3" fill={color} />
        </svg>
      );
    case "spring":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2">
          <line x1="2" y1="12" x2="4" y2="12" />
          <polyline points="4,12 6,8 8,16 10,8 12,16 14,8 16,16 18,12" />
          <line x1="18" y1="12" x2="20" y2="12" />
          <rect x="20" y="9" width="3" height="6" rx="1" fill={color} />
        </svg>
      );
    case "projectile":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2">
          <path d="M3 20 Q 10 2, 21 20" stroke-dasharray="3 3" />
          <circle cx="3" cy="20" r="2" fill={color} />
        </svg>
      );
    case "collisions":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2">
          <circle cx="8" cy="12" r="5" />
          <circle cx="16" cy="12" r="4" />
          <line x1="3" y1="12" x2="6" y2="12" stroke-dasharray="2 2" />
          <line x1="18" y1="12" x2="21" y2="12" stroke-dasharray="2 2" />
        </svg>
      );
    case "orbits":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} stroke-width="2">
          <circle cx="12" cy="12" r="3" fill={color} />
          <ellipse cx="12" cy="12" rx="10" ry="4" />
          <circle cx="20" cy="9" r="1.5" fill={color} />
        </svg>
      );
    default:
      return null;
  }
}
