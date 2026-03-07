import { useState, useEffect, useRef, useCallback } from "preact/hooks";

// ================================================================
// Types
// ================================================================

interface FileEntry {
  name: string;
  status: "new" | "modified";
}

interface Commit {
  hash: string;
  message: string;
  timestamp: number;
  parents: string[];
  branch: string;
  x: number;
  y: number;
  col: number;
  row: number;
}

interface Branch {
  name: string;
  commitHash: string;
  color: string;
}

interface GitState {
  commits: Commit[];
  branches: Branch[];
  head: string;
  currentBranch: string;
  detached: boolean;
  workingDir: FileEntry[];
  stagingArea: FileEntry[];
  initialized: boolean;
}

interface HistoryEntry {
  command: string;
  output: string;
  isError: boolean;
}

interface PresetScenario {
  name: string;
  commands: string[];
}

// ================================================================
// Constants
// ================================================================

const NODE_RADIUS = 18;
const COL_WIDTH = 70;
const ROW_HEIGHT = 70;
const LEFT_MARGIN = 60;
const TOP_MARGIN = 50;
const FONT_MONO = "12px 'SF Mono', 'Fira Code', monospace";
const FONT_BOLD = "bold 12px Inter, system-ui, sans-serif";
const FONT_SMALL = "10px Inter, system-ui, sans-serif";

const BRANCH_COLORS = [
  "#4f8ff7", "#34d399", "#f59e0b", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316",
];

const PRESETS: PresetScenario[] = [
  {
    name: "Basic workflow",
    commands: [
      "init",
      "add app.js",
      'commit -m "Initial commit"',
      "add utils.js",
      'commit -m "Add utilities"',
      "add README.md",
      'commit -m "Add README"',
    ],
  },
  {
    name: "Feature branch",
    commands: [
      "init",
      "add index.js",
      'commit -m "Init project"',
      "add config.js",
      'commit -m "Add config"',
      "branch feature",
      "checkout feature",
      "add feature.js",
      'commit -m "Start feature"',
      "add tests.js",
      'commit -m "Add tests"',
      "checkout main",
      "add hotfix.js",
      'commit -m "Hotfix on main"',
    ],
  },
  {
    name: "Merge conflict demo",
    commands: [
      "init",
      "add app.js",
      'commit -m "v0.1.0"',
      "branch dev",
      "checkout dev",
      "add api.js",
      'commit -m "Dev: add API"',
      "add db.js",
      'commit -m "Dev: add DB"',
      "branch experiment",
      "checkout experiment",
      "add lab.js",
      'commit -m "Try new idea"',
      "add lab-v2.js",
      'commit -m "Refine idea"',
      "checkout dev",
      "add middleware.js",
      'commit -m "More dev work"',
      "merge experiment",
      "checkout main",
      "add docs.js",
      'commit -m "Main progress"',
      "merge dev",
    ],
  },
];

// ================================================================
// Helpers
// ================================================================

function randomHash(): string {
  return Math.random().toString(16).substring(2, 9);
}

function getCssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function createEmptyState(): GitState {
  return {
    commits: [],
    branches: [],
    head: "",
    currentBranch: "",
    detached: false,
    workingDir: [],
    stagingArea: [],
    initialized: false,
  };
}

function createInitializedState(): GitState {
  const hash = randomHash();
  return {
    commits: [{
      hash, message: "root", timestamp: Date.now(),
      parents: [], branch: "main", x: 0, y: 0, col: 0, row: 0,
    }],
    branches: [{ name: "main", commitHash: hash, color: BRANCH_COLORS[0] }],
    head: hash,
    currentBranch: "main",
    detached: false,
    workingDir: [],
    stagingArea: [],
    initialized: true,
  };
}

function getBranchColor(branches: Branch[], name: string): string {
  const b = branches.find(br => br.name === name);
  return b ? b.color : BRANCH_COLORS[0];
}

// ================================================================
// Layout engine
// ================================================================

function layoutDAG(state: GitState): Commit[] {
  if (state.commits.length === 0) return [];
  const commits = [...state.commits];
  const branchCols = new Map<string, number>();
  let nextCol = 0;
  for (const b of state.branches) {
    if (!branchCols.has(b.name)) branchCols.set(b.name, nextCol++);
  }
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    const col = branchCols.get(c.branch) ?? 0;
    c.col = col;
    c.row = i;
    c.x = LEFT_MARGIN + col * COL_WIDTH;
    c.y = TOP_MARGIN + i * ROW_HEIGHT;
  }
  return commits;
}

// ================================================================
// Git command parser
// ================================================================

function executeCommand(
  state: GitState,
  rawCmd: string,
): { state: GitState; output: string; isError: boolean } {
  const cmd = rawCmd.trim();
  if (!cmd) return { state, output: "", isError: false };

  // init
  if (/^init$/i.test(cmd)) {
    if (state.initialized) {
      return { state, output: "Reinitialized existing Git repository", isError: false };
    }
    const newState = createInitializedState();
    return { state: newState, output: "Initialized empty Git repository", isError: false };
  }

  if (!state.initialized) {
    return { state, output: "fatal: not a git repository (run 'git init' first)", isError: true };
  }

  // add <file>
  const addMatch = cmd.match(/^add\s+(\S+)$/i);
  if (addMatch) {
    const fileName = addMatch[1];
    const existsInWorking = state.workingDir.find(f => f.name === fileName);
    const newFile: FileEntry = existsInWorking || { name: fileName, status: "new" };
    const newWorking = state.workingDir.filter(f => f.name !== fileName);
    const newStaging = [...state.stagingArea.filter(f => f.name !== fileName), newFile];
    return {
      state: { ...state, workingDir: newWorking, stagingArea: newStaging },
      output: `  staged: ${fileName}`,
      isError: false,
    };
  }

  // commit -m "message"
  const commitMatch = cmd.match(/^commit\s+-m\s+"(.+)"$/i)
    || cmd.match(/^commit\s+-m\s+'(.+)'$/i)
    || cmd.match(/^commit\s+"(.+)"$/i)
    || cmd.match(/^commit\s+'(.+)'$/i)
    || cmd.match(/^commit\s+(.+)$/i);
  if (commitMatch) {
    const message = commitMatch[1].replace(/^["']|["']$/g, "");
    if (state.stagingArea.length === 0 && state.commits.length > 1) {
      return { state, output: "nothing to commit, working tree clean", isError: true };
    }
    const hash = randomHash();
    const newCommit: Commit = {
      hash, message, timestamp: Date.now(),
      parents: state.head ? [state.head] : [],
      branch: state.currentBranch,
      x: 0, y: 0, col: 0, row: 0,
    };
    const newBranches = state.branches.map(b =>
      b.name === state.currentBranch ? { ...b, commitHash: hash } : b
    );
    return {
      state: {
        ...state,
        commits: [...state.commits, newCommit],
        branches: newBranches,
        head: hash,
        stagingArea: [],
      },
      output: `[${state.currentBranch} ${hash.substring(0, 7)}] ${message}`,
      isError: false,
    };
  }

  // branch <name>
  const branchMatch = cmd.match(/^branch\s+(\S+)$/i);
  if (branchMatch) {
    const name = branchMatch[1];
    if (state.branches.some(b => b.name === name)) {
      return { state, output: `fatal: branch '${name}' already exists`, isError: true };
    }
    const color = BRANCH_COLORS[state.branches.length % BRANCH_COLORS.length];
    return {
      state: { ...state, branches: [...state.branches, { name, commitHash: state.head, color }] },
      output: `Created branch '${name}' at ${state.head.substring(0, 7)}`,
      isError: false,
    };
  }

  // checkout <name>
  const checkoutMatch = cmd.match(/^checkout\s+(\S+)$/i);
  if (checkoutMatch) {
    const name = checkoutMatch[1];
    const branch = state.branches.find(b => b.name === name);
    if (!branch) {
      return { state, output: `error: pathspec '${name}' did not match any branch`, isError: true };
    }
    return {
      state: { ...state, head: branch.commitHash, currentBranch: name, detached: false },
      output: `Switched to branch '${name}'`,
      isError: false,
    };
  }

  // merge <name>
  const mergeMatch = cmd.match(/^merge\s+(\S+)$/i);
  if (mergeMatch) {
    const name = mergeMatch[1];
    const branch = state.branches.find(b => b.name === name);
    if (!branch) return { state, output: `merge: ${name} - not something we can merge`, isError: true };
    if (name === state.currentBranch) return { state, output: `Already on '${name}'`, isError: true };
    if (branch.commitHash === state.head) return { state, output: "Already up to date.", isError: false };

    const isAnc = isCommitAncestor(state, branch.commitHash, state.head);
    if (isAnc) return { state, output: "Already up to date.", isError: false };

    const canFF = isCommitAncestor(state, state.head, branch.commitHash);
    if (canFF) {
      const newBranches = state.branches.map(b =>
        b.name === state.currentBranch ? { ...b, commitHash: branch.commitHash } : b
      );
      return {
        state: { ...state, head: branch.commitHash, branches: newBranches },
        output: `Fast-forward: ${state.head.substring(0, 7)}..${branch.commitHash.substring(0, 7)}`,
        isError: false,
      };
    }

    const hash = randomHash();
    const mergeCommit: Commit = {
      hash,
      message: `Merge '${name}' into ${state.currentBranch}`,
      timestamp: Date.now(),
      parents: [state.head, branch.commitHash],
      branch: state.currentBranch,
      x: 0, y: 0, col: 0, row: 0,
    };
    const newBranches = state.branches.map(b =>
      b.name === state.currentBranch ? { ...b, commitHash: hash } : b
    );
    return {
      state: { ...state, commits: [...state.commits, mergeCommit], branches: newBranches, head: hash },
      output: `Merge made by 'ort' strategy.\n  ${hash.substring(0, 7)} Merge '${name}'`,
      isError: false,
    };
  }

  // log
  if (/^log$/i.test(cmd)) {
    if (state.commits.length === 0) return { state, output: "No commits yet.", isError: false };
    const lines: string[] = [];
    const visited = new Set<string>();
    const queue = [state.head];
    while (queue.length > 0) {
      const hash = queue.shift()!;
      if (visited.has(hash)) continue;
      visited.add(hash);
      const c = state.commits.find(cm => cm.hash === hash);
      if (!c) continue;
      const branchLabels = state.branches.filter(b => b.commitHash === hash).map(b => b.name);
      const refPart = branchLabels.length > 0 ? ` (${branchLabels.join(", ")})` : "";
      lines.push(`* ${hash.substring(0, 7)}${refPart} ${c.message}`);
      queue.push(...c.parents);
    }
    return { state, output: lines.join("\n"), isError: false };
  }

  // reset
  if (/^reset$/i.test(cmd)) {
    return { state: createInitializedState(), output: "Repository reset.", isError: false };
  }

  return { state, output: `git: '${cmd.split(" ")[0]}' is not a git command.`, isError: true };
}

function isCommitAncestor(state: GitState, ancestorHash: string, descendantHash: string): boolean {
  const visited = new Set<string>();
  const queue = [descendantHash];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === ancestorHash) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const commit = state.commits.find(c => c.hash === current);
    if (commit) queue.push(...commit.parents);
  }
  return false;
}

// ================================================================
// Canvas drawing
// ================================================================

function drawDAG(ctx: CanvasRenderingContext2D, width: number, height: number, state: GitState) {
  ctx.clearRect(0, 0, width, height);
  const commits = layoutDAG(state);
  if (commits.length === 0) return;

  const textColor = getCssVar("--color-heading", "#fff");
  const mutedColor = getCssVar("--color-text-muted", "#a1a1aa");

  // Connections
  for (const commit of commits) {
    for (const parentHash of commit.parents) {
      const parent = commits.find(c => c.hash === parentHash);
      if (!parent) continue;
      const isMerge = commit.parents.length > 1;
      const color = getBranchColor(state.branches, commit.branch);
      ctx.beginPath();
      ctx.strokeStyle = isMerge && parentHash !== commit.parents[0]
        ? getBranchColor(state.branches,
            state.branches.find(b => {
              const pc = commits.find(c => c.hash === parentHash);
              return pc && b.name === pc.branch;
            })?.name || commit.branch)
        : color;
      ctx.lineWidth = 2;
      ctx.setLineDash(isMerge && parentHash !== commit.parents[0] ? [4, 4] : []);

      if (commit.col === parent.col) {
        ctx.moveTo(commit.x, commit.y - NODE_RADIUS);
        ctx.lineTo(parent.x, parent.y + NODE_RADIUS);
      } else {
        const midY = (commit.y + parent.y) / 2;
        ctx.moveTo(commit.x, commit.y - NODE_RADIUS);
        ctx.bezierCurveTo(commit.x, midY, parent.x, midY, parent.x, parent.y + NODE_RADIUS);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrow
      const ax = parent.x;
      const ay = parent.y + NODE_RADIUS;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 5, ay - 8);
      ctx.lineTo(ax + 5, ay - 8);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  }

  // Commit nodes
  for (const commit of commits) {
    const color = getBranchColor(state.branches, commit.branch);
    const isHead = commit.hash === state.head;

    ctx.beginPath();
    ctx.arc(commit.x, commit.y, NODE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isHead ? color : getCssVar("--color-surface", "#111");
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isHead ? 3 : 2;
    ctx.stroke();

    ctx.font = FONT_MONO;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isHead ? "#000" : textColor;
    ctx.fillText(commit.hash.substring(0, 5), commit.x, commit.y);

    ctx.font = FONT_SMALL;
    ctx.textAlign = "left";
    ctx.fillStyle = mutedColor;
    let msg = commit.message;
    const maxMsgWidth = 160;
    if (ctx.measureText(msg).width > maxMsgWidth) {
      while (ctx.measureText(msg + "...").width > maxMsgWidth && msg.length > 3) msg = msg.slice(0, -1);
      msg += "...";
    }
    ctx.fillText(msg, commit.x + NODE_RADIUS + 8, commit.y);
  }

  // Branch labels
  const labeledPositions = new Map<string, number>();
  for (const branch of state.branches) {
    const commit = commits.find(c => c.hash === branch.commitHash);
    if (!commit) continue;
    const key = `${commit.x},${commit.y}`;
    const offset = labeledPositions.get(key) || 0;
    labeledPositions.set(key, offset + 1);
    const labelY = commit.y - NODE_RADIUS - 12 - offset * 18;

    ctx.font = FONT_BOLD;
    const tw = ctx.measureText(branch.name).width;
    const px = 6;
    const py = 3;
    ctx.beginPath();
    ctx.roundRect(commit.x - tw / 2 - px, labelY - 8 - py, tw + px * 2, 16 + py * 2, 4);
    ctx.fillStyle = branch.color + "30";
    ctx.fill();
    ctx.strokeStyle = branch.color;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = branch.color;
    ctx.fillText(branch.name, commit.x, labelY);
  }

  // HEAD indicator
  const headCommit = commits.find(c => c.hash === state.head);
  if (headCommit) {
    const headY = headCommit.y + NODE_RADIUS + 16;
    ctx.font = FONT_BOLD;
    ctx.textAlign = "center";
    ctx.fillStyle = "#f59e0b";
    ctx.fillText("HEAD", headCommit.x, headY);
    ctx.beginPath();
    ctx.moveTo(headCommit.x, headCommit.y + NODE_RADIUS);
    ctx.lineTo(headCommit.x, headY - 8);
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ================================================================
// Styles (inline for file-box rendering)
// ================================================================

const panelCss = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  padding: "1rem",
};

const fileBoxStyle = (isStaging: boolean): Record<string, string> => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.2rem 0.5rem",
  borderRadius: "0.25rem",
  fontSize: "0.7rem",
  fontFamily: "monospace",
  background: isStaging ? "rgba(52, 211, 153, 0.1)" : "rgba(239, 68, 68, 0.1)",
  color: isStaging ? "#34d399" : "#ef4444",
  border: `1px solid ${isStaging ? "rgba(52, 211, 153, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
});

// ================================================================
// Component
// ================================================================

export default function GitViz() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const [gitState, setGitState] = useState<GitState>(createEmptyState);
  const [cmdInput, setCmdInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState(-1);
  const [cmdHistoryList, setCmdHistoryList] = useState<string[]>([]);

  // Draw DAG
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const commits = layoutDAG(gitState);
    const maxRow = commits.length;
    const maxCol = Math.max(1, ...commits.map(c => c.col + 1));
    const neededW = Math.max(rect.width, LEFT_MARGIN + maxCol * COL_WIDTH + 200);
    const neededH = Math.max(200, TOP_MARGIN + (maxRow + 1) * ROW_HEIGHT);

    canvas.width = neededW * dpr;
    canvas.height = neededH * dpr;
    canvas.style.width = `${neededW}px`;
    canvas.style.height = `${neededH}px`;
    ctx.scale(dpr, dpr);
    drawDAG(ctx, neededW, neededH, gitState);
  }, [gitState]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => { historyEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const runCommand = useCallback((rawCmd: string) => {
    if (!rawCmd.trim()) return;
    const { state: newState, output, isError } = executeCommand(gitState, rawCmd);
    setGitState(newState);
    setHistory(prev => [...prev, { command: rawCmd, output, isError }]);
    setCmdHistoryList(prev => [...prev, rawCmd]);
    setCmdHistoryIdx(-1);
    setCmdInput("");
  }, [gitState]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter") {
      runCommand(cmdInput);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistoryList.length === 0) return;
      const newIdx = cmdHistoryIdx === -1 ? cmdHistoryList.length - 1 : Math.max(0, cmdHistoryIdx - 1);
      setCmdHistoryIdx(newIdx);
      setCmdInput(cmdHistoryList[newIdx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdHistoryIdx === -1) return;
      const newIdx = cmdHistoryIdx + 1;
      if (newIdx >= cmdHistoryList.length) { setCmdHistoryIdx(-1); setCmdInput(""); }
      else { setCmdHistoryIdx(newIdx); setCmdInput(cmdHistoryList[newIdx]); }
    }
  }, [cmdInput, cmdHistoryList, cmdHistoryIdx, runCommand]);

  const loadPreset = useCallback((preset: PresetScenario) => {
    let state = createEmptyState();
    const newHistory: HistoryEntry[] = [];
    const newCmdHistory: string[] = [];
    for (const cmd of preset.commands) {
      const result = executeCommand(state, cmd);
      state = result.state;
      newHistory.push({ command: cmd, output: result.output, isError: result.isError });
      newCmdHistory.push(cmd);
    }
    setGitState(state);
    setHistory(newHistory);
    setCmdHistoryList(newCmdHistory);
    setCmdHistoryIdx(-1);
    setCmdInput("");
  }, []);

  const resetRepo = useCallback(() => {
    setGitState(createEmptyState());
    setHistory([]);
    setCmdHistoryList([]);
    setCmdHistoryIdx(-1);
    setCmdInput("");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Terminal */}
      <div style={{ borderRadius: "0.75rem", border: "1px solid var(--color-border)", background: "#0d1117", overflow: "hidden" }}>
        {/* Title bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", borderBottom: "1px solid var(--color-border)", background: "#161b22", padding: "0.5rem 1rem" }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#ff5f56" }} />
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#ffbd2e" }} />
            <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#27c93f" }} />
          </div>
          <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>git terminal</span>
        </div>

        {/* History */}
        <div style={{ maxHeight: "200px", overflowY: "auto", padding: "0.5rem 1rem", fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: "0.75rem" }}>
          {history.map((entry, i) => (
            <div key={i} style={{ marginBottom: "0.25rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.25rem" }}>
                <span style={{ color: "#34d399" }}>$</span>
                <span style={{ color: "var(--color-text)" }}>git {entry.command}</span>
              </div>
              {entry.output && (
                <div style={{ marginLeft: "0.75rem", whiteSpace: "pre-wrap", color: entry.isError ? "#f87171" : "var(--color-text-muted)" }}>
                  {entry.output}
                </div>
              )}
            </div>
          ))}
          <div ref={historyEndRef} />
        </div>

        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", borderTop: "1px solid rgba(255,255,255,0.06)", padding: "0.5rem 1rem" }}>
          <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "#34d399" }}>$</span>
          <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>git</span>
          <input
            ref={inputRef}
            type="text"
            value={cmdInput}
            onInput={(e) => setCmdInput((e.target as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
            placeholder='init, add <file>, commit -m "msg", branch, checkout, merge, log'
            style={{
              flex: 1, background: "transparent", fontFamily: "monospace", fontSize: "0.75rem",
              color: "var(--color-text)", border: "none", outline: "none",
            }}
          />
        </div>
      </div>

      {/* Working Dir + Staging Area */}
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ ...panelCss, flex: "1 1 200px" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
            Working Directory
          </div>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", minHeight: "1.5rem" }}>
            {gitState.workingDir.length === 0
              ? <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>clean</span>
              : gitState.workingDir.map((f, i) => (
                  <span key={i} style={fileBoxStyle(false)}>{f.name}</span>
                ))
            }
          </div>
        </div>
        <div style={{ ...panelCss, flex: "1 1 200px" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
            Staging Area (Index)
          </div>
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", minHeight: "1.5rem" }}>
            {gitState.stagingArea.length === 0
              ? <span style={{ fontSize: "0.7rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>empty</span>
              : gitState.stagingArea.map((f, i) => (
                  <span key={i} style={fileBoxStyle(true)}>{f.name}</span>
                ))
            }
          </div>
        </div>
      </div>

      {/* Preset buttons */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
        {PRESETS.map(preset => (
          <button
            key={preset.name}
            onClick={() => loadPreset(preset)}
            style={{
              borderRadius: "0.375rem", border: "1px solid var(--color-border)",
              background: "var(--color-surface)", padding: "0.35rem 0.75rem",
              fontSize: "0.75rem", color: "var(--color-text)", cursor: "pointer",
              transition: "border-color 0.15s",
            }}
          >
            {preset.name}
          </button>
        ))}
        <button
          onClick={resetRepo}
          style={{
            borderRadius: "0.375rem", border: "1px solid rgba(239,68,68,0.3)",
            background: "var(--color-surface)", padding: "0.35rem 0.75rem",
            fontSize: "0.75rem", color: "#f87171", cursor: "pointer",
          }}
        >
          Reset
        </button>
      </div>

      {/* DAG canvas */}
      <div style={{ overflow: "auto", borderRadius: "0.75rem", border: "1px solid var(--color-border)", background: "var(--color-bg)", maxHeight: "480px" }}>
        <canvas ref={canvasRef} style={{ minHeight: "200px" }} />
      </div>

      {/* Info panels */}
      <div style={{ display: "grid", gap: "1rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {/* Branches */}
        <div style={panelCss}>
          <div style={{ fontSize: "0.7rem", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Branches
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {gitState.branches.length === 0
              ? <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>No branches yet</span>
              : gitState.branches.map(b => (
                  <div key={b.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: b.color }} />
                      <span style={{ fontSize: "0.85rem", fontWeight: b.name === gitState.currentBranch ? "700" : "400", color: b.name === gitState.currentBranch ? "var(--color-heading)" : "var(--color-text)" }}>
                        {b.name}
                        {b.name === gitState.currentBranch && (
                          <span style={{ marginLeft: "0.35rem", fontSize: "0.7rem", color: "#f59e0b" }}>(HEAD)</span>
                        )}
                      </span>
                    </div>
                    <span style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "var(--color-text-muted)" }}>
                      {b.commitHash.substring(0, 7)}
                    </span>
                  </div>
                ))
            }
          </div>
        </div>

        {/* Commands reference */}
        <div style={panelCss}>
          <div style={{ fontSize: "0.7rem", fontWeight: "600", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "0.75rem" }}>
            Commands
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
            {[
              ["init", "create repository"],
              ["add", "<file>"],
              ["commit", '-m "message"'],
              ["branch", "<name>"],
              ["checkout", "<name>"],
              ["merge", "<name>"],
              ["log", "show history"],
              ["reset", "reinitialize"],
            ].map(([cmd, arg]) => (
              <div key={cmd} style={{ display: "flex", gap: "0.5rem" }}>
                <span style={{ color: "var(--color-primary)" }}>{cmd}</span>
                <span style={{ color: "var(--color-text-muted)" }}>{arg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
