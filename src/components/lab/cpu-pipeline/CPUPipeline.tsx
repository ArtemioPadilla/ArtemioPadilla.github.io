import { useState, useCallback, useRef, useEffect } from "preact/hooks";

/* ──────────────────────────────────────
   Types & Constants
   ────────────────────────────────────── */

const STAGES = ["IF", "ID", "EX", "MEM", "WB"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABELS: Record<Stage, string> = {
  IF: "Fetch",
  ID: "Decode",
  EX: "Execute",
  MEM: "Memory",
  WB: "Write-Back",
};

type Opcode = "ADD" | "SUB" | "LOAD" | "STORE" | "BEQ" | "NOP";

interface Instruction {
  opcode: Opcode;
  rd: number;
  rs1: number;
  rs2: number;
  label: string;
  raw: string;
  index: number;
}

interface HazardInfo {
  type: "RAW" | "LOAD-USE" | "CONTROL";
  fromInstruction: number;
  toInstruction: number;
  register: number;
  resolved: "stall" | "forward" | "flush";
}

interface ForwardPath {
  fromStage: Stage;
  toStage: Stage;
  fromInstruction: number;
  toInstruction: number;
  register: number;
  cycle: number;
}

interface PipelineEntry {
  instructionIndex: number;
  stage: Stage | "BUBBLE" | "FLUSH";
}

interface CycleState {
  pipeline: (PipelineEntry | null)[];
  registers: number[];
  hazards: HazardInfo[];
  forwards: ForwardPath[];
}

interface Preset {
  label: string;
  description: string;
  code: string;
}

const INSTRUCTION_COLORS = [
  "var(--color-primary)",
  "var(--color-accent)",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#6366f1",
  "#14b8a6",
  "#e11d48",
];

const PRESETS: Record<string, Preset> = {
  "no-hazards": {
    label: "No Hazards",
    description: "Independent instructions with no data dependencies",
    code: `ADD R1, R2, R3
ADD R4, R5, R6
ADD R7, R0, R1
SUB R2, R3, R4`,
  },
  "raw-hazard": {
    label: "RAW Hazard",
    description: "ADD writes R1, SUB reads R1 immediately",
    code: `ADD R1, R2, R3
SUB R4, R1, R5`,
  },
  "load-use": {
    label: "Load-Use",
    description: "LOAD writes R1, next instruction uses R1 (requires stall even with forwarding)",
    code: `LOAD R1, [R2]
ADD R3, R1, R4
SUB R5, R3, R6`,
  },
  branch: {
    label: "Branch",
    description: "BEQ causes pipeline flush on misprediction",
    code: `ADD R1, R0, R0
BEQ R1, R0, skip
ADD R2, R3, R4
ADD R5, R6, R7`,
  },
  "full-program": {
    label: "Full Program",
    description: "Mix of hazards: RAW, load-use, and branch",
    code: `ADD R1, R2, R3
SUB R4, R1, R5
LOAD R6, [R4]
ADD R7, R6, R1
BEQ R7, R0, end
STORE R7, [R2]
NOP`,
  },
};

/* ──────────────────────────────────────
   Instruction Parser
   ────────────────────────────────────── */

function parseRegister(token: string): number {
  const cleaned = token.replace(/[,\[\]]/g, "").trim();
  if (cleaned.startsWith("R") || cleaned.startsWith("r")) {
    const num = parseInt(cleaned.slice(1), 10);
    if (!isNaN(num) && num >= 0 && num <= 7) return num;
  }
  return 0;
}

function parseInstructions(code: string): Instruction[] {
  const lines = code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("//"));

  return lines.map((line, index) => {
    const parts = line.split(/[\s,]+/).filter(Boolean);
    const opcode = (parts[0]?.toUpperCase() ?? "NOP") as Opcode;

    let rd = 0;
    let rs1 = 0;
    let rs2 = 0;
    let label = "";

    switch (opcode) {
      case "ADD":
      case "SUB":
        rd = parseRegister(parts[1] ?? "R0");
        rs1 = parseRegister(parts[2] ?? "R0");
        rs2 = parseRegister(parts[3] ?? "R0");
        break;
      case "LOAD":
        rd = parseRegister(parts[1] ?? "R0");
        rs1 = parseRegister(parts[2] ?? "R0");
        break;
      case "STORE":
        rs1 = parseRegister(parts[1] ?? "R0");
        rs2 = parseRegister(parts[2] ?? "R0");
        break;
      case "BEQ":
        rs1 = parseRegister(parts[1] ?? "R0");
        rs2 = parseRegister(parts[2] ?? "R0");
        label = parts[3] ?? "";
        break;
      case "NOP":
        break;
      default:
        break;
    }

    return { opcode, rd, rs1, rs2, label, raw: line, index };
  });
}

function getWriteReg(inst: Instruction): number | null {
  switch (inst.opcode) {
    case "ADD":
    case "SUB":
    case "LOAD":
      return inst.rd;
    default:
      return null;
  }
}

function getReadRegs(inst: Instruction): number[] {
  switch (inst.opcode) {
    case "ADD":
    case "SUB":
      return [inst.rs1, inst.rs2];
    case "LOAD":
      return [inst.rs1];
    case "STORE":
      return [inst.rs1, inst.rs2];
    case "BEQ":
      return [inst.rs1, inst.rs2];
    default:
      return [];
  }
}

/* ──────────────────────────────────────
   Pipeline Simulation Engine
   ────────────────────────────────────── */

interface PipelineSlot {
  instructionIndex: number;
  stage: Stage | "BUBBLE" | "FLUSH";
}

interface SimState {
  cycle: number;
  slots: PipelineSlot[];
  nextFetch: number;
  registers: number[];
  completed: boolean;
  stallCycles: number;
  flushCycles: number;
  instructionsCompleted: number;
  grid: (PipelineEntry | null)[][];
  hazardLog: HazardInfo[];
  forwardLog: ForwardPath[];
  flushedThisCycle: boolean;
}

function createInitialSimState(instructions: Instruction[]): SimState {
  if (instructions.length === 0) {
    return {
      cycle: 0,
      slots: [],
      nextFetch: 0,
      registers: new Array(8).fill(0),
      completed: true,
      stallCycles: 0,
      flushCycles: 0,
      instructionsCompleted: 0,
      grid: [],
      hazardLog: [],
      forwardLog: [],
      flushedThisCycle: false,
    };
  }
  return {
    cycle: 0,
    slots: [],
    nextFetch: 0,
    registers: [0, 1, 2, 3, 4, 5, 6, 7],
    completed: false,
    stallCycles: 0,
    flushCycles: 0,
    instructionsCompleted: 0,
    grid: [],
    hazardLog: [],
    forwardLog: [],
    flushedThisCycle: false,
  };
}

function findHazards(
  slots: PipelineSlot[],
  instructions: Instruction[],
  forwardingEnabled: boolean,
): { hazards: HazardInfo[]; forwards: ForwardPath[]; stallNeeded: boolean } {
  const hazards: HazardInfo[] = [];
  const forwards: ForwardPath[] = [];
  let stallNeeded = false;

  // Find instruction in ID stage (consumer) and check against producers ahead
  const idSlot = slots.find((s) => s.stage === "ID");
  if (!idSlot) return { hazards, forwards, stallNeeded };

  const consumer = instructions[idSlot.instructionIndex];
  if (!consumer) return { hazards, forwards, stallNeeded };

  const readRegs = getReadRegs(consumer);

  for (const other of slots) {
    if (other.instructionIndex >= idSlot.instructionIndex) continue;
    const producer = instructions[other.instructionIndex];
    if (!producer) continue;
    const writeReg = getWriteReg(producer);
    if (writeReg === null || writeReg === 0) continue;

    for (const rr of readRegs) {
      if (rr !== writeReg || rr === 0) continue;

      if (other.stage === "EX") {
        if (producer.opcode === "LOAD") {
          hazards.push({
            type: "LOAD-USE",
            fromInstruction: other.instructionIndex,
            toInstruction: idSlot.instructionIndex,
            register: rr,
            resolved: "stall",
          });
          stallNeeded = true;
        } else if (forwardingEnabled) {
          forwards.push({
            fromStage: "EX",
            toStage: "EX",
            fromInstruction: other.instructionIndex,
            toInstruction: idSlot.instructionIndex,
            register: rr,
            cycle: 0,
          });
          hazards.push({
            type: "RAW",
            fromInstruction: other.instructionIndex,
            toInstruction: idSlot.instructionIndex,
            register: rr,
            resolved: "forward",
          });
        } else {
          hazards.push({
            type: "RAW",
            fromInstruction: other.instructionIndex,
            toInstruction: idSlot.instructionIndex,
            register: rr,
            resolved: "stall",
          });
          stallNeeded = true;
        }
      } else if (other.stage === "MEM") {
        if (forwardingEnabled) {
          forwards.push({
            fromStage: "MEM",
            toStage: "EX",
            fromInstruction: other.instructionIndex,
            toInstruction: idSlot.instructionIndex,
            register: rr,
            cycle: 0,
          });
          hazards.push({
            type: "RAW",
            fromInstruction: other.instructionIndex,
            toInstruction: idSlot.instructionIndex,
            register: rr,
            resolved: "forward",
          });
        } else {
          hazards.push({
            type: "RAW",
            fromInstruction: other.instructionIndex,
            toInstruction: idSlot.instructionIndex,
            register: rr,
            resolved: "stall",
          });
          stallNeeded = true;
        }
      }
    }
  }

  return { hazards, forwards, stallNeeded };
}

function checkBranchHazard(
  slots: PipelineSlot[],
  instructions: Instruction[],
  registers: number[],
  branchPredictionEnabled: boolean,
): { flushNeeded: boolean; hazard: HazardInfo | null } {
  const exSlot = slots.find(
    (s) => s.stage === "EX" && instructions[s.instructionIndex]?.opcode === "BEQ",
  );
  if (!exSlot) return { flushNeeded: false, hazard: null };

  const inst = instructions[exSlot.instructionIndex];
  const taken = registers[inst.rs1] === registers[inst.rs2];

  // With prediction (always-not-taken): flush only on misprediction (branch taken)
  // Without prediction: always flush when branch reaches EX
  const shouldFlush = branchPredictionEnabled ? taken : true;

  if (shouldFlush) {
    return {
      flushNeeded: true,
      hazard: {
        type: "CONTROL",
        fromInstruction: exSlot.instructionIndex,
        toInstruction: exSlot.instructionIndex,
        register: 0,
        resolved: "flush",
      },
    };
  }

  return { flushNeeded: false, hazard: null };
}

function stepPipeline(
  state: SimState,
  instructions: Instruction[],
  forwardingEnabled: boolean,
  branchPredictionEnabled: boolean,
): SimState {
  if (state.completed) return state;

  const next: SimState = {
    ...state,
    cycle: state.cycle + 1,
    slots: [...state.slots],
    registers: [...state.registers],
    hazardLog: [],
    forwardLog: [],
    flushedThisCycle: false,
  };

  // Step 1: Remove completed instructions from WB, execute writeback
  const wbSlots = next.slots.filter((s) => s.stage === "WB");
  for (const slot of wbSlots) {
    const inst = instructions[slot.instructionIndex];
    if (inst) {
      const writeReg = getWriteReg(inst);
      if (writeReg !== null && writeReg !== 0) {
        switch (inst.opcode) {
          case "ADD":
            next.registers[writeReg] = next.registers[inst.rs1] + next.registers[inst.rs2];
            break;
          case "SUB":
            next.registers[writeReg] = next.registers[inst.rs1] - next.registers[inst.rs2];
            break;
          case "LOAD":
            next.registers[writeReg] = next.registers[inst.rs1] + 100;
            break;
        }
      }
      next.instructionsCompleted++;
    }
  }

  // Step 2: Advance all instructions by one stage (tentatively)
  const newSlots: PipelineSlot[] = [];
  for (const slot of next.slots) {
    if (slot.stage === "BUBBLE" || slot.stage === "FLUSH") continue;
    if (slot.stage === "WB") continue; // already completed

    const stageIdx = STAGES.indexOf(slot.stage as Stage);
    newSlots.push({ ...slot, stage: STAGES[stageIdx + 1] });
  }

  // Step 3: Check data hazards on the new state
  const { hazards, forwards, stallNeeded } = findHazards(
    newSlots,
    instructions,
    forwardingEnabled,
  );

  // Step 4: Check control hazards
  const { flushNeeded, hazard: branchHazard } = checkBranchHazard(
    newSlots,
    instructions,
    next.registers,
    branchPredictionEnabled,
  );

  if (stallNeeded) {
    // Stall: revert ID and IF instructions, insert bubble into EX
    const resultSlots: PipelineSlot[] = [];
    const stalledInstIdx = hazards.find((h) => h.resolved === "stall")?.toInstruction;

    for (const slot of newSlots) {
      const stageIdx = STAGES.indexOf(slot.stage as Stage);

      if (slot.instructionIndex === stalledInstIdx && slot.stage === "ID") {
        // Revert stalled instruction back to IF
        resultSlots.push({ instructionIndex: slot.instructionIndex, stage: "IF" });
      } else if (slot.stage === "IF") {
        // Any instruction that was behind the stall in IF: don't advance
        // Since it was already advanced from nothing to IF, it should stay
        // Actually it was advanced from IF to ID or nothing to IF...
        // We need to check: was this instruction already in pipeline before this step?
        const wasBefore = state.slots.find(
          (s) => s.instructionIndex === slot.instructionIndex,
        );
        if (wasBefore) {
          // It was in pipeline but shouldn't advance: keep at its old stage
          resultSlots.push({ ...wasBefore });
        } else {
          // Just fetched this cycle, but we're stalling so don't fetch
          // Don't add it -- revert the fetch
          next.nextFetch = Math.min(next.nextFetch, slot.instructionIndex);
        }
      } else {
        // Stages ahead of stall (EX, MEM, WB): advance normally
        resultSlots.push(slot);
      }
    }

    next.slots = resultSlots;
    next.stallCycles++;
    next.hazardLog = hazards;
    next.forwardLog = forwards;
  } else if (flushNeeded && branchHazard) {
    // Flush: remove instructions fetched after the branch
    const resultSlots = newSlots.filter(
      (s) => s.instructionIndex <= branchHazard.fromInstruction,
    );

    next.slots = resultSlots;
    next.flushCycles += 2;
    next.flushedThisCycle = true;

    const branchInst = instructions[branchHazard.fromInstruction];
    if (branchInst) {
      const taken = next.registers[branchInst.rs1] === next.registers[branchInst.rs2];
      if (taken) {
        next.nextFetch = instructions.length; // simplified: skip to end
      }
    }

    next.hazardLog = [branchHazard];
    next.forwardLog = [];
  } else {
    // Normal advance
    next.slots = newSlots;
    next.hazardLog = hazards;
    next.forwardLog = forwards;

    // Fetch next instruction
    if (next.nextFetch < instructions.length) {
      next.slots.push({
        instructionIndex: next.nextFetch,
        stage: "IF",
      });
      next.nextFetch++;
    }
  }

  // Build grid row
  const row: (PipelineEntry | null)[] = new Array(STAGES.length).fill(null);
  for (const slot of next.slots) {
    if (slot.stage === "BUBBLE" || slot.stage === "FLUSH") continue;
    const stageIdx = STAGES.indexOf(slot.stage as Stage);
    if (stageIdx >= 0 && !row[stageIdx]) {
      row[stageIdx] = {
        instructionIndex: slot.instructionIndex,
        stage: slot.stage as Stage,
      };
    }
  }

  // Mark bubble in grid if stall happened
  if (stallNeeded) {
    const exIdx = STAGES.indexOf("EX");
    if (!row[exIdx]) {
      row[exIdx] = { instructionIndex: -1, stage: "BUBBLE" };
    }
  }

  // Mark flush in grid
  if (flushNeeded) {
    for (let i = 0; i < STAGES.length; i++) {
      if (!row[i]) continue;
      const entry = row[i];
      if (entry && branchHazard && entry.instructionIndex > branchHazard.fromInstruction) {
        row[i] = { instructionIndex: entry.instructionIndex, stage: "FLUSH" };
      }
    }
  }

  next.grid = [...state.grid, row];

  // Check completion
  next.completed =
    next.nextFetch >= instructions.length && next.slots.length === 0;

  return next;
}

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function CPUPipeline() {
  const [code, setCode] = useState(PRESETS["no-hazards"].code);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [simState, setSimState] = useState<SimState | null>(null);
  const [forwardingEnabled, setForwardingEnabled] = useState(true);
  const [branchPrediction, setBranchPrediction] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(500);

  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);

  // Parse and reset when code or settings change
  const resetSimulation = useCallback(
    (newCode?: string) => {
      const src = newCode ?? code;
      const parsed = parseInstructions(src);
      setInstructions(parsed);
      setSimState(createInitialSimState(parsed));
      setIsPlaying(false);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    },
    [code],
  );

  // Initialize on mount
  useEffect(() => {
    resetSimulation();
  }, []);

  // Auto-scroll grid to bottom
  useEffect(() => {
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollTop =
        gridContainerRef.current.scrollHeight;
    }
  }, [simState?.cycle]);

  // Step function
  const step = useCallback(() => {
    setSimState((prev) => {
      if (!prev || prev.completed) {
        setIsPlaying(false);
        return prev;
      }
      return stepPipeline(
        prev,
        instructions,
        forwardingEnabled,
        branchPrediction,
      );
    });
  }, [instructions, forwardingEnabled, branchPrediction]);

  // Auto-play
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setSimState((prev) => {
          if (!prev || prev.completed) {
            setIsPlaying(false);
            if (playIntervalRef.current) {
              clearInterval(playIntervalRef.current);
              playIntervalRef.current = null;
            }
            return prev;
          }
          return stepPipeline(
            prev,
            instructions,
            forwardingEnabled,
            branchPrediction,
          );
        });
      }, speed);
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying, speed, instructions, forwardingEnabled, branchPrediction]);

  const loadPreset = useCallback(
    (key: string) => {
      const preset = PRESETS[key];
      if (!preset) return;
      setCode(preset.code);
      const parsed = parseInstructions(preset.code);
      setInstructions(parsed);
      setSimState(createInitialSimState(parsed));
      setIsPlaying(false);
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    },
    [],
  );

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const getInstructionColor = (index: number): string => {
    if (index < 0) return "var(--color-border)";
    return INSTRUCTION_COLORS[index % INSTRUCTION_COLORS.length];
  };

  const totalCycles = simState?.cycle ?? 0;
  const completedInstructions = simState?.instructionsCompleted ?? 0;
  const cpi =
    completedInstructions > 0 ? totalCycles / completedInstructions : 0;
  const ipc = totalCycles > 0 ? completedInstructions / totalCycles : 0;

  return (
    <div
      class="space-y-4 rounded-xl border p-4 sm:p-6"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      {/* Controls Bar */}
      <div class="flex flex-wrap items-center gap-3">
        <button
          class="rounded px-3 py-1.5 text-xs font-bold transition-colors"
          style={{
            backgroundColor: "var(--color-primary)",
            color: "#fff",
          }}
          onClick={step}
          disabled={simState?.completed}
        >
          Step
        </button>

        <button
          class="rounded px-3 py-1.5 text-xs font-bold transition-colors"
          style={{
            backgroundColor: isPlaying ? "#ef4444" : "var(--color-accent)",
            color: "#000",
          }}
          onClick={togglePlay}
          disabled={simState?.completed}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>

        <button
          class="rounded px-3 py-1.5 text-xs font-bold transition-colors"
          style={{
            border: "1px solid var(--color-border)",
            backgroundColor: "transparent",
            color: "var(--color-text)",
          }}
          onClick={() => resetSimulation()}
        >
          Reset
        </button>

        <div class="h-5 w-px" style={{ backgroundColor: "var(--color-border)" }} />

        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-[var(--color-text-muted)]">
            Speed:
          </label>
          <input
            type="range"
            min={50}
            max={1500}
            step={50}
            value={1550 - speed}
            onInput={(e) =>
              setSpeed(1550 - Number((e.target as HTMLInputElement).value))
            }
            class="w-20"
          />
        </div>

        <div class="h-5 w-px" style={{ backgroundColor: "var(--color-border)" }} />

        <label class="flex items-center gap-1.5 text-xs text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={forwardingEnabled}
            onChange={(e) => {
              setForwardingEnabled((e.target as HTMLInputElement).checked);
              resetSimulation();
            }}
          />
          <span>Forwarding</span>
        </label>

        <label class="flex items-center gap-1.5 text-xs text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={branchPrediction}
            onChange={(e) => {
              setBranchPrediction((e.target as HTMLInputElement).checked);
              resetSimulation();
            }}
          />
          <span>Branch Pred.</span>
        </label>
      </div>

      {/* Presets */}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs font-bold text-[var(--color-text-muted)]">
          Presets:
        </span>
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button
            key={key}
            class="rounded px-2 py-1 text-xs transition-colors"
            style={{
              border: "1px solid var(--color-border)",
              color: "var(--color-text)",
              backgroundColor: "transparent",
            }}
            onClick={() => loadPreset(key)}
            title={preset.description}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Main content: code editor + pipeline diagram */}
      <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Code Editor */}
        <div>
          <label class="mb-1 block text-xs font-bold text-[var(--color-text-muted)]">
            Instructions:
          </label>
          <textarea
            class="w-full resize-none rounded border bg-transparent p-2 font-mono text-xs leading-relaxed text-[var(--color-text)]"
            style={{ borderColor: "var(--color-border)" }}
            rows={10}
            value={code}
            onInput={(e) => setCode((e.target as HTMLTextAreaElement).value)}
            spellcheck={false}
          />
          <button
            class="mt-1 rounded px-3 py-1 text-xs font-bold transition-colors"
            style={{
              backgroundColor: "var(--color-primary)",
              color: "#fff",
            }}
            onClick={() => resetSimulation(code)}
          >
            Load & Reset
          </button>

          {/* Instruction List with Colors */}
          <div class="mt-3 space-y-1">
            <span class="text-xs font-bold text-[var(--color-text-muted)]">
              Parsed ({instructions.length}):
            </span>
            {instructions.map((inst, i) => (
              <div key={i} class="flex items-center gap-2 text-xs">
                <div
                  class="h-3 w-3 flex-shrink-0 rounded"
                  style={{ backgroundColor: getInstructionColor(i) }}
                />
                <span class="font-mono text-[var(--color-text)]">
                  I{i}: {inst.raw}
                </span>
              </div>
            ))}
          </div>

          {/* Register File */}
          <div class="mt-4">
            <span class="text-xs font-bold text-[var(--color-text-muted)]">
              Registers:
            </span>
            <div class="mt-1 grid grid-cols-4 gap-1">
              {(simState?.registers ?? [0, 1, 2, 3, 4, 5, 6, 7]).map(
                (val, i) => (
                  <div
                    key={i}
                    class="rounded border px-2 py-1 text-center font-mono text-xs"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text)",
                    }}
                  >
                    <span class="text-[var(--color-text-muted)]">R{i}</span>
                    <br />
                    <span class="font-bold text-[var(--color-heading)]">
                      {val}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>

        {/* Pipeline Diagram */}
        <div>
          <div class="mb-2 flex items-center justify-between">
            <span class="text-xs font-bold text-[var(--color-text-muted)]">
              Pipeline Diagram (Cycle {totalCycles}):
            </span>
            <div class="flex gap-3 text-xs text-[var(--color-text-muted)]">
              <span>
                CPI:{" "}
                <span class="font-mono font-bold text-[var(--color-heading)]">
                  {cpi > 0 ? cpi.toFixed(2) : "--"}
                </span>
              </span>
              <span>
                IPC:{" "}
                <span class="font-mono font-bold text-[var(--color-heading)]">
                  {ipc > 0 ? ipc.toFixed(2) : "--"}
                </span>
              </span>
              <span>
                Stalls:{" "}
                <span class="font-mono font-bold text-[var(--color-heading)]">
                  {simState?.stallCycles ?? 0}
                </span>
              </span>
              <span>
                Flushes:{" "}
                <span class="font-mono font-bold text-[var(--color-heading)]">
                  {simState?.flushCycles ?? 0}
                </span>
              </span>
            </div>
          </div>

          <div
            ref={gridContainerRef}
            class="overflow-auto rounded-lg border"
            style={{
              borderColor: "var(--color-border)",
              maxHeight: "400px",
              backgroundColor:
                "color-mix(in srgb, var(--color-surface) 80%, transparent)",
            }}
          >
            <table
              class="w-full border-collapse text-xs"
              style={{ minWidth: "500px" }}
            >
              <thead>
                <tr>
                  <th
                    class="sticky top-0 border-b px-3 py-2 text-left font-bold text-[var(--color-text-muted)]"
                    style={{
                      borderColor: "var(--color-border)",
                      backgroundColor: "var(--color-surface)",
                    }}
                  >
                    Cycle
                  </th>
                  {STAGES.map((stage) => (
                    <th
                      key={stage}
                      class="sticky top-0 border-b px-3 py-2 text-center font-bold text-[var(--color-text-muted)]"
                      style={{
                        borderColor: "var(--color-border)",
                        backgroundColor: "var(--color-surface)",
                      }}
                    >
                      {stage}
                      <div class="text-[10px] font-normal opacity-60">
                        {STAGE_LABELS[stage]}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(simState?.grid ?? []).map((row, cycleIdx) => (
                  <tr key={cycleIdx}>
                    <td
                      class="border-b px-3 py-2 font-mono font-bold text-[var(--color-text-muted)]"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      {cycleIdx + 1}
                    </td>
                    {row.map((entry, stageIdx) => {
                      if (!entry) {
                        return (
                          <td
                            key={stageIdx}
                            class="border-b px-3 py-2"
                            style={{ borderColor: "var(--color-border)" }}
                          />
                        );
                      }

                      const isBubble = entry.stage === "BUBBLE";
                      const isFlush = entry.stage === "FLUSH";
                      const color = isBubble || isFlush
                        ? "transparent"
                        : getInstructionColor(entry.instructionIndex);

                      const inst =
                        entry.instructionIndex >= 0
                          ? instructions[entry.instructionIndex]
                          : null;

                      // Check if there's a hazard affecting this cell
                      const cycleHazards =
                        cycleIdx + 1 === simState?.cycle
                          ? simState.hazardLog
                          : [];
                      const hazardHere = cycleHazards.find(
                        (h) =>
                          h.toInstruction === entry.instructionIndex &&
                          !isBubble,
                      );

                      // Check if there's a forward path to/from this cell
                      const cycleForwards =
                        cycleIdx + 1 === simState?.cycle
                          ? simState.forwardLog
                          : [];
                      const forwardHere = cycleForwards.find(
                        (f) =>
                          f.toInstruction === entry.instructionIndex ||
                          f.fromInstruction === entry.instructionIndex,
                      );

                      return (
                        <td
                          key={stageIdx}
                          class="border-b px-1 py-1 text-center"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          {isBubble ? (
                            <div
                              class="mx-auto rounded px-2 py-1.5 text-xs font-bold"
                              style={{
                                backgroundColor:
                                  "color-mix(in srgb, var(--color-text-muted) 20%, transparent)",
                                color: "var(--color-text-muted)",
                                maxWidth: "80px",
                              }}
                            >
                              STALL
                            </div>
                          ) : isFlush ? (
                            <div
                              class="mx-auto rounded px-2 py-1.5 text-xs font-bold"
                              style={{
                                backgroundColor:
                                  "color-mix(in srgb, #ef4444 20%, transparent)",
                                color: "#ef4444",
                                maxWidth: "80px",
                              }}
                            >
                              FLUSH
                            </div>
                          ) : (
                            <div
                              class="mx-auto rounded px-2 py-1.5 text-xs font-bold"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${color} 25%, transparent)`,
                                color,
                                maxWidth: "80px",
                                border: hazardHere
                                  ? hazardHere.resolved === "forward"
                                    ? "2px solid var(--color-accent)"
                                    : "2px solid #ef4444"
                                  : forwardHere
                                    ? "2px solid var(--color-accent)"
                                    : "1px solid transparent",
                              }}
                              title={
                                inst
                                  ? `I${entry.instructionIndex}: ${inst.raw}${hazardHere ? ` [${hazardHere.type}]` : ""}${forwardHere ? " [FWD]" : ""}`
                                  : ""
                              }
                            >
                              I{entry.instructionIndex}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {(simState?.grid ?? []).length === 0 && (
                  <tr>
                    <td
                      colspan={6}
                      class="px-3 py-8 text-center text-[var(--color-text-muted)]"
                    >
                      Click Step or Play to begin simulation
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Current Cycle Hazard/Forward Info */}
          {simState && simState.hazardLog.length > 0 && (
            <div class="mt-2 space-y-1">
              {simState.hazardLog.map((h, i) => (
                <div
                  key={i}
                  class="flex items-center gap-2 rounded px-2 py-1 text-xs"
                  style={{
                    backgroundColor:
                      h.resolved === "forward"
                        ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                        : h.resolved === "flush"
                          ? "color-mix(in srgb, #ef4444 10%, transparent)"
                          : "color-mix(in srgb, #f59e0b 10%, transparent)",
                    color:
                      h.resolved === "forward"
                        ? "var(--color-accent)"
                        : h.resolved === "flush"
                          ? "#ef4444"
                          : "#f59e0b",
                  }}
                >
                  <span class="font-bold">{h.type}</span>
                  {h.type !== "CONTROL" && (
                    <span>
                      R{h.register}: I{h.fromInstruction} → I{h.toInstruction}
                    </span>
                  )}
                  <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    style={{
                      backgroundColor:
                        h.resolved === "forward"
                          ? "var(--color-accent)"
                          : h.resolved === "flush"
                            ? "#ef4444"
                            : "#f59e0b",
                      color: "#000",
                    }}
                  >
                    {h.resolved}
                  </span>
                </div>
              ))}
            </div>
          )}

          {simState && simState.forwardLog.length > 0 && (
            <div class="mt-2 space-y-1">
              {simState.forwardLog.map((f, i) => (
                <div
                  key={i}
                  class="flex items-center gap-2 rounded px-2 py-1 text-xs"
                  style={{
                    backgroundColor:
                      "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                    color: "var(--color-accent)",
                  }}
                >
                  <span class="font-bold">FWD</span>
                  <span>
                    R{f.register}: {f.fromStage}(I{f.fromInstruction}) → {f.toStage}(I
                    {f.toInstruction})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pipeline Stage Legend */}
      <div
        class="flex flex-wrap gap-4 rounded-lg border p-3"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor:
            "color-mix(in srgb, var(--color-surface) 80%, transparent)",
        }}
      >
        <div class="flex items-center gap-2 text-xs">
          <div
            class="h-3 w-3 rounded"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-text-muted) 20%, transparent)",
            }}
          />
          <span class="text-[var(--color-text-muted)]">Stall (bubble)</span>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <div
            class="h-3 w-3 rounded"
            style={{ border: "2px solid #ef4444" }}
          />
          <span class="text-[var(--color-text-muted)]">RAW Hazard</span>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <div
            class="h-3 w-3 rounded"
            style={{ border: "2px solid var(--color-accent)" }}
          />
          <span class="text-[var(--color-text-muted)]">Forwarding</span>
        </div>
        <div class="flex items-center gap-2 text-xs">
          <div
            class="h-3 w-3 rounded"
            style={{
              backgroundColor:
                "color-mix(in srgb, #ef4444 20%, transparent)",
            }}
          />
          <span class="text-[var(--color-text-muted)]">Flush (branch)</span>
        </div>

        <div class="ml-auto flex gap-3 text-xs">
          <Stat label="Cycle" value={String(totalCycles)} />
          <Stat label="Completed" value={String(completedInstructions)} />
          <Stat label="CPI" value={cpi > 0 ? cpi.toFixed(2) : "--"} />
          <Stat label="IPC" value={ipc > 0 ? ipc.toFixed(2) : "--"} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div class="text-xs">
      <span class="text-[var(--color-text-muted)]">{label}: </span>
      <span class="font-mono font-bold text-[var(--color-heading)]">
        {value}
      </span>
    </div>
  );
}
