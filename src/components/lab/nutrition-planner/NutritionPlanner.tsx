import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import {
  Chart, ArcElement, DoughnutController, CategoryScale, LinearScale,
  PointElement, LineElement, LineController, Filler, Legend, Tooltip,
} from "chart.js";

Chart.register(ArcElement, DoughnutController, CategoryScale, LinearScale, PointElement, LineElement, LineController, Filler, Legend, Tooltip);

const C = {
  gold: "#d4a843", blue: "#4a9eff", green: "#3fb68a", red: "#e05c6a",
  purple: "#a78bfa", orange: "#f59e0b", cyan: "#22d3ee",
  muted: "#7d8590", gridDark: "rgba(48,54,61,0.5)", gridLight: "rgba(0,0,0,0.06)",
};

function CardTitle({ children }: { children: string }) {
  return (
    <div class="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em]" style={{ color: C.gold }}>
      <span class="inline-block h-1.5 w-1.5 rounded-full" style={{ background: C.gold }} />
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 transition-colors hover:border-[var(--color-primary)]">
      <div class="mb-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{label}</div>
      <div class="break-all font-mono text-base font-medium" style={{ color: color || "var(--color-text)" }}>{value}</div>
      {sub && <div class="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">{sub}</div>}
    </div>
  );
}

// ─── BMR/TDEE Formulas ───────────────────────────────────────────────
function calcBMR(weight: number, height: number, age: number, sex: "male" | "female"): number {
  // Mifflin-St Jeor
  if (sex === "male") return 10 * weight + 6.25 * height - 5 * age + 5;
  return 10 * weight + 6.25 * height - 5 * age - 161;
}

const ACTIVITY_FACTORS: { key: string; label: string; factor: number }[] = [
  { key: "sedentary", label: "Sedentary (desk job)", factor: 1.2 },
  { key: "light", label: "Light (1-3 days/week)", factor: 1.375 },
  { key: "moderate", label: "Moderate (3-5 days/week)", factor: 1.55 },
  { key: "active", label: "Active (6-7 days/week)", factor: 1.725 },
  { key: "very_active", label: "Very Active (2x/day)", factor: 1.9 },
];

const GOALS: { key: string; label: string; calAdj: number }[] = [
  { key: "lose_fast", label: "Lose Fast (-1kg/week)", calAdj: -1000 },
  { key: "lose", label: "Lose (-0.5kg/week)", calAdj: -500 },
  { key: "maintain", label: "Maintain Weight", calAdj: 0 },
  { key: "gain", label: "Gain (+0.5kg/week)", calAdj: 500 },
  { key: "gain_fast", label: "Gain Fast (+1kg/week)", calAdj: 1000 },
];

// ─── Food Database ───────────────────────────────────────────────────
interface Food {
  name: string;
  category: string;
  cal: number;  // per 100g
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

const FOODS: Food[] = [
  // Mexican staples
  { name: "Tortilla (corn)", category: "Grains", cal: 218, protein: 5.7, carbs: 44.6, fat: 2.8, fiber: 5.2 },
  { name: "Tortilla (flour)", category: "Grains", cal: 312, protein: 8.3, carbs: 52.4, fat: 8.0, fiber: 2.2 },
  { name: "Rice (cooked)", category: "Grains", cal: 130, protein: 2.7, carbs: 28.2, fat: 0.3, fiber: 0.4 },
  { name: "Black beans (cooked)", category: "Legumes", cal: 132, protein: 8.9, carbs: 23.7, fat: 0.5, fiber: 8.7 },
  { name: "Pinto beans (cooked)", category: "Legumes", cal: 143, protein: 9.0, carbs: 26.2, fat: 0.6, fiber: 9.0 },
  // Proteins
  { name: "Chicken breast", category: "Protein", cal: 165, protein: 31.0, carbs: 0, fat: 3.6, fiber: 0 },
  { name: "Beef (lean)", category: "Protein", cal: 250, protein: 26.0, carbs: 0, fat: 15.0, fiber: 0 },
  { name: "Egg", category: "Protein", cal: 155, protein: 13.0, carbs: 1.1, fat: 11.0, fiber: 0 },
  { name: "Tuna (canned)", category: "Protein", cal: 128, protein: 27.0, carbs: 0, fat: 1.4, fiber: 0 },
  { name: "Pork loin", category: "Protein", cal: 196, protein: 27.3, carbs: 0, fat: 8.6, fiber: 0 },
  { name: "Queso fresco", category: "Dairy", cal: 299, protein: 17.6, carbs: 3.4, fat: 24.0, fiber: 0 },
  { name: "Oaxaca cheese", category: "Dairy", cal: 274, protein: 25.0, carbs: 2.0, fat: 18.0, fiber: 0 },
  // Fruits & Vegetables
  { name: "Avocado", category: "Fruits", cal: 160, protein: 2.0, carbs: 8.5, fat: 14.7, fiber: 6.7 },
  { name: "Banana", category: "Fruits", cal: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6 },
  { name: "Mango", category: "Fruits", cal: 60, protein: 0.8, carbs: 15.0, fat: 0.4, fiber: 1.6 },
  { name: "Tomato", category: "Vegetables", cal: 18, protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2 },
  { name: "Onion", category: "Vegetables", cal: 40, protein: 1.1, carbs: 9.3, fat: 0.1, fiber: 1.7 },
  { name: "Nopales", category: "Vegetables", cal: 16, protein: 1.3, carbs: 3.3, fat: 0.1, fiber: 2.2 },
  { name: "Chile jalapeño", category: "Vegetables", cal: 29, protein: 0.9, carbs: 6.5, fat: 0.4, fiber: 2.8 },
  // Others
  { name: "Olive oil", category: "Fats", cal: 884, protein: 0, carbs: 0, fat: 100.0, fiber: 0 },
  { name: "Peanuts", category: "Nuts", cal: 567, protein: 25.8, carbs: 16.1, fat: 49.2, fiber: 8.5 },
  { name: "Oats", category: "Grains", cal: 389, protein: 16.9, carbs: 66.3, fat: 6.9, fiber: 10.6 },
  { name: "Milk (whole)", category: "Dairy", cal: 61, protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0 },
];

interface MealItem { foodIndex: number; grams: number; }

// ─── Main Component ──────────────────────────────────────────────────
export default function NutritionPlanner() {
  const [weight, setWeight] = useState(75);
  const [height, setHeight] = useState(175);
  const [age, setAge] = useState(28);
  const [sex, setSex] = useState<"male" | "female">("male");
  const [activity, setActivity] = useState("moderate");
  const [goal, setGoal] = useState("maintain");

  const [mealItems, setMealItems] = useState<MealItem[]>([]);
  const [foodFilter, setFoodFilter] = useState("");
  const [projWeeks, setProjWeeks] = useState(12);

  const doughnutRef = useRef<HTMLCanvasElement>(null);
  const doughnutInst = useRef<Chart | null>(null);
  const projRef = useRef<HTMLCanvasElement>(null);
  const projInst = useRef<Chart | null>(null);

  // ── Calculations ──
  const bmr = useMemo(() => calcBMR(weight, height, age, sex), [weight, height, age, sex]);
  const actFactor = ACTIVITY_FACTORS.find(a => a.key === activity)?.factor || 1.55;
  const tdee = bmr * actFactor;
  const goalAdj = GOALS.find(g => g.key === goal)?.calAdj || 0;
  const targetCal = Math.max(1200, tdee + goalAdj);

  // Macro targets (balanced: 30% protein, 40% carbs, 30% fat)
  const macroTargets = useMemo(() => ({
    protein: (targetCal * 0.30) / 4,
    carbs: (targetCal * 0.40) / 4,
    fat: (targetCal * 0.30) / 9,
    fiber: sex === "male" ? 38 : 25,
  }), [targetCal, sex]);

  // Current meal totals
  const mealTotals = useMemo(() => {
    const t = { cal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
    for (const item of mealItems) {
      const food = FOODS[item.foodIndex];
      const mult = item.grams / 100;
      t.cal += food.cal * mult;
      t.protein += food.protein * mult;
      t.carbs += food.carbs * mult;
      t.fat += food.fat * mult;
      t.fiber += food.fiber * mult;
    }
    return t;
  }, [mealItems]);

  // Weight projection
  const projectedWeights = useMemo(() => {
    const weeklyChange = goalAdj * 7 / 7700; // kg per week
    return Array.from({ length: projWeeks + 1 }, (_, w) => weight + weeklyChange * w);
  }, [weight, goalAdj, projWeeks]);

  function addFood(index: number) {
    setMealItems(p => [...p, { foodIndex: index, grams: 100 }]);
  }
  function removeItem(i: number) { setMealItems(p => p.filter((_, idx) => idx !== i)); }
  function setGrams(i: number, g: number) { setMealItems(p => p.map((item, idx) => idx === i ? { ...item, grams: g } : item)); }

  const filteredFoods = FOODS.filter(f => !foodFilter || f.name.toLowerCase().includes(foodFilter.toLowerCase()) || f.category.toLowerCase().includes(foodFilter.toLowerCase()));

  // ── Doughnut Chart ──
  useEffect(() => {
    if (!doughnutRef.current) return;
    doughnutInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    doughnutInst.current = new Chart(doughnutRef.current, {
      type: "doughnut",
      data: {
        labels: ["Protein", "Carbs", "Fat"],
        datasets: [{
          data: [mealTotals.protein * 4, mealTotals.carbs * 4, mealTotals.fat * 9],
          backgroundColor: [C.blue, C.orange, C.purple],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "60%",
        plugins: { legend: { labels: { color: textColor, font: { family: "monospace", size: 10 } } } },
      },
    });
    return () => { doughnutInst.current?.destroy(); doughnutInst.current = null; };
  }, [mealTotals]);

  // ── Projection Chart ──
  useEffect(() => {
    if (!projRef.current) return;
    projInst.current?.destroy();
    const isDark = !document.documentElement.classList.contains("light");
    const gridColor = isDark ? C.gridDark : C.gridLight;
    const textColor = isDark ? "#e4e4e7" : "#3f3f46";

    projInst.current = new Chart(projRef.current, {
      type: "line",
      data: {
        labels: projectedWeights.map((_, i) => `W${i}`),
        datasets: [{ label: "Weight (kg)", data: projectedWeights, borderColor: C.green, backgroundColor: C.green + "22", fill: true, tension: 0.3 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: (v: any) => v + "kg" } },
        },
        plugins: { legend: { display: false } },
      },
    });
    return () => { projInst.current?.destroy(); projInst.current = null; };
  }, [projectedWeights]);

  const calPct = mealTotals.cal > 0 ? (mealTotals.cal / targetCal) * 100 : 0;

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="TDEE" value={`${Math.round(tdee)} cal`} color={C.blue} sub="maintenance" />
        <StatCard label="Target" value={`${Math.round(targetCal)} cal`} color={C.gold} sub={GOALS.find(g => g.key === goal)?.label || ""} />
        <StatCard label="Today's Intake" value={`${Math.round(mealTotals.cal)} cal`} color={calPct > 110 ? C.red : calPct > 90 ? C.green : C.orange} sub={`${calPct.toFixed(0)}% of target`} />
        <StatCard label="BMR" value={`${Math.round(bmr)} cal`} color={C.purple} sub="at rest" />
      </div>

      <div class="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left */}
        <div class="space-y-4">
          {/* Body stats */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Your Profile</CardTitle>
            <div class="grid gap-3 sm:grid-cols-3">
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Weight (kg)</label>
                <input type="number" value={weight} onInput={(e: any) => setWeight(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Height (cm)</label>
                <input type="number" value={height} onInput={(e: any) => setHeight(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Age</label>
                <input type="number" value={age} onInput={(e: any) => setAge(+e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Sex</label>
                <select value={sex} onChange={(e: any) => setSex(e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none">
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Activity</label>
                <select value={activity} onChange={(e: any) => setActivity(e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none">
                  {ACTIVITY_FACTORS.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Goal</label>
                <select value={goal} onChange={(e: any) => setGoal(e.target.value)}
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none">
                  {GOALS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Food log */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Food Log</CardTitle>
            <input type="text" value={foodFilter} onInput={(e: any) => setFoodFilter(e.target.value)} placeholder="Search foods..."
              class="mb-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />

            <div class="mb-3 max-h-40 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)]">
              {filteredFoods.map((f, i) => (
                <button key={i} onClick={() => addFood(FOODS.indexOf(f))}
                  class="flex w-full items-center justify-between border-b border-[var(--color-border)] px-3 py-1.5 text-left font-mono text-xs hover:bg-[var(--color-surface)]">
                  <div>
                    <span class="text-[var(--color-heading)]">{f.name}</span>
                    <span class="ml-2 text-[var(--color-text-muted)]">{f.category}</span>
                  </div>
                  <span class="text-[var(--color-text-muted)]">{f.cal} cal/100g</span>
                </button>
              ))}
            </div>

            {mealItems.length > 0 && (
              <div class="space-y-1">
                {mealItems.map((item, i) => {
                  const food = FOODS[item.foodIndex];
                  const mult = item.grams / 100;
                  return (
                    <div key={i} class="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                      <span class="flex-1 font-mono text-xs text-[var(--color-heading)]">{food.name}</span>
                      <input type="number" value={item.grams} onInput={(e: any) => setGrams(i, +e.target.value)} min="1"
                        class="w-16 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1 text-center font-mono text-[10px] text-[var(--color-text)] outline-none" />
                      <span class="font-mono text-[10px] text-[var(--color-text-muted)]">g</span>
                      <span class="w-16 text-right font-mono text-[10px]" style={{ color: C.gold }}>{Math.round(food.cal * mult)} cal</span>
                      <button onClick={() => removeItem(i)} class="text-[var(--color-text-muted)] hover:text-red-400">✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Weight projection */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Weight Projection</CardTitle>
            <div class="mb-3 flex items-center gap-2">
              <span class="font-mono text-xs text-[var(--color-text-muted)]">Weeks:</span>
              <input type="range" min="4" max="52" value={projWeeks} onInput={(e: any) => setProjWeeks(+e.target.value)} class="flex-1 accent-[#d4a843]" />
              <span class="font-mono text-xs text-[var(--color-text)]">{projWeeks}</span>
            </div>
            <div style={{ height: "200px" }}><canvas ref={projRef} /></div>
            <p class="mt-2 font-mono text-[10px] text-[var(--color-text-muted)]">
              Projected: {projectedWeights[projectedWeights.length - 1]?.toFixed(1)}kg in {projWeeks} weeks ({goalAdj > 0 ? "+" : ""}{(goalAdj * 7 / 7700).toFixed(2)}kg/week)
            </p>
          </div>
        </div>

        {/* Right */}
        <div class="space-y-4">
          {/* Macro progress */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Macro Progress</CardTitle>
            {[
              { label: "Calories", current: mealTotals.cal, target: targetCal, unit: "cal", color: C.gold },
              { label: "Protein", current: mealTotals.protein, target: macroTargets.protein, unit: "g", color: C.blue },
              { label: "Carbs", current: mealTotals.carbs, target: macroTargets.carbs, unit: "g", color: C.orange },
              { label: "Fat", current: mealTotals.fat, target: macroTargets.fat, unit: "g", color: C.purple },
              { label: "Fiber", current: mealTotals.fiber, target: macroTargets.fiber, unit: "g", color: C.green },
            ].map(m => {
              const pct = m.target > 0 ? (m.current / m.target) * 100 : 0;
              return (
                <div key={m.label} class="mb-3">
                  <div class="flex justify-between font-mono text-[10px]">
                    <span class="text-[var(--color-text)]">{m.label}</span>
                    <span class="text-[var(--color-text-muted)]">{Math.round(m.current)}/{Math.round(m.target)} {m.unit}</span>
                  </div>
                  <div class="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                    <div class="h-full rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%`, background: pct > 110 ? C.red : m.color }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Macro doughnut */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Macro Split</CardTitle>
            <div style={{ height: "200px" }}><canvas ref={doughnutRef} /></div>
          </div>

          {/* Quick reference */}
          <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <CardTitle>Daily Targets</CardTitle>
            <div class="space-y-1 font-mono text-[10px]">
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">BMR (at rest)</span><span class="text-[var(--color-text)]">{Math.round(bmr)} cal</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">TDEE (×{actFactor})</span><span class="text-[var(--color-text)]">{Math.round(tdee)} cal</span></div>
              <div class="flex justify-between font-bold"><span class="text-[var(--color-heading)]">Target</span><span style={{ color: C.gold }}>{Math.round(targetCal)} cal</span></div>
              <div class="border-t border-[var(--color-border)] pt-1 flex justify-between"><span class="text-[var(--color-text-muted)]">Protein (30%)</span><span class="text-[var(--color-text)]">{Math.round(macroTargets.protein)}g</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Carbs (40%)</span><span class="text-[var(--color-text)]">{Math.round(macroTargets.carbs)}g</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Fat (30%)</span><span class="text-[var(--color-text)]">{Math.round(macroTargets.fat)}g</span></div>
              <div class="flex justify-between"><span class="text-[var(--color-text-muted)]">Water</span><span class="text-[var(--color-text)]">{(weight * 0.033).toFixed(1)}L</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
