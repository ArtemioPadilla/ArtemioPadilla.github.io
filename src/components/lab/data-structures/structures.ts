/* ──────────────────────────────────────────────────
   Data Structure Implementations
   Pure logic — no DOM, no canvas, no UI.
   ────────────────────────────────────────────────── */

// ═══════════════════════════════════════════════════
// Common Types
// ═══════════════════════════════════════════════════

export type StructureType =
  | "bst"
  | "avl"
  | "min-heap"
  | "max-heap"
  | "hash-table"
  | "linked-list"
  | "stack"
  | "queue";

export interface AnimationStep {
  type:
    | "visit"
    | "compare"
    | "found"
    | "not-found"
    | "insert"
    | "delete"
    | "swap"
    | "rotate"
    | "highlight"
    | "traverse"
    | "rehash"
    | "done";
  nodeIds: number[];
  message: string;
  pseudocodeLine: number;
  /** Snapshot of the data so the renderer can draw intermediate states */
  snapshot?: unknown;
}

// ═══════════════════════════════════════════════════
// BST Node
// ═══════════════════════════════════════════════════

export interface TreeNode {
  id: number;
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
  height: number; // Used by AVL
  x: number; // Layout position (computed by renderer)
  y: number;
  balanceFactor: number;
}

let nodeIdCounter = 0;
export function resetNodeIds(): void {
  nodeIdCounter = 0;
}

function createTreeNode(value: number): TreeNode {
  return {
    id: ++nodeIdCounter,
    value,
    left: null,
    right: null,
    height: 1,
    x: 0,
    y: 0,
    balanceFactor: 0,
  };
}

function treeHeight(node: TreeNode | null): number {
  return node ? node.height : 0;
}

function updateHeight(node: TreeNode): void {
  node.height = 1 + Math.max(treeHeight(node.left), treeHeight(node.right));
  node.balanceFactor = treeHeight(node.left) - treeHeight(node.right);
}

// ═══════════════════════════════════════════════════
// BST Operations
// ═══════════════════════════════════════════════════

export function bstInsert(
  root: TreeNode | null,
  value: number,
  steps: AnimationStep[],
): TreeNode {
  if (root === null) {
    const node = createTreeNode(value);
    steps.push({
      type: "insert",
      nodeIds: [node.id],
      message: `Insert ${value} as new node`,
      pseudocodeLine: 1,
    });
    return node;
  }

  steps.push({
    type: "compare",
    nodeIds: [root.id],
    message: `Compare ${value} with ${root.value}`,
    pseudocodeLine: 2,
  });

  if (value < root.value) {
    steps.push({
      type: "visit",
      nodeIds: [root.id],
      message: `${value} < ${root.value}, go left`,
      pseudocodeLine: 3,
    });
    root.left = bstInsert(root.left, value, steps);
  } else if (value > root.value) {
    steps.push({
      type: "visit",
      nodeIds: [root.id],
      message: `${value} > ${root.value}, go right`,
      pseudocodeLine: 5,
    });
    root.right = bstInsert(root.right, value, steps);
  } else {
    steps.push({
      type: "found",
      nodeIds: [root.id],
      message: `${value} already exists`,
      pseudocodeLine: 7,
    });
  }

  updateHeight(root);
  return root;
}

export function bstSearch(
  root: TreeNode | null,
  value: number,
  steps: AnimationStep[],
): TreeNode | null {
  if (root === null) {
    steps.push({
      type: "not-found",
      nodeIds: [],
      message: `${value} not found (null node)`,
      pseudocodeLine: 1,
    });
    return null;
  }

  steps.push({
    type: "compare",
    nodeIds: [root.id],
    message: `Compare ${value} with ${root.value}`,
    pseudocodeLine: 2,
  });

  if (value === root.value) {
    steps.push({
      type: "found",
      nodeIds: [root.id],
      message: `Found ${value}!`,
      pseudocodeLine: 3,
    });
    return root;
  }

  if (value < root.value) {
    steps.push({
      type: "visit",
      nodeIds: [root.id],
      message: `${value} < ${root.value}, go left`,
      pseudocodeLine: 4,
    });
    return bstSearch(root.left, value, steps);
  }

  steps.push({
    type: "visit",
    nodeIds: [root.id],
    message: `${value} > ${root.value}, go right`,
    pseudocodeLine: 6,
  });
  return bstSearch(root.right, value, steps);
}

function findMin(node: TreeNode): TreeNode {
  let current = node;
  while (current.left) {
    current = current.left;
  }
  return current;
}

export function bstDelete(
  root: TreeNode | null,
  value: number,
  steps: AnimationStep[],
): TreeNode | null {
  if (root === null) {
    steps.push({
      type: "not-found",
      nodeIds: [],
      message: `${value} not found`,
      pseudocodeLine: 1,
    });
    return null;
  }

  steps.push({
    type: "compare",
    nodeIds: [root.id],
    message: `Compare ${value} with ${root.value}`,
    pseudocodeLine: 2,
  });

  if (value < root.value) {
    steps.push({
      type: "visit",
      nodeIds: [root.id],
      message: `${value} < ${root.value}, go left`,
      pseudocodeLine: 3,
    });
    root.left = bstDelete(root.left, value, steps);
  } else if (value > root.value) {
    steps.push({
      type: "visit",
      nodeIds: [root.id],
      message: `${value} > ${root.value}, go right`,
      pseudocodeLine: 5,
    });
    root.right = bstDelete(root.right, value, steps);
  } else {
    steps.push({
      type: "delete",
      nodeIds: [root.id],
      message: `Found ${value}, deleting`,
      pseudocodeLine: 7,
    });

    if (!root.left && !root.right) {
      return null;
    }
    if (!root.left) {
      return root.right;
    }
    if (!root.right) {
      return root.left;
    }

    const successor = findMin(root.right);
    steps.push({
      type: "highlight",
      nodeIds: [successor.id],
      message: `Replace with in-order successor ${successor.value}`,
      pseudocodeLine: 9,
    });
    root.value = successor.value;
    root.right = bstDelete(root.right, successor.value, steps);
  }

  updateHeight(root);
  return root;
}

export function bstInOrder(
  root: TreeNode | null,
  steps: AnimationStep[],
): number[] {
  const result: number[] = [];

  function traverse(node: TreeNode | null): void {
    if (!node) return;
    traverse(node.left);
    steps.push({
      type: "traverse",
      nodeIds: [node.id],
      message: `Visit ${node.value}`,
      pseudocodeLine: 2,
    });
    result.push(node.value);
    traverse(node.right);
  }

  traverse(root);
  steps.push({
    type: "done",
    nodeIds: [],
    message: `In-order: [${result.join(", ")}]`,
    pseudocodeLine: 5,
  });
  return result;
}

// ═══════════════════════════════════════════════════
// AVL Operations
// ═══════════════════════════════════════════════════

function rotateRight(y: TreeNode, steps: AnimationStep[]): TreeNode {
  const x = y.left!;
  const T2 = x.right;

  steps.push({
    type: "rotate",
    nodeIds: [y.id, x.id],
    message: `Right rotation at ${y.value}`,
    pseudocodeLine: 8,
  });

  x.right = y;
  y.left = T2;
  updateHeight(y);
  updateHeight(x);
  return x;
}

function rotateLeft(x: TreeNode, steps: AnimationStep[]): TreeNode {
  const y = x.right!;
  const T2 = y.left;

  steps.push({
    type: "rotate",
    nodeIds: [x.id, y.id],
    message: `Left rotation at ${x.value}`,
    pseudocodeLine: 9,
  });

  y.left = x;
  x.right = T2;
  updateHeight(x);
  updateHeight(y);
  return y;
}

export function avlInsert(
  root: TreeNode | null,
  value: number,
  steps: AnimationStep[],
): TreeNode {
  if (root === null) {
    const node = createTreeNode(value);
    steps.push({
      type: "insert",
      nodeIds: [node.id],
      message: `Insert ${value}`,
      pseudocodeLine: 1,
    });
    return node;
  }

  steps.push({
    type: "compare",
    nodeIds: [root.id],
    message: `Compare ${value} with ${root.value}`,
    pseudocodeLine: 2,
  });

  if (value < root.value) {
    root.left = avlInsert(root.left, value, steps);
  } else if (value > root.value) {
    root.right = avlInsert(root.right, value, steps);
  } else {
    steps.push({
      type: "found",
      nodeIds: [root.id],
      message: `${value} already exists`,
      pseudocodeLine: 4,
    });
    return root;
  }

  updateHeight(root);
  const bf = root.balanceFactor;

  steps.push({
    type: "highlight",
    nodeIds: [root.id],
    message: `Balance factor of ${root.value} = ${bf}`,
    pseudocodeLine: 6,
  });

  // Left-Left
  if (bf > 1 && value < root.left!.value) {
    return rotateRight(root, steps);
  }
  // Right-Right
  if (bf < -1 && value > root.right!.value) {
    return rotateLeft(root, steps);
  }
  // Left-Right
  if (bf > 1 && value > root.left!.value) {
    root.left = rotateLeft(root.left!, steps);
    return rotateRight(root, steps);
  }
  // Right-Left
  if (bf < -1 && value < root.right!.value) {
    root.right = rotateRight(root.right!, steps);
    return rotateLeft(root, steps);
  }

  return root;
}

export function avlDelete(
  root: TreeNode | null,
  value: number,
  steps: AnimationStep[],
): TreeNode | null {
  if (root === null) {
    steps.push({
      type: "not-found",
      nodeIds: [],
      message: `${value} not found`,
      pseudocodeLine: 1,
    });
    return null;
  }

  steps.push({
    type: "compare",
    nodeIds: [root.id],
    message: `Compare ${value} with ${root.value}`,
    pseudocodeLine: 2,
  });

  if (value < root.value) {
    root.left = avlDelete(root.left, value, steps);
  } else if (value > root.value) {
    root.right = avlDelete(root.right, value, steps);
  } else {
    steps.push({
      type: "delete",
      nodeIds: [root.id],
      message: `Found ${value}, deleting`,
      pseudocodeLine: 4,
    });

    if (!root.left || !root.right) {
      return root.left || root.right;
    }

    const successor = findMin(root.right);
    steps.push({
      type: "highlight",
      nodeIds: [successor.id],
      message: `Replace with successor ${successor.value}`,
      pseudocodeLine: 6,
    });
    root.value = successor.value;
    root.right = avlDelete(root.right, successor.value, steps);
  }

  updateHeight(root);
  const bf = root.balanceFactor;

  // Rebalance
  if (bf > 1 && treeHeight(root.left?.left ?? null) >= treeHeight(root.left?.right ?? null)) {
    return rotateRight(root, steps);
  }
  if (bf > 1) {
    root.left = rotateLeft(root.left!, steps);
    return rotateRight(root, steps);
  }
  if (bf < -1 && treeHeight(root.right?.right ?? null) >= treeHeight(root.right?.left ?? null)) {
    return rotateLeft(root, steps);
  }
  if (bf < -1) {
    root.right = rotateRight(root.right!, steps);
    return rotateLeft(root, steps);
  }

  return root;
}

// ═══════════════════════════════════════════════════
// Heap
// ═══════════════════════════════════════════════════

export interface HeapData {
  array: number[];
  nodeIds: number[];
  isMax: boolean;
}

export function heapCreate(isMax: boolean): HeapData {
  return { array: [], nodeIds: [], isMax };
}

function heapShouldSwap(
  heap: HeapData,
  parentIdx: number,
  childIdx: number,
): boolean {
  if (heap.isMax) {
    return heap.array[childIdx] > heap.array[parentIdx];
  }
  return heap.array[childIdx] < heap.array[parentIdx];
}

export function heapInsert(
  heap: HeapData,
  value: number,
  steps: AnimationStep[],
): HeapData {
  const newHeap = {
    array: [...heap.array, value],
    nodeIds: [...heap.nodeIds, ++nodeIdCounter],
    isMax: heap.isMax,
  };

  let idx = newHeap.array.length - 1;

  steps.push({
    type: "insert",
    nodeIds: [newHeap.nodeIds[idx]],
    message: `Insert ${value} at index ${idx}`,
    pseudocodeLine: 1,
  });

  // Bubble up
  while (idx > 0) {
    const parentIdx = Math.floor((idx - 1) / 2);
    steps.push({
      type: "compare",
      nodeIds: [newHeap.nodeIds[idx], newHeap.nodeIds[parentIdx]],
      message: `Compare ${newHeap.array[idx]} with parent ${newHeap.array[parentIdx]}`,
      pseudocodeLine: 3,
    });

    if (heapShouldSwap(newHeap, parentIdx, idx)) {
      steps.push({
        type: "swap",
        nodeIds: [newHeap.nodeIds[idx], newHeap.nodeIds[parentIdx]],
        message: `Swap ${newHeap.array[idx]} with ${newHeap.array[parentIdx]}`,
        pseudocodeLine: 4,
      });

      [newHeap.array[idx], newHeap.array[parentIdx]] = [
        newHeap.array[parentIdx],
        newHeap.array[idx],
      ];
      [newHeap.nodeIds[idx], newHeap.nodeIds[parentIdx]] = [
        newHeap.nodeIds[parentIdx],
        newHeap.nodeIds[idx],
      ];
      idx = parentIdx;
    } else {
      steps.push({
        type: "done",
        nodeIds: [newHeap.nodeIds[idx]],
        message: `Heap property satisfied`,
        pseudocodeLine: 6,
      });
      break;
    }
  }

  return newHeap;
}

export function heapExtract(
  heap: HeapData,
  steps: AnimationStep[],
): { heap: HeapData; extracted: number | null } {
  if (heap.array.length === 0) {
    steps.push({
      type: "not-found",
      nodeIds: [],
      message: `Heap is empty`,
      pseudocodeLine: 1,
    });
    return { heap, extracted: null };
  }

  const extracted = heap.array[0];
  const newHeap = {
    array: [...heap.array],
    nodeIds: [...heap.nodeIds],
    isMax: heap.isMax,
  };

  steps.push({
    type: "delete",
    nodeIds: [newHeap.nodeIds[0]],
    message: `Extract root ${extracted}`,
    pseudocodeLine: 1,
  });

  const last = newHeap.array.pop()!;
  const lastId = newHeap.nodeIds.pop()!;

  if (newHeap.array.length === 0) {
    return { heap: newHeap, extracted };
  }

  newHeap.array[0] = last;
  newHeap.nodeIds[0] = lastId;

  steps.push({
    type: "swap",
    nodeIds: [lastId],
    message: `Move last element ${last} to root`,
    pseudocodeLine: 2,
  });

  // Bubble down
  let idx = 0;
  const len = newHeap.array.length;
  while (true) {
    let target = idx;
    const left = 2 * idx + 1;
    const right = 2 * idx + 2;

    if (left < len && heapShouldSwap(newHeap, target, left)) {
      target = left;
    }
    if (right < len && heapShouldSwap(newHeap, target, right)) {
      target = right;
    }

    if (target === idx) {
      steps.push({
        type: "done",
        nodeIds: [newHeap.nodeIds[idx]],
        message: `Heap property restored`,
        pseudocodeLine: 6,
      });
      break;
    }

    steps.push({
      type: "swap",
      nodeIds: [newHeap.nodeIds[idx], newHeap.nodeIds[target]],
      message: `Swap ${newHeap.array[idx]} with ${newHeap.array[target]}`,
      pseudocodeLine: 4,
    });

    [newHeap.array[idx], newHeap.array[target]] = [
      newHeap.array[target],
      newHeap.array[idx],
    ];
    [newHeap.nodeIds[idx], newHeap.nodeIds[target]] = [
      newHeap.nodeIds[target],
      newHeap.nodeIds[idx],
    ];
    idx = target;
  }

  return { heap: newHeap, extracted };
}

export function heapSearch(
  heap: HeapData,
  value: number,
  steps: AnimationStep[],
): boolean {
  for (let i = 0; i < heap.array.length; i++) {
    steps.push({
      type: "compare",
      nodeIds: [heap.nodeIds[i]],
      message: `Check index ${i}: ${heap.array[i]}`,
      pseudocodeLine: 2,
    });
    if (heap.array[i] === value) {
      steps.push({
        type: "found",
        nodeIds: [heap.nodeIds[i]],
        message: `Found ${value} at index ${i}`,
        pseudocodeLine: 3,
      });
      return true;
    }
  }
  steps.push({
    type: "not-found",
    nodeIds: [],
    message: `${value} not in heap`,
    pseudocodeLine: 5,
  });
  return false;
}

// ═══════════════════════════════════════════════════
// Hash Table (chaining)
// ═══════════════════════════════════════════════════

export interface HashEntry {
  key: number;
  id: number;
}

export interface HashTableData {
  buckets: HashEntry[][];
  size: number;
  count: number;
}

export function hashTableCreate(size: number = 7): HashTableData {
  return {
    buckets: Array.from({ length: size }, () => []),
    size,
    count: 0,
  };
}

function hashFn(key: number, size: number): number {
  return ((key % size) + size) % size;
}

export function hashTableInsert(
  table: HashTableData,
  key: number,
  steps: AnimationStep[],
): HashTableData {
  const newTable: HashTableData = {
    buckets: table.buckets.map((b) => [...b]),
    size: table.size,
    count: table.count,
  };

  const idx = hashFn(key, newTable.size);
  steps.push({
    type: "highlight",
    nodeIds: [idx],
    message: `Hash(${key}) = ${key} mod ${newTable.size} = ${idx}`,
    pseudocodeLine: 1,
  });

  const existing = newTable.buckets[idx].find((e) => e.key === key);
  if (existing) {
    steps.push({
      type: "found",
      nodeIds: [existing.id],
      message: `Key ${key} already in bucket ${idx}`,
      pseudocodeLine: 3,
    });
    return newTable;
  }

  const entry: HashEntry = { key, id: ++nodeIdCounter };
  newTable.buckets[idx] = [...newTable.buckets[idx], entry];
  newTable.count++;

  if (newTable.buckets[idx].length > 1) {
    steps.push({
      type: "highlight",
      nodeIds: [idx],
      message: `Collision at bucket ${idx} (chain length: ${newTable.buckets[idx].length})`,
      pseudocodeLine: 4,
    });
  }

  steps.push({
    type: "insert",
    nodeIds: [entry.id],
    message: `Insert ${key} into bucket ${idx}`,
    pseudocodeLine: 5,
  });

  return newTable;
}

export function hashTableSearch(
  table: HashTableData,
  key: number,
  steps: AnimationStep[],
): boolean {
  const idx = hashFn(key, table.size);
  steps.push({
    type: "highlight",
    nodeIds: [idx],
    message: `Hash(${key}) = ${idx}`,
    pseudocodeLine: 1,
  });

  const bucket = table.buckets[idx];
  for (let i = 0; i < bucket.length; i++) {
    steps.push({
      type: "compare",
      nodeIds: [bucket[i].id],
      message: `Compare with ${bucket[i].key}`,
      pseudocodeLine: 2,
    });
    if (bucket[i].key === key) {
      steps.push({
        type: "found",
        nodeIds: [bucket[i].id],
        message: `Found ${key}`,
        pseudocodeLine: 3,
      });
      return true;
    }
  }

  steps.push({
    type: "not-found",
    nodeIds: [],
    message: `${key} not in table`,
    pseudocodeLine: 5,
  });
  return false;
}

export function hashTableDelete(
  table: HashTableData,
  key: number,
  steps: AnimationStep[],
): HashTableData {
  const newTable: HashTableData = {
    buckets: table.buckets.map((b) => [...b]),
    size: table.size,
    count: table.count,
  };

  const idx = hashFn(key, newTable.size);
  steps.push({
    type: "highlight",
    nodeIds: [idx],
    message: `Hash(${key}) = ${idx}`,
    pseudocodeLine: 1,
  });

  const bucket = newTable.buckets[idx];
  const entryIdx = bucket.findIndex((e) => e.key === key);

  if (entryIdx === -1) {
    steps.push({
      type: "not-found",
      nodeIds: [],
      message: `${key} not in table`,
      pseudocodeLine: 3,
    });
    return newTable;
  }

  steps.push({
    type: "delete",
    nodeIds: [bucket[entryIdx].id],
    message: `Delete ${key} from bucket ${idx}`,
    pseudocodeLine: 4,
  });

  newTable.buckets[idx] = bucket.filter((_, i) => i !== entryIdx);
  newTable.count--;
  return newTable;
}

export function hashTableLoadFactor(table: HashTableData): number {
  return table.count / table.size;
}

// ═══════════════════════════════════════════════════
// Linked List
// ═══════════════════════════════════════════════════

export interface ListNode {
  id: number;
  value: number;
  next: ListNode | null;
}

export function listCreate(): ListNode | null {
  return null;
}

function cloneList(head: ListNode | null): ListNode | null {
  if (!head) return null;
  const newHead: ListNode = { id: head.id, value: head.value, next: null };
  let current = newHead;
  let source = head.next;
  while (source) {
    current.next = { id: source.id, value: source.value, next: null };
    current = current.next;
    source = source.next;
  }
  return newHead;
}

export function listInsertFront(
  head: ListNode | null,
  value: number,
  steps: AnimationStep[],
): ListNode {
  const node: ListNode = { id: ++nodeIdCounter, value, next: cloneList(head) };
  steps.push({
    type: "insert",
    nodeIds: [node.id],
    message: `Insert ${value} at front`,
    pseudocodeLine: 1,
  });
  return node;
}

export function listInsertBack(
  head: ListNode | null,
  value: number,
  steps: AnimationStep[],
): ListNode {
  const newNode: ListNode = { id: ++nodeIdCounter, value, next: null };
  if (!head) {
    steps.push({
      type: "insert",
      nodeIds: [newNode.id],
      message: `Insert ${value} (list was empty)`,
      pseudocodeLine: 1,
    });
    return newNode;
  }

  const newHead = cloneList(head)!;
  let current = newHead;
  while (current.next) {
    steps.push({
      type: "visit",
      nodeIds: [current.id],
      message: `Traverse: ${current.value}`,
      pseudocodeLine: 2,
    });
    current = current.next;
  }
  steps.push({
    type: "visit",
    nodeIds: [current.id],
    message: `Reached end at ${current.value}`,
    pseudocodeLine: 3,
  });
  current.next = newNode;
  steps.push({
    type: "insert",
    nodeIds: [newNode.id],
    message: `Insert ${value} at back`,
    pseudocodeLine: 4,
  });
  return newHead;
}

export function listDelete(
  head: ListNode | null,
  value: number,
  steps: AnimationStep[],
): ListNode | null {
  if (!head) {
    steps.push({
      type: "not-found",
      nodeIds: [],
      message: `List is empty`,
      pseudocodeLine: 1,
    });
    return null;
  }

  const newHead = cloneList(head)!;

  if (newHead.value === value) {
    steps.push({
      type: "delete",
      nodeIds: [newHead.id],
      message: `Delete ${value} from front`,
      pseudocodeLine: 2,
    });
    return newHead.next;
  }

  let current: ListNode = newHead;
  while (current.next) {
    steps.push({
      type: "visit",
      nodeIds: [current.id],
      message: `Check ${current.value}`,
      pseudocodeLine: 3,
    });
    if (current.next.value === value) {
      steps.push({
        type: "delete",
        nodeIds: [current.next.id],
        message: `Delete ${value}`,
        pseudocodeLine: 4,
      });
      current.next = current.next.next;
      return newHead;
    }
    current = current.next;
  }

  steps.push({
    type: "not-found",
    nodeIds: [],
    message: `${value} not found`,
    pseudocodeLine: 6,
  });
  return newHead;
}

export function listSearch(
  head: ListNode | null,
  value: number,
  steps: AnimationStep[],
): boolean {
  let current = head;
  let idx = 0;
  while (current) {
    steps.push({
      type: "compare",
      nodeIds: [current.id],
      message: `Index ${idx}: compare with ${current.value}`,
      pseudocodeLine: 2,
    });
    if (current.value === value) {
      steps.push({
        type: "found",
        nodeIds: [current.id],
        message: `Found ${value} at index ${idx}`,
        pseudocodeLine: 3,
      });
      return true;
    }
    current = current.next;
    idx++;
  }
  steps.push({
    type: "not-found",
    nodeIds: [],
    message: `${value} not found`,
    pseudocodeLine: 5,
  });
  return false;
}

export function listToArray(head: ListNode | null): number[] {
  const result: number[] = [];
  let current = head;
  while (current) {
    result.push(current.value);
    current = current.next;
  }
  return result;
}

// ═══════════════════════════════════════════════════
// Stack
// ═══════════════════════════════════════════════════

export interface StackData {
  items: Array<{ value: number; id: number }>;
}

export function stackCreate(): StackData {
  return { items: [] };
}

export function stackPush(
  stack: StackData,
  value: number,
  steps: AnimationStep[],
): StackData {
  const id = ++nodeIdCounter;
  steps.push({
    type: "insert",
    nodeIds: [id],
    message: `Push ${value} onto stack`,
    pseudocodeLine: 1,
  });
  return { items: [...stack.items, { value, id }] };
}

export function stackPop(
  stack: StackData,
  steps: AnimationStep[],
): { stack: StackData; popped: number | null } {
  if (stack.items.length === 0) {
    steps.push({
      type: "not-found",
      nodeIds: [],
      message: `Stack is empty`,
      pseudocodeLine: 1,
    });
    return { stack, popped: null };
  }

  const top = stack.items[stack.items.length - 1];
  steps.push({
    type: "delete",
    nodeIds: [top.id],
    message: `Pop ${top.value} from stack`,
    pseudocodeLine: 2,
  });
  return {
    stack: { items: stack.items.slice(0, -1) },
    popped: top.value,
  };
}

// ═══════════════════════════════════════════════════
// Queue
// ═══════════════════════════════════════════════════

export interface QueueData {
  items: Array<{ value: number; id: number }>;
}

export function queueCreate(): QueueData {
  return { items: [] };
}

export function queueEnqueue(
  queue: QueueData,
  value: number,
  steps: AnimationStep[],
): QueueData {
  const id = ++nodeIdCounter;
  steps.push({
    type: "insert",
    nodeIds: [id],
    message: `Enqueue ${value}`,
    pseudocodeLine: 1,
  });
  return { items: [...queue.items, { value, id }] };
}

export function queueDequeue(
  queue: QueueData,
  steps: AnimationStep[],
): { queue: QueueData; dequeued: number | null } {
  if (queue.items.length === 0) {
    steps.push({
      type: "not-found",
      nodeIds: [],
      message: `Queue is empty`,
      pseudocodeLine: 1,
    });
    return { queue, dequeued: null };
  }

  const front = queue.items[0];
  steps.push({
    type: "delete",
    nodeIds: [front.id],
    message: `Dequeue ${front.value}`,
    pseudocodeLine: 2,
  });
  return {
    queue: { items: queue.items.slice(1) },
    dequeued: front.value,
  };
}

// ═══════════════════════════════════════════════════
// Tree Layout Helper
// ═══════════════════════════════════════════════════

export function layoutTree(
  root: TreeNode | null,
  canvasWidth: number,
  startY: number = 40,
  levelGap: number = 60,
): void {
  if (!root) return;

  let posCounter = 0;
  const positions = new Map<number, number>();

  function inOrderPositions(node: TreeNode | null): void {
    if (!node) return;
    inOrderPositions(node.left);
    positions.set(node.id, posCounter++);
    inOrderPositions(node.right);
  }

  inOrderPositions(root);
  const totalNodes = posCounter;
  const xGap = canvasWidth / (totalNodes + 1);

  function assignPositions(node: TreeNode | null, depth: number): void {
    if (!node) return;
    const pos = positions.get(node.id)!;
    node.x = xGap * (pos + 1);
    node.y = startY + depth * levelGap;
    assignPositions(node.left, depth + 1);
    assignPositions(node.right, depth + 1);
  }

  assignPositions(root, 0);
}

export function collectTreeNodes(root: TreeNode | null): TreeNode[] {
  const nodes: TreeNode[] = [];
  function collect(node: TreeNode | null): void {
    if (!node) return;
    nodes.push(node);
    collect(node.left);
    collect(node.right);
  }
  collect(root);
  return nodes;
}

export function treeNodeCount(root: TreeNode | null): number {
  if (!root) return 0;
  return 1 + treeNodeCount(root.left) + treeNodeCount(root.right);
}
