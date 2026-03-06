import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

type SimMode = "ode" | "agent";
type ModelType = "sir" | "seir" | "sird";
type PlayState = "idle" | "running" | "paused";

const AGENT_STATE_SUSCEPTIBLE = 0 as const;
const AGENT_STATE_EXPOSED = 1 as const;
const AGENT_STATE_INFECTED = 2 as const;
const AGENT_STATE_RECOVERED = 3 as const;
const AGENT_STATE_DEAD = 4 as const;

type AgentHealthState =
  | typeof AGENT_STATE_SUSCEPTIBLE
  | typeof AGENT_STATE_EXPOSED
  | typeof AGENT_STATE_INFECTED
  | typeof AGENT_STATE_RECOVERED
  | typeof AGENT_STATE_DEAD;

interface Agent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  state: AgentHealthState;
  infectedAt: number;
  exposedAt: number;
}

interface EpidemicParams {
  beta: number;
  gamma: number;
  populationSize: number;
  initialInfected: number;
  vaccinationRate: number;
  quarantine: boolean;
  socialDistancing: number;
  mortalityRate: number;
  incubationRate: number;
}

interface CompartmentSnapshot {
  s: number;
  e: number;
  i: number;
  r: number;
  d: number;
  rEff: number;
}

interface Preset {
  name: string;
  description: string;
  params: Partial<EpidemicParams>;
  model: ModelType;
}

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const DEFAULT_PARAMS: EpidemicParams = {
  beta: 0.3,
  gamma: 0.1,
  populationSize: 500,
  initialInfected: 5,
  vaccinationRate: 0,
  quarantine: false,
  socialDistancing: 0,
  mortalityRate: 0.02,
  incubationRate: 0.2,
};

const PRESETS: Preset[] = [
  {
    name: "Common Cold",
    description: "High R0, very low mortality",
    params: { beta: 0.5, gamma: 0.14, mortalityRate: 0.001, incubationRate: 0.5 },
    model: "sir",
  },
  {
    name: "Severe Pandemic",
    description: "Moderate R0, high mortality",
    params: { beta: 0.25, gamma: 0.05, mortalityRate: 0.1, incubationRate: 0.15 },
    model: "sird",
  },
  {
    name: "Measles",
    description: "Very high R0, vaccine-preventable",
    params: { beta: 0.9, gamma: 0.07, mortalityRate: 0.002, incubationRate: 0.1 },
    model: "seir",
  },
  {
    name: "With Vaccination",
    description: "50% vaccinated population",
    params: { beta: 0.3, gamma: 0.1, vaccinationRate: 0.5, mortalityRate: 0.02 },
    model: "sir",
  },
  {
    name: "Lockdown",
    description: "80% social distancing",
    params: { beta: 0.3, gamma: 0.1, socialDistancing: 0.8, mortalityRate: 0.02 },
    model: "sir",
  },
];

const INFECTION_RADIUS = 15;
const AGENT_RADIUS = 3;
const AGENT_SPEED = 1.2;
const ODE_DT = 0.1;
const ODE_STEPS_PER_FRAME = 4;
const MAX_HISTORY = 600;
const CHART_HEIGHT = 160;
const CHART_PADDING = { top: 10, right: 10, bottom: 24, left: 40 };
const ODE_POPULATION = 1000;

const STATE_COLORS = {
  susceptible: "#22c55e",
  exposed: "#f59e0b",
  infected: "#ef4444",
  recovered: "#3b82f6",
  dead: "#6b7280",
};

/* ══════════════════════════════════════════════════════════
   Color helpers
   ══════════════════════════════════════════════════════════ */

function getCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/* ══════════════════════════════════════════════════════════
   ODE Engine (pure functions)
   ══════════════════════════════════════════════════════════ */

type ODEState = number[];
type ODEDerivFn = (state: ODEState) => ODEState;

function rk4(state: ODEState, dt: number, derivFn: ODEDerivFn): ODEState {
  const k1 = derivFn(state);
  const s2 = state.map((v, idx) => v + 0.5 * dt * k1[idx]);
  const k2 = derivFn(s2);
  const s3 = state.map((v, idx) => v + 0.5 * dt * k2[idx]);
  const k3 = derivFn(s3);
  const s4 = state.map((v, idx) => v + dt * k3[idx]);
  const k4 = derivFn(s4);
  return state.map((v, idx) =>
    Math.max(0, v + (dt / 6) * (k1[idx] + 2 * k2[idx] + 2 * k3[idx] + k4[idx])),
  );
}

function sirDerivatives(beta: number, gamma: number, n: number): ODEDerivFn {
  return ([s, i, _r]) => {
    const infection = (beta * s * i) / n;
    const recovery = gamma * i;
    return [-infection, infection - recovery, recovery];
  };
}

function seirDerivatives(beta: number, gamma: number, sigma: number, n: number): ODEDerivFn {
  return ([s, e, i, _r]) => {
    const infection = (beta * s * i) / n;
    const incubation = sigma * e;
    const recovery = gamma * i;
    return [-infection, infection - incubation, incubation - recovery, recovery];
  };
}

function sirdDerivatives(beta: number, gamma: number, mu: number, n: number): ODEDerivFn {
  return ([s, i, _r, _d]) => {
    const infection = (beta * s * i) / n;
    const recovery = gamma * (1 - mu) * i;
    const death = gamma * mu * i;
    return [-infection, infection - recovery - death, recovery, death];
  };
}

function computeREffective(beta: number, gamma: number, susceptibleFraction: number): number {
  if (gamma === 0) return 0;
  return (beta / gamma) * susceptibleFraction;
}

function buildDerivFn(
  model: ModelType,
  effectiveBeta: number,
  gamma: number,
  incubationRate: number,
  mortalityRate: number,
  pop: number,
): ODEDerivFn {
  switch (model) {
    case "sir": return sirDerivatives(effectiveBeta, gamma, pop);
    case "seir": return seirDerivatives(effectiveBeta, gamma, incubationRate, pop);
    case "sird": return sirdDerivatives(effectiveBeta, gamma, mortalityRate, pop);
  }
}

function odeStateToSnapshot(state: ODEState, model: ModelType, beta: number, gamma: number, pop: number): CompartmentSnapshot {
  switch (model) {
    case "sir":
      return {
        s: state[0], e: 0, i: state[1], r: state[2], d: 0,
        rEff: computeREffective(beta, gamma, state[0] / pop),
      };
    case "seir":
      return {
        s: state[0], e: state[1], i: state[2], r: state[3], d: 0,
        rEff: computeREffective(beta, gamma, state[0] / pop),
      };
    case "sird":
      return {
        s: state[0], e: 0, i: state[1], r: state[2], d: state[3],
        rEff: computeREffective(beta, gamma, state[0] / pop),
      };
  }
}

function initOdeState(model: ModelType, pop: number, infected: number, vaccinated: number): ODEState {
  const susceptible = pop - vaccinated - infected;
  switch (model) {
    case "sir": return [susceptible, infected, vaccinated];
    case "seir": return [susceptible, 0, infected, vaccinated];
    case "sird": return [susceptible, infected, vaccinated, 0];
  }
}

/* ══════════════════════════════════════════════════════════
   Agent Engine
   ══════════════════════════════════════════════════════════ */

function createAgents(
  count: number,
  initialInfected: number,
  vaccinationRate: number,
  width: number,
  height: number,
): Agent[] {
  const agents: Agent[] = [];
  const vaccinated = Math.floor(count * vaccinationRate);

  for (let idx = 0; idx < count; idx++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = AGENT_SPEED * (0.5 + Math.random() * 0.5);
    agents.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      state: AGENT_STATE_SUSCEPTIBLE,
      infectedAt: -1,
      exposedAt: -1,
    });
  }

  for (let idx = 0; idx < vaccinated; idx++) {
    agents[idx].state = AGENT_STATE_RECOVERED;
  }

  let infected = 0;
  for (let idx = vaccinated; idx < count && infected < initialInfected; idx++) {
    agents[idx].state = AGENT_STATE_INFECTED;
    agents[idx].infectedAt = 0;
    infected++;
  }

  return agents;
}

function moveAgents(agents: Agent[], params: EpidemicParams, width: number, height: number): void {
  const speedMultiplier = 1 - params.socialDistancing;
  for (const agent of agents) {
    if (agent.state === AGENT_STATE_DEAD) continue;
    if (params.quarantine && agent.state === AGENT_STATE_INFECTED) continue;

    agent.x += agent.vx * speedMultiplier;
    agent.y += agent.vy * speedMultiplier;

    if (agent.x < 0 || agent.x > width) {
      agent.vx *= -1;
      agent.x = Math.max(0, Math.min(width, agent.x));
    }
    if (agent.y < 0 || agent.y > height) {
      agent.vy *= -1;
      agent.y = Math.max(0, Math.min(height, agent.y));
    }

    if (Math.random() < 0.02) {
      const angle = Math.random() * Math.PI * 2;
      const speed = AGENT_SPEED * (0.5 + Math.random() * 0.5);
      agent.vx = Math.cos(angle) * speed;
      agent.vy = Math.sin(angle) * speed;
    }
  }
}

function spreadInfection(agents: Agent[], beta: number, tick: number, useExposed: boolean): void {
  const radiusSq = INFECTION_RADIUS * INFECTION_RADIUS;
  const infectionProb = beta * 0.1;

  for (let a = 0; a < agents.length; a++) {
    if (agents[a].state !== AGENT_STATE_SUSCEPTIBLE) continue;

    for (let b = 0; b < agents.length; b++) {
      if (agents[b].state !== AGENT_STATE_INFECTED) continue;

      const dx = agents[a].x - agents[b].x;
      const dy = agents[a].y - agents[b].y;
      if (dx * dx + dy * dy < radiusSq && Math.random() < infectionProb) {
        if (useExposed) {
          agents[a].state = AGENT_STATE_EXPOSED;
          agents[a].exposedAt = tick;
        } else {
          agents[a].state = AGENT_STATE_INFECTED;
          agents[a].infectedAt = tick;
        }
        break;
      }
    }
  }
}

function transitionExposed(agents: Agent[], tick: number, incubationRate: number): void {
  const incubationTicks = incubationRate > 0 ? Math.round(1 / incubationRate) * 10 : 50;
  for (const agent of agents) {
    if (agent.state === AGENT_STATE_EXPOSED && tick - agent.exposedAt > incubationTicks) {
      agent.state = AGENT_STATE_INFECTED;
      agent.infectedAt = tick;
    }
  }
}

function transitionRecovery(agents: Agent[], tick: number, gamma: number, mortalityRate: number): void {
  const recoveryTicks = gamma > 0 ? Math.round(1 / gamma) * 10 : 100;
  for (const agent of agents) {
    if (agent.state === AGENT_STATE_INFECTED && tick - agent.infectedAt > recoveryTicks) {
      agent.state = Math.random() < mortalityRate ? AGENT_STATE_DEAD : AGENT_STATE_RECOVERED;
    }
  }
}

function updateAgents(
  agents: Agent[],
  params: EpidemicParams,
  tick: number,
  width: number,
  height: number,
  useExposed: boolean,
): void {
  moveAgents(agents, params, width, height);
  const effectiveBeta = params.beta * (1 - params.socialDistancing);
  spreadInfection(agents, effectiveBeta, tick, useExposed);
  if (useExposed) transitionExposed(agents, tick, params.incubationRate);
  transitionRecovery(agents, tick, params.gamma, params.mortalityRate);
}

function countAgentStates(agents: Agent[], beta: number, gamma: number): CompartmentSnapshot {
  let s = 0, e = 0, i = 0, r = 0, d = 0;
  for (const agent of agents) {
    switch (agent.state) {
      case AGENT_STATE_SUSCEPTIBLE: s++; break;
      case AGENT_STATE_EXPOSED: e++; break;
      case AGENT_STATE_INFECTED: i++; break;
      case AGENT_STATE_RECOVERED: r++; break;
      case AGENT_STATE_DEAD: d++; break;
    }
  }
  const n = agents.length;
  return { s, e, i, r, d, rEff: n > 0 ? computeREffective(beta, gamma, s / n) : 0 };
}

/* ══════════════════════════════════════════════════════════
   Chart Drawing
   ══════════════════════════════════════════════════════════ */

function drawLineChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  history: CompartmentSnapshot[],
  modelType: ModelType,
  populationSize: number,
): void {
  const bgColor = getCssVar("--color-surface", "#111111");
  const borderColor = getCssVar("--color-border", "#27272a");
  const textColor = getCssVar("--color-text-muted", "#a1a1aa");

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  if (history.length < 2) {
    ctx.fillStyle = textColor;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for data...", width / 2, height / 2);
    return;
  }

  const { top: pt, right: pr, bottom: pb, left: pl } = CHART_PADDING;
  const chartW = width - pl - pr;
  const chartH = height - pt - pb;

  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 0.5;
  for (let frac = 0; frac <= 1; frac += 0.25) {
    const y = pt + chartH * (1 - frac);
    ctx.beginPath();
    ctx.moveTo(pl, y);
    ctx.lineTo(pl + chartW, y);
    ctx.stroke();
  }

  ctx.fillStyle = textColor;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let frac = 0; frac <= 1; frac += 0.25) {
    const y = pt + chartH * (1 - frac);
    ctx.fillText(`${Math.round(frac * populationSize)}`, pl - 4, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Time", width / 2, height - 10);

  const maxLen = history.length;
  const xScale = chartW / Math.max(maxLen - 1, 1);

  const series: Array<{ key: keyof CompartmentSnapshot; color: string; show: boolean }> = [
    { key: "s", color: STATE_COLORS.susceptible, show: true },
    { key: "e", color: STATE_COLORS.exposed, show: modelType === "seir" },
    { key: "i", color: STATE_COLORS.infected, show: true },
    { key: "r", color: STATE_COLORS.recovered, show: true },
    { key: "d", color: STATE_COLORS.dead, show: modelType === "sird" },
  ];

  ctx.lineWidth = 2;
  for (const { key, color, show } of series) {
    if (!show) continue;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let idx = 0; idx < maxLen; idx++) {
      const x = pl + idx * xScale;
      const y = pt + chartH * (1 - (history[idx][key] as number) / populationSize);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function drawREffChart(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  history: CompartmentSnapshot[],
): void {
  const bgColor = getCssVar("--color-surface", "#111111");
  const primaryColor = getCssVar("--color-primary", "#4f8ff7");
  const textColor = getCssVar("--color-text-muted", "#a1a1aa");

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  if (history.length < 2) return;

  const { top: pt, right: pr, bottom: pb, left: pl } = CHART_PADDING;
  const chartW = width - pl - pr;
  const chartH = height - pt - pb;
  const maxREff = Math.max(4, ...history.map((h) => h.rEff));

  // R=1 threshold line
  const thresholdY = pt + chartH * (1 - 1 / maxREff);
  ctx.strokeStyle = STATE_COLORS.infected;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pl, thresholdY);
  ctx.lineTo(pl + chartW, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = STATE_COLORS.infected;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("R=1", pl + 4, thresholdY - 2);

  ctx.fillStyle = textColor;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const step = Math.max(1, Math.ceil(maxREff / 4));
  for (let val = 0; val <= maxREff; val += step) {
    const y = pt + chartH * (1 - val / maxREff);
    ctx.fillText(`${val}`, pl - 4, y);
  }

  const maxLen = history.length;
  const xScale = chartW / Math.max(maxLen - 1, 1);
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let idx = 0; idx < maxLen; idx++) {
    const x = pl + idx * xScale;
    const y = pt + chartH * (1 - Math.min(history[idx].rEff, maxREff) / maxREff);
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawAgentCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  agents: Agent[],
): void {
  const bgColor = getCssVar("--color-surface", "#111111");
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);

  for (const agent of agents) {
    let color: string;
    switch (agent.state) {
      case AGENT_STATE_SUSCEPTIBLE: color = STATE_COLORS.susceptible; break;
      case AGENT_STATE_EXPOSED: color = STATE_COLORS.exposed; break;
      case AGENT_STATE_INFECTED: color = STATE_COLORS.infected; break;
      case AGENT_STATE_RECOVERED: color = STATE_COLORS.recovered; break;
      case AGENT_STATE_DEAD: color = STATE_COLORS.dead; break;
    }

    if (agent.state === AGENT_STATE_INFECTED) {
      ctx.beginPath();
      ctx.arc(agent.x, agent.y, INFECTION_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(239, 68, 68, 0.06)";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(agent.x, agent.y, AGENT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

/* ══════════════════════════════════════════════════════════
   Sub-components
   ══════════════════════════════════════════════════════════ */

function StackedBar({ snapshot, model, total }: {
  snapshot: CompartmentSnapshot;
  model: ModelType;
  total: number;
}): preact.JSX.Element {
  if (total === 0) return <div />;
  const pct = (v: number) => ((v / total) * 100).toFixed(1);
  const segments: Array<{ label: string; value: number; color: string }> = [
    { label: "S", value: snapshot.s, color: STATE_COLORS.susceptible },
  ];
  if (model === "seir") segments.push({ label: "E", value: snapshot.e, color: STATE_COLORS.exposed });
  segments.push({ label: "I", value: snapshot.i, color: STATE_COLORS.infected });
  segments.push({ label: "R", value: snapshot.r, color: STATE_COLORS.recovered });
  if (model === "sird") segments.push({ label: "D", value: snapshot.d, color: STATE_COLORS.dead });

  return (
    <div class="space-y-1">
      <div class="flex h-5 overflow-hidden rounded-full" style={{ background: "var(--color-border)" }}>
        {segments.map((seg) => {
          const w = (seg.value / total) * 100;
          if (w < 0.1) return null;
          return (
            <div
              key={seg.label}
              style={{ width: `${w}%`, background: seg.color, transition: "width 0.15s ease" }}
              title={`${seg.label}: ${Math.round(seg.value)} (${pct(seg.value)}%)`}
            />
          );
        })}
      </div>
      <div class="flex flex-wrap gap-3 text-[10px]">
        {segments.map((seg) => (
          <span key={seg.label} class="flex items-center gap-1">
            <span class="inline-block h-2 w-2 rounded-full" style={{ background: seg.color }} />
            {seg.label}: {Math.round(seg.value)} ({pct(seg.value)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: {
  label: string;
  value: number;
  color: string;
}): preact.JSX.Element {
  return (
    <div class="rounded-lg border border-[var(--color-border)] p-2.5 text-center">
      <div class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{label}</div>
      <div class="mt-0.5 text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function SliderControl({ label, value, min, max, step, unit, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}): preact.JSX.Element {
  const display = unit === "%" ? `${(value * 100).toFixed(0)}%` : value.toFixed(2);
  return (
    <label class="block">
      <span class="flex justify-between text-[11px] text-[var(--color-text-muted)]">
        <span>{label}</span>
        <span class="font-mono">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))}
        class="mt-1 w-full accent-[var(--color-primary)]"
      />
    </label>
  );
}

/* ══════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════ */

export default function EpidemicSim(): preact.JSX.Element {
  const [mode, setMode] = useState<SimMode>("ode");
  const [model, setModel] = useState<ModelType>("sir");
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [params, setParams] = useState<EpidemicParams>({ ...DEFAULT_PARAMS });
  const [history, setHistory] = useState<CompartmentSnapshot[]>([]);
  const [currentSnapshot, setCurrentSnapshot] = useState<CompartmentSnapshot>({
    s: 0, e: 0, i: 0, r: 0, d: 0, rEff: 0,
  });

  const agentCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartCanvasRef = useRef<HTMLCanvasElement>(null);
  const reffCanvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef<Agent[]>([]);
  const odeStateRef = useRef<ODEState>([]);
  const tickRef = useRef(0);
  const historyRef = useRef<CompartmentSnapshot[]>([]);
  const animRef = useRef<number>(0);
  const presetCounterRef = useRef(0);
  const [presetTrigger, setPresetTrigger] = useState(0);

  const getPopulation = useCallback((): number => {
    return mode === "agent" ? params.populationSize : ODE_POPULATION;
  }, [mode, params.populationSize]);

  const computeSnapshot = useCallback((): CompartmentSnapshot => {
    const pop = getPopulation();
    if (mode === "ode") {
      return odeStateToSnapshot(odeStateRef.current, model, params.beta, params.gamma, pop);
    }
    return countAgentStates(agentsRef.current, params.beta, params.gamma);
  }, [mode, model, params.beta, params.gamma, getPopulation]);

  const resetSimulation = useCallback(() => {
    const pop = getPopulation();
    tickRef.current = 0;
    historyRef.current = [];
    setHistory([]);

    if (mode === "ode") {
      const vaccinated = Math.floor(pop * params.vaccinationRate);
      odeStateRef.current = initOdeState(model, pop, params.initialInfected, vaccinated);
    } else {
      const canvas = agentCanvasRef.current;
      const w = canvas?.width ?? 600;
      const h = canvas?.height ?? 400;
      agentsRef.current = createAgents(pop, params.initialInfected, params.vaccinationRate, w, h);
    }

    const snap = computeSnapshot();
    setCurrentSnapshot(snap);
  }, [mode, model, params, getPopulation, computeSnapshot]);

  const step = useCallback(() => {
    const pop = getPopulation();
    tickRef.current++;

    if (mode === "ode") {
      const derivFn = buildDerivFn(
        model,
        params.beta * (1 - params.socialDistancing),
        params.gamma,
        params.incubationRate,
        params.mortalityRate,
        pop,
      );
      for (let s = 0; s < ODE_STEPS_PER_FRAME; s++) {
        odeStateRef.current = rk4(odeStateRef.current, ODE_DT, derivFn);
      }
    } else {
      const canvas = agentCanvasRef.current;
      updateAgents(
        agentsRef.current,
        params,
        tickRef.current,
        canvas?.width ?? 600,
        canvas?.height ?? 400,
        model === "seir",
      );
    }

    const snap = computeSnapshot();
    setCurrentSnapshot(snap);

    historyRef.current.push(snap);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    setHistory([...historyRef.current]);
  }, [mode, model, params, getPopulation, computeSnapshot]);

  // Animation loop
  useEffect(() => {
    if (playState !== "running") return;
    let running = true;
    const animate = () => {
      if (!running) return;
      step();
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [playState, step]);

  // Draw agent canvas
  useEffect(() => {
    if (mode !== "agent") return;
    const canvas = agentCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawAgentCanvas(ctx, canvas.width, canvas.height, agentsRef.current);
  }, [mode, currentSnapshot]);

  // Draw charts
  useEffect(() => {
    const chartCanvas = chartCanvasRef.current;
    if (chartCanvas) {
      const ctx = chartCanvas.getContext("2d");
      if (ctx) drawLineChart(ctx, chartCanvas.width, chartCanvas.height, history, model, getPopulation());
    }
    const reffCanvas = reffCanvasRef.current;
    if (reffCanvas) {
      const ctx = reffCanvas.getContext("2d");
      if (ctx) drawREffChart(ctx, reffCanvas.width, reffCanvas.height, history);
    }
  }, [history, model, getPopulation]);

  // Reset on mode/model/preset change
  useEffect(() => {
    setPlayState("idle");
    resetSimulation();
  }, [mode, model, presetTrigger]);

  const handlePlay = () => {
    if (playState === "idle") resetSimulation();
    setPlayState("running");
  };

  const handlePreset = (preset: Preset) => {
    setPlayState("idle");
    setModel(preset.model);
    setParams((prev) => ({ ...prev, ...preset.params }));
    presetCounterRef.current++;
    setPresetTrigger(presetCounterRef.current);
  };

  const updateParam = <K extends keyof EpidemicParams>(key: K, value: EpidemicParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const r0Display = params.gamma > 0 ? (params.beta / params.gamma).toFixed(2) : "N/A";

  return (
    <div class="space-y-6">
      {/* Mode & Model selector */}
      <div class="flex flex-wrap items-center gap-4">
        <div class="flex overflow-hidden rounded-lg border border-[var(--color-border)]">
          {(["ode", "agent"] as const).map((m) => (
            <button
              key={m}
              class={`px-4 py-2 text-xs font-medium transition-colors ${
                mode === m
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
              }`}
              onClick={() => setMode(m)}
            >
              {m === "ode" ? "ODE Model" : "Agent-Based"}
            </button>
          ))}
        </div>

        <div class="flex overflow-hidden rounded-lg border border-[var(--color-border)]">
          {(["sir", "seir", "sird"] as const).map((m) => (
            <button
              key={m}
              class={`px-3 py-2 text-xs font-medium uppercase transition-colors ${
                model === m
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
              }`}
              onClick={() => setModel(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <div class="ml-auto flex items-center gap-2">
          <span class="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)]">
            R<sub>0</sub> = {r0Display}
          </span>
          <span
            class="rounded border px-2 py-1 text-xs font-bold"
            style={{
              borderColor: currentSnapshot.rEff >= 1 ? STATE_COLORS.infected : STATE_COLORS.susceptible,
              color: currentSnapshot.rEff >= 1 ? STATE_COLORS.infected : STATE_COLORS.susceptible,
            }}
          >
            R<sub>eff</sub> = {currentSnapshot.rEff.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Presets */}
      <div class="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            class="rounded-full border border-[var(--color-border)] px-3 py-1 text-[11px] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            onClick={() => handlePreset(preset)}
            title={preset.description}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Main layout */}
      <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: Visualizations */}
        <div class="space-y-4">
          {mode === "agent" && (
            <div class="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <canvas
                ref={agentCanvasRef}
                width={600}
                height={400}
                class="w-full"
                style={{ background: "var(--color-surface)", aspectRatio: "3/2" }}
              />
            </div>
          )}

          <div class="rounded-xl border border-[var(--color-border)] p-3">
            <div class="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Population Distribution
            </div>
            <StackedBar snapshot={currentSnapshot} model={model} total={getPopulation()} />
          </div>

          <div class="overflow-hidden rounded-xl border border-[var(--color-border)]">
            <div class="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Population Curves
            </div>
            <canvas
              ref={chartCanvasRef}
              width={600}
              height={CHART_HEIGHT}
              class="w-full"
              style={{ background: "var(--color-surface)" }}
            />
          </div>

          <div class="overflow-hidden rounded-xl border border-[var(--color-border)]">
            <div class="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
              Effective Reproduction Number (R<sub>eff</sub>)
            </div>
            <canvas
              ref={reffCanvasRef}
              width={600}
              height={120}
              class="w-full"
              style={{ background: "var(--color-surface)" }}
            />
          </div>
        </div>

        {/* Right: Controls */}
        <div class="space-y-4">
          {/* Play controls */}
          <div class="flex gap-2">
            {playState !== "running" ? (
              <button
                onClick={handlePlay}
                class="flex-1 rounded-lg bg-[var(--color-primary)] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                {playState === "idle" ? "Start" : "Resume"}
              </button>
            ) : (
              <button
                onClick={() => setPlayState("paused")}
                class="flex-1 rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs font-semibold text-[var(--color-heading)] transition-colors hover:border-[var(--color-primary)]"
              >
                Pause
              </button>
            )}
            <button
              onClick={() => { setPlayState("idle"); resetSimulation(); }}
              class="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
            >
              Reset
            </button>
          </div>

          {/* Parameters */}
          <div class="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Parameters
            </h3>

            <SliderControl
              label={`Contact rate (\u03B2)`}
              value={params.beta} min={0.01} max={1} step={0.01}
              onChange={(v) => updateParam("beta", v)}
            />
            <SliderControl
              label={`Recovery rate (\u03B3)`}
              value={params.gamma} min={0.01} max={0.5} step={0.01}
              onChange={(v) => updateParam("gamma", v)}
            />

            {model === "seir" && (
              <SliderControl
                label={`Incubation rate (\u03C3)`}
                value={params.incubationRate} min={0.01} max={1} step={0.01}
                onChange={(v) => updateParam("incubationRate", v)}
              />
            )}

            <SliderControl
              label="Mortality rate"
              value={params.mortalityRate} min={0} max={0.5} step={0.005} unit="%"
              onChange={(v) => updateParam("mortalityRate", v)}
            />

            {mode === "agent" && (
              <label class="block">
                <span class="flex justify-between text-[11px] text-[var(--color-text-muted)]">
                  <span>Population size</span>
                  <span class="font-mono">{params.populationSize}</span>
                </span>
                <input
                  type="range" min="100" max="2000" step="50"
                  value={params.populationSize}
                  onInput={(e) => updateParam("populationSize", parseInt((e.target as HTMLInputElement).value, 10))}
                  class="mt-1 w-full accent-[var(--color-primary)]"
                />
              </label>
            )}

            <label class="block">
              <span class="flex justify-between text-[11px] text-[var(--color-text-muted)]">
                <span>Initial infected</span>
                <span class="font-mono">{params.initialInfected}</span>
              </span>
              <input
                type="range" min="1" max={mode === "agent" ? 50 : 100} step="1"
                value={params.initialInfected}
                onInput={(e) => updateParam("initialInfected", parseInt((e.target as HTMLInputElement).value, 10))}
                class="mt-1 w-full accent-[var(--color-primary)]"
              />
            </label>
          </div>

          {/* Interventions */}
          <div class="space-y-3 rounded-xl border border-[var(--color-border)] p-4">
            <h3 class="text-xs font-semibold uppercase tracking-wider text-[var(--color-heading)]">
              Interventions
            </h3>

            <SliderControl
              label="Vaccination rate"
              value={params.vaccinationRate} min={0} max={0.95} step={0.05} unit="%"
              onChange={(v) => updateParam("vaccinationRate", v)}
            />
            <SliderControl
              label="Social distancing"
              value={params.socialDistancing} min={0} max={0.95} step={0.05} unit="%"
              onChange={(v) => updateParam("socialDistancing", v)}
            />

            {mode === "agent" && (
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.quarantine}
                  onChange={(e) => updateParam("quarantine", (e.target as HTMLInputElement).checked)}
                  class="accent-[var(--color-accent)]"
                />
                <span class="text-[11px] text-[var(--color-text-muted)]">Quarantine infected</span>
              </label>
            )}
          </div>

          {/* Stats */}
          <div class="grid grid-cols-2 gap-2">
            <StatCard label="Susceptible" value={Math.round(currentSnapshot.s)} color={STATE_COLORS.susceptible} />
            {model === "seir" && <StatCard label="Exposed" value={Math.round(currentSnapshot.e)} color={STATE_COLORS.exposed} />}
            <StatCard label="Infected" value={Math.round(currentSnapshot.i)} color={STATE_COLORS.infected} />
            <StatCard label="Recovered" value={Math.round(currentSnapshot.r)} color={STATE_COLORS.recovered} />
            {model === "sird" && <StatCard label="Dead" value={Math.round(currentSnapshot.d)} color={STATE_COLORS.dead} />}
            <StatCard
              label="Day"
              value={mode === "ode" ? Math.round(tickRef.current * ODE_DT * ODE_STEPS_PER_FRAME) : tickRef.current}
              color={getCssVar("--color-primary", "#4f8ff7")}
            />
          </div>

          {/* Legend */}
          <div class="rounded-xl border border-[var(--color-border)] p-3 text-[10px] text-[var(--color-text-muted)]">
            <p class="font-semibold uppercase tracking-wider text-[var(--color-heading)]">How it works</p>
            <ul class="mt-1.5 space-y-1 leading-relaxed">
              {mode === "ode" ? (
                <>
                  <li>Solves {model.toUpperCase()} differential equations using RK4 integration</li>
                  <li>R<sub>0</sub> = {"\u03B2"}/{"\u03B3"} determines outbreak threshold (R<sub>0</sub> {">"} 1 spreads)</li>
                  <li>Social distancing reduces effective {"\u03B2"}</li>
                  <li>Vaccination makes a fraction immune at start</li>
                </>
              ) : (
                <>
                  <li>Each dot is an individual moving randomly in 2D space</li>
                  <li>Infection spreads when susceptible enters radius of infected</li>
                  <li>Quarantine stops movement of infected agents</li>
                  <li>Social distancing reduces all movement speed</li>
                </>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
