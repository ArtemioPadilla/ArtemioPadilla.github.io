import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import type {
  Block,
  MerkleNode,
  ChainStats,
  PresetName,
} from "./engine";
import {
  mineBlock,
  createUnminedBlock,
  validateChain,
  buildMerkleTree,
  computeMerkleRoot,
  getDifficultyPrefix,
  computeStats,
  PRESETS,
} from "./engine";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

type ViewTab = "chain" | "merkle" | "peers";

interface MiningProgress {
  blockIndex: number;
  attempts: number;
}

interface PeerChain {
  label: string;
  chain: Block[];
  validity: boolean[];
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const DIFFICULTY_MIN = 1;
const DIFFICULTY_MAX = 4;
const DEFAULT_DIFFICULTY = 2;

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function BlockchainViz() {
  const [chain, setChain] = useState<Block[]>([]);
  const [difficulty, setDifficulty] = useState(DEFAULT_DIFFICULTY);
  const [validity, setValidity] = useState<boolean[]>([]);
  const [miningTimes, setMiningTimes] = useState<number[]>([]);
  const [miningAttempts, setMiningAttempts] = useState<number[]>([]);
  const [miningProgress, setMiningProgress] = useState<MiningProgress | null>(null);
  const [isMining, setIsMining] = useState(false);
  const [newBlockData, setNewBlockData] = useState("");
  const [activeTab, setActiveTab] = useState<ViewTab>("chain");
  const [merkleBlockIndex, setMerkleBlockIndex] = useState(0);
  const [merkleTree, setMerkleTree] = useState<MerkleNode | null>(null);
  const [peerChains, setPeerChains] = useState<PeerChain[]>([]);
  const [showPeers, setShowPeers] = useState(false);
  const [stats, setStats] = useState<ChainStats | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const chainContainerRef = useRef<HTMLDivElement>(null);

  /* ── Initialize genesis block ── */
  useEffect(() => {
    loadPreset("genesis");
  }, []);

  /* ── Revalidate on chain or difficulty change ── */
  useEffect(() => {
    if (chain.length === 0) return;
    validateChain(chain, difficulty).then(setValidity);
    setStats(computeStats(chain, miningTimes, miningAttempts, difficulty));
  }, [chain, difficulty]);

  /* ── Merkle tree update ── */
  useEffect(() => {
    if (activeTab !== "merkle" || chain.length === 0) return;
    const block = chain[merkleBlockIndex];
    if (!block) return;
    buildMerkleTree(block.transactions).then(setMerkleTree);
  }, [activeTab, merkleBlockIndex, chain]);

  /* ── Auto-scroll chain to rightmost block ── */
  const scrollToEnd = useCallback(() => {
    const el = chainContainerRef.current;
    if (el) {
      setTimeout(() => {
        el.scrollLeft = el.scrollWidth;
      }, 50);
    }
  }, []);

  /* ──────────────────────────────────────
     Preset loading
     ────────────────────────────────────── */

  const loadPreset = useCallback(
    async (name: PresetName) => {
      if (isMining) return;
      const preset = PRESETS[name];
      const blocks: Block[] = [];
      const times: number[] = [];
      const attempts: number[] = [];

      setIsMining(true);
      setMiningProgress({ blockIndex: 0, attempts: 0 });

      for (let i = 0; i < preset.blocks.length; i++) {
        const def = preset.blocks[i];
        const prevHash = i === 0 ? "0".repeat(64) : blocks[i - 1].hash;
        const block = createUnminedBlock(i, def.data, prevHash, def.transactions);
        const merkleRoot = await computeMerkleRoot(block.transactions);
        block.merkleRoot = merkleRoot;

        const result = await mineBlock(
          block.index,
          block.timestamp,
          block.data,
          block.previousHash,
          difficulty,
          merkleRoot,
          (a) => setMiningProgress({ blockIndex: i, attempts: a }),
        );

        block.nonce = result.nonce;
        block.hash = result.hash;
        blocks.push(block);
        times.push(result.timeMs);
        attempts.push(result.attempts);
      }

      // Apply tampering if preset requires it
      if (preset.tamperIndex !== undefined && preset.tamperData !== undefined) {
        const idx = preset.tamperIndex;
        blocks[idx] = { ...blocks[idx], data: preset.tamperData };
      }

      setChain(blocks);
      setMiningTimes(times);
      setMiningAttempts(attempts);
      setIsMining(false);
      setMiningProgress(null);
      scrollToEnd();
    },
    [difficulty, isMining, scrollToEnd],
  );

  /* ──────────────────────────────────────
     Mining a single block
     ────────────────────────────────────── */

  const mineBlockAt = useCallback(
    async (index: number) => {
      if (isMining) return;
      setIsMining(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const block = { ...chain[index] };
      const merkleRoot = await computeMerkleRoot(block.transactions);
      block.merkleRoot = merkleRoot;
      block.timestamp = Date.now();
      if (index > 0) {
        block.previousHash = chain[index - 1].hash;
      }

      setMiningProgress({ blockIndex: index, attempts: 0 });

      try {
        const result = await mineBlock(
          block.index,
          block.timestamp,
          block.data,
          block.previousHash,
          difficulty,
          merkleRoot,
          (a) => setMiningProgress({ blockIndex: index, attempts: a }),
          controller.signal,
        );

        block.nonce = result.nonce;
        block.hash = result.hash;

        setChain((prev) => {
          const updated = [...prev];
          updated[index] = block;
          return updated;
        });
        setMiningTimes((prev) => {
          const updated = [...prev];
          updated[index] = result.timeMs;
          return updated;
        });
        setMiningAttempts((prev) => {
          const updated = [...prev];
          updated[index] = result.attempts;
          return updated;
        });
      } catch {
        // Mining was aborted
      }

      setIsMining(false);
      setMiningProgress(null);
      abortRef.current = null;
    },
    [chain, difficulty, isMining],
  );

  /* ──────────────────────────────────────
     Re-mine from a given index onward
     ────────────────────────────────────── */

  const remineFrom = useCallback(
    async (startIndex: number) => {
      if (isMining) return;
      setIsMining(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const updated = [...chain];
      const times = [...miningTimes];
      const attempts = [...miningAttempts];

      try {
        for (let i = startIndex; i < updated.length; i++) {
          const block = { ...updated[i] };
          block.timestamp = Date.now();
          if (i > 0) {
            block.previousHash = updated[i - 1].hash;
          }
          const merkleRoot = await computeMerkleRoot(block.transactions);
          block.merkleRoot = merkleRoot;

          setMiningProgress({ blockIndex: i, attempts: 0 });

          const result = await mineBlock(
            block.index,
            block.timestamp,
            block.data,
            block.previousHash,
            difficulty,
            merkleRoot,
            (a) => setMiningProgress({ blockIndex: i, attempts: a }),
            controller.signal,
          );

          block.nonce = result.nonce;
          block.hash = result.hash;
          updated[i] = block;
          times[i] = result.timeMs;
          attempts[i] = result.attempts;

          // Update chain progressively
          setChain([...updated]);
        }
      } catch {
        // Mining aborted
      }

      setMiningTimes(times);
      setMiningAttempts(attempts);
      setIsMining(false);
      setMiningProgress(null);
      abortRef.current = null;
    },
    [chain, difficulty, isMining, miningTimes, miningAttempts],
  );

  /* ──────────────────────────────────────
     Add new block
     ────────────────────────────────────── */

  const addBlock = useCallback(async () => {
    if (isMining || !newBlockData.trim()) return;
    setIsMining(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const index = chain.length;
    const prevHash = chain.length > 0 ? chain[chain.length - 1].hash : "0".repeat(64);
    const transactions = newBlockData
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    const block = createUnminedBlock(index, newBlockData.trim(), prevHash, transactions);
    const merkleRoot = await computeMerkleRoot(block.transactions);
    block.merkleRoot = merkleRoot;

    setMiningProgress({ blockIndex: index, attempts: 0 });

    try {
      const result = await mineBlock(
        block.index,
        block.timestamp,
        block.data,
        block.previousHash,
        difficulty,
        merkleRoot,
        (a) => setMiningProgress({ blockIndex: index, attempts: a }),
        controller.signal,
      );

      block.nonce = result.nonce;
      block.hash = result.hash;

      setChain((prev) => [...prev, block]);
      setMiningTimes((prev) => [...prev, result.timeMs]);
      setMiningAttempts((prev) => [...prev, result.attempts]);
      setNewBlockData("");
      scrollToEnd();
    } catch {
      // Mining aborted
    }

    setIsMining(false);
    setMiningProgress(null);
    abortRef.current = null;
  }, [chain, difficulty, isMining, newBlockData, scrollToEnd]);

  /* ──────────────────────────────────────
     Tamper with a block's data
     ────────────────────────────────────── */

  const tamperBlock = useCallback(
    (index: number, newData: string) => {
      if (isMining) return;
      setChain((prev) => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          data: newData,
          transactions: newData
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean),
        };
        return updated;
      });
    },
    [isMining],
  );

  /* ──────────────────────────────────────
     Cancel mining
     ────────────────────────────────────── */

  const cancelMining = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ──────────────────────────────────────
     Peer simulation
     ────────────────────────────────────── */

  const initPeers = useCallback(async () => {
    if (isMining) return;
    setShowPeers(true);
    setActiveTab("peers");
    setIsMining(true);

    // Build two diverging chains from a common ancestor (genesis)
    const genesis = createUnminedBlock(0, "Genesis Block", "0".repeat(64));
    genesis.merkleRoot = await computeMerkleRoot(genesis.transactions);
    const gResult = await mineBlock(
      genesis.index, genesis.timestamp, genesis.data,
      genesis.previousHash, difficulty, genesis.merkleRoot,
    );
    genesis.nonce = gResult.nonce;
    genesis.hash = gResult.hash;

    // Peer A: 3 blocks
    const peerABlocks: Block[] = [genesis];
    for (let i = 1; i <= 3; i++) {
      const b = createUnminedBlock(i, `Peer A tx #${i}`, peerABlocks[i - 1].hash);
      b.merkleRoot = await computeMerkleRoot(b.transactions);
      const r = await mineBlock(b.index, b.timestamp, b.data, b.previousHash, difficulty, b.merkleRoot);
      b.nonce = r.nonce;
      b.hash = r.hash;
      peerABlocks.push(b);
    }

    // Peer B: 2 blocks (shorter — will lose consensus)
    const peerBBlocks: Block[] = [genesis];
    for (let i = 1; i <= 2; i++) {
      const b = createUnminedBlock(i, `Peer B tx #${i}`, peerBBlocks[i - 1].hash);
      b.merkleRoot = await computeMerkleRoot(b.transactions);
      const r = await mineBlock(b.index, b.timestamp, b.data, b.previousHash, difficulty, b.merkleRoot);
      b.nonce = r.nonce;
      b.hash = r.hash;
      peerBBlocks.push(b);
    }

    const validA = await validateChain(peerABlocks, difficulty);
    const validB = await validateChain(peerBBlocks, difficulty);

    setPeerChains([
      { label: "Peer A (3 blocks — wins)", chain: peerABlocks, validity: validA },
      { label: "Peer B (2 blocks — loses)", chain: peerBBlocks, validity: validB },
    ]);

    setIsMining(false);
  }, [difficulty, isMining]);

  /* ──────────────────────────────────────
     Render helpers
     ────────────────────────────────────── */

  const formatHash = (hash: string, diff: number) => {
    if (!hash) return <span class="font-mono text-xs text-[var(--color-text-muted)]">Not mined</span>;
    const prefix = hash.slice(0, diff);
    const rest = hash.slice(diff, 16);
    const ellipsis = hash.length > 16 ? ".." : "";
    return (
      <span class="font-mono text-xs">
        <span style={{ color: "var(--color-accent)" }}>{prefix}</span>
        <span style={{ color: "var(--color-text)" }}>{rest}{ellipsis}</span>
      </span>
    );
  };

  const formatTime = (ms: number) => {
    if (ms < 1) return "<1ms";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  /* ──────────────────────────────────────
     Block Card Component
     ────────────────────────────────────── */

  const BlockCard = ({
    block,
    isValid,
    showRemine,
    onTamper,
    onMine,
    onRemineFrom,
    miningThis,
  }: {
    block: Block;
    isValid: boolean;
    showRemine: boolean;
    onTamper: (data: string) => void;
    onMine: () => void;
    onRemineFrom: () => void;
    miningThis: boolean;
  }) => {
    const borderColor = !block.hash
      ? "var(--color-border)"
      : isValid
        ? "var(--color-accent)"
        : "#ef4444";

    const bgColor = !block.hash
      ? "var(--color-surface)"
      : isValid
        ? "color-mix(in srgb, var(--color-accent) 5%, var(--color-surface))"
        : "color-mix(in srgb, #ef4444 8%, var(--color-surface))";

    return (
      <div
        class="flex-shrink-0 rounded-lg border-2 p-3 transition-colors"
        style={{
          borderColor,
          backgroundColor: bgColor,
          width: "260px",
          minHeight: "280px",
        }}
      >
        {/* Header */}
        <div class="mb-2 flex items-center justify-between">
          <span
            class="rounded px-2 py-0.5 text-xs font-bold"
            style={{
              backgroundColor: isValid ? "var(--color-accent)" : "#ef4444",
              color: "#000",
            }}
          >
            Block #{block.index}
          </span>
          {!isValid && block.hash && (
            <span class="text-xs font-bold" style={{ color: "#ef4444" }}>
              INVALID
            </span>
          )}
          {isValid && block.hash && (
            <span class="text-xs font-bold" style={{ color: "var(--color-accent)" }}>
              VALID
            </span>
          )}
        </div>

        {/* Fields */}
        <div class="space-y-1.5 text-xs">
          <Field label="Nonce" value={String(block.nonce)} />
          <Field label="Timestamp" value={new Date(block.timestamp).toLocaleTimeString()} />

          <div>
            <span class="font-bold text-[var(--color-text-muted)]">Data:</span>
            <textarea
              class="mt-0.5 block w-full resize-none rounded border bg-transparent p-1 font-mono text-xs text-[var(--color-text)]"
              style={{ borderColor: "var(--color-border)" }}
              rows={2}
              value={block.data}
              onInput={(e) => onTamper((e.target as HTMLTextAreaElement).value)}
              disabled={isMining}
            />
          </div>

          <div>
            <span class="font-bold text-[var(--color-text-muted)]">Prev Hash:</span>
            <div class="mt-0.5 truncate font-mono text-xs text-[var(--color-text-muted)]">
              {block.previousHash.slice(0, 16)}..
            </div>
          </div>

          <div>
            <span class="font-bold text-[var(--color-text-muted)]">Hash:</span>
            <div class="mt-0.5">{formatHash(block.hash, difficulty)}</div>
          </div>
        </div>

        {/* Mining indicator */}
        {miningThis && miningProgress && (
          <div class="mt-2 text-xs text-[var(--color-primary)]">
            Mining... {miningProgress.attempts.toLocaleString()} attempts
            <div
              class="mt-1 h-1 rounded-full"
              style={{ backgroundColor: "var(--color-border)" }}
            >
              <div
                class="h-1 rounded-full transition-all"
                style={{
                  backgroundColor: "var(--color-primary)",
                  width: `${Math.min((miningProgress.attempts / 1000) * 100, 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div class="mt-2 flex gap-1.5">
          {!isValid && block.hash && (
            <button
              class="rounded px-2 py-1 text-xs font-bold text-white transition-colors"
              style={{ backgroundColor: "var(--color-primary)" }}
              onClick={onMine}
              disabled={isMining}
            >
              Mine
            </button>
          )}
          {showRemine && !isValid && (
            <button
              class="rounded px-2 py-1 text-xs font-bold transition-colors"
              style={{
                backgroundColor: "transparent",
                border: "1px solid var(--color-primary)",
                color: "var(--color-primary)",
              }}
              onClick={onRemineFrom}
              disabled={isMining}
            >
              Re-mine all
            </button>
          )}
        </div>
      </div>
    );
  };

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div>
      <span class="font-bold text-[var(--color-text-muted)]">{label}:</span>{" "}
      <span class="font-mono text-[var(--color-text)]">{value}</span>
    </div>
  );

  /* ──────────────────────────────────────
     Arrow connector between blocks
     ────────────────────────────────────── */

  const Arrow = ({ valid }: { valid: boolean }) => (
    <div class="flex flex-shrink-0 items-center" style={{ width: "40px" }}>
      <div
        class="h-0.5 flex-1"
        style={{ backgroundColor: valid ? "var(--color-accent)" : "#ef4444" }}
      />
      <div
        style={{
          width: 0,
          height: 0,
          borderTop: "6px solid transparent",
          borderBottom: "6px solid transparent",
          borderLeft: `8px solid ${valid ? "var(--color-accent)" : "#ef4444"}`,
        }}
      />
    </div>
  );

  /* ──────────────────────────────────────
     Merkle Tree Renderer
     ────────────────────────────────────── */

  const MerkleTreeView = ({ node, depth = 0 }: { node: MerkleNode | null; depth?: number }) => {
    if (!node) return <div class="text-sm text-[var(--color-text-muted)]">No transactions</div>;

    const isLeaf = !node.left && !node.right;
    const bgColor = isLeaf
      ? "color-mix(in srgb, var(--color-primary) 15%, var(--color-surface))"
      : "color-mix(in srgb, var(--color-accent) 10%, var(--color-surface))";

    return (
      <div class="flex flex-col items-center">
        <div
          class="rounded border px-2 py-1 text-center"
          style={{
            borderColor: isLeaf ? "var(--color-primary)" : "var(--color-accent)",
            backgroundColor: bgColor,
            maxWidth: "160px",
          }}
        >
          <div class="font-mono text-xs" style={{ color: "var(--color-accent)" }}>
            {node.hash.slice(0, 8)}..
          </div>
          {node.label && (
            <div class="mt-0.5 text-xs text-[var(--color-text)]">{node.label}</div>
          )}
        </div>
        {(node.left || node.right) && (
          <div class="mt-1 flex items-start gap-4">
            <div class="flex flex-col items-center">
              <div class="h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />
              <MerkleTreeView node={node.left} depth={depth + 1} />
            </div>
            {node.right && (
              <div class="flex flex-col items-center">
                <div class="h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />
                <MerkleTreeView node={node.right} depth={depth + 1} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ──────────────────────────────────────
     Peer Chain Mini View
     ────────────────────────────────────── */

  const PeerChainView = ({ peer, isWinner }: { peer: PeerChain; isWinner: boolean }) => (
    <div
      class="rounded-lg border p-4"
      style={{
        borderColor: isWinner ? "var(--color-accent)" : "var(--color-border)",
        backgroundColor: isWinner
          ? "color-mix(in srgb, var(--color-accent) 5%, var(--color-surface))"
          : "var(--color-surface)",
      }}
    >
      <div class="mb-3 flex items-center gap-2">
        <span class="text-sm font-bold text-[var(--color-heading)]">{peer.label}</span>
        {isWinner && (
          <span
            class="rounded px-2 py-0.5 text-xs font-bold"
            style={{ backgroundColor: "var(--color-accent)", color: "#000" }}
          >
            CONSENSUS
          </span>
        )}
      </div>
      <div class="flex items-center gap-2 overflow-x-auto pb-2">
        {peer.chain.map((block, i) => (
          <div key={i} class="flex items-center gap-2">
            {i > 0 && <Arrow valid={peer.validity[i]} />}
            <div
              class="flex-shrink-0 rounded border p-2"
              style={{
                borderColor: peer.validity[i] ? "var(--color-accent)" : "#ef4444",
                width: "140px",
              }}
            >
              <div class="text-xs font-bold" style={{ color: peer.validity[i] ? "var(--color-accent)" : "#ef4444" }}>
                Block #{block.index}
              </div>
              <div class="mt-1 truncate font-mono text-xs text-[var(--color-text-muted)]">
                {block.data}
              </div>
              <div class="mt-1">{formatHash(block.hash, difficulty)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  /* ──────────────────────────────────────
     Main render
     ────────────────────────────────────── */

  return (
    <div
      class="space-y-4 rounded-xl border p-4 sm:p-6"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-surface)",
      }}
    >
      {/* ── Controls Bar ── */}
      <div class="flex flex-wrap items-center gap-3">
        {/* Difficulty */}
        <div class="flex items-center gap-2">
          <label class="text-xs font-bold text-[var(--color-text-muted)]">
            Difficulty:
          </label>
          <input
            type="range"
            min={DIFFICULTY_MIN}
            max={DIFFICULTY_MAX}
            value={difficulty}
            onInput={(e) => setDifficulty(Number((e.target as HTMLInputElement).value))}
            disabled={isMining}
            class="w-20"
          />
          <span class="font-mono text-sm text-[var(--color-heading)]">
            {difficulty} ({getDifficultyPrefix(difficulty)}x)
          </span>
        </div>

        <div class="h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />

        {/* Presets */}
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-bold text-[var(--color-text-muted)]">Presets:</span>
          {(Object.entries(PRESETS) as [PresetName, typeof PRESETS[PresetName]][]).map(
            ([key, preset]) => (
              <button
                key={key}
                class="rounded px-2 py-1 text-xs transition-colors"
                style={{
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                  backgroundColor: "transparent",
                }}
                onClick={() => loadPreset(key)}
                disabled={isMining}
                title={preset.description}
              >
                {preset.label}
              </button>
            ),
          )}
        </div>

        <div class="h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />

        {/* Peer simulation */}
        <button
          class="rounded px-2 py-1 text-xs transition-colors"
          style={{
            border: "1px solid var(--color-primary)",
            color: "var(--color-primary)",
            backgroundColor: "transparent",
          }}
          onClick={initPeers}
          disabled={isMining}
        >
          Peer Simulation
        </button>

        {/* Cancel button */}
        {isMining && (
          <button
            class="rounded px-2 py-1 text-xs font-bold text-white transition-colors"
            style={{ backgroundColor: "#ef4444" }}
            onClick={cancelMining}
          >
            Cancel Mining
          </button>
        )}
      </div>

      {/* ── Tab Nav ── */}
      <div class="flex gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
        {(
          [
            { key: "chain" as ViewTab, label: "Chain View" },
            { key: "merkle" as ViewTab, label: "Merkle Tree" },
            ...(showPeers ? [{ key: "peers" as ViewTab, label: "Peer Consensus" }] : []),
          ] as Array<{ key: ViewTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.key}
            class="px-3 py-2 text-xs font-bold transition-colors"
            style={{
              color:
                activeTab === tab.key
                  ? "var(--color-primary)"
                  : "var(--color-text-muted)",
              borderBottom:
                activeTab === tab.key
                  ? "2px solid var(--color-primary)"
                  : "2px solid transparent",
              backgroundColor: "transparent",
            }}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Chain View ── */}
      {activeTab === "chain" && (
        <div>
          {/* Blocks */}
          <div
            ref={chainContainerRef}
            class="flex items-start gap-0 overflow-x-auto pb-4"
            style={{ scrollBehavior: "smooth" }}
          >
            {chain.map((block, i) => (
              <div key={`${block.index}-${block.hash}`} class="flex items-center">
                {i > 0 && <Arrow valid={validity[i] ?? true} />}
                <BlockCard
                  block={block}
                  isValid={validity[i] ?? true}
                  showRemine={
                    !validity[i] &&
                    validity.slice(i).some((v) => !v)
                  }
                  onTamper={(data) => tamperBlock(i, data)}
                  onMine={() => mineBlockAt(i)}
                  onRemineFrom={() => remineFrom(i)}
                  miningThis={miningProgress?.blockIndex === i}
                />
              </div>
            ))}
          </div>

          {/* Add new block */}
          <div
            class="mt-4 flex items-start gap-3 rounded-lg border p-3"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
            }}
          >
            <div class="flex-1">
              <label class="mb-1 block text-xs font-bold text-[var(--color-text-muted)]">
                New block data (one transaction per line):
              </label>
              <textarea
                class="w-full resize-none rounded border bg-transparent p-2 font-mono text-xs text-[var(--color-text)]"
                style={{ borderColor: "var(--color-border)" }}
                rows={2}
                placeholder="Alice pays Bob 10 BTC&#10;Bob pays Carol 5 BTC"
                value={newBlockData}
                onInput={(e) => setNewBlockData((e.target as HTMLTextAreaElement).value)}
                disabled={isMining}
              />
            </div>
            <button
              class="mt-5 whitespace-nowrap rounded px-4 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary)" }}
              onClick={addBlock}
              disabled={isMining || !newBlockData.trim()}
            >
              Add & Mine
            </button>
          </div>
        </div>
      )}

      {/* ── Merkle Tree View ── */}
      {activeTab === "merkle" && (
        <div>
          <div class="mb-3 flex items-center gap-2">
            <label class="text-xs font-bold text-[var(--color-text-muted)]">
              Select block:
            </label>
            <select
              class="rounded border bg-transparent px-2 py-1 text-xs text-[var(--color-text)]"
              style={{ borderColor: "var(--color-border)" }}
              value={merkleBlockIndex}
              onChange={(e) => setMerkleBlockIndex(Number((e.target as HTMLSelectElement).value))}
            >
              {chain.map((b, i) => (
                <option key={i} value={i}>
                  Block #{b.index} — {b.data.slice(0, 30)}
                </option>
              ))}
            </select>
          </div>

          {chain[merkleBlockIndex] && (
            <div class="mb-2 text-xs text-[var(--color-text-muted)]">
              Transactions: {chain[merkleBlockIndex].transactions.length} |{" "}
              Merkle Root: <span class="font-mono text-[var(--color-accent)]">
                {chain[merkleBlockIndex].merkleRoot.slice(0, 16)}..
              </span>
            </div>
          )}

          <div
            class="overflow-x-auto rounded-lg border p-4"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
            }}
          >
            <div class="flex justify-center">
              <MerkleTreeView node={merkleTree} />
            </div>
          </div>
        </div>
      )}

      {/* ── Peer Consensus View ── */}
      {activeTab === "peers" && showPeers && (
        <div class="space-y-4">
          <div
            class="rounded-lg border p-3 text-xs text-[var(--color-text-muted)]"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "color-mix(in srgb, var(--color-primary) 5%, var(--color-surface))",
            }}
          >
            <strong class="text-[var(--color-heading)]">Longest Chain Rule:</strong>{" "}
            When peers have conflicting chains, the network adopts the longest valid chain.
            Peer A has more blocks, so its chain wins consensus.
          </div>

          {peerChains.map((peer, i) => (
            <PeerChainView
              key={i}
              peer={peer}
              isWinner={i === 0}
            />
          ))}
        </div>
      )}

      {/* ── Stats Footer ── */}
      {stats && (
        <div
          class="flex flex-wrap gap-4 rounded-lg border p-3"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "color-mix(in srgb, var(--color-surface) 80%, transparent)",
          }}
        >
          <Stat label="Blocks" value={String(stats.totalBlocks)} />
          <Stat label="Difficulty" value={`${stats.difficulty} (${"0".repeat(stats.difficulty)}..)`} />
          <Stat label="Total Mining" value={formatTime(stats.totalMiningTimeMs)} />
          <Stat label="Total Hashes" value={stats.totalAttempts.toLocaleString()} />
          <Stat
            label="Hash Rate"
            value={`${Math.round(stats.averageHashRate).toLocaleString()} H/s`}
          />
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────
   Small stat display
   ────────────────────────────────────── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div class="text-xs">
      <span class="text-[var(--color-text-muted)]">{label}: </span>
      <span class="font-mono font-bold text-[var(--color-heading)]">{value}</span>
    </div>
  );
}
