import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Legend,
  Tooltip,
} from "chart.js";
import { calcLoanPayment } from "../shared/amortization";

Chart.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  LineController, Filler, Legend, Tooltip
);

// ─── Types ────────────────────────────────────────────────────────────

interface Amortization {
  id: number;
  tipo: "unica" | "periodica";
  monto: number;
  efecto: "plazo" | "pago";
  mes?: number;
  mesInicio?: number;
  mesFin?: number;
  frecuencia?: number;
}

interface SimRow {
  mes: number;
  interes: number;
  capital: number;
  amort: number;
  saldo: number;
  mensualidad: number;
  totalInteres: number;
  totalPagado: number;
}

interface SimResult {
  rows: SimRow[];
  totalInteres: number;
  totalPagado: number;
  totalAmortizado: number;
  mesesReales: number;
  mensualidadBase: number;
  gastosApertura: number;
}

// ─── Colors ───────────────────────────────────────────────────────────

const C = {
  gold: "#d4a843",
  goldLight: "#f0c96a",
  goldDim: "rgba(212,168,67,0.15)",
  goldBorder: "rgba(212,168,67,0.25)",
  blue: "#4a9eff",
  blueDim: "rgba(74,158,255,0.15)",
  blueBorder: "rgba(74,158,255,0.25)",
  green: "#3fb68a",
  greenDim: "rgba(63,182,138,0.15)",
  greenBorder: "rgba(63,182,138,0.25)",
  red: "#e05c6a",
  muted: "#7d8590",
  gridDark: "rgba(48,54,61,0.5)",
  gridLight: "rgba(0,0,0,0.06)",
};

// ─── Formatters ───────────────────────────────────────────────────────

const fmt = (n: number, dec = 0) =>
  new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(n);

const fmtM = (n: number) => "$" + fmt(n);
const fmtPct = (n: number) => n.toFixed(2) + "%";

// ─── Calculation engine ───────────────────────────────────────────────

const calcMensualidad = calcLoanPayment;

function simular(
  credito: number,
  tasaMensual: number,
  meses: number,
  gastosAperturaMonto: number,
  amorts: Amortization[],
  forceEfecto: "plazo" | "pago" | null
): SimResult {
  if (credito <= 0) {
    return {
      rows: [],
      totalInteres: 0,
      totalPagado: gastosAperturaMonto,
      totalAmortizado: 0,
      mesesReales: 0,
      mensualidadBase: 0,
      gastosApertura: gastosAperturaMonto,
    };
  }

  const mensualidadBase = calcMensualidad(credito, tasaMensual, meses);
  let saldo = credito;
  let mensualidad = mensualidadBase;
  let totalInteres = 0;
  let totalPagado = gastosAperturaMonto;
  let totalAmortizado = 0;
  const rows: SimRow[] = [];
  let mesReal = 0;

  for (let mes = 1; mes <= meses; mes++) {
    if (saldo <= 0.01) break;
    mesReal = mes;

    let amortEste = 0;
    let efectoEste: "plazo" | "pago" | null = null;
    for (const a of amorts) {
      let aplica = false;
      if (a.tipo === "unica") {
        aplica = a.mes === mes;
      } else {
        const inicio = a.mesInicio ?? 1;
        const fin = a.mesFin ?? meses;
        const freq = a.frecuencia ?? 12;
        const dentroRango = mes >= inicio && mes <= fin;
        const esFrecuencia = (mes - inicio) % freq === 0;
        aplica = dentroRango && esFrecuencia;
      }
      if (aplica) {
        amortEste += Math.min(a.monto, saldo);
        efectoEste = forceEfecto || a.efecto;
      }
    }

    const interes = saldo * tasaMensual;
    const capitalBase = Math.min(Math.max(0, mensualidad - interes), saldo);
    const pagoBase = Math.min(mensualidad, saldo + interes);

    saldo -= capitalBase;
    totalInteres += interes;
    totalPagado += pagoBase;

    if (amortEste > 0) {
      const amortReal = Math.min(amortEste, saldo);
      saldo -= amortReal;
      totalAmortizado += amortReal;
      totalPagado += amortReal;

      if (efectoEste === "pago" && saldo > 0.01) {
        const mesesRestantes = meses - mes;
        if (mesesRestantes > 0)
          mensualidad = calcMensualidad(saldo, tasaMensual, mesesRestantes);
      }
    }

    rows.push({
      mes,
      interes,
      capital: capitalBase,
      amort: amortEste > 0 ? Math.min(amortEste, saldo + amortEste) : 0,
      saldo: Math.max(0, saldo),
      mensualidad,
      totalInteres,
      totalPagado,
    });

    if (saldo <= 0.01) break;
  }

  return {
    rows,
    totalInteres,
    totalPagado,
    totalAmortizado,
    mesesReales: mesReal,
    mensualidadBase,
    gastosApertura: gastosAperturaMonto,
  };
}

// ─── Subcomponents ────────────────────────────────────────────────────

function CardTitle({ children }: { children: string }) {
  return (
    <div
      class="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em]"
      style={{ color: C.gold }}
    >
      <span
        class="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: C.gold }}
      />
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 transition-colors hover:border-[var(--color-primary)]">
      <div class="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">
        {label}
      </div>
      <div
        class="break-all font-mono text-base font-medium"
        style={{ color: color || "var(--color-text)" }}
      >
        {value}
      </div>
      {sub && (
        <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────

export default function MortgageCalc() {
  // ── Input state ──
  const [propertyValue, setPropertyValue] = useState(3_000_000);
  const [downPaymentPct, setDownPaymentPct] = useState(20);
  const [downPaymentAmt, setDownPaymentAmt] = useState(600_000);
  const [rate, setRate] = useState(10);
  const [termYears, setTermYears] = useState(20);
  const [openingCostsPct, setOpeningCostsPct] = useState(2);

  // ── Amortization state ──
  const [amortizations, setAmortizations] = useState<Amortization[]>([]);
  const [nextId, setNextId] = useState(1);
  const [amortTab, setAmortTab] = useState<"unica" | "periodica">("unica");
  const [uMes, setUMes] = useState(12);
  const [uMonto, setUMonto] = useState(100_000);
  const [uTipo, setUTipo] = useState<"plazo" | "pago">("plazo");
  const [pMesInicio, setPMesInicio] = useState(12);
  const [pMesFin, setPMesFin] = useState(0);
  const [pMonto, setPMonto] = useState(50_000);
  const [pFrecuencia, setPFrecuencia] = useState(12);
  const [pTipo, setPTipo] = useState<"plazo" | "pago">("plazo");

  // ── UI state ──
  const [chartTab, setChartTab] = useState<"saldo" | "intereses" | "desglose">(
    "saldo"
  );
  const [schedScenario, setSchedScenario] = useState<"base" | "amort">("base");
  const [schedOpen, setSchedOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState("");

  // ── Refs ──
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);
  const syncingRef = useRef(false);

  // ── Derived values ──
  const credit = Math.max(0, propertyValue - downPaymentAmt);
  const totalMonths = termYears * 12;
  const monthlyRate = rate / 100 / 12;
  const openingCostsAmt = credit * openingCostsPct / 100;

  // ── Simulations ──
  const base = useMemo(
    () => simular(credit, monthlyRate, totalMonths, openingCostsAmt, [], null),
    [credit, monthlyRate, totalMonths, openingCostsAmt]
  );
  const conPlazo = useMemo(
    () =>
      simular(
        credit, monthlyRate, totalMonths, openingCostsAmt,
        amortizations, "plazo"
      ),
    [credit, monthlyRate, totalMonths, openingCostsAmt, amortizations]
  );
  const conPago = useMemo(
    () =>
      simular(
        credit, monthlyRate, totalMonths, openingCostsAmt,
        amortizations, "pago"
      ),
    [credit, monthlyRate, totalMonths, openingCostsAmt, amortizations]
  );
  const conAmort = useMemo(
    () =>
      simular(
        credit, monthlyRate, totalMonths, openingCostsAmt,
        amortizations, null
      ),
    [credit, monthlyRate, totalMonths, openingCostsAmt, amortizations]
  );

  // ── Enganche sync ──
  function syncFromPct(newPct: number) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setDownPaymentPct(newPct);
    setDownPaymentAmt(Math.round(propertyValue * newPct / 100));
    syncingRef.current = false;
  }

  function syncFromAmt(newAmt: number) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setDownPaymentAmt(newAmt);
    if (propertyValue > 0)
      setDownPaymentPct(+(newAmt / propertyValue * 100).toFixed(2));
    syncingRef.current = false;
  }

  function syncFromPropertyValue(newVal: number) {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setPropertyValue(newVal);
    setDownPaymentAmt(Math.round(newVal * downPaymentPct / 100));
    syncingRef.current = false;
  }

  // ── Chart rendering ──
  useEffect(() => {
    if (!chartRef.current) return;
    if (chartInstanceRef.current) chartInstanceRef.current.destroy();

    const isLight = document.documentElement.classList.contains("light");
    const gridColor = isLight ? C.gridLight : C.gridDark;
    const textColor = isLight ? "#71717a" : C.muted;
    const hasAmort = amortizations.length > 0;
    const maxMeses = Math.max(
      base.mesesReales,
      hasAmort ? conPlazo.mesesReales : 0,
      hasAmort ? conPago.mesesReales : 0,
      1
    );

    const labels = Array.from({ length: maxMeses }, (_, i) => {
      const m = i + 1;
      if (m % 12 === 0) return `Ano ${m / 12}`;
      if (m % 6 === 0) return `Mes ${m}`;
      return "";
    });

    let datasets: any[] = [];

    if (chartTab === "saldo") {
      const baseData = Array.from({ length: maxMeses }, (_, i) =>
        i < base.rows.length ? base.rows[i].saldo : null
      );
      datasets.push({
        label: "Sin amortizar",
        data: baseData,
        borderColor: C.muted,
        backgroundColor: "rgba(125,133,144,0.04)",
        fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0,
        borderDash: [4, 3],
      });
      if (hasAmort) {
        datasets.push({
          label: "Reducir plazo",
          data: Array.from({ length: maxMeses }, (_, i) =>
            i < conPlazo.rows.length ? conPlazo.rows[i].saldo : null
          ),
          borderColor: C.blue,
          backgroundColor: "rgba(74,158,255,0.06)",
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0,
        });
        datasets.push({
          label: "Reducir mensualidad",
          data: Array.from({ length: maxMeses }, (_, i) =>
            i < conPago.rows.length ? conPago.rows[i].saldo : null
          ),
          borderColor: C.green,
          backgroundColor: "rgba(63,182,138,0.06)",
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0,
        });
      }
    } else if (chartTab === "intereses") {
      datasets.push({
        label: "Sin amortizar",
        data: Array.from({ length: maxMeses }, (_, i) =>
          i < base.rows.length ? base.rows[i].totalInteres : base.totalInteres
        ),
        borderColor: C.red,
        backgroundColor: "rgba(224,92,106,0.04)",
        fill: true, tension: 0.3, borderWidth: 1.5, pointRadius: 0,
        borderDash: [4, 3],
      });
      if (hasAmort) {
        datasets.push({
          label: "Reducir plazo",
          data: Array.from({ length: maxMeses }, (_, i) =>
            i < conPlazo.rows.length
              ? conPlazo.rows[i].totalInteres
              : conPlazo.totalInteres
          ),
          borderColor: C.blue,
          backgroundColor: "rgba(74,158,255,0.04)",
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0,
        });
        datasets.push({
          label: "Reducir mensualidad",
          data: Array.from({ length: maxMeses }, (_, i) =>
            i < conPago.rows.length
              ? conPago.rows[i].totalInteres
              : conPago.totalInteres
          ),
          borderColor: C.green,
          backgroundColor: "rgba(63,182,138,0.04)",
          fill: true, tension: 0.3, borderWidth: 2, pointRadius: 0,
        });
      }
    } else {
      const interesData = base.rows.map((r) => r.interes);
      const capitalData = base.rows.map((r) => r.capital);
      datasets = [
        {
          label: "Capital",
          data: capitalData,
          borderColor: C.green,
          backgroundColor: "rgba(63,182,138,0.55)",
          fill: true, tension: 0, borderWidth: 0, pointRadius: 0,
          stack: "stack",
        },
        {
          label: "Interes",
          data: interesData,
          borderColor: C.red,
          backgroundColor: "rgba(224,92,106,0.55)",
          fill: true, tension: 0, borderWidth: 0, pointRadius: 0,
          stack: "stack",
        },
      ];
    }

    const stacked = chartTab === "desglose";
    const chartLabels =
      chartTab === "desglose"
        ? base.rows.map((_, i) => {
            const m = i + 1;
            if (m % 12 === 0) return `Ano ${m / 12}`;
            if (m % 6 === 0) return `Mes ${m}`;
            return "";
          })
        : labels;

    chartInstanceRef.current = new Chart(chartRef.current, {
      type: "line",
      data: { labels: chartLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: textColor,
              font: { family: "monospace", size: 10 },
              boxWidth: 12,
              padding: 16,
            },
          },
          tooltip: {
            backgroundColor: isLight ? "#fff" : "#1c2330",
            borderColor: isLight ? "#e4e4e7" : "#30363d",
            borderWidth: 1,
            titleColor: isLight ? "#18181b" : "#e6edf3",
            bodyColor: textColor,
            titleFont: { family: "monospace", size: 11 },
            bodyFont: { family: "monospace", size: 11 },
            callbacks: {
              label: (ctx: any) =>
                ` ${ctx.dataset.label}: $${ctx.parsed.y?.toLocaleString("es-MX", { maximumFractionDigits: 0 }) ?? "0"}`,
            },
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Tiempo",
              color: textColor,
              font: { family: "monospace", size: 10 },
              padding: { top: 8 },
            },
            grid: { color: gridColor, drawTicks: false },
            ticks: {
              color: textColor,
              font: { family: "monospace", size: 9 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10,
            },
            border: { color: gridColor },
          },
          y: {
            stacked,
            title: {
              display: true,
              text: chartTab === "desglose" ? "Monto mensual (MXN)" : "Monto (MXN)",
              color: textColor,
              font: { family: "monospace", size: 10 },
              padding: { bottom: 8 },
            },
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: "monospace", size: 9 },
              callback: (v: any) =>
                "$" +
                (v >= 1e6
                  ? (v / 1e6).toFixed(1) + "M"
                  : v >= 1e3
                    ? (v / 1e3).toFixed(0) + "k"
                    : v),
            },
            border: { color: gridColor },
          },
        },
      },
    });

    return () => {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [base, conPlazo, conPago, chartTab, amortizations.length]);

  // ── Handlers ──
  function addAmort() {
    let obj: Amortization;
    if (amortTab === "unica") {
      if (uMonto <= 0) return;
      obj = {
        id: nextId,
        tipo: "unica",
        mes: Math.min(uMes, totalMonths),
        monto: uMonto,
        efecto: uTipo,
      };
    } else {
      if (pMonto <= 0) return;
      obj = {
        id: nextId,
        tipo: "periodica",
        mesInicio: pMesInicio,
        mesFin: pMesFin || totalMonths,
        monto: pMonto,
        frecuencia: pFrecuencia,
        efecto: pTipo,
      };
    }
    setNextId((n) => n + 1);
    setAmortizations((prev) => [...prev, obj]);
    const efectoLabel =
      obj.efecto === "plazo" ? "reducir plazo" : "reducir mensualidad";
    setModalMsg(
      `Amortizacion de ${fmtM(obj.monto)} configurada para ${efectoLabel}. Revisa las graficas para ver el impacto.`
    );
    setModalOpen(true);
  }

  function removeAmort(id: number) {
    setAmortizations((prev) => prev.filter((a) => a.id !== id));
  }

  // ── Schedule rows ──
  const schedRows = schedScenario === "base" ? base.rows : conAmort.rows;

  // ── Compare data ──
  const hasAmort = amortizations.length > 0;
  const lastMensPago =
    conPago.rows.length > 0
      ? conPago.rows[conPago.rows.length - 1].mensualidad
      : base.mensualidadBase;
  const retornoPlazo =
    conPlazo.totalAmortizado > 0
      ? ((base.totalInteres - conPlazo.totalInteres) /
          conPlazo.totalAmortizado) *
        100
      : 0;
  const retornoPago =
    conPago.totalAmortizado > 0
      ? ((base.totalInteres - conPago.totalInteres) /
          conPago.totalAmortizado) *
        100
      : 0;

  // ── Number input helper ──
  const numInput = (
    value: number,
    onChange: (v: number) => void,
    opts?: {
      prefix?: string;
      suffix?: string;
      min?: number;
      max?: number;
      step?: number;
    }
  ) => (
    <div class="relative flex items-center">
      {opts?.prefix && (
        <span
          class="pointer-events-none absolute left-3 z-[1] font-mono text-sm"
          style={{ color: C.gold }}
        >
          {opts.prefix}
        </span>
      )}
      <input
        type="number"
        value={value}
        min={opts?.min}
        max={opts?.max}
        step={opts?.step}
        onInput={(e) =>
          onChange(Number((e.target as HTMLInputElement).value) || 0)
        }
        class={`w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-light)] py-2 font-mono text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)] ${opts?.prefix ? "pl-7" : "px-3"} ${opts?.suffix ? "pr-10" : "pr-3"}`}
        style={{
          MozAppearance: "textfield",
          WebkitAppearance: "none",
        }}
      />
      {opts?.suffix && (
        <span class="pointer-events-none absolute right-3 font-mono text-xs text-[var(--color-text-muted)]">
          {opts.suffix}
        </span>
      )}
    </div>
  );

  const selectInput = (
    value: string,
    onChange: (v: string) => void,
    options: { value: string; label: string }[]
  ) => (
    <select
      value={value}
      onChange={(e) => onChange((e.target as HTMLSelectElement).value)}
      class="w-full cursor-pointer appearance-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-light)] px-3 py-2 pr-8 font-mono text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-primary)]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%237d8590' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  const label = (text: string) => (
    <div class="mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
      {text}
    </div>
  );

  // ── Render ──
  return (
    <div class="space-y-6">
      <div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
        {/* ════ LEFT COLUMN ════ */}
        <div class="space-y-4">
          {/* ── Loan params ── */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Parametros del credito</CardTitle>

            <div class="mb-3">
              {label("Valor de la propiedad")}
              {numInput(propertyValue, syncFromPropertyValue, {
                prefix: "$",
                suffix: "MXN",
                min: 0,
                step: 10000,
              })}
            </div>

            <div class="mb-3 grid grid-cols-2 gap-3">
              <div>
                {label("Enganche")}
                {numInput(downPaymentPct, syncFromPct, {
                  suffix: "%",
                  min: 0,
                  max: 99,
                  step: 1,
                })}
              </div>
              <div>
                {label("Monto enganche")}
                {numInput(downPaymentAmt, syncFromAmt, {
                  prefix: "$",
                  min: 0,
                  step: 1000,
                })}
              </div>
            </div>

            {/* Derived info */}
            <div
              class="mb-4 flex flex-wrap justify-between gap-2 rounded-lg border p-3"
              style={{
                background: C.goldDim,
                borderColor: C.goldBorder,
              }}
            >
              <div class="text-center">
                <div class="font-mono text-[9px] uppercase text-[var(--color-text-muted)]">
                  Credito
                </div>
                <div class="font-mono text-sm" style={{ color: C.goldLight }}>
                  {fmtM(credit)}
                </div>
              </div>
              <div class="text-center">
                <div class="font-mono text-[9px] uppercase text-[var(--color-text-muted)]">
                  Enganche %
                </div>
                <div class="font-mono text-sm" style={{ color: C.goldLight }}>
                  {propertyValue > 0
                    ? fmtPct((downPaymentAmt / propertyValue) * 100)
                    : "0%"}
                </div>
              </div>
              <div class="text-center">
                <div class="font-mono text-[9px] uppercase text-[var(--color-text-muted)]">
                  LTV
                </div>
                <div class="font-mono text-sm" style={{ color: C.goldLight }}>
                  {propertyValue > 0
                    ? fmtPct((credit / propertyValue) * 100)
                    : "0%"}
                </div>
              </div>
            </div>

            <div class="mb-3 grid grid-cols-2 gap-3">
              <div>
                {label("Tasa anual")}
                {numInput(rate, setRate, {
                  suffix: "%",
                  min: 0.1,
                  max: 50,
                  step: 0.01,
                })}
              </div>
              <div>
                {label("Plazo")}
                {numInput(termYears, setTermYears, {
                  suffix: "anos",
                  min: 1,
                  max: 30,
                  step: 1,
                })}
              </div>
            </div>

            <div>
              {label("Gastos de apertura")}
              {numInput(openingCostsPct, setOpeningCostsPct, {
                suffix: "%",
                min: 0,
                max: 10,
                step: 0.1,
              })}
            </div>
          </div>

          {/* ── Amortizations ── */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Amortizaciones anticipadas</CardTitle>

            {/* Tabs */}
            <div class="mb-4 flex gap-1 rounded-lg bg-[var(--color-bg)] p-0.5">
              {(["unica", "periodica"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setAmortTab(tab)}
                  class={`flex-1 rounded-md px-3 py-2 font-mono text-[11px] uppercase tracking-wider transition-colors ${
                    amortTab === tab
                      ? "border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]"
                      : "border border-transparent text-[var(--color-text-muted)]"
                  }`}
                >
                  {tab === "unica" ? "Pago unico" : "Periodica"}
                </button>
              ))}
            </div>

            {/* Unica form */}
            {amortTab === "unica" && (
              <div>
                <div class="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    {label("Mes del pago")}
                    {numInput(uMes, setUMes, { min: 1, max: 360 })}
                  </div>
                  <div>
                    {label("Monto")}
                    {numInput(uMonto, setUMonto, {
                      prefix: "$",
                      min: 1,
                      step: 1000,
                    })}
                  </div>
                </div>
                <div class="mb-3">
                  {label("Efecto")}
                  {selectInput(uTipo, (v) => setUTipo(v as "plazo" | "pago"), [
                    {
                      value: "plazo",
                      label: "Reducir plazo (misma mensualidad)",
                    },
                    {
                      value: "pago",
                      label: "Reducir mensualidad (mismo plazo)",
                    },
                  ])}
                </div>
              </div>
            )}

            {/* Periodica form */}
            {amortTab === "periodica" && (
              <div>
                <div class="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    {label("Desde mes")}
                    {numInput(pMesInicio, setPMesInicio, { min: 1, max: 360 })}
                  </div>
                  <div>
                    {label("Hasta mes (0 = siempre)")}
                    {numInput(pMesFin, setPMesFin, { min: 0, max: 360 })}
                  </div>
                </div>
                <div class="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    {label("Monto c/vez")}
                    {numInput(pMonto, setPMonto, {
                      prefix: "$",
                      min: 1,
                      step: 1000,
                    })}
                  </div>
                  <div>
                    {label("Frecuencia")}
                    {selectInput(
                      String(pFrecuencia),
                      (v) => setPFrecuencia(Number(v)),
                      [
                        { value: "12", label: "Anual" },
                        { value: "6", label: "Semestral" },
                        { value: "3", label: "Trimestral" },
                        { value: "1", label: "Mensual" },
                      ]
                    )}
                  </div>
                </div>
                <div class="mb-3">
                  {label("Efecto")}
                  {selectInput(pTipo, (v) => setPTipo(v as "plazo" | "pago"), [
                    { value: "plazo", label: "Reducir plazo" },
                    { value: "pago", label: "Reducir mensualidad" },
                  ])}
                </div>
              </div>
            )}

            <button
              onClick={addAmort}
              class="mb-4 w-full rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5"
              style={{ color: C.gold }}
            >
              + Agregar amortizacion
            </button>

            {/* Amort list */}
            <div class="h-px bg-[var(--color-border)]" />
            <div class="mt-3 flex max-h-60 flex-col gap-2 overflow-y-auto">
              {amortizations.length === 0 ? (
                <p class="py-3 text-center font-mono text-xs text-[var(--color-text-muted)]">
                  Sin amortizaciones. Agrega pagos extraordinarios para ver el
                  impacto.
                </p>
              ) : (
                amortizations.map((a) => {
                  const badgeColor =
                    a.efecto === "plazo" ? C.blue : C.green;
                  const badgeBg =
                    a.efecto === "plazo" ? C.blueDim : C.greenDim;
                  const badgeBorder =
                    a.efecto === "plazo" ? C.blueBorder : C.greenBorder;
                  const badgeLabel =
                    a.efecto === "plazo" ? "Plazo" : "Mensualidad";
                  const freqLabels: Record<number, string> = {
                    12: "Anual",
                    6: "Semestral",
                    3: "Trimestral",
                    1: "Mensual",
                  };
                  const meta =
                    a.tipo === "unica"
                      ? `Mes ${a.mes} - ${fmtM(a.monto)}`
                      : `${freqLabels[a.frecuencia ?? 12]} desde mes ${a.mesInicio} - ${fmtM(a.monto)} c/vez`;

                  return (
                    <div
                      key={a.id}
                      class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2"
                    >
                      <div class="min-w-0 flex-1">
                        <div class="truncate font-mono text-sm text-[var(--color-text)]">
                          {fmtM(a.monto)}
                        </div>
                        <div class="font-mono text-[10px] text-[var(--color-text-muted)]">
                          {meta}
                        </div>
                      </div>
                      <span
                        class="shrink-0 rounded px-2 py-0.5 font-mono text-[10px]"
                        style={{
                          color: badgeColor,
                          background: badgeBg,
                          border: `1px solid ${badgeBorder}`,
                        }}
                      >
                        {badgeLabel}
                      </span>
                      <button
                        onClick={() => removeAmort(a.id)}
                        class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] transition-colors hover:border-red-500 hover:text-red-400"
                      >
                        x
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ════ RIGHT COLUMN ════ */}
        <div class="space-y-4">
          {/* ── KPIs ── */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Resumen base del credito</CardTitle>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                label="Mensualidad"
                value={fmtM(base.mensualidadBase)}
                sub="pago fijo mensual"
                color={C.goldLight}
              />
              <StatCard
                label="Total intereses"
                value={fmtM(base.totalInteres)}
                sub={
                  credit > 0
                    ? fmtPct((base.totalInteres / credit) * 100) +
                      " del credito"
                    : ""
                }
                color={C.red}
              />
              <StatCard
                label="Total pagado"
                value={fmtM(base.totalPagado)}
                sub={`incluye ${fmtM(openingCostsAmt)} apertura`}
              />
              <StatCard
                label="Credito"
                value={fmtM(credit)}
                sub="capital a pagar"
              />
              <StatCard
                label="Plazo"
                value={`${base.mesesReales} meses`}
                sub={`${(base.mesesReales / 12).toFixed(1)} anos`}
              />
              <StatCard
                label="Costo anual"
                value={fmtM(base.mensualidadBase * 12)}
                sub="pagos anuales aprox"
              />
            </div>
          </div>

          {/* ── Comparison ── */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Comparacion de escenarios</CardTitle>
            {!hasAmort ? (
              <p class="py-4 text-center font-mono text-xs text-[var(--color-text-muted)]">
                Agrega amortizaciones para comparar escenarios
              </p>
            ) : (
              <div>
                <div class="overflow-x-auto">
                  <table class="w-full border-collapse font-mono text-xs">
                    <thead>
                      <tr>
                        <th class="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                          Metrica
                        </th>
                        <th class="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-[9px] uppercase tracking-wider text-[var(--color-text-muted)]">
                          Sin amortizar
                        </th>
                        <th
                          class="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-[9px] uppercase tracking-wider"
                          style={{ color: C.blue }}
                        >
                          Reducir plazo
                        </th>
                        <th
                          class="border-b border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left text-[9px] uppercase tracking-wider"
                          style={{ color: C.green }}
                        >
                          Reducir mensualidad
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td class="border-b border-[var(--color-border)]/50 px-3 py-2">
                          Mensualidad
                        </td>
                        <td class="border-b border-[var(--color-border)]/50 px-3 py-2 text-[var(--color-text-muted)]">
                          {fmtM(base.mensualidadBase)}
                        </td>
                        <td
                          class="border-b border-[var(--color-border)]/50 px-3 py-2"
                          style={{ color: C.blue }}
                        >
                          {fmtM(base.mensualidadBase)}{" "}
                          <span class="text-[var(--color-text-muted)]">
                            (igual)
                          </span>
                        </td>
                        <td
                          class="border-b border-[var(--color-border)]/50 px-3 py-2"
                          style={{ color: C.green }}
                        >
                          {fmtM(lastMensPago)}{" "}
                          <span style={{ color: C.green, fontSize: "9px" }}>
                            (-{fmtM(base.mensualidadBase - lastMensPago)})
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td class="border-b border-[var(--color-border)]/50 px-3 py-2">
                          Total intereses
                        </td>
                        <td class="border-b border-[var(--color-border)]/50 px-3 py-2 text-[var(--color-text-muted)]">
                          {fmtM(base.totalInteres)}
                        </td>
                        <td
                          class="border-b border-[var(--color-border)]/50 px-3 py-2"
                          style={{ color: C.blue }}
                        >
                          {fmtM(conPlazo.totalInteres)}{" "}
                          <span style={{ color: C.green, fontSize: "9px" }}>
                            (-
                            {fmtM(
                              base.totalInteres - conPlazo.totalInteres
                            )}
                            )
                          </span>
                        </td>
                        <td
                          class="border-b border-[var(--color-border)]/50 px-3 py-2"
                          style={{ color: C.green }}
                        >
                          {fmtM(conPago.totalInteres)}{" "}
                          <span style={{ color: C.green, fontSize: "9px" }}>
                            (-
                            {fmtM(base.totalInteres - conPago.totalInteres)})
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td class="border-b border-[var(--color-border)]/50 px-3 py-2">
                          Total pagado
                        </td>
                        <td class="border-b border-[var(--color-border)]/50 px-3 py-2 text-[var(--color-text-muted)]">
                          {fmtM(base.totalPagado)}
                        </td>
                        <td
                          class="border-b border-[var(--color-border)]/50 px-3 py-2"
                          style={{ color: C.blue }}
                        >
                          {fmtM(conPlazo.totalPagado)}
                        </td>
                        <td
                          class="border-b border-[var(--color-border)]/50 px-3 py-2"
                          style={{ color: C.green }}
                        >
                          {fmtM(conPago.totalPagado)}
                        </td>
                      </tr>
                      <tr>
                        <td class="border-b border-[var(--color-border)]/50 px-3 py-2">
                          Plazo efectivo
                        </td>
                        <td class="border-b border-[var(--color-border)]/50 px-3 py-2 text-[var(--color-text-muted)]">
                          {base.mesesReales} meses
                        </td>
                        <td
                          class="border-b border-[var(--color-border)]/50 px-3 py-2"
                          style={{ color: C.blue }}
                        >
                          {conPlazo.mesesReales} meses{" "}
                          <span style={{ color: C.blue, fontSize: "9px" }}>
                            (-{base.mesesReales - conPlazo.mesesReales})
                          </span>
                        </td>
                        <td
                          class="border-b border-[var(--color-border)]/50 px-3 py-2"
                          style={{ color: C.green }}
                        >
                          {conPago.mesesReales} meses
                        </td>
                      </tr>
                      <tr>
                        <td class="px-3 py-2">Retorno implicito</td>
                        <td class="px-3 py-2 text-[var(--color-text-muted)]">
                          --
                        </td>
                        <td class="px-3 py-2" style={{ color: C.gold }}>
                          {fmtPct(retornoPlazo)} / peso
                        </td>
                        <td class="px-3 py-2" style={{ color: C.gold }}>
                          {fmtPct(retornoPago)} / peso
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Summary boxes */}
                <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div
                    class="rounded-lg border p-3 font-mono text-[11px]"
                    style={{
                      background: C.blueDim,
                      borderColor: C.blueBorder,
                      color: C.blue,
                    }}
                  >
                    <strong>Reducir plazo</strong>
                    <br />
                    <span class="text-[var(--color-text-muted)]">
                      Terminas {base.mesesReales - conPlazo.mesesReales} meses
                      antes. Ahorras{" "}
                      {fmtM(base.totalInteres - conPlazo.totalInteres)} en
                      intereses.
                    </span>
                  </div>
                  <div
                    class="rounded-lg border p-3 font-mono text-[11px]"
                    style={{
                      background: C.greenDim,
                      borderColor: C.greenBorder,
                      color: C.green,
                    }}
                  >
                    <strong>Reducir mensualidad</strong>
                    <br />
                    <span class="text-[var(--color-text-muted)]">
                      Pagas {fmtM(base.mensualidadBase - lastMensPago)} menos
                      c/mes. Ahorras{" "}
                      {fmtM(base.totalInteres - conPago.totalInteres)} en
                      intereses.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Chart ── */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Proyeccion grafica</CardTitle>
            <div class="mb-3 flex flex-wrap gap-1.5">
              {(["saldo", "intereses", "desglose"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setChartTab(tab)}
                  class={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    chartTab === tab
                      ? "text-[var(--color-text)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                  }`}
                  style={
                    chartTab === tab
                      ? { borderColor: C.gold, color: C.gold, background: C.goldDim }
                      : undefined
                  }
                >
                  {tab === "saldo"
                    ? "Saldo capital"
                    : tab === "intereses"
                      ? "Intereses acumulados"
                      : "Desglose mensual"}
                </button>
              ))}
            </div>
            <div class="relative h-[280px] w-full">
              <canvas ref={chartRef} />
            </div>
          </div>

          {/* ── Schedule ── */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <CardTitle>Tabla de amortizacion</CardTitle>

            <div class="mb-3 flex flex-wrap gap-1.5">
              {(["base", "amort"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSchedScenario(s)}
                  class={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                    schedScenario === s
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] text-[var(--color-text-muted)]"
                  }`}
                >
                  {s === "base" ? "Base" : "Con amortizaciones"}
                </button>
              ))}
            </div>

            <button
              onClick={() => setSchedOpen(!schedOpen)}
              class="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-primary)]"
            >
              <svg
                width="8"
                height="12"
                viewBox="0 0 8 12"
                fill="currentColor"
                class="transition-transform"
                style={{
                  transform: schedOpen ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                <path d="M2 1l5 5-5 5" />
              </svg>
              {schedOpen
                ? "Ocultar tabla"
                : "Ver tabla completa mes a mes"}
            </button>

            {schedOpen && (
              <div class="max-h-[300px] overflow-auto rounded-lg border border-[var(--color-border)]">
                <table class="w-full border-collapse font-mono text-[11px]">
                  <thead>
                    <tr>
                      {[
                        "Mes",
                        "Mensualidad",
                        "Capital",
                        "Interes",
                        "Amort. extra",
                        "Saldo",
                        "Int. acum.",
                      ].map((h) => (
                        <th
                          key={h}
                          class="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-surface-light)] px-2 py-2 text-right text-[9px] uppercase tracking-wider text-[var(--color-text-muted)] first:text-left"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {schedRows.map((r) => (
                      <tr
                        key={r.mes}
                        class={
                          r.amort > 0
                            ? "bg-[var(--color-primary)]/5"
                            : ""
                        }
                      >
                        <td
                          class="border-b border-[var(--color-border)]/30 px-2 py-1 text-left text-[var(--color-text-muted)]"
                          style={r.amort > 0 ? { color: C.gold } : undefined}
                        >
                          {r.mes}
                        </td>
                        <td class="border-b border-[var(--color-border)]/30 px-2 py-1 text-right">
                          {fmtM(r.mensualidad)}
                        </td>
                        <td class="border-b border-[var(--color-border)]/30 px-2 py-1 text-right">
                          {fmtM(r.capital)}
                        </td>
                        <td class="border-b border-[var(--color-border)]/30 px-2 py-1 text-right">
                          {fmtM(r.interes)}
                        </td>
                        <td class="border-b border-[var(--color-border)]/30 px-2 py-1 text-right">
                          {r.amort > 0 ? fmtM(r.amort) : "--"}
                        </td>
                        <td class="border-b border-[var(--color-border)]/30 px-2 py-1 text-right">
                          {fmtM(r.saldo)}
                        </td>
                        <td class="border-b border-[var(--color-border)]/30 px-2 py-1 text-right">
                          {fmtM(r.totalInteres)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ════ MODAL ════ */}
      {modalOpen && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div class="w-[min(400px,90vw)] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <div
              class="mb-3 font-mono text-lg"
              style={{ color: C.goldLight }}
            >
              Amortizacion agregada
            </div>
            <p class="mb-4 font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
              {modalMsg}
            </p>
            <button
              onClick={() => setModalOpen(false)}
              class="w-full rounded-lg px-4 py-2.5 font-mono text-xs font-medium uppercase tracking-wider text-[#0d1117] transition-all hover:-translate-y-0.5"
              style={{
                background: C.gold,
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
