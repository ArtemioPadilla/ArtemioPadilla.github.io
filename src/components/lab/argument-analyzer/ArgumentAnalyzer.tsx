import { useState, useMemo } from "preact/hooks";

// ─── Colors ──────────────────────────────────────────────────────────
const C = {
  gold: "#d4a843", green: "#3fb68a", red: "#e05c6a", blue: "#4a9eff",
  orange: "#f59e0b", purple: "#a78bfa", muted: "#7d8590",
};

// ─── Types ───────────────────────────────────────────────────────────
interface Premise { id: number; text: string; isKey: boolean; }
interface FallacyMatch { name: string; severity: "high" | "medium" | "low"; description: string; }

interface Argument {
  id: number;
  name: string;
  premises: Premise[];
  conclusion: string;
  type: "deductive" | "inductive" | "abductive" | "analogical";
  fallacies: FallacyMatch[];
  notes: string;
}

// ─── Fallacy Database ────────────────────────────────────────────────
const FALLACIES: { name: string; category: string; description: string; example: string; severity: "high" | "medium" | "low" }[] = [
  { name: "Ad Hominem", category: "Relevance", description: "Attacking the person instead of the argument.", example: "You can't trust his economic analysis — he dropped out of college.", severity: "high" },
  { name: "Straw Man", category: "Relevance", description: "Misrepresenting someone's argument to make it easier to attack.", example: "You want environmental regulations? So you want to destroy all businesses.", severity: "high" },
  { name: "Appeal to Authority", category: "Relevance", description: "Claiming something is true because an authority figure said it.", example: "This celebrity says the diet works, so it must be effective.", severity: "medium" },
  { name: "Appeal to Emotion", category: "Relevance", description: "Using emotion rather than logic to persuade.", example: "Think of the children! We must ban all video games.", severity: "medium" },
  { name: "Red Herring", category: "Relevance", description: "Introducing an unrelated topic to divert attention.", example: "Why worry about climate change when there are homeless people?", severity: "medium" },
  { name: "False Dilemma", category: "Presumption", description: "Presenting only two options when more exist.", example: "You're either with us or against us.", severity: "high" },
  { name: "Slippery Slope", category: "Presumption", description: "Claiming one event will lead to a chain of negative events without evidence.", example: "If we allow flexible hours, soon nobody will come to work at all.", severity: "medium" },
  { name: "Circular Reasoning", category: "Presumption", description: "Using the conclusion as a premise.", example: "The Bible is true because God wrote it, and we know God exists because the Bible says so.", severity: "high" },
  { name: "Hasty Generalization", category: "Induction", description: "Drawing a broad conclusion from too few examples.", example: "I met two rude people from that city — everyone there must be rude.", severity: "medium" },
  { name: "False Cause", category: "Induction", description: "Assuming correlation implies causation.", example: "Ice cream sales and drownings both increase in summer, so ice cream causes drowning.", severity: "high" },
  { name: "Bandwagon", category: "Relevance", description: "Arguing something is true because many people believe it.", example: "Everyone is investing in crypto, so it must be a good investment.", severity: "medium" },
  { name: "Tu Quoque", category: "Relevance", description: "Deflecting criticism by pointing to the accuser's behavior.", example: "You smoke too, so you can't tell me to quit.", severity: "medium" },
  { name: "Equivocation", category: "Ambiguity", description: "Using a word with multiple meanings in different parts of the argument.", example: "A feather is light. What is light cannot be dark. Therefore, a feather cannot be dark.", severity: "low" },
  { name: "Loaded Question", category: "Presumption", description: "Asking a question that presupposes something unproven.", example: "When did you stop cheating on your taxes?", severity: "medium" },
  { name: "No True Scotsman", category: "Presumption", description: "Redefining criteria to exclude counterexamples.", example: "No true programmer would use that language.", severity: "low" },
  { name: "Appeal to Nature", category: "Relevance", description: "Arguing that what is natural is inherently good.", example: "Organic food is natural, so it must be healthier.", severity: "low" },
];

const ARGUMENT_TEMPLATES: { name: string; premises: string[]; conclusion: string; type: Argument["type"] }[] = [
  { name: "Modus Ponens", premises: ["If P then Q", "P is true"], conclusion: "Therefore Q", type: "deductive" },
  { name: "Modus Tollens", premises: ["If P then Q", "Q is false"], conclusion: "Therefore P is false", type: "deductive" },
  { name: "Hypothetical Syllogism", premises: ["If P then Q", "If Q then R"], conclusion: "Therefore if P then R", type: "deductive" },
  { name: "Disjunctive Syllogism", premises: ["Either P or Q", "Not P"], conclusion: "Therefore Q", type: "deductive" },
  { name: "Inductive Generalization", premises: ["Observed X in case 1", "Observed X in case 2", "Observed X in case N"], conclusion: "Therefore X is generally true", type: "inductive" },
  { name: "Argument by Analogy", premises: ["A and B share properties X, Y, Z", "A also has property W"], conclusion: "Therefore B likely has property W", type: "analogical" },
  { name: "Inference to Best Explanation", premises: ["Observation O occurred", "Hypothesis H would explain O", "No better explanation exists"], conclusion: "Therefore H is likely true", type: "abductive" },
];

// ─── Sub-components ──────────────────────────────────────────────────
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

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = { high: C.red, medium: C.orange, low: C.muted };
  return (
    <span class="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase" style={{ background: `${colors[severity]}22`, color: colors[severity] }}>
      {severity}
    </span>
  );
}

// ─── Strength Calculator ─────────────────────────────────────────────
function calcStrength(arg: Argument): { score: number; label: string; color: string; reasons: string[] } {
  let score = 50;
  const reasons: string[] = [];

  // Premises count
  if (arg.premises.length >= 3) { score += 10; reasons.push("Multiple supporting premises"); }
  else if (arg.premises.length === 1) { score -= 10; reasons.push("Only one premise — weak support"); }

  // Key premises
  const keyCount = arg.premises.filter(p => p.isKey).length;
  if (keyCount > 0) { score += 5 * keyCount; reasons.push(`${keyCount} key premise(s) identified`); }

  // Non-empty premises
  const emptyPremises = arg.premises.filter(p => p.text.trim().length < 5).length;
  if (emptyPremises > 0) { score -= 10 * emptyPremises; reasons.push(`${emptyPremises} premise(s) too vague`); }

  // Conclusion
  if (arg.conclusion.trim().length < 5) { score -= 20; reasons.push("Conclusion missing or vague"); }

  // Fallacies
  const highFallacies = arg.fallacies.filter(f => f.severity === "high").length;
  const medFallacies = arg.fallacies.filter(f => f.severity === "medium").length;
  score -= highFallacies * 20;
  score -= medFallacies * 10;
  if (highFallacies > 0) reasons.push(`${highFallacies} severe fallacy(ies) detected`);
  if (medFallacies > 0) reasons.push(`${medFallacies} moderate fallacy(ies) detected`);
  if (arg.fallacies.length === 0) { score += 10; reasons.push("No fallacies detected"); }

  // Type bonus
  if (arg.type === "deductive") { score += 5; reasons.push("Deductive form (strongest if valid)"); }

  score = Math.max(0, Math.min(100, score));
  const label = score >= 75 ? "Strong" : score >= 50 ? "Moderate" : score >= 25 ? "Weak" : "Very Weak";
  const color = score >= 75 ? C.green : score >= 50 ? C.blue : score >= 25 ? C.orange : C.red;
  return { score, label, color, reasons };
}

// ─── Main Component ──────────────────────────────────────────────────
export default function ArgumentAnalyzer() {
  const [args, setArgs] = useState<Argument[]>([{
    id: 1, name: "My Argument",
    premises: [{ id: 1, text: "", isKey: false }, { id: 2, text: "", isKey: false }],
    conclusion: "", type: "deductive", fallacies: [], notes: "",
  }]);
  const [activeArg, setActiveArg] = useState(1);
  const [nextArgId, setNextArgId] = useState(2);
  const [nextPremId, setNextPremId] = useState(3);
  const [tab, setTab] = useState<"build" | "fallacies" | "templates">("build");
  const [fallacyFilter, setFallacyFilter] = useState("");

  const current = args.find(a => a.id === activeArg) || args[0];
  const strength = useMemo(() => current ? calcStrength(current) : null, [current]);

  // ── CRUD ──
  function updateCurrent(fn: (a: Argument) => Argument) {
    setArgs(prev => prev.map(a => a.id === activeArg ? fn(a) : a));
  }
  function addArgument() {
    const id = nextArgId; setNextArgId(id + 1);
    setArgs(prev => [...prev, { id, name: `Argument ${id}`, premises: [{ id: nextPremId, text: "", isKey: false }], conclusion: "", type: "deductive", fallacies: [], notes: "" }]);
    setNextPremId(p => p + 1);
    setActiveArg(id);
  }
  function removeArgument(id: number) {
    if (args.length <= 1) return;
    const remaining = args.filter(a => a.id !== id);
    setArgs(remaining);
    if (activeArg === id) setActiveArg(remaining[0].id);
  }
  function addPremise() {
    const id = nextPremId; setNextPremId(id + 1);
    updateCurrent(a => ({ ...a, premises: [...a.premises, { id, text: "", isKey: false }] }));
  }
  function removePremise(pid: number) {
    updateCurrent(a => ({ ...a, premises: a.premises.filter(p => p.id !== pid) }));
  }
  function setPremText(pid: number, text: string) {
    updateCurrent(a => ({ ...a, premises: a.premises.map(p => p.id === pid ? { ...p, text } : p) }));
  }
  function toggleKey(pid: number) {
    updateCurrent(a => ({ ...a, premises: a.premises.map(p => p.id === pid ? { ...p, isKey: !p.isKey } : p) }));
  }
  function addFallacy(name: string) {
    const f = FALLACIES.find(x => x.name === name);
    if (!f || current.fallacies.some(x => x.name === name)) return;
    updateCurrent(a => ({ ...a, fallacies: [...a.fallacies, { name: f.name, severity: f.severity, description: f.description }] }));
  }
  function removeFallacy(name: string) {
    updateCurrent(a => ({ ...a, fallacies: a.fallacies.filter(f => f.name !== name) }));
  }
  function loadTemplate(t: typeof ARGUMENT_TEMPLATES[0]) {
    let pid = nextPremId;
    const premises = t.premises.map(text => ({ id: pid++, text, isKey: false }));
    setNextPremId(pid);
    updateCurrent(a => ({ ...a, premises, conclusion: t.conclusion, type: t.type, name: t.name }));
  }

  const filteredFallacies = FALLACIES.filter(f =>
    !fallacyFilter || f.name.toLowerCase().includes(fallacyFilter.toLowerCase()) || f.category.toLowerCase().includes(fallacyFilter.toLowerCase())
  );

  return (
    <div class="space-y-6">
      {/* Summary */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Strength" value={strength?.label || "—"} color={strength?.color} sub={strength ? `${strength.score}/100` : ""} />
        <StatCard label="Premises" value={String(current?.premises.length || 0)} color={C.blue} />
        <StatCard label="Fallacies" value={String(current?.fallacies.length || 0)} color={current?.fallacies.length ? C.red : C.green} />
        <StatCard label="Type" value={current?.type || "—"} color={C.purple} />
      </div>

      {/* Argument tabs */}
      <div class="flex gap-2 overflow-x-auto">
        {args.map(a => (
          <button key={a.id} onClick={() => setActiveArg(a.id)}
            class={`flex items-center gap-2 rounded px-3 py-1.5 font-mono text-xs transition-colors ${activeArg === a.id ? "text-[var(--color-bg)]" : "border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
            style={activeArg === a.id ? { background: C.gold } : undefined}>
            {a.name}
            {args.length > 1 && <span onClick={(e) => { e.stopPropagation(); removeArgument(a.id); }} class="ml-1 hover:text-red-400">✕</span>}
          </button>
        ))}
        <button onClick={addArgument} class="rounded border border-dashed border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">+ New</button>
      </div>

      {/* Mode tabs */}
      <div class="flex gap-2 border-b border-[var(--color-border)] pb-2">
        {(["build", "fallacies", "templates"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            class={`px-3 py-1.5 font-mono text-xs transition-colors ${tab === t ? "border-b-2 text-[var(--color-heading)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
            style={tab === t ? { borderColor: C.gold } : undefined}>
            {t === "build" ? "Build Argument" : t === "fallacies" ? "Fallacy Checker" : "Templates"}
          </button>
        ))}
      </div>

      {/* Build tab */}
      {tab === "build" && current && (
        <div class="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div class="space-y-4">
            {/* Argument name & type */}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Argument Setup</CardTitle>
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Name</label>
                  <input type="text" value={current.name} onInput={(e: any) => updateCurrent(a => ({ ...a, name: e.target.value }))}
                    class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
                </div>
                <div>
                  <label class="mb-1 block font-mono text-[10px] uppercase text-[var(--color-text-muted)]">Type</label>
                  <select value={current.type} onChange={(e: any) => updateCurrent(a => ({ ...a, type: e.target.value }))}
                    class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none">
                    <option value="deductive">Deductive</option>
                    <option value="inductive">Inductive</option>
                    <option value="abductive">Abductive</option>
                    <option value="analogical">Analogical</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Premises */}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Premises</CardTitle>
              <div class="space-y-2">
                {current.premises.map((p, i) => (
                  <div key={p.id} class="flex items-start gap-2">
                    <span class="mt-2.5 font-mono text-xs text-[var(--color-text-muted)]">P{i + 1}</span>
                    <div class="flex-1">
                      <input type="text" value={p.text} onInput={(e: any) => setPremText(p.id, e.target.value)}
                        placeholder="Enter premise..."
                        class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]" />
                    </div>
                    <button onClick={() => toggleKey(p.id)} title="Mark as key premise"
                      class={`mt-1.5 rounded px-2 py-1 font-mono text-[10px] ${p.isKey ? "text-[var(--color-bg)]" : "border border-[var(--color-border)] text-[var(--color-text-muted)]"}`}
                      style={p.isKey ? { background: C.gold } : undefined}>KEY</button>
                    {current.premises.length > 1 && (
                      <button onClick={() => removePremise(p.id)} class="mt-2 text-[var(--color-text-muted)] hover:text-red-400">✕</button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={addPremise} class="mt-3 rounded border border-dashed border-[var(--color-border)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-muted)] hover:border-[var(--color-primary)]">+ Add Premise</button>
            </div>

            {/* Conclusion */}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Conclusion</CardTitle>
              <div class="flex items-start gap-2">
                <span class="mt-2.5 font-mono text-xs" style={{ color: C.gold }}>∴</span>
                <input type="text" value={current.conclusion} onInput={(e: any) => updateCurrent(a => ({ ...a, conclusion: e.target.value }))}
                  placeholder="Therefore..."
                  class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]" />
              </div>
            </div>

            {/* Detected Fallacies */}
            {current.fallacies.length > 0 && (
              <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <CardTitle>Detected Fallacies</CardTitle>
                <div class="space-y-2">
                  {current.fallacies.map(f => (
                    <div key={f.name} class="flex items-start gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
                      <SeverityBadge severity={f.severity} />
                      <div class="flex-1">
                        <div class="font-mono text-sm font-bold text-[var(--color-heading)]">{f.name}</div>
                        <div class="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{f.description}</div>
                      </div>
                      <button onClick={() => removeFallacy(f.name)} class="text-[var(--color-text-muted)] hover:text-red-400">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Notes</CardTitle>
              <textarea value={current.notes} onInput={(e: any) => updateCurrent(a => ({ ...a, notes: e.target.value }))}
                rows={3} placeholder="Analysis notes..."
                class="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)]" />
            </div>
          </div>

          {/* Right: Strength panel */}
          <div class="space-y-4">
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Argument Strength</CardTitle>
              <div class="text-center">
                <div class="font-mono text-4xl font-bold" style={{ color: strength?.color }}>{strength?.score}</div>
                <div class="mt-1 font-mono text-sm" style={{ color: strength?.color }}>{strength?.label}</div>
                <div class="mx-auto mt-3 h-3 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                  <div class="h-full rounded-full transition-all" style={{ width: `${strength?.score || 0}%`, background: strength?.color }} />
                </div>
              </div>
              <div class="mt-4 space-y-1">
                {strength?.reasons.map((r, i) => (
                  <div key={i} class="font-mono text-[10px] text-[var(--color-text-muted)]">• {r}</div>
                ))}
              </div>
            </div>

            {/* Argument structure */}
            <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <CardTitle>Structure</CardTitle>
              <div class="space-y-2 font-mono text-xs">
                {current.premises.map((p, i) => (
                  <div key={p.id} class="flex gap-2">
                    <span class="text-[var(--color-text-muted)]">P{i + 1}:</span>
                    <span class={p.text.trim() ? "text-[var(--color-text)]" : "italic text-[var(--color-text-muted)]"}>
                      {p.text.trim() || "(empty)"}
                      {p.isKey && <span class="ml-1" style={{ color: C.gold }}>[KEY]</span>}
                    </span>
                  </div>
                ))}
                <div class="border-t border-[var(--color-border)] pt-2 flex gap-2">
                  <span style={{ color: C.gold }}>∴</span>
                  <span class={current.conclusion.trim() ? "text-[var(--color-heading)]" : "italic text-[var(--color-text-muted)]"}>
                    {current.conclusion.trim() || "(empty)"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fallacies tab */}
      {tab === "fallacies" && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <CardTitle>Fallacy Reference</CardTitle>
          <input type="text" value={fallacyFilter} onInput={(e: any) => setFallacyFilter(e.target.value)}
            placeholder="Search fallacies..."
            class="mb-4 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-text)] outline-none" />
          <div class="grid gap-3 sm:grid-cols-2">
            {filteredFallacies.map(f => {
              const active = current?.fallacies.some(x => x.name === f.name);
              return (
                <div key={f.name} class={`rounded border p-3 transition-colors ${active ? "border-red-500/50 bg-red-500/5" : "border-[var(--color-border)] bg-[var(--color-bg)]"}`}>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-sm font-bold text-[var(--color-heading)]">{f.name}</span>
                      <SeverityBadge severity={f.severity} />
                    </div>
                    <button onClick={() => active ? removeFallacy(f.name) : addFallacy(f.name)}
                      class={`rounded px-2 py-0.5 font-mono text-[10px] ${active ? "bg-red-500/20 text-red-400" : "border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]"}`}>
                      {active ? "Remove" : "Flag"}
                    </button>
                  </div>
                  <div class="mt-1 font-mono text-[10px] uppercase text-[var(--color-text-muted)]">{f.category}</div>
                  <div class="mt-1 font-mono text-xs text-[var(--color-text-muted)]">{f.description}</div>
                  <div class="mt-2 rounded bg-[var(--color-surface)] p-2 font-mono text-[10px] italic text-[var(--color-text-muted)]">"{f.example}"</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Templates tab */}
      {tab === "templates" && (
        <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <CardTitle>Argument Forms</CardTitle>
          <div class="grid gap-3 sm:grid-cols-2">
            {ARGUMENT_TEMPLATES.map(t => (
              <div key={t.name} class="rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
                <div class="flex items-center justify-between">
                  <span class="font-mono text-sm font-bold text-[var(--color-heading)]">{t.name}</span>
                  <span class="rounded px-2 py-0.5 font-mono text-[10px] uppercase" style={{ color: C.purple, background: `${C.purple}22` }}>{t.type}</span>
                </div>
                <div class="mt-2 space-y-1 font-mono text-xs text-[var(--color-text-muted)]">
                  {t.premises.map((p, i) => <div key={i}>P{i + 1}: {p}</div>)}
                  <div class="border-t border-[var(--color-border)] pt-1" style={{ color: C.gold }}>∴ {t.conclusion}</div>
                </div>
                <button onClick={() => loadTemplate(t)}
                  class="mt-3 rounded border border-[var(--color-border)] px-3 py-1 font-mono text-[10px] text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-text)]">
                  Use Template
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
