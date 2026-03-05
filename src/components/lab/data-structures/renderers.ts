/* ──────────────────────────────────────────────────
   Canvas renderers for each data structure.
   Pure functions — receive ctx + data, draw pixels.
   ────────────────────────────────────────────────── */

import type {
  TreeNode,
  HeapData,
  HashTableData,
  ListNode,
  StackData,
  QueueData,
} from "./structures";

// ═══════════════════════════════════════════════════
// Colors (read at render time from CSS vars)
// ═══════════════════════════════════════════════════

export interface ThemeColors {
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  heading: string;
  bg: string;
}

export function readThemeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  return {
    surface: style.getPropertyValue("--color-surface").trim() || "#111111",
    border: style.getPropertyValue("--color-border").trim() || "#27272a",
    text: style.getPropertyValue("--color-text").trim() || "#e4e4e7",
    textMuted:
      style.getPropertyValue("--color-text-muted").trim() || "#a1a1aa",
    heading: style.getPropertyValue("--color-heading").trim() || "#ffffff",
    bg: style.getPropertyValue("--color-bg").trim() || "#09090b",
  };
}

// Fixed semantic colors for animations
const COLOR_HIGHLIGHT = "#f59e0b";
const COLOR_FOUND = "#34d399";
const COLOR_NOT_FOUND = "#ef4444";
const COLOR_INSERT = "#4f8ff7";
const COLOR_SWAP = "#a78bfa";

export type HighlightType =
  | "none"
  | "visit"
  | "compare"
  | "found"
  | "not-found"
  | "insert"
  | "delete"
  | "swap"
  | "rotate"
  | "highlight"
  | "traverse";

function highlightColor(type: HighlightType): string | null {
  switch (type) {
    case "visit":
    case "compare":
    case "highlight":
    case "traverse":
      return COLOR_HIGHLIGHT;
    case "found":
      return COLOR_FOUND;
    case "not-found":
    case "delete":
      return COLOR_NOT_FOUND;
    case "insert":
      return COLOR_INSERT;
    case "swap":
    case "rotate":
      return COLOR_SWAP;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════
// Shared Drawing Primitives
// ═══════════════════════════════════════════════════

const NODE_RADIUS = 20;
const FONT_SIZE = 13;

function drawCircleNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number,
  colors: ThemeColors,
  hl: HighlightType = "none",
  label?: string,
): void {
  const hlColor = highlightColor(hl);

  ctx.beginPath();
  ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = hlColor ?? colors.surface;
  ctx.fill();
  ctx.strokeStyle = hlColor ?? colors.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = hl !== "none" ? "#000000" : colors.heading;
  ctx.font = `bold ${FONT_SIZE}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value), x, y);

  if (label) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${FONT_SIZE - 3}px Inter, sans-serif`;
    ctx.fillText(label, x, y - NODE_RADIUS - 8);
  }
}

function drawEdge(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colors: ThemeColors,
  hl: HighlightType = "none",
): void {
  const hlColor = highlightColor(hl);
  ctx.beginPath();
  ctx.moveTo(x1, y1 + NODE_RADIUS);
  ctx.lineTo(x2, y2 - NODE_RADIUS);
  ctx.strokeStyle = hlColor ?? colors.border;
  ctx.lineWidth = hl !== "none" ? 2.5 : 1.5;
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colors: ThemeColors,
  hl: HighlightType = "none",
): void {
  const hlColor = highlightColor(hl);
  const headLen = 8;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = hlColor ?? colors.textMuted;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fillStyle = hlColor ?? colors.textMuted;
  ctx.fill();
}

function drawBoxNode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
  colors: ThemeColors,
  hl: HighlightType = "none",
  label?: string,
): void {
  const hlColor = highlightColor(hl);

  ctx.fillStyle = hlColor ?? colors.surface;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = hlColor ?? colors.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  ctx.fillStyle = hl !== "none" ? "#000000" : colors.heading;
  ctx.font = `bold ${FONT_SIZE}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value), x + w / 2, y + h / 2);

  if (label) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${FONT_SIZE - 3}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(label, x + w / 2, y - 8);
  }
}

// ═══════════════════════════════════════════════════
// Tree Renderer (BST / AVL)
// ═══════════════════════════════════════════════════

export function renderTree(
  ctx: CanvasRenderingContext2D,
  root: TreeNode | null,
  width: number,
  height: number,
  colors: ThemeColors,
  highlightedIds: Set<number>,
  highlightType: HighlightType,
  showBalanceFactor: boolean = false,
): void {
  ctx.clearRect(0, 0, width, height);

  if (!root) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${FONT_SIZE}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Empty tree. Insert a value to begin.", width / 2, height / 2);
    return;
  }

  // Draw edges first (below nodes)
  function drawEdges(node: TreeNode | null): void {
    if (!node) return;
    if (node.left) {
      const edgeHl =
        highlightedIds.has(node.id) && highlightedIds.has(node.left.id)
          ? highlightType
          : "none";
      drawEdge(ctx, node.x, node.y, node.left.x, node.left.y, colors, edgeHl);
      drawEdges(node.left);
    }
    if (node.right) {
      const edgeHl =
        highlightedIds.has(node.id) && highlightedIds.has(node.right.id)
          ? highlightType
          : "none";
      drawEdge(
        ctx,
        node.x,
        node.y,
        node.right.x,
        node.right.y,
        colors,
        edgeHl,
      );
      drawEdges(node.right);
    }
  }

  drawEdges(root);

  // Draw nodes
  function drawNodes(node: TreeNode | null): void {
    if (!node) return;
    const hl = highlightedIds.has(node.id) ? highlightType : "none";
    const label = showBalanceFactor ? `bf:${node.balanceFactor}` : undefined;
    drawCircleNode(ctx, node.x, node.y, node.value, colors, hl, label);
    drawNodes(node.left);
    drawNodes(node.right);
  }

  drawNodes(root);
}

// ═══════════════════════════════════════════════════
// Heap Renderer (tree view + array bar view)
// ═══════════════════════════════════════════════════

function heapNodePosition(
  index: number,
  totalLevels: number,
  canvasWidth: number,
  startY: number,
  levelGap: number,
): { x: number; y: number } {
  const level = Math.floor(Math.log2(index + 1));
  const posInLevel = index - (Math.pow(2, level) - 1);
  const nodesInLevel = Math.pow(2, level);
  const maxWidth = canvasWidth - 40;
  const levelWidth = maxWidth / Math.pow(2, Math.max(0, totalLevels - level - 1));
  const startX = (canvasWidth - levelWidth * (nodesInLevel - 1)) / 2;
  const gap = nodesInLevel > 1 ? levelWidth : 0;

  return {
    x: startX + posInLevel * gap,
    y: startY + level * levelGap,
  };
}

export function renderHeap(
  ctx: CanvasRenderingContext2D,
  heap: HeapData,
  width: number,
  height: number,
  colors: ThemeColors,
  highlightedIds: Set<number>,
  highlightType: HighlightType,
): void {
  ctx.clearRect(0, 0, width, height);

  if (heap.array.length === 0) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${FONT_SIZE}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Empty heap. Insert a value to begin.", width / 2, height / 2);
    return;
  }

  const totalLevels = Math.floor(Math.log2(heap.array.length)) + 1;
  const treeHeight = totalLevels * 60 + 40;
  const levelGap = Math.min(60, (height * 0.55) / totalLevels);

  // Tree view
  // Edges
  for (let i = 0; i < heap.array.length; i++) {
    const pos = heapNodePosition(i, totalLevels, width, 35, levelGap);
    const leftIdx = 2 * i + 1;
    const rightIdx = 2 * i + 2;

    if (leftIdx < heap.array.length) {
      const leftPos = heapNodePosition(leftIdx, totalLevels, width, 35, levelGap);
      drawEdge(ctx, pos.x, pos.y, leftPos.x, leftPos.y, colors);
    }
    if (rightIdx < heap.array.length) {
      const rightPos = heapNodePosition(rightIdx, totalLevels, width, 35, levelGap);
      drawEdge(ctx, pos.x, pos.y, rightPos.x, rightPos.y, colors);
    }
  }

  // Nodes
  for (let i = 0; i < heap.array.length; i++) {
    const pos = heapNodePosition(i, totalLevels, width, 35, levelGap);
    const hl = highlightedIds.has(heap.nodeIds[i]) ? highlightType : "none";
    drawCircleNode(ctx, pos.x, pos.y, heap.array[i], colors, hl);
  }

  // Array bar view at bottom
  const barY = Math.min(treeHeight + 20, height - 55);
  const barH = 32;
  const maxBarW = (width - 40) / Math.max(heap.array.length, 1);
  const barW = Math.min(maxBarW, 48);
  const barStartX = (width - barW * heap.array.length) / 2;

  ctx.fillStyle = colors.textMuted;
  ctx.font = `${FONT_SIZE - 2}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("Array representation:", width / 2, barY - 10);

  for (let i = 0; i < heap.array.length; i++) {
    const x = barStartX + i * barW;
    const hl = highlightedIds.has(heap.nodeIds[i]) ? highlightType : "none";
    drawBoxNode(ctx, x, barY, barW - 2, barH, heap.array[i], colors, hl);

    // Index label
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${FONT_SIZE - 4}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(String(i), x + (barW - 2) / 2, barY + barH + 12);
  }
}

// ═══════════════════════════════════════════════════
// Hash Table Renderer
// ═══════════════════════════════════════════════════

export function renderHashTable(
  ctx: CanvasRenderingContext2D,
  table: HashTableData,
  width: number,
  height: number,
  colors: ThemeColors,
  highlightedIds: Set<number>,
  highlightType: HighlightType,
  highlightBucket: number,
): void {
  ctx.clearRect(0, 0, width, height);

  const bucketH = 36;
  const bucketW = 56;
  const chainNodeW = 44;
  const gapY = 8;
  const startX = 20;
  const totalH = table.size * (bucketH + gapY);
  const startY = Math.max(10, (height - totalH) / 2);

  // Load factor display
  const lf = (table.count / table.size).toFixed(2);
  ctx.fillStyle = colors.textMuted;
  ctx.font = `${FONT_SIZE - 1}px Inter, sans-serif`;
  ctx.textAlign = "right";
  ctx.fillText(
    `Load factor: ${lf} (${table.count}/${table.size})`,
    width - 15,
    startY - 2,
  );

  for (let i = 0; i < table.size; i++) {
    const y = startY + i * (bucketH + gapY);
    const isHlBucket = highlightBucket === i;

    // Bucket index
    ctx.fillStyle = isHlBucket ? COLOR_HIGHLIGHT : colors.textMuted;
    ctx.font = `bold ${FONT_SIZE - 1}px Inter, sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i), startX - 8, y + bucketH / 2);

    // Bucket box
    ctx.fillStyle = isHlBucket
      ? COLOR_HIGHLIGHT + "33"
      : colors.surface;
    ctx.fillRect(startX, y, bucketW, bucketH);
    ctx.strokeStyle = isHlBucket ? COLOR_HIGHLIGHT : colors.border;
    ctx.lineWidth = isHlBucket ? 2 : 1;
    ctx.strokeRect(startX, y, bucketW, bucketH);

    // Chain entries
    const bucket = table.buckets[i];
    let chainX = startX + bucketW + 10;

    for (let j = 0; j < bucket.length; j++) {
      const entry = bucket[j];
      const hl = highlightedIds.has(entry.id) ? highlightType : "none";

      // Arrow from previous
      drawArrow(
        ctx,
        chainX - 10,
        y + bucketH / 2,
        chainX,
        y + bucketH / 2,
        colors,
        hl,
      );

      // Chain node
      const nodeHlColor = highlightColor(hl);
      ctx.fillStyle = nodeHlColor ?? colors.surface;
      ctx.fillRect(chainX, y + 2, chainNodeW, bucketH - 4);
      ctx.strokeStyle = nodeHlColor ?? colors.border;
      ctx.lineWidth = hl !== "none" ? 2 : 1;
      ctx.strokeRect(chainX, y + 2, chainNodeW, bucketH - 4);

      ctx.fillStyle = hl !== "none" ? "#000000" : colors.heading;
      ctx.font = `bold ${FONT_SIZE}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(entry.key), chainX + chainNodeW / 2, y + bucketH / 2);

      chainX += chainNodeW + 15;
    }

    if (bucket.length === 0) {
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${FONT_SIZE - 2}px Inter, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("null", startX + bucketW + 14, y + bucketH / 2);
    }
  }
}

// ═══════════════════════════════════════════════════
// Linked List Renderer
// ═══════════════════════════════════════════════════

export function renderLinkedList(
  ctx: CanvasRenderingContext2D,
  head: ListNode | null,
  width: number,
  height: number,
  colors: ThemeColors,
  highlightedIds: Set<number>,
  highlightType: HighlightType,
): void {
  ctx.clearRect(0, 0, width, height);

  if (!head) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${FONT_SIZE}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Empty list. Insert a value to begin.", width / 2, height / 2);
    return;
  }

  const nodeW = 52;
  const nodeH = 36;
  const gap = 30;
  const rowCapacity = Math.floor((width - 40) / (nodeW + gap));

  let current: ListNode | null = head;
  let idx = 0;
  const centerY = height / 2;

  // Count nodes for centering
  let count = 0;
  let tmp: ListNode | null = head;
  while (tmp) {
    count++;
    tmp = tmp.next;
  }

  const rows = Math.ceil(count / rowCapacity);
  const totalHeight = rows * (nodeH + 40);
  const baseY = Math.max(20, (height - totalHeight) / 2);

  // HEAD label
  ctx.fillStyle = colors.textMuted;
  ctx.font = `bold ${FONT_SIZE - 2}px Inter, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("HEAD", 15, baseY + nodeH / 2 - 20);

  while (current) {
    const row = Math.floor(idx / rowCapacity);
    const col = idx % rowCapacity;
    const nodesInRow = Math.min(rowCapacity, count - row * rowCapacity);
    const rowWidth = nodesInRow * (nodeW + gap) - gap;
    const startX = (width - rowWidth) / 2;

    const x = startX + col * (nodeW + gap);
    const y = baseY + row * (nodeH + 40);

    const hl = highlightedIds.has(current.id) ? highlightType : "none";
    drawBoxNode(ctx, x, y, nodeW, nodeH, current.value, colors, hl);

    // Arrow to next
    if (current.next) {
      const nextRow = Math.floor((idx + 1) / rowCapacity);
      if (nextRow === row) {
        // Same row — arrow right
        drawArrow(
          ctx,
          x + nodeW + 2,
          y + nodeH / 2,
          x + nodeW + gap - 2,
          y + nodeH / 2,
          colors,
        );
      } else {
        // Wrap to next row
        drawArrow(
          ctx,
          x + nodeW / 2,
          y + nodeH + 2,
          x + nodeW / 2,
          y + nodeH + 20,
          colors,
        );
      }
    } else {
      // null terminator
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${FONT_SIZE - 2}px Inter, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("null", x + nodeW + 8, y + nodeH / 2);
    }

    current = current.next;
    idx++;
  }
}

// ═══════════════════════════════════════════════════
// Stack Renderer (vertical, top-down)
// ═══════════════════════════════════════════════════

export function renderStack(
  ctx: CanvasRenderingContext2D,
  stack: StackData,
  width: number,
  height: number,
  colors: ThemeColors,
  highlightedIds: Set<number>,
  highlightType: HighlightType,
): void {
  ctx.clearRect(0, 0, width, height);

  if (stack.items.length === 0) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${FONT_SIZE}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Empty stack. Push a value to begin.", width / 2, height / 2);
    return;
  }

  const boxW = 80;
  const boxH = 36;
  const gap = 4;
  const totalH = stack.items.length * (boxH + gap);
  const startY = Math.max(30, (height - totalH) / 2);
  const centerX = width / 2 - boxW / 2;

  // TOP label
  ctx.fillStyle = COLOR_INSERT;
  ctx.font = `bold ${FONT_SIZE - 1}px Inter, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("TOP", width / 2, startY - 10);

  // Draw from top (last item) to bottom (first item)
  for (let i = stack.items.length - 1; i >= 0; i--) {
    const item = stack.items[i];
    const drawIdx = stack.items.length - 1 - i;
    const y = startY + drawIdx * (boxH + gap);
    const hl = highlightedIds.has(item.id) ? highlightType : "none";
    drawBoxNode(ctx, centerX, y, boxW, boxH, item.value, colors, hl);
  }

  // Base line
  const baseY = startY + stack.items.length * (boxH + gap) - gap + 4;
  ctx.beginPath();
  ctx.moveTo(centerX - 10, baseY);
  ctx.lineTo(centerX + boxW + 10, baseY);
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ═══════════════════════════════════════════════════
// Queue Renderer (horizontal, left to right)
// ═══════════════════════════════════════════════════

export function renderQueue(
  ctx: CanvasRenderingContext2D,
  queue: QueueData,
  width: number,
  height: number,
  colors: ThemeColors,
  highlightedIds: Set<number>,
  highlightType: HighlightType,
): void {
  ctx.clearRect(0, 0, width, height);

  if (queue.items.length === 0) {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${FONT_SIZE}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "Empty queue. Enqueue a value to begin.",
      width / 2,
      height / 2,
    );
    return;
  }

  const boxW = 52;
  const boxH = 40;
  const gap = 12;
  const totalW = queue.items.length * (boxW + gap) - gap;
  const startX = Math.max(20, (width - totalW) / 2);
  const centerY = height / 2 - boxH / 2;

  // FRONT / BACK labels
  ctx.font = `bold ${FONT_SIZE - 1}px Inter, sans-serif`;
  ctx.textAlign = "center";

  ctx.fillStyle = COLOR_NOT_FOUND;
  ctx.fillText("FRONT", startX + boxW / 2, centerY - 14);

  ctx.fillStyle = COLOR_INSERT;
  ctx.fillText(
    "BACK",
    startX + (queue.items.length - 1) * (boxW + gap) + boxW / 2,
    centerY - 14,
  );

  for (let i = 0; i < queue.items.length; i++) {
    const item = queue.items[i];
    const x = startX + i * (boxW + gap);
    const hl = highlightedIds.has(item.id) ? highlightType : "none";
    drawBoxNode(ctx, x, centerY, boxW, boxH, item.value, colors, hl);

    // Arrow
    if (i < queue.items.length - 1) {
      drawArrow(
        ctx,
        x + boxW + 2,
        centerY + boxH / 2,
        x + boxW + gap - 2,
        centerY + boxH / 2,
        colors,
      );
    }
  }
}
