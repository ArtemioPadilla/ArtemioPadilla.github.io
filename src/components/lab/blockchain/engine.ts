/* ──────────────────────────────────────
   Blockchain Engine — pure logic, SSR-safe
   All browser-dependent code (Web Crypto) is
   guarded behind async functions that are never
   called during SSR.
   ────────────────────────────────────── */

export interface Block {
  index: number;
  timestamp: number;
  data: string;
  previousHash: string;
  nonce: number;
  hash: string;
  transactions: string[];
  merkleRoot: string;
}

export interface MiningResult {
  nonce: number;
  hash: string;
  attempts: number;
  timeMs: number;
}

export interface ChainStats {
  totalBlocks: number;
  totalMiningTimeMs: number;
  totalAttempts: number;
  averageHashRate: number;
  difficulty: number;
}

export interface MerkleNode {
  hash: string;
  left: MerkleNode | null;
  right: MerkleNode | null;
  label: string;
}

/* ──────────────────────────────────────
   SHA-256 via Web Crypto API
   ────────────────────────────────────── */

export async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ──────────────────────────────────────
   Difficulty target
   ────────────────────────────────────── */

export function getDifficultyPrefix(difficulty: number): string {
  return "0".repeat(difficulty);
}

export function hashMeetsDifficulty(hash: string, difficulty: number): boolean {
  return hash.startsWith(getDifficultyPrefix(difficulty));
}

/* ──────────────────────────────────────
   Mining
   ────────────────────────────────────── */

export async function mineBlock(
  index: number,
  timestamp: number,
  data: string,
  previousHash: string,
  difficulty: number,
  merkleRoot: string,
  onProgress?: (attempts: number) => void,
  signal?: AbortSignal,
): Promise<MiningResult> {
  const prefix = getDifficultyPrefix(difficulty);
  let nonce = 0;
  let attempts = 0;
  const start = performance.now();

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("Mining aborted", "AbortError");
    }

    const candidate = blockString(index, timestamp, data, previousHash, nonce, merkleRoot);
    const hash = await sha256(candidate);
    attempts++;

    if (hash.startsWith(prefix)) {
      return {
        nonce,
        hash,
        attempts,
        timeMs: performance.now() - start,
      };
    }

    nonce++;

    if (attempts % 500 === 0) {
      onProgress?.(attempts);
      // Yield to the event loop every 500 attempts to keep UI responsive
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
}

/* ──────────────────────────────────────
   Block string serialization
   ────────────────────────────────────── */

export function blockString(
  index: number,
  timestamp: number,
  data: string,
  previousHash: string,
  nonce: number,
  merkleRoot: string,
): string {
  return `${index}${timestamp}${data}${previousHash}${nonce}${merkleRoot}`;
}

/* ──────────────────────────────────────
   Block creation
   ────────────────────────────────────── */

export function createUnminedBlock(
  index: number,
  data: string,
  previousHash: string,
  transactions?: string[],
): Block {
  const txs = transactions ?? [data];
  return {
    index,
    timestamp: Date.now(),
    data,
    previousHash,
    nonce: 0,
    hash: "",
    transactions: txs,
    merkleRoot: "",
  };
}

/* ──────────────────────────────────────
   Hash computation for a full block
   ────────────────────────────────────── */

export async function computeBlockHash(block: Block): Promise<string> {
  const str = blockString(
    block.index,
    block.timestamp,
    block.data,
    block.previousHash,
    block.nonce,
    block.merkleRoot,
  );
  return sha256(str);
}

/* ──────────────────────────────────────
   Chain validation
   ────────────────────────────────────── */

export async function validateChain(
  chain: Block[],
  difficulty: number,
): Promise<boolean[]> {
  const valid: boolean[] = new Array(chain.length).fill(true);

  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    const expectedHash = await computeBlockHash(block);

    if (block.hash !== expectedHash) {
      // This block and all after it are invalid
      for (let j = i; j < chain.length; j++) {
        valid[j] = false;
      }
      break;
    }

    if (!hashMeetsDifficulty(block.hash, difficulty)) {
      for (let j = i; j < chain.length; j++) {
        valid[j] = false;
      }
      break;
    }

    if (i > 0 && block.previousHash !== chain[i - 1].hash) {
      for (let j = i; j < chain.length; j++) {
        valid[j] = false;
      }
      break;
    }
  }

  return valid;
}

/* ──────────────────────────────────────
   Merkle Tree
   ────────────────────────────────────── */

export async function buildMerkleTree(transactions: string[]): Promise<MerkleNode | null> {
  if (transactions.length === 0) return null;

  let nodes: MerkleNode[] = await Promise.all(
    transactions.map(async (tx) => ({
      hash: await sha256(tx),
      left: null,
      right: null,
      label: tx.length > 16 ? tx.slice(0, 14) + ".." : tx,
    })),
  );

  while (nodes.length > 1) {
    const nextLevel: MerkleNode[] = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left = nodes[i];
      const right = i + 1 < nodes.length ? nodes[i + 1] : nodes[i];
      const combinedHash = await sha256(left.hash + right.hash);
      nextLevel.push({
        hash: combinedHash,
        left,
        right: i + 1 < nodes.length ? right : null,
        label: "",
      });
    }
    nodes = nextLevel;
  }

  return nodes[0];
}

export async function computeMerkleRoot(transactions: string[]): Promise<string> {
  const tree = await buildMerkleTree(transactions);
  return tree?.hash ?? "";
}

/* ──────────────────────────────────────
   Presets
   ────────────────────────────────────── */

export type PresetName = "genesis" | "five-blocks" | "tampered";

export interface PresetDef {
  label: string;
  description: string;
  blocks: Array<{ data: string; transactions?: string[] }>;
  tamperIndex?: number;
  tamperData?: string;
}

export const PRESETS: Record<PresetName, PresetDef> = {
  genesis: {
    label: "Genesis Only",
    description: "A single genesis block",
    blocks: [{ data: "Genesis Block" }],
  },
  "five-blocks": {
    label: "5-Block Chain",
    description: "A valid chain of 5 blocks",
    blocks: [
      { data: "Genesis Block" },
      { data: "Alice pays Bob 10 BTC", transactions: ["Alice->Bob: 10", "Miner reward: 1"] },
      { data: "Bob pays Carol 5 BTC", transactions: ["Bob->Carol: 5", "Carol->Dave: 2", "Miner reward: 1"] },
      { data: "Carol pays Dave 3 BTC", transactions: ["Carol->Dave: 3", "Miner reward: 1"] },
      { data: "Dave pays Eve 1 BTC", transactions: ["Dave->Eve: 1", "Eve->Alice: 0.5", "Miner reward: 1"] },
    ],
  },
  tampered: {
    label: "Tampered Chain",
    description: "A 4-block chain where block #2 has been tampered with",
    blocks: [
      { data: "Genesis Block" },
      { data: "Alice pays Bob 10 BTC" },
      { data: "Bob pays Carol 5 BTC" },
      { data: "Carol pays Dave 3 BTC" },
    ],
    tamperIndex: 1,
    tamperData: "Alice pays Bob 1000 BTC",
  },
};

/* ──────────────────────────────────────
   Chain stats
   ────────────────────────────────────── */

export function computeStats(
  chain: Block[],
  miningTimes: number[],
  miningAttempts: number[],
  difficulty: number,
): ChainStats {
  const totalMiningTimeMs = miningTimes.reduce((a, b) => a + b, 0);
  const totalAttempts = miningAttempts.reduce((a, b) => a + b, 0);
  const averageHashRate =
    totalMiningTimeMs > 0 ? (totalAttempts / totalMiningTimeMs) * 1000 : 0;

  return {
    totalBlocks: chain.length,
    totalMiningTimeMs,
    totalAttempts,
    averageHashRate,
    difficulty,
  };
}
