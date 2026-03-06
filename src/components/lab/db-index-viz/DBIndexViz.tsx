import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "preact/hooks";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type IndexType = "btree" | "bplus" | "hash";

interface BTreeNode {
  keys: number[];
  children: BTreeNode[];
  isLeaf: boolean;
  next: BTreeNode | null; // only used in B+ Tree leaves
}

interface HashBucket {
  entries: number[];
}

interface HashIndex {
  buckets: HashBucket[];
  size: number;
  count: number;
}

interface AnimationFrame {
  type: "visit" | "insert" | "split" | "merge" | "redistribute" | "found" | "not-found" | "hash" | "range" | "delete" | "leaf-link";
  nodeKeys?: number[];
  key?: number;
  bucketIndex?: number;
  description: string;
}

interface Stats {
  height: number;
  nodeCount: number;
  keyCount: number;
  comparisons: number;
}

interface LayoutNode {
  node: BTreeNode;
  x: number;
  y: number;
  width: number;
}

interface ThemeColors {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  heading: string;
  primary: string;
  accent: string;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const INDEX_TABS: Array<{ value: IndexType; label: string }> = [
  { value: "btree", label: "B-Tree" },
  { value: "bplus", label: "B+ Tree" },
  { value: "hash", label: "Hash Index" },
];

const NODE_HEIGHT = 32;
const KEY_WIDTH = 36;
const NODE_GAP_X = 16;
const LEVEL_GAP_Y = 64;
const CANVAS_PADDING = 24;
const LEAF_LINK_Y_OFFSET = 16;
const HASH_BUCKET_WIDTH = 120;
const HASH_BUCKET_HEIGHT = 36;
const HASH_CHAIN_NODE_W = 44;
const HASH_CHAIN_NODE_H = 28;
const HASH_CHAIN_GAP = 8;

const INITIAL_HASH_SIZE = 8;
const HASH_LOAD_THRESHOLD = 0.75;

const FONT = "13px Inter, system-ui, sans-serif";
const FONT_SMALL = "11px Inter, system-ui, sans-serif";
const FONT_BOLD = "bold 13px Inter, system-ui, sans-serif";

const PRESETS = [
  { label: "Sequential (1-15)", keys: Array.from({ length: 15 }, (_, i) => i + 1) },
  { label: "Random (15 keys)", keys: [] as number[] },
  { label: "Bulk load (sorted)", keys: [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35] },
];

function generateRandomPreset(): number[] {
  const set = new Set<number>();
  while (set.size < 15) {
    set.add(Math.floor(Math.random() * 99) + 1);
  }
  return Array.from(set);
}

// ─────────────────────────────────────────────────────────
// B-Tree / B+ Tree Engine
// ─────────────────────────────────────────────────────────

function createNode(isLeaf: boolean): BTreeNode {
  return { keys: [], children: [], isLeaf, next: null };
}

function btreeSearch(
  root: BTreeNode | null,
  key: number,
  frames: AnimationFrame[],
): BTreeNode | null {
  let node = root;
  while (node) {
    frames.push({
      type: "visit",
      nodeKeys: [...node.keys],
      key,
      description: `Visit node [${node.keys.join(", ")}], looking for ${key}`,
    });
    let i = 0;
    while (i < node.keys.length && key > node.keys[i]) i++;
    if (i < node.keys.length && node.keys[i] === key) {
      frames.push({
        type: "found",
        nodeKeys: [...node.keys],
        key,
        description: `Found ${key} in node [${node.keys.join(", ")}]`,
      });
      return node;
    }
    if (node.isLeaf) {
      frames.push({
        type: "not-found",
        key,
        description: `${key} not found (reached leaf)`,
      });
      return null;
    }
    node = node.children[i];
  }
  return null;
}

function bplusSearch(
  root: BTreeNode | null,
  key: number,
  frames: AnimationFrame[],
): BTreeNode | null {
  let node = root;
  while (node) {
    frames.push({
      type: "visit",
      nodeKeys: [...node.keys],
      key,
      description: `Visit node [${node.keys.join(", ")}], routing to ${key}`,
    });
    if (node.isLeaf) {
      if (node.keys.includes(key)) {
        frames.push({
          type: "found",
          nodeKeys: [...node.keys],
          key,
          description: `Found ${key} in leaf [${node.keys.join(", ")}]`,
        });
        return node;
      }
      frames.push({
        type: "not-found",
        key,
        description: `${key} not found in leaf`,
      });
      return null;
    }
    let i = 0;
    while (i < node.keys.length && key >= node.keys[i]) i++;
    node = node.children[i];
  }
  return null;
}

function splitChild(parent: BTreeNode, index: number, order: number, isBPlus: boolean): void {
  const child = parent.children[index];
  const mid = Math.floor(order / 2);
  const newNode = createNode(child.isLeaf);

  if (isBPlus && child.isLeaf) {
    // B+ Tree leaf split: copy median up, keep all keys in leaves
    newNode.keys = child.keys.splice(mid);
    newNode.isLeaf = true;
    newNode.next = child.next;
    child.next = newNode;
    parent.keys.splice(index, 0, newNode.keys[0]);
    parent.children.splice(index + 1, 0, newNode);
  } else {
    // B-Tree split OR B+ Tree internal split: median goes up
    const medianKey = child.keys[mid];
    newNode.keys = child.keys.splice(mid + 1);
    child.keys.splice(mid); // remove median from child
    if (!child.isLeaf) {
      newNode.children = child.children.splice(mid + 1);
    }
    newNode.isLeaf = child.isLeaf;
    parent.keys.splice(index, 0, medianKey);
    parent.children.splice(index + 1, 0, newNode);
  }
}

function btreeInsert(
  root: BTreeNode | null,
  key: number,
  order: number,
  isBPlus: boolean,
  frames: AnimationFrame[],
): BTreeNode {
  if (!root) {
    const node = createNode(true);
    node.keys.push(key);
    frames.push({
      type: "insert",
      nodeKeys: [key],
      key,
      description: `Create root with key ${key}`,
    });
    return node;
  }

  // If root is full, split it first
  if (root.keys.length >= order) {
    const newRoot = createNode(false);
    newRoot.children.push(root);
    splitChild(newRoot, 0, order, isBPlus);
    frames.push({
      type: "split",
      nodeKeys: [...newRoot.keys],
      key,
      description: `Root split: new root [${newRoot.keys.join(", ")}]`,
    });
    insertNonFull(newRoot, key, order, isBPlus, frames);
    return newRoot;
  }

  insertNonFull(root, key, order, isBPlus, frames);
  return root;
}

function insertNonFull(
  node: BTreeNode,
  key: number,
  order: number,
  isBPlus: boolean,
  frames: AnimationFrame[],
): void {
  frames.push({
    type: "visit",
    nodeKeys: [...node.keys],
    key,
    description: `Navigate node [${node.keys.join(", ")}]`,
  });

  if (node.isLeaf) {
    let i = node.keys.length - 1;
    while (i >= 0 && node.keys[i] > key) i--;
    // Avoid duplicates
    if (i >= 0 && node.keys[i] === key) {
      frames.push({
        type: "found",
        nodeKeys: [...node.keys],
        key,
        description: `Key ${key} already exists`,
      });
      return;
    }
    node.keys.splice(i + 1, 0, key);
    frames.push({
      type: "insert",
      nodeKeys: [...node.keys],
      key,
      description: `Insert ${key} into leaf [${node.keys.join(", ")}]`,
    });
    return;
  }

  let i = 0;
  while (i < node.keys.length && key > node.keys[i]) i++;
  // For B+ Tree, key >= routing key goes right
  if (isBPlus) {
    i = 0;
    while (i < node.keys.length && key >= node.keys[i]) i++;
  }

  if (node.children[i] && node.children[i].keys.length >= order) {
    splitChild(node, i, order, isBPlus);
    frames.push({
      type: "split",
      nodeKeys: [...node.keys],
      key,
      description: `Split child, parent now [${node.keys.join(", ")}]`,
    });
    if (key > node.keys[i]) i++;
    if (isBPlus && key >= node.keys[i]) i++;
  }

  if (node.children[i]) {
    insertNonFull(node.children[i], key, order, isBPlus, frames);
  }
}

function btreeDelete(
  root: BTreeNode | null,
  key: number,
  order: number,
  isBPlus: boolean,
  frames: AnimationFrame[],
): BTreeNode | null {
  if (!root) return null;
  deleteKey(root, key, order, isBPlus, frames);

  // If root has no keys, use its child as new root
  if (root.keys.length === 0 && !root.isLeaf) {
    frames.push({
      type: "merge",
      description: "Root is empty, promoting child",
    });
    return root.children[0] || null;
  }
  if (root.keys.length === 0 && root.isLeaf) {
    return null;
  }
  return root;
}

function deleteKey(
  node: BTreeNode,
  key: number,
  order: number,
  isBPlus: boolean,
  frames: AnimationFrame[],
): void {
  const minKeys = Math.floor(order / 2) - (order % 2 === 0 ? 1 : 0);
  frames.push({
    type: "visit",
    nodeKeys: [...node.keys],
    key,
    description: `Visit node [${node.keys.join(", ")}] to delete ${key}`,
  });

  const idx = node.keys.indexOf(key);

  if (node.isLeaf) {
    if (idx >= 0) {
      node.keys.splice(idx, 1);
      frames.push({
        type: "delete",
        nodeKeys: [...node.keys],
        key,
        description: `Removed ${key} from leaf [${node.keys.join(", ")}]`,
      });
    } else {
      frames.push({
        type: "not-found",
        key,
        description: `${key} not found in leaf`,
      });
    }
    return;
  }

  if (idx >= 0 && !isBPlus) {
    // Key in internal node (B-Tree): replace with predecessor
    const pred = getPredecessor(node.children[idx]);
    node.keys[idx] = pred;
    frames.push({
      type: "delete",
      nodeKeys: [...node.keys],
      key,
      description: `Replace ${key} with predecessor ${pred}`,
    });
    ensureMinKeys(node, idx, order, minKeys);
    deleteKey(node.children[idx], pred, order, isBPlus, frames);
    return;
  }

  // Find child to descend into
  let childIdx = 0;
  if (isBPlus) {
    while (childIdx < node.keys.length && key >= node.keys[childIdx]) childIdx++;
  } else {
    while (childIdx < node.keys.length && key > node.keys[childIdx]) childIdx++;
  }

  if (!node.children[childIdx]) return;

  ensureMinKeys(node, childIdx, order, minKeys);

  // After ensure, the structure may have changed; re-find child
  if (isBPlus) {
    childIdx = 0;
    while (childIdx < node.keys.length && key >= node.keys[childIdx]) childIdx++;
  } else {
    childIdx = 0;
    while (childIdx < node.keys.length && key > node.keys[childIdx]) childIdx++;
  }

  if (node.children[childIdx]) {
    deleteKey(node.children[childIdx], key, order, isBPlus, frames);
    // For B+ Tree: update routing keys if needed
    if (isBPlus && !node.children[childIdx].isLeaf) return;
    if (isBPlus && childIdx > 0 && node.children[childIdx].keys.length > 0) {
      node.keys[childIdx - 1] = node.children[childIdx].keys[0];
    }
  }
}

function ensureMinKeys(
  parent: BTreeNode,
  childIdx: number,
  order: number,
  minKeys: number,
): void {
  const child = parent.children[childIdx];
  if (!child || child.keys.length > minKeys) return;

  const left = childIdx > 0 ? parent.children[childIdx - 1] : null;
  const right = childIdx < parent.children.length - 1 ? parent.children[childIdx + 1] : null;

  if (left && left.keys.length > minKeys) {
    // Borrow from left
    child.keys.unshift(parent.keys[childIdx - 1]);
    parent.keys[childIdx - 1] = left.keys.pop()!;
    if (!left.isLeaf) {
      child.children.unshift(left.children.pop()!);
    }
  } else if (right && right.keys.length > minKeys) {
    // Borrow from right
    child.keys.push(parent.keys[childIdx]);
    parent.keys[childIdx] = right.keys.shift()!;
    if (!right.isLeaf) {
      child.children.push(right.children.shift()!);
    }
  } else if (left) {
    // Merge with left
    left.keys.push(parent.keys[childIdx - 1]);
    left.keys.push(...child.keys);
    left.children.push(...child.children);
    left.next = child.next;
    parent.keys.splice(childIdx - 1, 1);
    parent.children.splice(childIdx, 1);
  } else if (right) {
    // Merge with right
    child.keys.push(parent.keys[childIdx]);
    child.keys.push(...right.keys);
    child.children.push(...right.children);
    child.next = right.next;
    parent.keys.splice(childIdx, 1);
    parent.children.splice(childIdx + 1, 1);
  }
}

function getPredecessor(node: BTreeNode): number {
  while (!node.isLeaf) {
    node = node.children[node.children.length - 1];
  }
  return node.keys[node.keys.length - 1];
}

function rangeQuery(
  root: BTreeNode | null,
  low: number,
  high: number,
  isBPlus: boolean,
  frames: AnimationFrame[],
): number[] {
  const result: number[] = [];
  if (!root) return result;

  if (isBPlus) {
    // Navigate to leftmost leaf >= low
    let node: BTreeNode | null = root;
    while (node && !node.isLeaf) {
      frames.push({
        type: "visit",
        nodeKeys: [...node.keys],
        description: `Navigate toward range [${low}, ${high}]`,
      });
      let i = 0;
      while (i < node.keys.length && low >= node.keys[i]) i++;
      node = node.children[i] || null;
    }
    // Scan leaf chain
    while (node) {
      frames.push({
        type: "range",
        nodeKeys: [...node.keys],
        description: `Scan leaf [${node.keys.join(", ")}]`,
      });
      for (const k of node.keys) {
        if (k >= low && k <= high) result.push(k);
        if (k > high) return result;
      }
      if (node.next) {
        frames.push({
          type: "leaf-link",
          description: "Follow leaf link to next leaf",
        });
      }
      node = node.next;
    }
  } else {
    // In-order traversal for B-Tree
    rangeInOrder(root, low, high, result, frames);
  }
  return result;
}

function rangeInOrder(
  node: BTreeNode,
  low: number,
  high: number,
  result: number[],
  frames: AnimationFrame[],
): void {
  frames.push({
    type: "visit",
    nodeKeys: [...node.keys],
    description: `Visit node [${node.keys.join(", ")}] for range [${low}, ${high}]`,
  });
  for (let i = 0; i < node.keys.length; i++) {
    if (!node.isLeaf && node.children[i]) {
      if (node.keys[i] >= low) {
        rangeInOrder(node.children[i], low, high, result, frames);
      }
    }
    if (node.keys[i] >= low && node.keys[i] <= high) {
      result.push(node.keys[i]);
      frames.push({
        type: "range",
        nodeKeys: [...node.keys],
        key: node.keys[i],
        description: `Key ${node.keys[i]} is in range`,
      });
    }
    if (node.keys[i] > high) return;
  }
  if (!node.isLeaf && node.children[node.keys.length]) {
    const lastKey = node.keys[node.keys.length - 1];
    if (lastKey <= high) {
      rangeInOrder(node.children[node.keys.length], low, high, result, frames);
    }
  }
}

// ─────────────────────────────────────────────────────────
// B-Tree stats
// ─────────────────────────────────────────────────────────

function computeStats(root: BTreeNode | null): Stats {
  if (!root) return { height: 0, nodeCount: 0, keyCount: 0, comparisons: 0 };
  let height = 0;
  let nodeCount = 0;
  let keyCount = 0;
  const queue: Array<{ node: BTreeNode; level: number }> = [{ node: root, level: 1 }];
  while (queue.length > 0) {
    const { node, level } = queue.shift()!;
    nodeCount++;
    keyCount += node.keys.length;
    if (level > height) height = level;
    for (const child of node.children) {
      queue.push({ node: child, level: level + 1 });
    }
  }
  return { height, nodeCount, keyCount, comparisons: 0 };
}

function deepCloneTree(node: BTreeNode | null): BTreeNode | null {
  if (!node) return null;
  const clone: BTreeNode = {
    keys: [...node.keys],
    children: node.children.map((c) => deepCloneTree(c)!),
    isLeaf: node.isLeaf,
    next: null, // leaf links are re-established if needed
  };
  return clone;
}

// ─────────────────────────────────────────────────────────
// Hash Index Engine
// ─────────────────────────────────────────────────────────

function createHashIndex(): HashIndex {
  const buckets: HashBucket[] = Array.from({ length: INITIAL_HASH_SIZE }, () => ({
    entries: [],
  }));
  return { buckets, size: INITIAL_HASH_SIZE, count: 0 };
}

function hashFn(key: number, size: number): number {
  return ((key * 2654435761) >>> 0) % size;
}

function hashInsert(
  index: HashIndex,
  key: number,
  frames: AnimationFrame[],
): HashIndex {
  const bucket = hashFn(key, index.size);
  frames.push({
    type: "hash",
    key,
    bucketIndex: bucket,
    description: `hash(${key}) = ${bucket}`,
  });

  // Check for duplicate
  if (index.buckets[bucket].entries.includes(key)) {
    frames.push({
      type: "found",
      key,
      bucketIndex: bucket,
      description: `Key ${key} already in bucket ${bucket}`,
    });
    return index;
  }

  index.buckets[bucket].entries.push(key);
  index.count++;

  frames.push({
    type: "insert",
    key,
    bucketIndex: bucket,
    description: `Insert ${key} into bucket ${bucket} (chain length: ${index.buckets[bucket].entries.length})`,
  });

  // Check load factor
  const loadFactor = index.count / index.size;
  if (loadFactor > HASH_LOAD_THRESHOLD) {
    frames.push({
      type: "split",
      description: `Load factor ${loadFactor.toFixed(2)} > ${HASH_LOAD_THRESHOLD}, resizing...`,
    });
    return resizeHash(index, frames);
  }

  return index;
}

function resizeHash(index: HashIndex, frames: AnimationFrame[]): HashIndex {
  const newSize = index.size * 2;
  const newBuckets: HashBucket[] = Array.from({ length: newSize }, () => ({
    entries: [],
  }));
  for (const bucket of index.buckets) {
    for (const key of bucket.entries) {
      const newBucket = hashFn(key, newSize);
      newBuckets[newBucket].entries.push(key);
    }
  }
  frames.push({
    type: "hash",
    description: `Resized from ${index.size} to ${newSize} buckets`,
  });
  return { buckets: newBuckets, size: newSize, count: index.count };
}

function hashSearch(
  index: HashIndex,
  key: number,
  frames: AnimationFrame[],
): boolean {
  const bucket = hashFn(key, index.size);
  frames.push({
    type: "hash",
    key,
    bucketIndex: bucket,
    description: `hash(${key}) = ${bucket}`,
  });

  const chain = index.buckets[bucket].entries;
  for (let i = 0; i < chain.length; i++) {
    frames.push({
      type: "visit",
      key: chain[i],
      bucketIndex: bucket,
      description: `Check chain[${i}] = ${chain[i]}`,
    });
    if (chain[i] === key) {
      frames.push({
        type: "found",
        key,
        bucketIndex: bucket,
        description: `Found ${key} in bucket ${bucket}`,
      });
      return true;
    }
  }
  frames.push({
    type: "not-found",
    key,
    description: `${key} not found`,
  });
  return false;
}

function hashDelete(
  index: HashIndex,
  key: number,
  frames: AnimationFrame[],
): HashIndex {
  const bucket = hashFn(key, index.size);
  frames.push({
    type: "hash",
    key,
    bucketIndex: bucket,
    description: `hash(${key}) = ${bucket}`,
  });

  const chain = index.buckets[bucket].entries;
  const idx = chain.indexOf(key);
  if (idx >= 0) {
    chain.splice(idx, 1);
    index.count--;
    frames.push({
      type: "delete",
      key,
      bucketIndex: bucket,
      description: `Deleted ${key} from bucket ${bucket}`,
    });
  } else {
    frames.push({
      type: "not-found",
      key,
      description: `${key} not found`,
    });
  }
  return index;
}

// ─────────────────────────────────────────────────────────
// Layout helpers for Canvas rendering
// ─────────────────────────────────────────────────────────

function layoutBTree(root: BTreeNode | null): { nodes: LayoutNode[]; width: number; height: number } {
  if (!root) return { nodes: [], width: 0, height: 0 };

  const levels: BTreeNode[][] = [];
  const queue: Array<{ node: BTreeNode; level: number }> = [{ node: root, level: 0 }];
  while (queue.length > 0) {
    const { node, level } = queue.shift()!;
    if (!levels[level]) levels[level] = [];
    levels[level].push(node);
    for (const child of node.children) {
      queue.push({ node: child, level: level + 1 });
    }
  }

  const nodeWidths = new Map<BTreeNode, number>();
  const subtreeWidths = new Map<BTreeNode, number>();

  // Calculate node widths
  function calcWidth(node: BTreeNode): number {
    const w = Math.max(node.keys.length * KEY_WIDTH, KEY_WIDTH);
    nodeWidths.set(node, w);
    return w;
  }

  // Calculate subtree widths bottom-up
  function calcSubtreeWidth(node: BTreeNode): number {
    const nodeW = calcWidth(node);
    if (node.isLeaf || node.children.length === 0) {
      subtreeWidths.set(node, nodeW);
      return nodeW;
    }
    let childrenW = 0;
    for (const child of node.children) {
      childrenW += calcSubtreeWidth(child);
    }
    childrenW += (node.children.length - 1) * NODE_GAP_X;
    const totalW = Math.max(nodeW, childrenW);
    subtreeWidths.set(node, totalW);
    return totalW;
  }

  calcSubtreeWidth(root);

  const totalWidth = subtreeWidths.get(root) || 0;
  const totalHeight = levels.length * (NODE_HEIGHT + LEVEL_GAP_Y);

  const layoutNodes: LayoutNode[] = [];

  function positionNode(node: BTreeNode, centerX: number, level: number): void {
    const w = nodeWidths.get(node) || KEY_WIDTH;
    layoutNodes.push({ node, x: centerX - w / 2, y: level * (NODE_HEIGHT + LEVEL_GAP_Y) + CANVAS_PADDING, width: w });

    if (!node.isLeaf && node.children.length > 0) {
      const childrenTotalW = node.children.reduce(
        (sum, c) => sum + (subtreeWidths.get(c) || 0),
        0,
      ) + (node.children.length - 1) * NODE_GAP_X;

      let startX = centerX - childrenTotalW / 2;
      for (const child of node.children) {
        const childW = subtreeWidths.get(child) || 0;
        positionNode(child, startX + childW / 2, level + 1);
        startX += childW + NODE_GAP_X;
      }
    }
  }

  positionNode(root, totalWidth / 2 + CANVAS_PADDING, 0);

  return {
    nodes: layoutNodes,
    width: totalWidth + CANVAS_PADDING * 2,
    height: totalHeight + CANVAS_PADDING * 2,
  };
}

// ─────────────────────────────────────────────────────────
// Canvas rendering
// ─────────────────────────────────────────────────────────

function readThemeColors(canvas: HTMLCanvasElement): ThemeColors {
  const cs = getComputedStyle(canvas);
  return {
    bg: cs.getPropertyValue("--color-bg").trim() || "#09090b",
    surface: cs.getPropertyValue("--color-surface").trim() || "#111111",
    text: cs.getPropertyValue("--color-text").trim() || "#e4e4e7",
    textMuted: cs.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
    border: cs.getPropertyValue("--color-border").trim() || "#27272a",
    heading: cs.getPropertyValue("--color-heading").trim() || "#ffffff",
    primary: cs.getPropertyValue("--color-primary").trim() || "#4f8ff7",
    accent: cs.getPropertyValue("--color-accent").trim() || "#34d399",
  };
}

function renderBTree(
  ctx: CanvasRenderingContext2D,
  layout: { nodes: LayoutNode[]; width: number; height: number },
  colors: ThemeColors,
  highlightKeys: Set<number>,
  highlightNodes: Set<BTreeNode>,
  isBPlus: boolean,
  rangeKeys: Set<number>,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (layout.nodes.length === 0) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.fillText("Empty tree. Insert a key to begin.", ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const nodeMap = new Map<BTreeNode, LayoutNode>();
  for (const ln of layout.nodes) {
    nodeMap.set(ln.node, ln);
  }

  // Draw edges
  for (const ln of layout.nodes) {
    const parentCx = ln.x + ln.width / 2;
    const parentBy = ln.y + NODE_HEIGHT;

    for (const child of ln.node.children) {
      const childLn = nodeMap.get(child);
      if (!childLn) continue;
      const childCx = childLn.x + childLn.width / 2;
      const childTy = childLn.y;

      ctx.beginPath();
      ctx.moveTo(parentCx, parentBy);
      ctx.lineTo(childCx, childTy);
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Draw leaf links for B+ Tree
  if (isBPlus) {
    const leaves = layout.nodes.filter((ln) => ln.node.isLeaf);
    // Sort leaves by x position
    leaves.sort((a, b) => a.x - b.x);
    for (let i = 0; i < leaves.length - 1; i++) {
      const a = leaves[i];
      const b = leaves[i + 1];
      if (a.node.next === b.node) {
        const ax = a.x + a.width;
        const bx = b.x;
        const ay = a.y + NODE_HEIGHT + LEAF_LINK_Y_OFFSET;

        ctx.beginPath();
        ctx.moveTo(ax, ay - LEAF_LINK_Y_OFFSET);
        ctx.lineTo(ax + 4, ay - LEAF_LINK_Y_OFFSET);
        ctx.lineTo(bx - 4, ay - LEAF_LINK_Y_OFFSET);
        ctx.lineTo(bx, ay - LEAF_LINK_Y_OFFSET);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrow head
        ctx.beginPath();
        ctx.moveTo(bx, ay - LEAF_LINK_Y_OFFSET);
        ctx.lineTo(bx - 6, ay - LEAF_LINK_Y_OFFSET - 4);
        ctx.lineTo(bx - 6, ay - LEAF_LINK_Y_OFFSET + 4);
        ctx.closePath();
        ctx.fillStyle = colors.accent;
        ctx.fill();
      }
    }
  }

  // Draw nodes
  for (const ln of layout.nodes) {
    const isHighlighted = highlightNodes.has(ln.node);
    const nodeW = ln.width;

    // Node background
    ctx.fillStyle = isHighlighted ? colors.primary + "22" : colors.surface;
    ctx.strokeStyle = isHighlighted ? colors.primary : colors.border;
    ctx.lineWidth = isHighlighted ? 2 : 1;
    roundRect(ctx, ln.x, ln.y, nodeW, NODE_HEIGHT, 6);
    ctx.fill();
    ctx.stroke();

    // Draw keys
    const keyW = nodeW / Math.max(ln.node.keys.length, 1);
    for (let i = 0; i < ln.node.keys.length; i++) {
      const kx = ln.x + i * keyW;
      const k = ln.node.keys[i];
      const isKeyHighlighted = highlightKeys.has(k);
      const isRangeKey = rangeKeys.has(k);

      if (isKeyHighlighted) {
        ctx.fillStyle = colors.primary + "44";
        roundRect(ctx, kx + 1, ln.y + 1, keyW - 2, NODE_HEIGHT - 2, 4);
        ctx.fill();
      } else if (isRangeKey) {
        ctx.fillStyle = colors.accent + "44";
        roundRect(ctx, kx + 1, ln.y + 1, keyW - 2, NODE_HEIGHT - 2, 4);
        ctx.fill();
      }

      // Key separator
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(kx, ln.y + 4);
        ctx.lineTo(kx, ln.y + NODE_HEIGHT - 4);
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Key text
      ctx.fillStyle = isKeyHighlighted ? colors.primary : isRangeKey ? colors.accent : colors.heading;
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(k), kx + keyW / 2, ln.y + NODE_HEIGHT / 2);
    }

    // Label for B+ Tree: "leaf" marker
    if (isBPlus && ln.node.isLeaf) {
      ctx.fillStyle = colors.textMuted;
      ctx.font = FONT_SMALL;
      ctx.textAlign = "center";
      ctx.fillText("leaf", ln.x + nodeW / 2, ln.y + NODE_HEIGHT + 12);
    }
  }
}

function renderHashIndex(
  ctx: CanvasRenderingContext2D,
  index: HashIndex,
  colors: ThemeColors,
  highlightBucket: number,
  highlightKey: number | null,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (index.size === 0) return;

  const bucketsPerRow = Math.min(index.size, 4);
  const rowCount = Math.ceil(index.size / bucketsPerRow);
  const startX = CANVAS_PADDING;
  const startY = CANVAS_PADDING;
  const colWidth = HASH_BUCKET_WIDTH + 180;
  const rowHeight = HASH_BUCKET_HEIGHT + 20;

  for (let i = 0; i < index.size; i++) {
    const col = i % bucketsPerRow;
    const row = Math.floor(i / bucketsPerRow);
    const bx = startX + col * colWidth;
    const by = startY + row * rowHeight;
    const isHL = i === highlightBucket;

    // Bucket box
    ctx.fillStyle = isHL ? colors.primary + "22" : colors.surface;
    ctx.strokeStyle = isHL ? colors.primary : colors.border;
    ctx.lineWidth = isHL ? 2 : 1;
    roundRect(ctx, bx, by, HASH_BUCKET_WIDTH, HASH_BUCKET_HEIGHT, 4);
    ctx.fill();
    ctx.stroke();

    // Bucket label
    ctx.fillStyle = isHL ? colors.primary : colors.textMuted;
    ctx.font = FONT_SMALL;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`[${i}]`, bx + 20, by + HASH_BUCKET_HEIGHT / 2);

    // Chain entries
    const chain = index.buckets[i].entries;
    let cx = bx + HASH_BUCKET_WIDTH + HASH_CHAIN_GAP;
    const cy = by + (HASH_BUCKET_HEIGHT - HASH_CHAIN_NODE_H) / 2;

    if (chain.length > 0) {
      // Arrow from bucket to chain
      ctx.beginPath();
      ctx.moveTo(bx + HASH_BUCKET_WIDTH, by + HASH_BUCKET_HEIGHT / 2);
      ctx.lineTo(cx, by + HASH_BUCKET_HEIGHT / 2);
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (let j = 0; j < chain.length; j++) {
      const isKeyHL = highlightKey === chain[j] && i === highlightBucket;

      ctx.fillStyle = isKeyHL ? colors.accent + "33" : colors.surface;
      ctx.strokeStyle = isKeyHL ? colors.accent : colors.border;
      ctx.lineWidth = isKeyHL ? 2 : 1;
      roundRect(ctx, cx, cy, HASH_CHAIN_NODE_W, HASH_CHAIN_NODE_H, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isKeyHL ? colors.accent : colors.heading;
      ctx.font = FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(chain[j]), cx + HASH_CHAIN_NODE_W / 2, cy + HASH_CHAIN_NODE_H / 2);

      // Chain link arrow
      if (j < chain.length - 1) {
        const nextX = cx + HASH_CHAIN_NODE_W + HASH_CHAIN_GAP;
        ctx.beginPath();
        ctx.moveTo(cx + HASH_CHAIN_NODE_W, cy + HASH_CHAIN_NODE_H / 2);
        ctx.lineTo(nextX, cy + HASH_CHAIN_NODE_H / 2);
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        ctx.stroke();
        // Arrow head
        ctx.beginPath();
        ctx.moveTo(nextX, cy + HASH_CHAIN_NODE_H / 2);
        ctx.lineTo(nextX - 5, cy + HASH_CHAIN_NODE_H / 2 - 3);
        ctx.lineTo(nextX - 5, cy + HASH_CHAIN_NODE_H / 2 + 3);
        ctx.closePath();
        ctx.fillStyle = colors.border;
        ctx.fill();
      }

      cx += HASH_CHAIN_NODE_W + HASH_CHAIN_GAP;
    }
  }

  // Stats
  const loadFactor = index.count / index.size;
  ctx.fillStyle = colors.textMuted;
  ctx.font = FONT_SMALL;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const statsY = startY + rowCount * rowHeight + 10;
  ctx.fillText(
    `Buckets: ${index.size}  |  Keys: ${index.count}  |  Load factor: ${loadFactor.toFixed(2)}`,
    startX,
    statsY,
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────

export default function DBIndexViz() {
  const [indexType, setIndexType] = useState<IndexType>("btree");
  const [order, setOrder] = useState(4);
  const [inputValue, setInputValue] = useState("");
  const [rangeInput, setRangeInput] = useState("");
  const [btreeRoot, setBtreeRoot] = useState<BTreeNode | null>(null);
  const [bplusRoot, setBplusRoot] = useState<BTreeNode | null>(null);
  const [hashIndex, setHashIndex] = useState<HashIndex>(createHashIndex());

  const [animFrames, setAnimFrames] = useState<AnimationFrame[]>([]);
  const [animIdx, setAnimIdx] = useState(-1);
  const [autoPlay, setAutoPlay] = useState(true);
  const [animSpeed, setAnimSpeed] = useState(500);
  const [stats, setStats] = useState<Stats>({ height: 0, nodeCount: 0, keyCount: 0, comparisons: 0 });
  const [lastResult, setLastResult] = useState<string>("");

  const [compareMode, setCompareMode] = useState(false);
  const [compareRoot, setCompareRoot] = useState<BTreeNode | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compareCanvasRef = useRef<HTMLCanvasElement>(null);
  const animTimerRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentRoot = useCallback(() => {
    return indexType === "btree" ? btreeRoot : bplusRoot;
  }, [indexType, btreeRoot, bplusRoot]);

  const setCurrentRoot = useCallback(
    (root: BTreeNode | null) => {
      if (indexType === "btree") setBtreeRoot(root);
      else setBplusRoot(root);
    },
    [indexType],
  );

  // Update stats when tree changes
  useEffect(() => {
    if (indexType === "hash") {
      setStats({
        height: 0,
        nodeCount: hashIndex.size,
        keyCount: hashIndex.count,
        comparisons: 0,
      });
    } else {
      const root = indexType === "btree" ? btreeRoot : bplusRoot;
      setStats(computeStats(root));
    }
  }, [btreeRoot, bplusRoot, hashIndex, indexType]);

  // Canvas sizing
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !containerRef.current) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = containerRef.current.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = 420;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);

      if (compareMode && compareCanvasRef.current) {
        const cc = compareCanvasRef.current;
        cc.width = w * dpr;
        cc.height = h * dpr;
        cc.style.width = `${w}px`;
        cc.style.height = `${h}px`;
        const cctx = cc.getContext("2d");
        if (cctx) cctx.scale(dpr, dpr);
      }

      drawCanvas();
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [btreeRoot, bplusRoot, hashIndex, indexType, animIdx, animFrames, compareMode, compareRoot]);

  // Auto-play animation
  useEffect(() => {
    if (!autoPlay || animFrames.length === 0 || animIdx >= animFrames.length - 1) return;
    animTimerRef.current = window.setTimeout(() => {
      setAnimIdx((prev) => Math.min(prev + 1, animFrames.length - 1));
    }, animSpeed);
    return () => clearTimeout(animTimerRef.current);
  }, [autoPlay, animIdx, animFrames, animSpeed]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors = readThemeColors(canvas);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // Determine highlights from current animation frame
    const highlightKeys = new Set<number>();
    const highlightNodes = new Set<BTreeNode>();
    const rangeKeys = new Set<number>();
    let highlightBucket = -1;
    let highlightKey: number | null = null;

    if (animIdx >= 0 && animIdx < animFrames.length) {
      const frame = animFrames[animIdx];
      if (frame.key !== undefined) highlightKeys.add(frame.key);
      if (frame.bucketIndex !== undefined) highlightBucket = frame.bucketIndex;
      if (frame.key !== undefined && frame.type === "found") highlightKey = frame.key;
      if (frame.type === "range" && frame.key !== undefined) rangeKeys.add(frame.key);

      // Highlight matching nodes
      if (frame.nodeKeys && indexType !== "hash") {
        const root = currentRoot();
        if (root) {
          findNodeByKeys(root, frame.nodeKeys, highlightNodes);
        }
      }
    }

    // Collect all range keys from frames up to current
    if (animIdx >= 0) {
      for (let i = 0; i <= animIdx; i++) {
        const f = animFrames[i];
        if (f.type === "range" && f.key !== undefined) rangeKeys.add(f.key);
      }
    }

    if (indexType === "hash") {
      renderHashIndex(ctx, hashIndex, colors, highlightBucket, highlightKey);
    } else {
      const root = currentRoot();
      const layout = layoutBTree(root);

      // Auto-scroll/scale to fit
      ctx.save();
      const scaleX = layout.width > 0 ? Math.min(1, (w - 20) / layout.width) : 1;
      const scaleY = layout.height > 0 ? Math.min(1, (h - 20) / layout.height) : 1;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = (w - layout.width * scale) / 2;
      const offsetY = Math.max(10, (h - layout.height * scale) / 2);
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      renderBTree(ctx, layout, colors, highlightKeys, highlightNodes, indexType === "bplus", rangeKeys);
      ctx.restore();
    }

    // Draw compare canvas
    if (compareMode && compareCanvasRef.current) {
      const cctx = compareCanvasRef.current.getContext("2d");
      if (cctx) {
        const layout2 = layoutBTree(compareRoot);
        const s2x = layout2.width > 0 ? Math.min(1, (w - 20) / layout2.width) : 1;
        const s2y = layout2.height > 0 ? Math.min(1, (h - 20) / layout2.height) : 1;
        const s2 = Math.min(s2x, s2y);
        cctx.save();
        cctx.clearRect(0, 0, w, h);
        cctx.translate((w - layout2.width * s2) / 2, Math.max(10, (h - layout2.height * s2) / 2));
        cctx.scale(s2, s2);
        renderBTree(cctx, layout2, colors, highlightKeys, new Set(), true, rangeKeys);
        cctx.restore();
      }
    }
  }, [btreeRoot, bplusRoot, hashIndex, indexType, animIdx, animFrames, compareMode, compareRoot, currentRoot]);

  function findNodeByKeys(node: BTreeNode, keys: number[], result: Set<BTreeNode>): void {
    if (arraysEqual(node.keys, keys)) result.add(node);
    for (const child of node.children) {
      findNodeByKeys(child, keys, result);
    }
  }

  function arraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // ─── Operations ───

  function handleInsert(): void {
    const key = parseInt(inputValue, 10);
    if (isNaN(key)) return;
    setInputValue("");
    const frames: AnimationFrame[] = [];

    if (indexType === "hash") {
      const newIndex = hashInsert({ ...hashIndex, buckets: hashIndex.buckets.map((b) => ({ entries: [...b.entries] })) }, key, frames);
      setHashIndex(newIndex);
    } else {
      const isBPlus = indexType === "bplus";
      const root = currentRoot();
      const newRoot = btreeInsert(deepCloneTree(root), key, order, isBPlus, frames);
      setCurrentRoot(newRoot);

      if (compareMode) {
        const altFrames: AnimationFrame[] = [];
        const isBPlusAlt = !isBPlus;
        const newCompare = btreeInsert(deepCloneTree(compareRoot), key, order, isBPlusAlt, altFrames);
        setCompareRoot(newCompare);
      }
    }

    setAnimFrames(frames);
    setAnimIdx(autoPlay ? 0 : -1);
    setLastResult(`Inserted ${key}`);
  }

  function handleDelete(): void {
    const key = parseInt(inputValue, 10);
    if (isNaN(key)) return;
    setInputValue("");
    const frames: AnimationFrame[] = [];

    if (indexType === "hash") {
      const newIndex = hashDelete(
        { ...hashIndex, buckets: hashIndex.buckets.map((b) => ({ entries: [...b.entries] })) },
        key,
        frames,
      );
      setHashIndex(newIndex);
    } else {
      const isBPlus = indexType === "bplus";
      const root = currentRoot();
      const newRoot = btreeDelete(deepCloneTree(root), key, order, isBPlus, frames);
      setCurrentRoot(newRoot);

      if (compareMode) {
        const altFrames: AnimationFrame[] = [];
        const newCompare = btreeDelete(deepCloneTree(compareRoot), key, order, !isBPlus, altFrames);
        setCompareRoot(newCompare);
      }
    }

    setAnimFrames(frames);
    setAnimIdx(autoPlay ? 0 : -1);
    setLastResult(`Deleted ${key}`);
  }

  function handleSearch(): void {
    const key = parseInt(inputValue, 10);
    if (isNaN(key)) return;
    const frames: AnimationFrame[] = [];

    if (indexType === "hash") {
      const found = hashSearch(hashIndex, key, frames);
      setLastResult(found ? `Found ${key}` : `${key} not found`);
    } else {
      const isBPlus = indexType === "bplus";
      const root = currentRoot();
      const found = isBPlus ? bplusSearch(root, key, frames) : btreeSearch(root, key, frames);
      setLastResult(found ? `Found ${key}` : `${key} not found`);
    }

    setStats((prev) => ({ ...prev, comparisons: frames.filter((f) => f.type === "visit").length }));
    setAnimFrames(frames);
    setAnimIdx(autoPlay ? 0 : -1);
  }

  function handleRange(): void {
    const parts = rangeInput.split("-").map((s) => parseInt(s.trim(), 10));
    if (parts.length !== 2 || parts.some(isNaN)) return;
    const [low, high] = parts;
    const frames: AnimationFrame[] = [];
    const isBPlus = indexType === "bplus";
    const root = currentRoot();
    const result = rangeQuery(root, low, high, isBPlus, frames);
    setLastResult(`Range [${low}, ${high}]: ${result.length > 0 ? result.join(", ") : "none"}`);
    setStats((prev) => ({ ...prev, comparisons: frames.filter((f) => f.type === "visit").length }));
    setAnimFrames(frames);
    setAnimIdx(autoPlay ? 0 : -1);
  }

  function handleBulkInsert(): void {
    const count = parseInt(inputValue, 10) || 10;
    setInputValue("");
    const keys: number[] = [];
    const existing = new Set<number>();

    // Collect existing keys
    if (indexType === "hash") {
      for (const b of hashIndex.buckets) {
        for (const e of b.entries) existing.add(e);
      }
    } else {
      collectKeys(currentRoot(), existing);
    }

    while (keys.length < count) {
      const k = Math.floor(Math.random() * 999) + 1;
      if (!existing.has(k)) {
        keys.push(k);
        existing.add(k);
      }
    }

    const frames: AnimationFrame[] = [];

    if (indexType === "hash") {
      let idx = { ...hashIndex, buckets: hashIndex.buckets.map((b) => ({ entries: [...b.entries] })) };
      for (const k of keys) {
        idx = hashInsert(idx, k, frames);
      }
      setHashIndex(idx);
    } else {
      const isBPlus = indexType === "bplus";
      let root = deepCloneTree(currentRoot());
      for (const k of keys) {
        root = btreeInsert(root, k, order, isBPlus, frames);
      }
      setCurrentRoot(root);

      if (compareMode) {
        let cRoot = deepCloneTree(compareRoot);
        const cFrames: AnimationFrame[] = [];
        for (const k of keys) {
          cRoot = btreeInsert(cRoot, k, order, !isBPlus, cFrames);
        }
        setCompareRoot(cRoot);
      }
    }

    setAnimFrames(frames);
    setAnimIdx(autoPlay ? 0 : -1);
    setLastResult(`Bulk inserted ${count} keys`);
  }

  function collectKeys(node: BTreeNode | null, set: Set<number>): void {
    if (!node) return;
    for (const k of node.keys) set.add(k);
    for (const c of node.children) collectKeys(c, set);
  }

  function handleClear(): void {
    setBtreeRoot(null);
    setBplusRoot(null);
    setHashIndex(createHashIndex());
    setCompareRoot(null);
    setAnimFrames([]);
    setAnimIdx(-1);
    setLastResult("");
  }

  function handlePreset(preset: typeof PRESETS[number]): void {
    handleClear();
    const keys = preset.keys.length > 0 ? preset.keys : generateRandomPreset();

    setTimeout(() => {
      const frames: AnimationFrame[] = [];

      if (indexType === "hash") {
        let idx = createHashIndex();
        for (const k of keys) {
          idx = hashInsert(idx, k, frames);
        }
        setHashIndex(idx);
      } else {
        const isBPlus = indexType === "bplus";
        let root: BTreeNode | null = null;
        for (const k of keys) {
          root = btreeInsert(root, k, order, isBPlus, frames);
        }
        setCurrentRoot(root);

        if (compareMode) {
          let cRoot: BTreeNode | null = null;
          const cFrames: AnimationFrame[] = [];
          for (const k of keys) {
            cRoot = btreeInsert(cRoot, k, order, !isBPlus, cFrames);
          }
          setCompareRoot(cRoot);
        }
      }

      setAnimFrames(frames);
      setAnimIdx(autoPlay ? 0 : -1);
      setLastResult(`Loaded preset: ${preset.label}`);
    }, 50);
  }

  function handleCompareToggle(): void {
    if (!compareMode) {
      // Enable compare: clone current tree as B+ Tree (or B-Tree if currently B+)
      const isBPlus = indexType === "bplus";
      const root = currentRoot();
      // Rebuild the tree with the other type
      const keys: number[] = [];
      collectKeys(root, new Set(keys));
      collectKeysArr(root, keys);
      let cRoot: BTreeNode | null = null;
      const frames: AnimationFrame[] = [];
      for (const k of keys) {
        cRoot = btreeInsert(cRoot, k, order, !isBPlus, frames);
      }
      setCompareRoot(cRoot);
      setCompareMode(true);
      // Force to btree or bplus
      if (indexType === "hash") setIndexType("btree");
    } else {
      setCompareMode(false);
      setCompareRoot(null);
    }
  }

  function collectKeysArr(node: BTreeNode | null, arr: number[]): void {
    if (!node) return;
    for (const k of node.keys) {
      if (!arr.includes(k)) arr.push(k);
    }
    for (const c of node.children) collectKeysArr(c, arr);
  }

  function stepForward(): void {
    setAnimIdx((prev) => Math.min(prev + 1, animFrames.length - 1));
  }

  function stepBackward(): void {
    setAnimIdx((prev) => Math.max(prev - 1, 0));
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Enter") handleInsert();
  }

  // Current frame description
  const currentFrameDesc =
    animIdx >= 0 && animIdx < animFrames.length
      ? animFrames[animIdx].description
      : "";

  // ─── Styles ───

  const tabStyle = (active: boolean): string =>
    `px-3 py-1.5 text-xs font-medium rounded-md border transition-all cursor-pointer ${
      active
        ? "border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10"
        : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]"
    }`;

  const btnStyle =
    "px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)] transition-all cursor-pointer";

  const btnPrimary =
    "px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10 hover:bg-[var(--color-primary)]/20 transition-all cursor-pointer";

  const inputStyle =
    "w-20 px-2 py-1.5 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none";

  return (
    <div ref={containerRef} class="space-y-4">
      {/* Index type tabs */}
      <div class="flex flex-wrap items-center gap-2">
        {INDEX_TABS.map((tab) => (
          <button
            key={tab.value}
            class={tabStyle(indexType === tab.value)}
            onClick={() => {
              setIndexType(tab.value);
              setAnimFrames([]);
              setAnimIdx(-1);
              if (tab.value === "hash") setCompareMode(false);
            }}
          >
            {tab.label}
          </button>
        ))}

        <span class="mx-2 h-4 w-px bg-[var(--color-border)]" />

        {/* Order selector (B-Tree/B+ Tree only) */}
        {indexType !== "hash" && (
          <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            Order:
            <select
              class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
              value={order}
              onChange={(e) => {
                setOrder(parseInt((e.target as HTMLSelectElement).value, 10));
                handleClear();
              }}
            >
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </label>
        )}

        {indexType !== "hash" && (
          <button
            class={tabStyle(compareMode)}
            onClick={handleCompareToggle}
          >
            Compare B-Tree vs B+ Tree
          </button>
        )}
      </div>

      {/* Operations panel */}
      <div class="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <input
          type="text"
          class={inputStyle}
          placeholder="Key"
          value={inputValue}
          onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
          onKeyDown={handleKeyDown}
        />
        <button class={btnPrimary} onClick={handleInsert}>Insert</button>
        <button class={btnStyle} onClick={handleDelete}>Delete</button>
        <button class={btnStyle} onClick={handleSearch}>Search</button>

        {indexType !== "hash" && (
          <>
            <span class="mx-1 h-4 w-px bg-[var(--color-border)]" />
            <input
              type="text"
              class={`${inputStyle} w-24`}
              placeholder="low-high"
              value={rangeInput}
              onInput={(e) => setRangeInput((e.target as HTMLInputElement).value)}
            />
            <button class={btnStyle} onClick={handleRange}>Range</button>
          </>
        )}

        <span class="mx-1 h-4 w-px bg-[var(--color-border)]" />
        <button class={btnStyle} onClick={handleBulkInsert}>
          Bulk ({inputValue || "10"})
        </button>
        <button class={btnStyle} onClick={handleClear}>Clear</button>
      </div>

      {/* Presets */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-[var(--color-text-muted)]">Presets:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            class={btnStyle}
            onClick={() => handlePreset(preset)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <div class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] overflow-hidden">
        {compareMode && (
          <div class="flex border-b border-[var(--color-border)]">
            <div class="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] border-r border-[var(--color-border)]">
              {indexType === "btree" ? "B-Tree" : "B+ Tree"}
            </div>
            <div class="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--color-accent)]">
              {indexType === "btree" ? "B+ Tree" : "B-Tree"}
            </div>
          </div>
        )}
        <div class={compareMode ? "flex" : ""}>
          <canvas
            ref={canvasRef}
            class={compareMode ? "flex-1 border-r border-[var(--color-border)]" : "w-full"}
          />
          {compareMode && (
            <canvas ref={compareCanvasRef} class="flex-1" />
          )}
        </div>
      </div>

      {/* Animation controls */}
      {animFrames.length > 0 && (
        <div class="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <button class={btnStyle} onClick={stepBackward} disabled={animIdx <= 0}>
            Prev
          </button>
          <button
            class={btnStyle}
            onClick={() => setAutoPlay(!autoPlay)}
          >
            {autoPlay ? "Pause" : "Play"}
          </button>
          <button
            class={btnStyle}
            onClick={stepForward}
            disabled={animIdx >= animFrames.length - 1}
          >
            Next
          </button>

          <span class="text-xs text-[var(--color-text-muted)]">
            Step {Math.max(0, animIdx + 1)}/{animFrames.length}
          </span>

          <span class="mx-1 h-4 w-px bg-[var(--color-border)]" />

          <label class="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            Speed:
            <input
              type="range"
              min={100}
              max={1500}
              step={100}
              value={1600 - animSpeed}
              onInput={(e) => setAnimSpeed(1600 - parseInt((e.target as HTMLInputElement).value, 10))}
              class="w-20 accent-[var(--color-primary)]"
            />
          </label>

          {currentFrameDesc && (
            <span class="ml-2 text-xs text-[var(--color-text)]">
              {currentFrameDesc}
            </span>
          )}
        </div>
      )}

      {/* Stats */}
      <div class="flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
        {indexType !== "hash" ? (
          <>
            <span>Height: <b class="text-[var(--color-heading)]">{stats.height}</b></span>
            <span>Nodes: <b class="text-[var(--color-heading)]">{stats.nodeCount}</b></span>
            <span>Keys: <b class="text-[var(--color-heading)]">{stats.keyCount}</b></span>
            {stats.comparisons > 0 && (
              <span>Comparisons: <b class="text-[var(--color-primary)]">{stats.comparisons}</b></span>
            )}
          </>
        ) : (
          <>
            <span>Buckets: <b class="text-[var(--color-heading)]">{hashIndex.size}</b></span>
            <span>Keys: <b class="text-[var(--color-heading)]">{hashIndex.count}</b></span>
            <span>Load factor: <b class="text-[var(--color-heading)]">{(hashIndex.count / hashIndex.size).toFixed(2)}</b></span>
          </>
        )}

        {lastResult && (
          <span class="ml-auto text-[var(--color-accent)]">{lastResult}</span>
        )}
      </div>
    </div>
  );
}
