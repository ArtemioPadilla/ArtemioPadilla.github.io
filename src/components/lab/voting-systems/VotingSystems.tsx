import { useState, useEffect, useRef, useCallback, useMemo } from "preact/hooks";

/* ══════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════ */

interface Candidate {
  id: string;
  x: number;
  y: number;
  color: string;
}

interface VoterCluster {
  x: number;
  y: number;
  spread: number;
  count: number;
}

interface VoterPrefs {
  ranking: string[];
  distances: Map<string, number>;
}

interface MethodResult {
  name: string;
  winner: string;
  details: string;
  tally: Map<string, number>;
}

interface IRVRound {
  eliminated: string;
  counts: Map<string, number>;
  remaining: string[];
}

interface ScenarioPreset {
  name: string;
  candidates: Candidate[];
  clusters: VoterCluster[];
}

type DragTarget =
  | { type: "candidate"; idx: number }
  | { type: "cluster"; idx: number }
  | null;

/* ══════════════════════════════════════════════════════════
   Constants
   ══════════════════════════════════════════════════════════ */

const CANVAS_W = 500;
const CANVAS_H = 500;
const MARGIN = 30;
const APPROVAL_THRESHOLD = 0.55;

const CANDIDATE_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#ec4899"];
const CANDIDATE_LABELS = ["A", "B", "C", "D", "E", "F"];

const DEFAULT_CANDIDATES: Candidate[] = [
  { id: "A", x: -0.4, y: 0.3, color: CANDIDATE_COLORS[0] },
  { id: "B", x: 0.4, y: 0.3, color: CANDIDATE_COLORS[1] },
  { id: "C", x: 0.0, y: -0.3, color: CANDIDATE_COLORS[2] },
  { id: "D", x: -0.2, y: -0.1, color: CANDIDATE_COLORS[3] },
];

const DEFAULT_CLUSTERS: VoterCluster[] = [
  { x: -0.5, y: 0.4, spread: 0.25, count: 200 },
  { x: 0.3, y: 0.2, spread: 0.2, count: 150 },
  { x: 0.0, y: -0.4, spread: 0.3, count: 180 },
];

const CLUSTER_COLORS = [
  "rgba(59,130,246,0.12)",
  "rgba(239,68,68,0.12)",
  "rgba(34,197,94,0.12)",
  "rgba(245,158,11,0.12)",
];
const CLUSTER_BORDER = [
  "rgba(59,130,246,0.35)",
  "rgba(239,68,68,0.35)",
  "rgba(34,197,94,0.35)",
  "rgba(245,158,11,0.35)",
];

const PRESETS: ScenarioPreset[] = [
  {
    name: "Default",
    candidates: DEFAULT_CANDIDATES,
    clusters: DEFAULT_CLUSTERS,
  },
  {
    name: "Spoiler Effect",
    candidates: [
      { id: "A", x: -0.5, y: 0.0, color: CANDIDATE_COLORS[0] },
      { id: "B", x: 0.5, y: 0.0, color: CANDIDATE_COLORS[1] },
      { id: "C", x: -0.3, y: 0.1, color: CANDIDATE_COLORS[2] },
    ],
    clusters: [
      { x: -0.45, y: 0.0, spread: 0.25, count: 250 },
      { x: 0.4, y: 0.0, spread: 0.3, count: 220 },
    ],
  },
  {
    name: "Condorcet Paradox",
    candidates: [
      { id: "A", x: -0.5, y: 0.5, color: CANDIDATE_COLORS[0] },
      { id: "B", x: 0.5, y: 0.5, color: CANDIDATE_COLORS[1] },
      { id: "C", x: 0.0, y: -0.5, color: CANDIDATE_COLORS[2] },
    ],
    clusters: [
      { x: -0.6, y: 0.3, spread: 0.15, count: 180 },
      { x: 0.6, y: 0.3, spread: 0.15, count: 180 },
      { x: 0.0, y: -0.6, spread: 0.15, count: 180 },
    ],
  },
  {
    name: "Majority vs Plurality",
    candidates: [
      { id: "A", x: -0.6, y: 0.0, color: CANDIDATE_COLORS[0] },
      { id: "B", x: 0.1, y: 0.0, color: CANDIDATE_COLORS[1] },
      { id: "C", x: 0.6, y: 0.0, color: CANDIDATE_COLORS[2] },
    ],
    clusters: [
      { x: -0.5, y: 0.0, spread: 0.2, count: 200 },
      { x: 0.0, y: 0.1, spread: 0.25, count: 160 },
      { x: 0.5, y: 0.0, spread: 0.2, count: 170 },
    ],
  },
];

/* ══════════════════════════════════════════════════════════
   Coordinate transforms & math
   ══════════════════════════════════════════════════════════ */

function toCanvas(val: number, size: number): number {
  return MARGIN + ((val + 1) / 2) * (size - 2 * MARGIN);
}

function fromCanvas(px: number, size: number): number {
  return ((px - MARGIN) / (size - 2 * MARGIN)) * 2 - 1;
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function gaussRandom(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/* ══════════════════════════════════════════════════════════
   Voter generation
   ══════════════════════════════════════════════════════════ */

function generateVoters(clusters: VoterCluster[]): Array<{ x: number; y: number }> {
  const voters: Array<{ x: number; y: number }> = [];
  for (const cluster of clusters) {
    for (let i = 0; i < cluster.count; i++) {
      const x = clamp(cluster.x + gaussRandom() * cluster.spread, -1, 1);
      const y = clamp(cluster.y + gaussRandom() * cluster.spread, -1, 1);
      voters.push({ x, y });
    }
  }
  return voters;
}

function getVoterPreferences(
  voter: { x: number; y: number },
  candidates: Candidate[],
): VoterPrefs {
  const distances = new Map<string, number>();
  for (const c of candidates) {
    distances.set(c.id, dist(voter.x, voter.y, c.x, c.y));
  }
  const ranking = [...candidates]
    .sort((a, b) => (distances.get(a.id) ?? 0) - (distances.get(b.id) ?? 0))
    .map((c) => c.id);
  return { ranking, distances };
}

/* ══════════════════════════════════════════════════════════
   Voting methods
   ══════════════════════════════════════════════════════════ */

function runPlurality(allPrefs: VoterPrefs[], candidates: Candidate[]): MethodResult {
  const tally = new Map<string, number>();
  for (const c of candidates) tally.set(c.id, 0);
  for (const pref of allPrefs) {
    const top = pref.ranking[0];
    tally.set(top, (tally.get(top) ?? 0) + 1);
  }
  let winner = candidates[0].id;
  let max = 0;
  for (const [id, count] of tally) {
    if (count > max) { max = count; winner = id; }
  }
  const details = candidates.map((c) => `${c.id}: ${tally.get(c.id) ?? 0}`).join(", ");
  return { name: "Plurality", winner, details, tally };
}

function runIRV(
  allPrefs: VoterPrefs[],
  candidates: Candidate[],
): { result: MethodResult; rounds: IRVRound[] } {
  let remaining = candidates.map((c) => c.id);
  const rounds: IRVRound[] = [];
  const total = allPrefs.length;

  for (let round = 0; round < candidates.length - 1; round++) {
    const tally = new Map<string, number>();
    for (const id of remaining) tally.set(id, 0);

    for (const pref of allPrefs) {
      const top = pref.ranking.find((id) => remaining.includes(id));
      if (top) tally.set(top, (tally.get(top) ?? 0) + 1);
    }

    // Check majority
    for (const [id, count] of tally) {
      if (count > total / 2) {
        rounds.push({ eliminated: "", counts: tally, remaining: [...remaining] });
        const details = rounds.map((r, i) => {
          const entries = [...r.counts.entries()].map(([k, v]) => `${k}:${v}`).join(" ");
          return r.eliminated
            ? `R${i + 1}: ${entries} (elim ${r.eliminated})`
            : `R${i + 1}: ${entries} -> ${id} wins`;
        }).join(" | ");
        return {
          result: { name: "Ranked-Choice (IRV)", winner: id, details, tally },
          rounds,
        };
      }
    }

    // Eliminate lowest
    let minCount = Infinity;
    let minId = remaining[0];
    for (const [id, count] of tally) {
      if (count < minCount) { minCount = count; minId = id; }
    }

    rounds.push({ eliminated: minId, counts: tally, remaining: [...remaining] });
    remaining = remaining.filter((id) => id !== minId);
  }

  const tally = new Map<string, number>();
  tally.set(remaining[0], total);
  const details = rounds
    .map((r, i) => {
      const entries = [...r.counts.entries()].map(([k, v]) => `${k}:${v}`).join(" ");
      return `R${i + 1}: ${entries} (elim ${r.eliminated})`;
    })
    .join(" | ");
  return {
    result: { name: "Ranked-Choice (IRV)", winner: remaining[0], details, tally },
    rounds,
  };
}

function runApproval(allPrefs: VoterPrefs[], candidates: Candidate[]): MethodResult {
  const tally = new Map<string, number>();
  for (const c of candidates) tally.set(c.id, 0);
  for (const pref of allPrefs) {
    for (const c of candidates) {
      if ((pref.distances.get(c.id) ?? Infinity) <= APPROVAL_THRESHOLD) {
        tally.set(c.id, (tally.get(c.id) ?? 0) + 1);
      }
    }
  }
  let winner = candidates[0].id;
  let max = 0;
  for (const [id, count] of tally) {
    if (count > max) { max = count; winner = id; }
  }
  const details = candidates.map((c) => `${c.id}: ${tally.get(c.id) ?? 0}`).join(", ");
  return { name: `Approval (d<${APPROVAL_THRESHOLD})`, winner, details, tally };
}

function runBorda(allPrefs: VoterPrefs[], candidates: Candidate[]): MethodResult {
  const n = candidates.length;
  const tally = new Map<string, number>();
  for (const c of candidates) tally.set(c.id, 0);
  for (const pref of allPrefs) {
    for (let rank = 0; rank < pref.ranking.length; rank++) {
      const id = pref.ranking[rank];
      if (tally.has(id)) {
        tally.set(id, (tally.get(id) ?? 0) + (n - 1 - rank));
      }
    }
  }
  let winner = candidates[0].id;
  let max = 0;
  for (const [id, count] of tally) {
    if (count > max) { max = count; winner = id; }
  }
  const details = candidates.map((c) => `${c.id}: ${tally.get(c.id) ?? 0}pts`).join(", ");
  return { name: "Borda Count", winner, details, tally };
}

function runCondorcet(allPrefs: VoterPrefs[], candidates: Candidate[]): MethodResult {
  const ids = candidates.map((c) => c.id);
  const pairwise = new Map<string, number>();
  for (const a of ids) {
    for (const b of ids) {
      if (a !== b) pairwise.set(`${a}>${b}`, 0);
    }
  }

  for (const pref of allPrefs) {
    for (let i = 0; i < pref.ranking.length; i++) {
      for (let j = i + 1; j < pref.ranking.length; j++) {
        const key = `${pref.ranking[i]}>${pref.ranking[j]}`;
        pairwise.set(key, (pairwise.get(key) ?? 0) + 1);
      }
    }
  }

  let condorcetWinner: string | null = null;
  for (const a of ids) {
    let winsAll = true;
    for (const b of ids) {
      if (a === b) continue;
      const ab = pairwise.get(`${a}>${b}`) ?? 0;
      const ba = pairwise.get(`${b}>${a}`) ?? 0;
      if (ab <= ba) { winsAll = false; break; }
    }
    if (winsAll) { condorcetWinner = a; break; }
  }

  const matchups: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ab = pairwise.get(`${ids[i]}>${ids[j]}`) ?? 0;
      const ba = pairwise.get(`${ids[j]}>${ids[i]}`) ?? 0;
      const wChar = ab > ba ? ids[i] : ba > ab ? ids[j] : "tie";
      matchups.push(`${ids[i]}v${ids[j]}:${wChar}`);
    }
  }

  const tally = new Map<string, number>();
  for (const id of ids) {
    let wins = 0;
    for (const other of ids) {
      if (id === other) continue;
      if ((pairwise.get(`${id}>${other}`) ?? 0) > (pairwise.get(`${other}>${id}`) ?? 0)) wins++;
    }
    tally.set(id, wins);
  }

  const winner = condorcetWinner ?? findCopelandWinner(tally, ids);
  const details = condorcetWinner
    ? `${condorcetWinner} beats all: ${matchups.join(", ")}`
    : `No Condorcet winner (cycle). Copeland: ${ids.map((id) => `${id}:${tally.get(id)}w`).join(" ")}`;

  return { name: "Condorcet", winner, details, tally };
}

function findCopelandWinner(tally: Map<string, number>, ids: string[]): string {
  let best = ids[0];
  let bestWins = 0;
  for (const id of ids) {
    const w = tally.get(id) ?? 0;
    if (w > bestWins) { bestWins = w; best = id; }
  }
  return best;
}

/* ══════════════════════════════════════════════════════════
   Canvas drawing
   ══════════════════════════════════════════════════════════ */

function drawCompass(
  ctx: CanvasRenderingContext2D,
  candidates: Candidate[],
  clusters: VoterCluster[],
  voters: Array<{ x: number; y: number }>,
  w: number,
  h: number,
  irvHighlight: Set<string>,
): void {
  ctx.clearRect(0, 0, w, h);

  // Background grid
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 0.5;
  for (let v = -1; v <= 1; v += 0.25) {
    const px = toCanvas(v, w);
    const py = toCanvas(v, h);
    ctx.beginPath(); ctx.moveTo(px, MARGIN); ctx.lineTo(px, h - MARGIN); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(MARGIN, py); ctx.lineTo(w - MARGIN, py); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 1;
  const cx = toCanvas(0, w);
  const cy = toCanvas(0, h);
  ctx.beginPath(); ctx.moveTo(cx, MARGIN); ctx.lineTo(cx, h - MARGIN); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(MARGIN, cy); ctx.lineTo(w - MARGIN, cy); ctx.stroke();

  // Labels
  ctx.fillStyle = "#71717a";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Economic Left", MARGIN + 30, h - MARGIN + 16);
  ctx.fillText("Economic Right", w - MARGIN - 30, h - MARGIN + 16);
  ctx.textAlign = "left";
  ctx.save();
  ctx.translate(MARGIN - 16, cy);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Social", 0, 0);
  ctx.restore();

  // Voter clusters
  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    const px = toCanvas(cluster.x, w);
    const py = toCanvas(cluster.y, h);
    const radius = (cluster.spread / 2) * (w - 2 * MARGIN);

    ctx.fillStyle = CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
    ctx.strokeStyle = CLUSTER_BORDER[ci % CLUSTER_BORDER.length];
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    ctx.fillStyle = CLUSTER_BORDER[ci % CLUSTER_BORDER.length];
    ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#a1a1aa";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${cluster.count} voters`, px, py + radius + 14);
  }

  // Voter dots
  ctx.fillStyle = "rgba(228,228,231,0.15)";
  for (const v of voters) {
    ctx.fillRect(toCanvas(v.x, w) - 0.8, toCanvas(v.y, h) - 0.8, 1.6, 1.6);
  }

  // Candidates
  for (const c of candidates) {
    const px = toCanvas(c.x, w);
    const py = toCanvas(c.y, h);
    const eliminated = irvHighlight.size > 0 && !irvHighlight.has(c.id);
    const alpha = eliminated ? 0.25 : 1;

    // Glow
    ctx.globalAlpha = alpha;
    ctx.fillStyle = c.color + "33";
    ctx.beginPath(); ctx.arc(px, py, 18, 0, Math.PI * 2); ctx.fill();

    // Dot
    ctx.fillStyle = c.color;
    ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill();

    // Border
    ctx.strokeStyle = eliminated ? "#555" : "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.stroke();

    // Label
    ctx.fillStyle = eliminated ? "#888" : "#ffffff";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c.id, px, py);
    ctx.textBaseline = "alphabetic";
    ctx.globalAlpha = 1;

    // X for eliminated
    if (eliminated) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(px - 6, py - 6); ctx.lineTo(px + 6, py + 6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px + 6, py - 6); ctx.lineTo(px - 6, py + 6); ctx.stroke();
    }
  }

  // Approval radius
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const c of candidates) {
    const px = toCanvas(c.x, w);
    const py = toCanvas(c.y, h);
    ctx.beginPath();
    ctx.arc(px, py, (APPROVAL_THRESHOLD / 2) * (w - 2 * MARGIN), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/* ══════════════════════════════════════════════════════════
   Component
   ══════════════════════════════════════════════════════════ */

export default function VotingSystems() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [candidates, setCandidates] = useState<Candidate[]>([...DEFAULT_CANDIDATES]);
  const [clusters, setClusters] = useState<VoterCluster[]>([...DEFAULT_CLUSTERS]);
  const [numCandidates, setNumCandidates] = useState(4);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [irvRoundIdx, setIrvRoundIdx] = useState(-1);
  const [irvPlaying, setIrvPlaying] = useState(false);
  const irvTimerRef = useRef(0);

  const voters = useMemo(() => generateVoters(clusters), [clusters]);
  const allPrefs = useMemo(
    () => voters.map((v) => getVoterPreferences(v, candidates)),
    [voters, candidates],
  );

  const irvData = useMemo(() => {
    if (candidates.length < 2) return null;
    return runIRV(allPrefs, candidates);
  }, [allPrefs, candidates]);

  const results: MethodResult[] = useMemo(() => {
    if (candidates.length < 2) return [];
    return [
      runPlurality(allPrefs, candidates),
      irvData?.result ?? { name: "Ranked-Choice (IRV)", winner: "", details: "N/A", tally: new Map() },
      runApproval(allPrefs, candidates),
      runBorda(allPrefs, candidates),
      runCondorcet(allPrefs, candidates),
    ];
  }, [allPrefs, candidates, irvData]);

  const winners = useMemo(() => new Set(results.map((r) => r.winner)), [results]);
  const disagreement = winners.size > 1;

  // IRV animation highlight
  const irvHighlight = useMemo(() => {
    if (!irvData || irvRoundIdx < 0) return new Set<string>();
    const round = irvData.rounds[Math.min(irvRoundIdx, irvData.rounds.length - 1)];
    return new Set(round.remaining.filter((id) => id !== round.eliminated));
  }, [irvData, irvRoundIdx]);

  // IRV auto-play
  useEffect(() => {
    if (!irvPlaying || !irvData) return;
    const maxRound = irvData.rounds.length - 1;
    irvTimerRef.current = window.setInterval(() => {
      setIrvRoundIdx((prev) => {
        const next = prev + 1;
        if (next > maxRound) {
          setIrvPlaying(false);
          return maxRound;
        }
        return next;
      });
    }, 1200);
    return () => clearInterval(irvTimerRef.current);
  }, [irvPlaying, irvData]);

  // Draw canvas
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawCompass(ctx, candidates, clusters, voters, canvas.width, canvas.height, irvHighlight);
  }, [candidates, clusters, voters, irvHighlight]);

  useEffect(() => { redraw(); }, [redraw]);

  // Dragging
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      const wx = fromCanvas(mx, canvas.width);
      const wy = fromCanvas(my, canvas.height);

      for (let i = 0; i < candidates.length; i++) {
        if (dist(wx, wy, candidates[i].x, candidates[i].y) < 0.08) {
          setDragTarget({ type: "candidate", idx: i });
          return;
        }
      }
      for (let i = 0; i < clusters.length; i++) {
        if (dist(wx, wy, clusters[i].x, clusters[i].y) < 0.1) {
          setDragTarget({ type: "cluster", idx: i });
          return;
        }
      }
    },
    [candidates, clusters],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragTarget) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (canvas.height / rect.height);
      const wx = clamp(fromCanvas(mx, canvas.width), -0.95, 0.95);
      const wy = clamp(fromCanvas(my, canvas.height), -0.95, 0.95);

      if (dragTarget.type === "candidate") {
        setCandidates((prev) => {
          const next = [...prev];
          next[dragTarget.idx] = { ...next[dragTarget.idx], x: wx, y: wy };
          return next;
        });
      } else {
        setClusters((prev) => {
          const next = [...prev];
          next[dragTarget.idx] = { ...next[dragTarget.idx], x: wx, y: wy };
          return next;
        });
      }
    },
    [dragTarget],
  );

  const handleMouseUp = useCallback(() => { setDragTarget(null); }, []);

  const handleCandidateCount = useCallback(
    (count: number) => {
      setNumCandidates(count);
      const newCandidates: Candidate[] = [];
      for (let i = 0; i < count; i++) {
        if (i < candidates.length) {
          newCandidates.push(candidates[i]);
        } else {
          const angle = (i / count) * Math.PI * 2;
          newCandidates.push({
            id: CANDIDATE_LABELS[i],
            x: Math.cos(angle) * 0.4,
            y: Math.sin(angle) * 0.4,
            color: CANDIDATE_COLORS[i],
          });
        }
      }
      setCandidates(newCandidates);
    },
    [candidates],
  );

  const addCluster = useCallback(() => {
    if (clusters.length >= 4) return;
    setClusters((prev) => [
      ...prev,
      { x: Math.random() * 1.2 - 0.6, y: Math.random() * 1.2 - 0.6, spread: 0.2, count: 150 },
    ]);
  }, [clusters.length]);

  const removeCluster = useCallback((idx: number) => {
    if (clusters.length <= 1) return;
    setClusters((prev) => prev.filter((_, i) => i !== idx));
  }, [clusters.length]);

  const handleClusterSpread = useCallback((idx: number, spread: number) => {
    setClusters((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], spread };
      return next;
    });
  }, []);

  const handleClusterCount = useCallback((idx: number, count: number) => {
    setClusters((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], count };
      return next;
    });
  }, []);

  const handleRandomize = useCallback(() => {
    setCandidates((prev) =>
      prev.map((c) => ({ ...c, x: Math.random() * 1.6 - 0.8, y: Math.random() * 1.6 - 0.8 })),
    );
    setClusters((prev) =>
      prev.map((c) => ({ ...c, x: Math.random() * 1.6 - 0.8, y: Math.random() * 1.6 - 0.8 })),
    );
  }, []);

  const applyPreset = useCallback((preset: ScenarioPreset) => {
    setCandidates([...preset.candidates]);
    setClusters([...preset.clusters]);
    setNumCandidates(preset.candidates.length);
    setIrvRoundIdx(-1);
    setIrvPlaying(false);
  }, []);

  const startIRVAnimation = useCallback(() => {
    setIrvRoundIdx(0);
    setIrvPlaying(true);
  }, []);

  const stopIRVAnimation = useCallback(() => {
    setIrvPlaying(false);
    setIrvRoundIdx(-1);
  }, []);

  return (
    <div class="space-y-4">
      {/* Header */}
      <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h3 class="mb-2 text-lg font-bold text-[var(--color-heading)]">
          Voting Systems Explorer
        </h3>
        <p class="text-sm text-[var(--color-text-muted)]">
          Drag candidates (colored dots) and voter clusters on the 2D compass. Each voter prefers
          the closest candidate. Compare how 6 different voting methods pick different winners from
          the same preferences.
        </p>
      </div>

      {/* Presets */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] font-medium text-[var(--color-text-muted)]">Scenarios:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyPreset(preset)}
            class="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div class="flex flex-col gap-4 xl:flex-row">
        {/* Canvas */}
        <div class="space-y-3">
          <div class="overflow-hidden rounded-lg border border-[var(--color-border)]">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              class="block cursor-grab active:cursor-grabbing"
              style={{ width: CANVAS_W, height: CANVAS_H, background: "#09090b" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          </div>

          {/* Quick controls */}
          <div class="flex flex-wrap items-center gap-2">
            <label class="text-xs text-[var(--color-text-muted)]">Candidates:</label>
            {[3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => handleCandidateCount(n)}
                class="rounded border px-3 py-1 text-xs font-mono"
                style={{
                  borderColor:
                    numCandidates === n ? "var(--color-primary)" : "var(--color-border)",
                  color: numCandidates === n ? "var(--color-primary)" : "var(--color-text-muted)",
                  background: "var(--color-surface)",
                }}
              >
                {n}
              </button>
            ))}
            <button
              onClick={handleRandomize}
              class="ml-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-text)]"
            >
              Randomize
            </button>
          </div>

          {/* IRV animation controls */}
          {irvData && irvData.rounds.length > 1 && (
            <div class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
              <span class="text-[11px] text-[var(--color-text-muted)]">IRV Rounds:</span>
              <button
                onClick={irvPlaying ? stopIRVAnimation : startIRVAnimation}
                class="rounded bg-[var(--color-primary)] px-3 py-1 text-xs font-medium text-white"
              >
                {irvPlaying ? "Stop" : "Animate"}
              </button>
              {irvRoundIdx >= 0 && (
                <span class="text-xs font-mono text-[var(--color-heading)]">
                  Round {irvRoundIdx + 1} of {irvData.rounds.length}
                  {irvData.rounds[Math.min(irvRoundIdx, irvData.rounds.length - 1)].eliminated &&
                    ` (elim ${irvData.rounds[Math.min(irvRoundIdx, irvData.rounds.length - 1)].eliminated})`}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right panel */}
        <div class="flex-1 space-y-3">
          {/* Results Table */}
          <div
            class="rounded-xl border bg-[var(--color-surface)] p-3"
            style={{ borderColor: disagreement ? "#f59e0b" : "var(--color-border)" }}
          >
            {disagreement && (
              <div
                class="mb-2 rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}
              >
                Different methods produce different winners!
              </div>
            )}
            <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">
              Results ({voters.length} voters)
            </h4>
            <div class="space-y-1.5">
              {results.map((r) => {
                const candidateInfo = candidates.find((c) => c.id === r.winner);
                return (
                  <div
                    key={r.name}
                    class="rounded-lg border p-2"
                    style={{
                      borderColor: candidateInfo?.color ?? "var(--color-border)",
                      background: (candidateInfo?.color ?? "#fff") + "0d",
                    }}
                  >
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-medium text-[var(--color-text)]">{r.name}</span>
                      <span
                        class="rounded-full px-2 py-0.5 text-xs font-bold text-white"
                        style={{ background: candidateInfo?.color ?? "#666" }}
                      >
                        Winner: {r.winner}
                      </span>
                    </div>
                    <div class="mt-1 break-all font-mono text-xs text-[var(--color-text-muted)]">
                      {r.details}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cluster Controls */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <div class="mb-2 flex items-center justify-between">
              <h4 class="text-sm font-semibold text-[var(--color-heading)]">Voter Clusters</h4>
              <div class="flex gap-1">
                {clusters.length < 4 && (
                  <button
                    onClick={addCluster}
                    class="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
                  >
                    + Add
                  </button>
                )}
              </div>
            </div>
            <div class="space-y-3">
              {clusters.map((cluster, ci) => (
                <div key={ci} class="space-y-1">
                  <div class="flex items-center gap-2">
                    <div
                      class="h-3 w-3 flex-shrink-0 rounded-full"
                      style={{ background: CLUSTER_BORDER[ci % CLUSTER_BORDER.length] }}
                    />
                    <span class="text-xs font-medium text-[var(--color-text)]">
                      Cluster {ci + 1}
                    </span>
                    {clusters.length > 1 && (
                      <button
                        onClick={() => removeCluster(ci)}
                        class="ml-auto text-[10px] text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="text-xs text-[var(--color-text-muted)]" style={{ minWidth: 50 }}>
                      Size
                    </label>
                    <input
                      type="range"
                      min={20}
                      max={400}
                      value={cluster.count}
                      onInput={(e) =>
                        handleClusterCount(ci, parseInt((e.target as HTMLInputElement).value, 10))
                      }
                      class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border)]"
                    />
                    <span class="w-8 text-right font-mono text-xs text-[var(--color-text-muted)]">
                      {cluster.count}
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="text-xs text-[var(--color-text-muted)]" style={{ minWidth: 50 }}>
                      Spread
                    </label>
                    <input
                      type="range"
                      min={5}
                      max={60}
                      value={Math.round(cluster.spread * 100)}
                      onInput={(e) =>
                        handleClusterSpread(
                          ci,
                          parseInt((e.target as HTMLInputElement).value, 10) / 100,
                        )
                      }
                      class="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[var(--color-border)]"
                    />
                    <span class="w-8 text-right font-mono text-xs text-[var(--color-text-muted)]">
                      {Math.round(cluster.spread * 100)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Method Descriptions */}
          <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <h4 class="mb-2 text-sm font-semibold text-[var(--color-heading)]">Voting Methods</h4>
            <ul class="space-y-1 text-xs text-[var(--color-text-muted)]">
              <li>
                <span class="font-medium text-[var(--color-text)]">Plurality</span>: Each voter
                picks their top choice. Most votes wins.
              </li>
              <li>
                <span class="font-medium text-[var(--color-text)]">Ranked-Choice (IRV)</span>:
                Voters rank all candidates. Lowest is eliminated each round; votes transfer.
              </li>
              <li>
                <span class="font-medium text-[var(--color-text)]">Approval</span>: Voters approve
                all candidates within distance {APPROVAL_THRESHOLD}. Most approvals wins.
              </li>
              <li>
                <span class="font-medium text-[var(--color-text)]">Borda Count</span>: Points
                awarded by rank position (N-1 for 1st, N-2 for 2nd, etc.).
              </li>
              <li>
                <span class="font-medium text-[var(--color-text)]">Condorcet</span>: The candidate
                who beats every other in pairwise matchups. Falls back to Copeland if a cycle exists.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
