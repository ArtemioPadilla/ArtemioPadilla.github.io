/* ──────────────────────────────────────────────────
   Pseudocode for each data structure operation.
   Each entry is an array of lines — the animation
   step's `pseudocodeLine` maps to the 1-based index.
   ────────────────────────────────────────────────── */

import type { StructureType } from "./structures";

export interface PseudocodeEntry {
  operation: string;
  lines: string[];
}

type PseudocodeMap = Record<string, PseudocodeEntry>;

const BST_PSEUDOCODE: PseudocodeMap = {
  insert: {
    operation: "BST Insert",
    lines: [
      "if node is null → create new node",
      "compare value with node.value",
      "if value < node.value:",
      "  recurse left",
      "if value > node.value:",
      "  recurse right",
      "else: value already exists",
    ],
  },
  search: {
    operation: "BST Search",
    lines: [
      "if node is null → not found",
      "compare value with node.value",
      "if value == node.value → found!",
      "if value < node.value:",
      "  search left subtree",
      "if value > node.value:",
      "  search right subtree",
    ],
  },
  delete: {
    operation: "BST Delete",
    lines: [
      "if node is null → not found",
      "compare value with node.value",
      "if value < node.value: recurse left",
      "if value > node.value:",
      "  recurse right",
      "found node to delete:",
      "  if leaf → remove",
      "  if one child → replace with child",
      "  if two children → find in-order successor",
      "  replace value, delete successor",
    ],
  },
  traverse: {
    operation: "In-Order Traversal",
    lines: [
      "traverse(node):",
      "  visit left subtree",
      "  process current node",
      "  visit right subtree",
      "return result",
    ],
  },
};

const AVL_PSEUDOCODE: PseudocodeMap = {
  insert: {
    operation: "AVL Insert",
    lines: [
      "if node is null → create new node",
      "compare value with node.value",
      "recurse into left or right subtree",
      "if value exists → return",
      "update height",
      "compute balance factor",
      "if |BF| > 1: rebalance needed",
      "  right rotation (LL case)",
      "  left rotation (RR case)",
      "  LR or RL double rotation",
    ],
  },
  search: BST_PSEUDOCODE.search,
  delete: {
    operation: "AVL Delete",
    lines: [
      "if node is null → not found",
      "compare value with node.value",
      "recurse to find node",
      "delete node (same as BST)",
      "update height",
      "compute balance factor",
      "rebalance if needed",
    ],
  },
  traverse: BST_PSEUDOCODE.traverse,
};

const HEAP_PSEUDOCODE: PseudocodeMap = {
  insert: {
    operation: "Heap Insert",
    lines: [
      "append value to end of array",
      "bubble up:",
      "  compare with parent",
      "  if violates heap property → swap",
      "  move to parent index",
      "  repeat until root or satisfied",
    ],
  },
  extract: {
    operation: "Heap Extract",
    lines: [
      "save root value",
      "move last element to root",
      "bubble down:",
      "  compare with children",
      "  swap with smaller/larger child",
      "  repeat until leaf or satisfied",
    ],
  },
  search: {
    operation: "Heap Search (Linear)",
    lines: [
      "for each element in array:",
      "  compare with target",
      "  if match → found",
      "  continue to next",
      "not found",
    ],
  },
};

const HASH_PSEUDOCODE: PseudocodeMap = {
  insert: {
    operation: "Hash Table Insert",
    lines: [
      "index = hash(key) mod size",
      "check bucket for existing key",
      "if key exists → skip",
      "if collision → chain at bucket",
      "add entry to bucket",
    ],
  },
  search: {
    operation: "Hash Table Search",
    lines: [
      "index = hash(key) mod size",
      "scan chain at bucket[index]",
      "if key found → return",
      "if end of chain → not found",
      "return not found",
    ],
  },
  delete: {
    operation: "Hash Table Delete",
    lines: [
      "index = hash(key) mod size",
      "scan chain at bucket[index]",
      "if key not found → return",
      "remove entry from chain",
      "decrement count",
    ],
  },
};

const LIST_PSEUDOCODE: PseudocodeMap = {
  "insert-front": {
    operation: "Insert Front",
    lines: [
      "create new node",
      "new.next = head",
      "head = new",
    ],
  },
  "insert-back": {
    operation: "Insert Back",
    lines: [
      "if empty → new node is head",
      "traverse to last node",
      "  current = current.next",
      "last.next = new node",
    ],
  },
  delete: {
    operation: "List Delete",
    lines: [
      "if empty → not found",
      "if head matches → head = head.next",
      "traverse list to find value",
      "  if next matches → unlink next",
      "  advance pointer",
      "not found",
    ],
  },
  search: {
    operation: "List Search",
    lines: [
      "current = head",
      "while current not null:",
      "  if current.value == target → found",
      "  current = current.next",
      "not found",
    ],
  },
};

const STACK_PSEUDOCODE: PseudocodeMap = {
  push: {
    operation: "Stack Push",
    lines: [
      "add value to top of stack",
      "increment size",
    ],
  },
  pop: {
    operation: "Stack Pop",
    lines: [
      "if empty → underflow",
      "remove and return top element",
      "decrement size",
    ],
  },
};

const QUEUE_PSEUDOCODE: PseudocodeMap = {
  enqueue: {
    operation: "Queue Enqueue",
    lines: [
      "add value to back of queue",
      "increment size",
    ],
  },
  dequeue: {
    operation: "Queue Dequeue",
    lines: [
      "if empty → underflow",
      "remove and return front element",
      "decrement size",
    ],
  },
};

const ALL_PSEUDOCODE: Record<StructureType, PseudocodeMap> = {
  bst: BST_PSEUDOCODE,
  avl: AVL_PSEUDOCODE,
  "min-heap": HEAP_PSEUDOCODE,
  "max-heap": HEAP_PSEUDOCODE,
  "hash-table": HASH_PSEUDOCODE,
  "linked-list": LIST_PSEUDOCODE,
  stack: STACK_PSEUDOCODE,
  queue: QUEUE_PSEUDOCODE,
};

export function getPseudocode(
  structure: StructureType,
  operation: string,
): PseudocodeEntry | null {
  return ALL_PSEUDOCODE[structure]?.[operation] ?? null;
}

export function getOperations(structure: StructureType): string[] {
  return Object.keys(ALL_PSEUDOCODE[structure] ?? {});
}

// ═══════════════════════════════════════════════════
// Complexity Information
// ═══════════════════════════════════════════════════

export interface ComplexityInfo {
  average: string;
  worst: string;
  space: string;
}

type ComplexityMap = Record<string, ComplexityInfo>;

const BST_COMPLEXITY: ComplexityMap = {
  insert: { average: "O(log n)", worst: "O(n)", space: "O(n)" },
  search: { average: "O(log n)", worst: "O(n)", space: "O(1)" },
  delete: { average: "O(log n)", worst: "O(n)", space: "O(n)" },
  traverse: { average: "O(n)", worst: "O(n)", space: "O(n)" },
};

const AVL_COMPLEXITY: ComplexityMap = {
  insert: { average: "O(log n)", worst: "O(log n)", space: "O(n)" },
  search: { average: "O(log n)", worst: "O(log n)", space: "O(1)" },
  delete: { average: "O(log n)", worst: "O(log n)", space: "O(n)" },
  traverse: { average: "O(n)", worst: "O(n)", space: "O(n)" },
};

const HEAP_COMPLEXITY: ComplexityMap = {
  insert: { average: "O(log n)", worst: "O(log n)", space: "O(1)" },
  extract: { average: "O(log n)", worst: "O(log n)", space: "O(1)" },
  search: { average: "O(n)", worst: "O(n)", space: "O(1)" },
};

const HASH_COMPLEXITY: ComplexityMap = {
  insert: { average: "O(1)", worst: "O(n)", space: "O(n)" },
  search: { average: "O(1)", worst: "O(n)", space: "O(1)" },
  delete: { average: "O(1)", worst: "O(n)", space: "O(1)" },
};

const LIST_COMPLEXITY: ComplexityMap = {
  "insert-front": { average: "O(1)", worst: "O(1)", space: "O(1)" },
  "insert-back": { average: "O(n)", worst: "O(n)", space: "O(1)" },
  delete: { average: "O(n)", worst: "O(n)", space: "O(1)" },
  search: { average: "O(n)", worst: "O(n)", space: "O(1)" },
};

const STACK_COMPLEXITY: ComplexityMap = {
  push: { average: "O(1)", worst: "O(1)", space: "O(1)" },
  pop: { average: "O(1)", worst: "O(1)", space: "O(1)" },
};

const QUEUE_COMPLEXITY: ComplexityMap = {
  enqueue: { average: "O(1)", worst: "O(1)", space: "O(1)" },
  dequeue: { average: "O(1)", worst: "O(1)", space: "O(1)" },
};

const ALL_COMPLEXITY: Record<StructureType, ComplexityMap> = {
  bst: BST_COMPLEXITY,
  avl: AVL_COMPLEXITY,
  "min-heap": HEAP_COMPLEXITY,
  "max-heap": HEAP_COMPLEXITY,
  "hash-table": HASH_COMPLEXITY,
  "linked-list": LIST_COMPLEXITY,
  stack: STACK_COMPLEXITY,
  queue: QUEUE_COMPLEXITY,
};

export function getComplexity(
  structure: StructureType,
  operation: string,
): ComplexityInfo | null {
  return ALL_COMPLEXITY[structure]?.[operation] ?? null;
}
