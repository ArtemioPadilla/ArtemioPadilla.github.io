import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

type AttractorType = "lorenz" | "rossler" | "double-pendulum" | "henon" | "logistic";

interface AttractorTab {
  id: AttractorType;
  label: string;
  icon: string;
}

interface LorenzParams {
  sigma: number;
  rho: number;
  beta: number;
}

interface RosslerParams {
  a: number;
  b: number;
  c: number;
}

interface DoublePendulumParams {
  m1: number;
  m2: number;
  l1: number;
  l2: number;
  theta1: number;
  theta2: number;
}

interface DoublePendulumState {
  theta1: number;
  theta2: number;
  omega1: number;
  omega2: number;
}

interface HenonParams {
  a: number;
  b: number;
}

interface LogisticParams {
  rMin: number;
  rMax: number;
  rCurrent: number;
}

interface Camera3D {
  rotX: number;
  rotY: number;
  zoom: number;
  autoRotate: boolean;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const TABS: AttractorTab[] = [
  { id: "lorenz", label: "Lorenz", icon: "L" },
  { id: "rossler", label: "Rossler", icon: "R" },
  { id: "double-pendulum", label: "Double Pendulum", icon: "P" },
  { id: "henon", label: "Henon Map", icon: "H" },
  { id: "logistic", label: "Logistic Map", icon: "B" },
];

const DEFAULT_LORENZ: LorenzParams = { sigma: 10, rho: 28, beta: 8 / 3 };
const DEFAULT_ROSSLER: RosslerParams = { a: 0.2, b: 0.2, c: 5.7 };
const DEFAULT_DOUBLE_PENDULUM: DoublePendulumParams = {
  m1: 1, m2: 1, l1: 1, l2: 1, theta1: Math.PI / 2, theta2: Math.PI / 2,
};
const DEFAULT_HENON: HenonParams = { a: 1.4, b: 0.3 };
const DEFAULT_LOGISTIC: LogisticParams = { rMin: 2.5, rMax: 4.0, rCurrent: 3.57 };

const TRAIL_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316",
];

const G = 9.81;

/* ══════════════════════════════════════════════════════════
   RK4 integration
   ══════════════════════════════════════════════════════════ */

function rk4(
  state: number[],
  dt: number,
  derivs: (s: number[]) => number[],
): number[] {
  const n = state.length;
  const k1 = derivs(state);

  const s2 = new Array(n);
  for (let i = 0; i < n; i++) s2[i] = state[i] + 0.5 * dt * k1[i];
  const k2 = derivs(s2);

  const s3 = new Array(n);
  for (let i = 0; i < n; i++) s3[i] = state[i] + 0.5 * dt * k2[i];
  const k3 = derivs(s3);

  const s4 = new Array(n);
  for (let i = 0; i < n; i++) s4[i] = state[i] + dt * k3[i];
  const k4 = derivs(s4);

  const result = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = state[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return result;
}

/* ══════════════════════════════════════════════════════════
   Lorenz system
   ══════════════════════════════════════════════════════════ */

function lorenzDerivs(state: number[], p: LorenzParams): number[] {
  const [x, y, z] = state;
  return [
    p.sigma * (y - x),
    x * (p.rho - z) - y,
    x * y - p.beta * z,
  ];
}

/* ══════════════════════════════════════════════════════════
   Rossler system
   ══════════════════════════════════════════════════════════ */

function rosslerDerivs(state: number[], p: RosslerParams): number[] {
  const [x, y, z] = state;
  return [
    -(y + z),
    x + p.a * y,
    p.b + z * (x - p.c),
  ];
}

/* ══════════════════════════════════════════════════════════
   Double pendulum (Lagrangian mechanics)
   ══════════════════════════════════════════════════════════ */

function doublePendulumDerivs(state: number[], p: DoublePendulumParams): number[] {
  const [th1, th2, w1, w2] = state;
  const { m1, m2, l1, l2 } = p;
  const dth = th1 - th2;
  const sinD = Math.sin(dth);
  const cosD = Math.cos(dth);
  const M = m1 + m2;

  const den1 = l1 * (M - m2 * cosD * cosD);
  const den2 = l2 * (M - m2 * cosD * cosD);

  const alpha1 =
    (-m2 * l1 * w1 * w1 * sinD * cosD +
      m2 * G * Math.sin(th2) * cosD -
      m2 * l2 * w2 * w2 * sinD -
      M * G * Math.sin(th1)) /
    den1;

  const alpha2 =
    (m2 * l2 * w2 * w2 * sinD * cosD +
      M * (G * Math.sin(th1) * cosD - l1 * w1 * w1 * sinD - G * Math.sin(th2))) /
    den2;

  return [w1, w2, alpha1, alpha2];
}

/* ══════════════════════════════════════════════════════════
   3D projection
   ══════════════════════════════════════════════════════════ */

function project3D(
  point: Vec3,
  camera: Camera3D,
  cx: number,
  cy: number,
): { x: number; y: number; depth: number } {
  // Rotate around Y axis
  const cosY = Math.cos(camera.rotY);
  const sinY = Math.sin(camera.rotY);
  let rx = point.x * cosY - point.z * sinY;
  let rz = point.x * sinY + point.z * cosY;
  const ry1 = point.y;

  // Rotate around X axis
  const cosX = Math.cos(camera.rotX);
  const sinX = Math.sin(camera.rotX);
  const ry = ry1 * cosX - rz * sinX;
  rz = ry1 * sinX + rz * cosX;

  // Perspective
  const fov = 400;
  const d = fov + rz * camera.zoom;
  const scale = d > 10 ? fov / d : fov / 10;

  return {
    x: cx + rx * camera.zoom * scale,
    y: cy - ry * camera.zoom * scale,
    depth: rz,
  };
}

/* ══════════════════════════════════════════════════════════
   Lyapunov exponent estimation
   ══════════════════════════════════════════════════════════ */

function estimateLyapunov(
  derivsFn: (s: number[]) => number[],
  state: number[],
  dt: number,
  steps: number,
): number {
  const eps = 1e-8;
  let s1 = [...state];
  let s2 = state.map((v, i) => (i === 0 ? v + eps : v));
  let lyapSum = 0;

  for (let i = 0; i < steps; i++) {
    s1 = rk4(s1, dt, derivsFn);
    s2 = rk4(s2, dt, derivsFn);

    let dist = 0;
    for (let j = 0; j < s1.length; j++) {
      dist += (s1[j] - s2[j]) ** 2;
    }
    dist = Math.sqrt(dist);

    if (dist > 0) {
      lyapSum += Math.log(dist / eps);
      const scale = eps / dist;
      for (let j = 0; j < s2.length; j++) {
        s2[j] = s1[j] + (s2[j] - s1[j]) * scale;
      }
    }
  }

  return lyapSum / (steps * dt);
}

/* ══════════════════════════════════════════════════════════
   Color utilities
   ══════════════════════════════════════════════════════════ */

function hslToRgb(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return `rgb(${r},${g},${b})`;
}

function trailColor(index: number, total: number): string {
  const t = total > 1 ? index / (total - 1) : 0;
  const h = 220 + t * 140; // blue -> green
  return hslToRgb(h, 0.8, 0.55);
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function StrangeAttractors() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false, lastX: 0, lastY: 0,
  });

  const [activeTab, setActiveTab] = useState<AttractorType>("lorenz");
  const [playing, setPlaying] = useState(true);
  const [dt, setDt] = useState(0.005);
  const [speed, setSpeed] = useState(4);
  const [trailLength, setTrailLength] = useState(3000);

  // Lorenz
  const [lorenz, setLorenz] = useState<LorenzParams>({ ...DEFAULT_LORENZ });
  const lorenzTrailRef = useRef<Vec3[]>([]);
  const lorenzStateRef = useRef<number[]>([1, 1, 1]);

  // Rossler
  const [rossler, setRossler] = useState<RosslerParams>({ ...DEFAULT_ROSSLER });
  const rosslerTrailRef = useRef<Vec3[]>([]);
  const rosslerStateRef = useRef<number[]>([1, 1, 0]);

  // Double pendulum
  const [dpParams, setDpParams] = useState<DoublePendulumParams>({ ...DEFAULT_DOUBLE_PENDULUM });
  const dpState1Ref = useRef<DoublePendulumState>({
    theta1: Math.PI / 2, theta2: Math.PI / 2, omega1: 0, omega2: 0,
  });
  const dpState2Ref = useRef<DoublePendulumState>({
    theta1: Math.PI / 2 + 0.001, theta2: Math.PI / 2, omega1: 0, omega2: 0,
  });
  const dpTrail1Ref = useRef<{ x: number; y: number }[]>([]);
  const dpTrail2Ref = useRef<{ x: number; y: number }[]>([]);
  const dpPhaseRef = useRef<{ x: number; y: number }[]>([]);

  // Henon
  const [henon, setHenon] = useState<HenonParams>({ ...DEFAULT_HENON });

  // Logistic
  const [logistic, setLogistic] = useState<LogisticParams>({ ...DEFAULT_LOGISTIC });
  // Camera
  const [camera, setCamera] = useState<Camera3D>({
    rotX: -0.5, rotY: 0.5, zoom: 5, autoRotate: true,
  });

  // Lyapunov exponent
  const [lyapunov, setLyapunov] = useState<number | null>(null);

  // Color mode
  const [colorMode, setColorMode] = useState<"time" | "speed">("time");

  const getColors = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return {
        bg: "#09090b", text: "#e4e4e7", muted: "#a1a1aa",
        primary: "#4f8ff7", accent: "#34d399", border: "#27272a",
        surface: "#111111", heading: "#ffffff",
      };
    }
    const cs = getComputedStyle(canvas);
    return {
      bg: cs.getPropertyValue("--color-bg").trim() || "#09090b",
      text: cs.getPropertyValue("--color-text").trim() || "#e4e4e7",
      muted: cs.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
      primary: cs.getPropertyValue("--color-primary").trim() || "#4f8ff7",
      accent: cs.getPropertyValue("--color-accent").trim() || "#34d399",
      border: cs.getPropertyValue("--color-border").trim() || "#27272a",
      surface: cs.getPropertyValue("--color-surface").trim() || "#111111",
      heading: cs.getPropertyValue("--color-heading").trim() || "#ffffff",
    };
  }, []);

  /* ── Reset state ── */

  const resetAttractor = useCallback(() => {
    lorenzStateRef.current = [1, 1, 1];
    lorenzTrailRef.current = [];
    rosslerStateRef.current = [1, 1, 0];
    rosslerTrailRef.current = [];

    const th1 = dpParams.theta1;
    const th2 = dpParams.theta2;
    dpState1Ref.current = { theta1: th1, theta2: th2, omega1: 0, omega2: 0 };
    dpState2Ref.current = { theta1: th1 + 0.001, theta2: th2, omega1: 0, omega2: 0 };
    dpTrail1Ref.current = [];
    dpTrail2Ref.current = [];
    dpPhaseRef.current = [];

    setLyapunov(null);
  }, [dpParams.theta1, dpParams.theta2]);

  /* ── Compute Lyapunov ── */

  const computeLyapunov = useCallback(() => {
    if (activeTab === "lorenz") {
      const p = lorenz;
      const lyap = estimateLyapunov(
        (s) => lorenzDerivs(s, p),
        [1, 1, 1],
        0.01,
        5000,
      );
      setLyapunov(lyap);
    } else if (activeTab === "rossler") {
      const p = rossler;
      const lyap = estimateLyapunov(
        (s) => rosslerDerivs(s, p),
        [1, 1, 0],
        0.01,
        5000,
      );
      setLyapunov(lyap);
    }
  }, [activeTab, lorenz, rossler]);

  /* ── Lorenz / Rossler rendering ── */

  const draw3DAttractor = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera3D) => {
      const colors = getColors();
      const isLorenz = activeTab === "lorenz";
      const trail = isLorenz ? lorenzTrailRef.current : rosslerTrailRef.current;
      const stateRef = isLorenz ? lorenzStateRef : rosslerStateRef;
      const trailRef = isLorenz ? lorenzTrailRef : rosslerTrailRef;
      const params = isLorenz ? lorenz : rossler;

      if (playing) {
        for (let i = 0; i < speed; i++) {
          const derivsFn = isLorenz
            ? (s: number[]) => lorenzDerivs(s, params as LorenzParams)
            : (s: number[]) => rosslerDerivs(s, params as RosslerParams);

          stateRef.current = rk4(stateRef.current, dt, derivsFn);
          const [x, y, z] = stateRef.current;

          // Divergence check
          if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(z) > 1e6) {
            stateRef.current = isLorenz ? [1, 1, 1] : [1, 1, 0];
            trailRef.current = [];
            break;
          }

          const center = isLorenz ? { x: 0, y: 0, z: 25 } : { x: 0, y: 0, z: 0 };
          trailRef.current.push({
            x: x - center.x,
            y: z - center.z, // map z -> y for vertical
            z: y - center.y,
          });

          if (trailRef.current.length > trailLength) {
            trailRef.current.shift();
          }
        }
      }

      // Auto-rotate
      if (cam.autoRotate && playing) {
        cam = { ...cam, rotY: cam.rotY + 0.003 };
        setCamera(cam);
      }

      // Clear
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Draw trail
      if (trail.length < 2) return;

      const cx = w / 2;
      const cy = h / 2;

      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";

      for (let i = 1; i < trail.length; i++) {
        const p1 = project3D(trail[i - 1], cam, cx, cy);
        const p2 = project3D(trail[i], cam, cx, cy);

        let color: string;
        if (colorMode === "speed" && i > 0) {
          const dx = trail[i].x - trail[i - 1].x;
          const dy = trail[i].y - trail[i - 1].y;
          const dz = trail[i].z - trail[i - 1].z;
          const spd = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const t = Math.min(spd / 2, 1);
          color = hslToRgb(220 + t * 140, 0.9, 0.45 + t * 0.2);
        } else {
          color = trailColor(i, trail.length);
        }

        // Depth-based opacity
        const avgDepth = (p1.depth + p2.depth) / 2;
        const opacity = Math.max(0.15, Math.min(1, 0.6 + avgDepth * 0.01));

        ctx.globalAlpha = opacity * (i / trail.length);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Draw current point
      if (trail.length > 0) {
        const last = trail[trail.length - 1];
        const proj = project3D(last, cam, cx, cy);
        ctx.fillStyle = colors.accent;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Axis labels
      ctx.font = "11px Inter, sans-serif";
      ctx.fillStyle = colors.muted;
      const axes = [
        { label: "X", vec: { x: 15, y: 0, z: 0 } },
        { label: "Y", vec: { x: 0, y: 15, z: 0 } },
        { label: "Z", vec: { x: 0, y: 0, z: 15 } },
      ];
      for (const ax of axes) {
        const p = project3D(ax.vec, cam, cx, cy);
        const o = project3D({ x: 0, y: 0, z: 0 }, cam, cx, cy);
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = colors.muted;
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.fillText(ax.label, p.x + 4, p.y - 4);
      }
      ctx.globalAlpha = 1;
    },
    [activeTab, playing, speed, dt, lorenz, rossler, trailLength, colorMode, getColors],
  );

  /* ── Double pendulum rendering ── */

  const drawDoublePendulum = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const colors = getColors();

      if (playing) {
        for (let s = 0; s < speed; s++) {
          // Pendulum 1
          const st1 = dpState1Ref.current;
          const arr1 = [st1.theta1, st1.theta2, st1.omega1, st1.omega2];
          const next1 = rk4(arr1, dt, (sv) => doublePendulumDerivs(sv, dpParams));
          dpState1Ref.current = { theta1: next1[0], theta2: next1[1], omega1: next1[2], omega2: next1[3] };

          // Pendulum 2 (slightly different initial conditions)
          const st2 = dpState2Ref.current;
          const arr2 = [st2.theta1, st2.theta2, st2.omega1, st2.omega2];
          const next2 = rk4(arr2, dt, (sv) => doublePendulumDerivs(sv, dpParams));
          dpState2Ref.current = { theta1: next2[0], theta2: next2[1], omega1: next2[2], omega2: next2[3] };

          // Compute bob positions for trail
          const scale = Math.min(w, h) * 0.18;
          const pivotX = w / 2;
          const pivotY = h * 0.35;

          // Pendulum 1 bob 2
          const x1_1 = pivotX + dpParams.l1 * scale * Math.sin(next1[0]);
          const y1_1 = pivotY + dpParams.l1 * scale * Math.cos(next1[0]);
          const x1_2 = x1_1 + dpParams.l2 * scale * Math.sin(next1[1]);
          const y1_2 = y1_1 + dpParams.l2 * scale * Math.cos(next1[1]);

          dpTrail1Ref.current.push({ x: x1_2, y: y1_2 });
          if (dpTrail1Ref.current.length > trailLength) dpTrail1Ref.current.shift();

          // Pendulum 2 bob 2
          const x2_1 = pivotX + dpParams.l1 * scale * Math.sin(next2[0]);
          const y2_1 = pivotY + dpParams.l1 * scale * Math.cos(next2[0]);
          const x2_2 = x2_1 + dpParams.l2 * scale * Math.sin(next2[1]);
          const y2_2 = y2_1 + dpParams.l2 * scale * Math.cos(next2[1]);

          dpTrail2Ref.current.push({ x: x2_2, y: y2_2 });
          if (dpTrail2Ref.current.length > trailLength) dpTrail2Ref.current.shift();

          // Phase space
          dpPhaseRef.current.push({ x: next1[0], y: next1[1] });
          if (dpPhaseRef.current.length > trailLength) dpPhaseRef.current.shift();
        }
      }

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      const scale = Math.min(w, h) * 0.18;
      const pivotX = w / 2;
      const pivotY = h * 0.35;

      // Draw trails
      const drawTrail = (trail: { x: number; y: number }[], color: string) => {
        if (trail.length < 2) return;
        for (let i = 1; i < trail.length; i++) {
          ctx.globalAlpha = (i / trail.length) * 0.6;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      };

      drawTrail(dpTrail1Ref.current, TRAIL_COLORS[0]);
      drawTrail(dpTrail2Ref.current, TRAIL_COLORS[3]);

      // Draw pendulums
      const drawPendulum = (state: DoublePendulumState, color: string) => {
        const x1 = pivotX + dpParams.l1 * scale * Math.sin(state.theta1);
        const y1 = pivotY + dpParams.l1 * scale * Math.cos(state.theta1);
        const x2 = x1 + dpParams.l2 * scale * Math.sin(state.theta2);
        const y2 = y1 + dpParams.l2 * scale * Math.cos(state.theta2);

        // Rods
        ctx.strokeStyle = colors.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY);
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Pivot
        ctx.fillStyle = colors.muted;
        ctx.beginPath();
        ctx.arc(pivotX, pivotY, 4, 0, Math.PI * 2);
        ctx.fill();

        // Bob 1
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x1, y1, 6 + dpParams.m1 * 3, 0, Math.PI * 2);
        ctx.fill();

        // Bob 2
        ctx.beginPath();
        ctx.arc(x2, y2, 6 + dpParams.m2 * 3, 0, Math.PI * 2);
        ctx.fill();
      };

      drawPendulum(dpState1Ref.current, TRAIL_COLORS[0]);
      drawPendulum(dpState2Ref.current, TRAIL_COLORS[3]);

      // Phase space mini-plot (bottom-right corner)
      const phaseW = 140;
      const phaseH = 140;
      const phaseX = w - phaseW - 16;
      const phaseY = h - phaseH - 16;

      ctx.fillStyle = colors.surface;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(phaseX, phaseY, phaseW, phaseH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(phaseX, phaseY, phaseW, phaseH);

      ctx.font = "10px Inter, sans-serif";
      ctx.fillStyle = colors.muted;
      ctx.fillText("Phase: th1 vs th2", phaseX + 4, phaseY + 12);

      const phase = dpPhaseRef.current;
      if (phase.length > 1) {
        const pcx = phaseX + phaseW / 2;
        const pcy = phaseY + phaseH / 2 + 6;
        const pscale = (phaseW - 20) / (2 * Math.PI);

        for (let i = 1; i < phase.length; i++) {
          ctx.globalAlpha = (i / phase.length) * 0.7;
          ctx.strokeStyle = TRAIL_COLORS[0];
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(pcx + phase[i - 1].x * pscale, pcy + phase[i - 1].y * pscale);
          ctx.lineTo(pcx + phase[i].x * pscale, pcy + phase[i].y * pscale);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Labels
      ctx.fillStyle = colors.muted;
      ctx.font = "10px Inter, sans-serif";
      ctx.fillText("Pendulum 1 (blue)", 12, h - 30);
      ctx.fillText("Pendulum 2 (red) -- delta theta = 0.001", 12, h - 16);
    },
    [playing, speed, dt, dpParams, trailLength, getColors],
  );

  /* ── Henon map rendering ── */

  const drawHenon = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const colors = getColors();
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      const { a, b } = henon;
      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.28;

      // Iterate Henon map
      const iterations = 30000;
      let x = 0.1;
      let y = 0.1;

      ctx.fillStyle = TRAIL_COLORS[0];

      for (let i = 0; i < iterations; i++) {
        const xNew = 1 - a * x * x + y;
        const yNew = b * x;
        x = xNew;
        y = yNew;

        if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6) break;

        if (i > 100) {
          const alpha = Math.min(1, i / 1000) * 0.6;
          ctx.globalAlpha = alpha;
          ctx.fillRect(cx + x * scale, cy - y * scale, 1.2, 1.2);
        }
      }

      ctx.globalAlpha = 1;

      // Labels
      ctx.font = "12px Inter, sans-serif";
      ctx.fillStyle = colors.muted;
      ctx.fillText(`Henon Map: a=${a.toFixed(2)}, b=${b.toFixed(2)}`, 12, 24);
      ctx.fillText("x_{n+1} = 1 - a*x^2 + y", 12, 42);
      ctx.fillText("y_{n+1} = b*x", 12, 58);

      // Axes
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    [henon, getColors],
  );

  /* ── Logistic map bifurcation rendering ── */

  const drawLogistic = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const colors = getColors();
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      const { rMin, rMax, rCurrent } = logistic;
      const padding = 40;
      const plotW = w - padding * 2;
      const plotH = h - padding * 2;

      // Draw bifurcation diagram
      const rSteps = Math.min(plotW * 2, 1200);
      const warmup = 200;
      const plotPoints = 100;

      for (let i = 0; i < rSteps; i++) {
        const r = rMin + (i / rSteps) * (rMax - rMin);
        let x = 0.5;

        // Warmup
        for (let j = 0; j < warmup; j++) {
          x = r * x * (1 - x);
        }

        // Plot stable values
        const px = padding + (i / rSteps) * plotW;
        ctx.fillStyle = TRAIL_COLORS[0];
        ctx.globalAlpha = 0.15;

        for (let j = 0; j < plotPoints; j++) {
          x = r * x * (1 - x);
          if (x >= 0 && x <= 1) {
            const py = padding + (1 - x) * plotH;
            ctx.fillRect(px, py, 1, 1);
          }
        }
      }

      ctx.globalAlpha = 1;

      // Axes
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, padding);
      ctx.lineTo(padding, padding + plotH);
      ctx.lineTo(padding + plotW, padding + plotH);
      ctx.stroke();

      // Axis labels
      ctx.font = "11px Inter, sans-serif";
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "center";
      ctx.fillText("r", w / 2, h - 8);
      ctx.textAlign = "left";

      // r ticks
      const tickCount = 6;
      for (let i = 0; i <= tickCount; i++) {
        const r = rMin + (i / tickCount) * (rMax - rMin);
        const px = padding + (i / tickCount) * plotW;
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "center";
        ctx.fillText(r.toFixed(2), px, padding + plotH + 16);
        ctx.strokeStyle = colors.border;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(px, padding);
        ctx.lineTo(px, padding + plotH);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // x ticks
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const val = i / 4;
        const py = padding + (1 - val) * plotH;
        ctx.fillStyle = colors.muted;
        ctx.fillText(val.toFixed(2), padding - 6, py + 4);
      }

      // Current r indicator line
      if (rCurrent >= rMin && rCurrent <= rMax) {
        const rx = padding + ((rCurrent - rMin) / (rMax - rMin)) * plotW;
        ctx.strokeStyle = TRAIL_COLORS[3];
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(rx, padding);
        ctx.lineTo(rx, padding + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // Time series mini-plot (top-right)
        const tsW = 180;
        const tsH = 100;
        const tsX = w - tsW - 16;
        const tsY = 16;

        ctx.fillStyle = colors.surface;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(tsX, tsY, tsW, tsH);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(tsX, tsY, tsW, tsH);

        ctx.font = "10px Inter, sans-serif";
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "left";
        ctx.fillText(`r = ${rCurrent.toFixed(3)}`, tsX + 4, tsY + 12);

        // Generate time series at current r
        let xn = 0.5;
        const series: number[] = [];
        for (let j = 0; j < 50; j++) {
          xn = rCurrent * xn * (1 - xn);
        }
        for (let j = 0; j < 60; j++) {
          xn = rCurrent * xn * (1 - xn);
          series.push(xn);
        }

        ctx.strokeStyle = TRAIL_COLORS[0];
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let j = 0; j < series.length; j++) {
          const sx = tsX + 4 + (j / (series.length - 1)) * (tsW - 8);
          const sy = tsY + tsH - 6 - series[j] * (tsH - 20);
          if (j === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }

      // Title
      ctx.font = "12px Inter, sans-serif";
      ctx.fillStyle = colors.muted;
      ctx.textAlign = "left";
      ctx.fillText("Logistic Map Bifurcation: x_{n+1} = r * x_n * (1 - x_n)", padding, padding - 10);

      // Click hint
      ctx.font = "10px Inter, sans-serif";
      ctx.fillStyle = colors.muted;
      ctx.globalAlpha = 0.5;
      ctx.fillText("Click to set r and see time series", padding, padding - 24);
      ctx.globalAlpha = 1;
    },
    [logistic, getColors],
  );

  /* ── Main animation loop ── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const tick = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      if (activeTab === "lorenz" || activeTab === "rossler") {
        draw3DAttractor(ctx, w, h, camera);
      } else if (activeTab === "double-pendulum") {
        drawDoublePendulum(ctx, w, h);
      } else if (activeTab === "henon") {
        drawHenon(ctx, w, h);
      } else if (activeTab === "logistic") {
        drawLogistic(ctx, w, h);
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, [activeTab, draw3DAttractor, drawDoublePendulum, drawHenon, drawLogistic, camera]);

  /* ── Mouse interaction for 3D rotation ── */

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (activeTab === "logistic") {
      // Click to set r value
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const padding = 40;
      const plotW = rect.width - padding * 2;
      const rFrac = (mx - padding) / plotW;
      if (rFrac >= 0 && rFrac <= 1) {
        const r = logistic.rMin + rFrac * (logistic.rMax - logistic.rMin);
        setLogistic((prev) => ({ ...prev, rCurrent: Math.round(r * 1000) / 1000 }));
      }
      return;
    }

    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
    if (camera.autoRotate) {
      setCamera((c) => ({ ...c, autoRotate: false }));
    }
  }, [activeTab, camera.autoRotate, logistic.rMin, logistic.rMax]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;

    setCamera((c) => ({
      ...c,
      rotY: c.rotY + dx * 0.01,
      rotX: c.rotX + dy * 0.01,
    }));
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.active = false;
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setCamera((c) => ({
      ...c,
      zoom: Math.max(1, Math.min(20, c.zoom - e.deltaY * 0.01)),
    }));
  }, []);

  /* ── Slider helper ── */

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
    <label class="flex flex-col gap-1">
      <span class="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
        <span>{label}</span>
        <span class="font-mono">{value.toFixed(step < 0.01 ? 4 : step < 1 ? 2 : 0)}{unit ?? ""}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
        class="accent-[var(--color-primary)]"
      />
    </label>
  );

  /* ── Tab switch handler ── */

  const switchTab = useCallback(
    (tab: AttractorType) => {
      setActiveTab(tab);
      setLyapunov(null);
      if (tab === "lorenz" || tab === "rossler") {
        setCamera({ rotX: -0.5, rotY: 0.5, zoom: 5, autoRotate: true });
      }
    },
    [],
  );

  /* ── Controls panel ── */

  const renderControls = () => {
    switch (activeTab) {
      case "lorenz":
        return (
          <>
            <Slider label="sigma" value={lorenz.sigma} min={0} max={30} step={0.1}
              onChange={(v) => setLorenz((p) => ({ ...p, sigma: v }))} />
            <Slider label="rho" value={lorenz.rho} min={0} max={50} step={0.1}
              onChange={(v) => setLorenz((p) => ({ ...p, rho: v }))} />
            <Slider label="beta" value={lorenz.beta} min={0} max={10} step={0.01}
              onChange={(v) => setLorenz((p) => ({ ...p, beta: v }))} />
          </>
        );
      case "rossler":
        return (
          <>
            <Slider label="a" value={rossler.a} min={0} max={1} step={0.01}
              onChange={(v) => setRossler((p) => ({ ...p, a: v }))} />
            <Slider label="b" value={rossler.b} min={0} max={1} step={0.01}
              onChange={(v) => setRossler((p) => ({ ...p, b: v }))} />
            <Slider label="c" value={rossler.c} min={1} max={20} step={0.1}
              onChange={(v) => setRossler((p) => ({ ...p, c: v }))} />
          </>
        );
      case "double-pendulum":
        return (
          <>
            <Slider label="Mass 1" value={dpParams.m1} min={0.5} max={3} step={0.1}
              onChange={(v) => setDpParams((p) => ({ ...p, m1: v }))} />
            <Slider label="Mass 2" value={dpParams.m2} min={0.5} max={3} step={0.1}
              onChange={(v) => setDpParams((p) => ({ ...p, m2: v }))} />
            <Slider label="Length 1" value={dpParams.l1} min={0.5} max={2} step={0.1}
              onChange={(v) => setDpParams((p) => ({ ...p, l1: v }))} />
            <Slider label="Length 2" value={dpParams.l2} min={0.5} max={2} step={0.1}
              onChange={(v) => setDpParams((p) => ({ ...p, l2: v }))} />
            <Slider label="Initial theta 1" value={dpParams.theta1} min={-Math.PI} max={Math.PI} step={0.01}
              onChange={(v) => setDpParams((p) => ({ ...p, theta1: v }))} unit=" rad" />
            <Slider label="Initial theta 2" value={dpParams.theta2} min={-Math.PI} max={Math.PI} step={0.01}
              onChange={(v) => setDpParams((p) => ({ ...p, theta2: v }))} unit=" rad" />
          </>
        );
      case "henon":
        return (
          <>
            <Slider label="a" value={henon.a} min={0.5} max={2} step={0.01}
              onChange={(v) => setHenon((p) => ({ ...p, a: v }))} />
            <Slider label="b" value={henon.b} min={0} max={0.5} step={0.01}
              onChange={(v) => setHenon((p) => ({ ...p, b: v }))} />
          </>
        );
      case "logistic":
        return (
          <>
            <Slider label="r min" value={logistic.rMin} min={0} max={3.5} step={0.01}
              onChange={(v) => setLogistic((p) => ({ ...p, rMin: v }))} />
            <Slider label="r max" value={logistic.rMax} min={3} max={4} step={0.01}
              onChange={(v) => setLogistic((p) => ({ ...p, rMax: v }))} />
            <Slider label="r current" value={logistic.rCurrent} min={logistic.rMin} max={logistic.rMax} step={0.001}
              onChange={(v) => setLogistic((p) => ({ ...p, rCurrent: v }))} />
          </>
        );
    }
  };

  const show3DControls = activeTab === "lorenz" || activeTab === "rossler";
  const showPlayControls = activeTab !== "henon";

  return (
    <div class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
      {/* Tab bar */}
      <div class="flex flex-wrap border-b border-[var(--color-border)]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            class={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors sm:px-5 ${
              activeTab === tab.id
                ? "border-b-2 border-[var(--color-primary)] text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
            }`}
          >
            <span class="mr-1 font-mono text-[10px] opacity-60">{tab.icon}</span>
            <span class="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      <div class="flex flex-col lg:flex-row">
        {/* Canvas */}
        <div class="relative min-h-[400px] flex-1 lg:min-h-[520px]">
          <canvas
            ref={canvasRef}
            class="h-full w-full cursor-grab active:cursor-grabbing"
            style="display:block"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />

          {/* Lyapunov badge */}
          {lyapunov !== null && (activeTab === "lorenz" || activeTab === "rossler") && (
            <div class="absolute left-3 top-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[10px]">
              <span class="text-[var(--color-text-muted)]">Lyapunov: </span>
              <span class={`font-mono font-bold ${lyapunov > 0 ? "text-[#ef4444]" : "text-[#34d399]"}`}>
                {lyapunov.toFixed(4)}
              </span>
              <span class="ml-1 text-[var(--color-text-muted)]">
                {lyapunov > 0 ? "(chaotic)" : "(stable)"}
              </span>
            </div>
          )}
        </div>

        {/* Controls panel */}
        <div class="w-full border-t border-[var(--color-border)] p-4 lg:w-64 lg:border-l lg:border-t-0">
          {/* Playback */}
          {showPlayControls && (
            <div class="mb-4 flex items-center gap-2">
              <button
                onClick={() => setPlaying((p) => !p)}
                class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-heading)] transition-colors hover:border-[var(--color-primary)]"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <button
                onClick={resetAttractor}
                class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
              >
                Reset
              </button>
            </div>
          )}

          {/* Speed + dt + trail */}
          {showPlayControls && (
            <div class="mb-4 space-y-2">
              <Slider label="Speed" value={speed} min={1} max={20} step={1}
                onChange={(v) => setSpeed(v)} unit="x" />
              <Slider label="dt" value={dt} min={0.001} max={0.02} step={0.001}
                onChange={(v) => setDt(v)} />
              {activeTab !== "logistic" && (
                <Slider label="Trail length" value={trailLength} min={500} max={10000} step={100}
                  onChange={(v) => setTrailLength(v)} />
              )}
            </div>
          )}

          {/* 3D camera controls */}
          {show3DControls && (
            <div class="mb-4 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Camera
                </span>
                <label class="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)]">
                  <input
                    type="checkbox"
                    checked={camera.autoRotate}
                    onChange={(e) =>
                      setCamera((c) => ({ ...c, autoRotate: (e.target as HTMLInputElement).checked }))
                    }
                    class="accent-[var(--color-primary)]"
                  />
                  Auto-rotate
                </label>
              </div>
              <Slider label="Zoom" value={camera.zoom} min={1} max={20} step={0.5}
                onChange={(v) => setCamera((c) => ({ ...c, zoom: v }))} />
            </div>
          )}

          {/* Color mode for 3D */}
          {show3DControls && (
            <div class="mb-4">
              <span class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                Color
              </span>
              <div class="flex gap-1">
                {(["time", "speed"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setColorMode(mode)}
                    class={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors ${
                      colorMode === mode
                        ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Lyapunov button */}
          {(activeTab === "lorenz" || activeTab === "rossler") && (
            <div class="mb-4">
              <button
                onClick={computeLyapunov}
                class="w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-heading)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                Compute Lyapunov Exponent
              </button>
            </div>
          )}

          {/* Divider */}
          <div class="mb-3 border-t border-[var(--color-border)]" />

          {/* Attractor-specific params */}
          <div class="space-y-2">
            <span class="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Parameters
            </span>
            {renderControls()}
          </div>

          {/* Reset params button */}
          <button
            onClick={() => {
              switch (activeTab) {
                case "lorenz": setLorenz({ ...DEFAULT_LORENZ }); break;
                case "rossler": setRossler({ ...DEFAULT_ROSSLER }); break;
                case "double-pendulum": setDpParams({ ...DEFAULT_DOUBLE_PENDULUM }); break;
                case "henon": setHenon({ ...DEFAULT_HENON }); break;
                case "logistic": setLogistic({ ...DEFAULT_LOGISTIC }); break;
              }
              resetAttractor();
            }}
            class="mt-3 w-full rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[10px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          >
            Reset Parameters
          </button>

          {/* Info */}
          <div class="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              About
            </span>
            {activeTab === "lorenz" && (
              <p class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                The Lorenz attractor is a set of chaotic solutions to the Lorenz system,
                first studied by Edward Lorenz in 1963. It is notable for having chaotic
                solutions for certain parameter values and initial conditions -- the famous
                butterfly shape. Default: sigma=10, rho=28, beta=8/3.
              </p>
            )}
            {activeTab === "rossler" && (
              <p class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                The Rossler attractor is a system of three non-linear ODEs originally studied
                by Otto Rossler in 1976. It was designed as the simplest system showing chaotic
                behavior with a single quadratic nonlinearity (xz term).
              </p>
            )}
            {activeTab === "double-pendulum" && (
              <p class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                A double pendulum is a pendulum attached to the end of another pendulum.
                Two pendulums with nearly identical initial conditions (delta=0.001 rad)
                diverge rapidly, demonstrating sensitive dependence on initial conditions.
                Phase space plot shows theta1 vs theta2.
              </p>
            )}
            {activeTab === "henon" && (
              <p class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                The Henon map is a discrete-time dynamical system introduced by Michel Henon
                in 1976 as a simplified model of the Poincare section of the Lorenz model.
                Classic parameters: a=1.4, b=0.3 produce a strange attractor.
              </p>
            )}
            {activeTab === "logistic" && (
              <p class="mt-1 text-[10px] leading-relaxed text-[var(--color-text-muted)]">
                The logistic map x_n+1 = r*x_n*(1-x_n) shows period-doubling bifurcation
                as r increases. The Feigenbaum constant (delta ~ 4.669) governs the ratio
                of successive bifurcation intervals. Click to set r and see time series.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
