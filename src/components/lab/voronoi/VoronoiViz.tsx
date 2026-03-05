import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface Point {
  x: number;
  y: number;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
}

interface Edge {
  from: number;
  to: number;
}

interface VoronoiCell {
  siteIndex: number;
  vertices: Point[];
}

interface DelaunayResult {
  triangles: Triangle[];
  points: Point[];
}

type ColorMode = "random" | "gradient" | "palette" | "monochrome";
type PresetName = "grid" | "spiral" | "clusters" | "random" | "poisson";
type DisplayMode = "voronoi" | "delaunay" | "both" | "dual";

interface DragState {
  pointIndex: number;
  offsetX: number;
  offsetY: number;
}

interface SweepState {
  running: boolean;
  sweepX: number;
  speed: number;
  events: SweepEvent[];
  currentEventIndex: number;
}

interface SweepEvent {
  type: "site" | "circle";
  x: number;
  y: number;
  siteIndex?: number;
  radius?: number;
  center?: Point;
}

interface LloydState {
  running: boolean;
  iterations: number;
}

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const POINT_RADIUS = 6;
const POINT_HOVER_RADIUS = 10;
const MIN_POINTS = 0;
const MAX_POINTS = 500;
const DEFAULT_POINT_COUNT = 30;
const LLOYD_INTERVAL_MS = 100;

const PALETTE_SETS: Record<string, string[]> = {
  ocean: ["#0077b6", "#00b4d8", "#90e0ef", "#caf0f8", "#023e8a", "#0096c7", "#48cae4", "#ade8f4"],
  sunset: ["#ff6b6b", "#ffa06b", "#ffd56b", "#c9e265", "#ff8e53", "#ffbe76", "#ff7979", "#f0932b"],
  forest: ["#2d6a4f", "#40916c", "#52b788", "#74c69d", "#95d5b2", "#b7e4c7", "#d8f3dc", "#1b4332"],
  neon: ["#ff006e", "#8338ec", "#3a86ff", "#06d6a0", "#ffd166", "#ef476f", "#118ab2", "#073b4c"],
};

/* ──────────────────────────────────────
   Pure math: Delaunay triangulation (Bowyer-Watson)
   ────────────────────────────────────── */

function circumcircle(
  p1: Point,
  p2: Point,
  p3: Point
): { center: Point; radius: number } | null {
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-10) return null;

  const ux =
    ((ax * ax + ay * ay) * (by - cy) +
      (bx * bx + by * by) * (cy - ay) +
      (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy =
    ((ax * ax + ay * ay) * (cx - bx) +
      (bx * bx + by * by) * (ax - cx) +
      (cx * cx + cy * cy) * (bx - ax)) /
    d;

  const dx = ax - ux;
  const dy = ay - uy;
  return { center: { x: ux, y: uy }, radius: Math.sqrt(dx * dx + dy * dy) };
}

function bowyerWatson(points: Point[], boundsW: number, boundsH: number): DelaunayResult {
  if (points.length < 3) {
    return { triangles: [], points: [...points] };
  }

  // Create a super-triangle that encompasses all points
  const margin = Math.max(boundsW, boundsH) * 10;
  const superA: Point = { x: -margin, y: -margin };
  const superB: Point = { x: boundsW + margin * 2, y: -margin };
  const superC: Point = { x: boundsW / 2, y: boundsH + margin * 2 };

  const allPoints: Point[] = [...points, superA, superB, superC];
  const superIdxA = points.length;
  const superIdxB = points.length + 1;
  const superIdxC = points.length + 2;

  let triangles: Triangle[] = [{ a: superIdxA, b: superIdxB, c: superIdxC }];

  // Insert each point
  for (let pi = 0; pi < points.length; pi++) {
    const p = points[pi];
    const badTriangles: number[] = [];

    // Find all triangles whose circumcircle contains p
    for (let ti = 0; ti < triangles.length; ti++) {
      const tri = triangles[ti];
      const cc = circumcircle(
        allPoints[tri.a],
        allPoints[tri.b],
        allPoints[tri.c]
      );
      if (!cc) continue;
      const dx = p.x - cc.center.x;
      const dy = p.y - cc.center.y;
      if (dx * dx + dy * dy <= cc.radius * cc.radius + 1e-8) {
        badTriangles.push(ti);
      }
    }

    // Find the boundary of the polygonal hole
    const boundary: Edge[] = [];
    for (const bi of badTriangles) {
      const tri = triangles[bi];
      const edges: Edge[] = [
        { from: tri.a, to: tri.b },
        { from: tri.b, to: tri.c },
        { from: tri.c, to: tri.a },
      ];
      for (const edge of edges) {
        let shared = false;
        for (const bj of badTriangles) {
          if (bi === bj) continue;
          const otherTri = triangles[bj];
          const otherVerts = [otherTri.a, otherTri.b, otherTri.c];
          if (otherVerts.includes(edge.from) && otherVerts.includes(edge.to)) {
            shared = true;
            break;
          }
        }
        if (!shared) {
          boundary.push(edge);
        }
      }
    }

    // Remove bad triangles (in reverse order to preserve indices)
    const sorted = [...badTriangles].sort((a, b) => b - a);
    for (const idx of sorted) {
      triangles.splice(idx, 1);
    }

    // Create new triangles from boundary edges to the inserted point
    for (const edge of boundary) {
      triangles.push({ a: edge.from, b: edge.to, c: pi });
    }
  }

  // Remove triangles that share a vertex with the super-triangle
  triangles = triangles.filter(
    (tri) =>
      tri.a !== superIdxA &&
      tri.a !== superIdxB &&
      tri.a !== superIdxC &&
      tri.b !== superIdxA &&
      tri.b !== superIdxB &&
      tri.b !== superIdxC &&
      tri.c !== superIdxA &&
      tri.c !== superIdxB &&
      tri.c !== superIdxC
  );

  return { triangles, points: [...points] };
}

/* ──────────────────────────────────────
   Pure math: Voronoi from Delaunay
   ────────────────────────────────────── */

function computeVoronoiCells(
  delaunay: DelaunayResult,
  boundsW: number,
  boundsH: number
): VoronoiCell[] {
  const { triangles, points } = delaunay;
  if (points.length < 3 || triangles.length === 0) return [];

  // For each site, find adjacent triangles and their circumcenters
  const siteTriangles: Map<number, number[]> = new Map();
  for (let i = 0; i < points.length; i++) {
    siteTriangles.set(i, []);
  }

  for (let ti = 0; ti < triangles.length; ti++) {
    const tri = triangles[ti];
    siteTriangles.get(tri.a)?.push(ti);
    siteTriangles.get(tri.b)?.push(ti);
    siteTriangles.get(tri.c)?.push(ti);
  }

  // Compute circumcenters for all triangles
  const circumcenters: (Point | null)[] = triangles.map((tri) => {
    const cc = circumcircle(points[tri.a], points[tri.b], points[tri.c]);
    return cc ? cc.center : null;
  });

  const cells: VoronoiCell[] = [];

  for (let si = 0; si < points.length; si++) {
    const triIndices = siteTriangles.get(si) ?? [];
    if (triIndices.length === 0) continue;

    const vertices: Point[] = [];
    for (const ti of triIndices) {
      const cc = circumcenters[ti];
      if (cc) vertices.push(cc);
    }

    if (vertices.length < 2) continue;

    // Sort vertices by angle around the site
    const site = points[si];
    vertices.sort((a, b) => {
      const angleA = Math.atan2(a.y - site.y, a.x - site.x);
      const angleB = Math.atan2(b.y - site.y, b.x - site.x);
      return angleA - angleB;
    });

    // Clip to bounds
    const clipped = clipPolygonToBounds(vertices, boundsW, boundsH);

    cells.push({ siteIndex: si, vertices: clipped });
  }

  return cells;
}

function clipPolygonToBounds(
  vertices: Point[],
  w: number,
  h: number
): Point[] {
  let output = [...vertices];

  // Sutherland-Hodgman clipping against 4 edges
  const edges: Array<{ inside: (p: Point) => boolean; intersect: (a: Point, b: Point) => Point }> = [
    {
      inside: (p) => p.x >= 0,
      intersect: (a, b) => {
        const t = (0 - a.x) / (b.x - a.x);
        return { x: 0, y: a.y + t * (b.y - a.y) };
      },
    },
    {
      inside: (p) => p.x <= w,
      intersect: (a, b) => {
        const t = (w - a.x) / (b.x - a.x);
        return { x: w, y: a.y + t * (b.y - a.y) };
      },
    },
    {
      inside: (p) => p.y >= 0,
      intersect: (a, b) => {
        const t = (0 - a.y) / (b.y - a.y);
        return { x: a.x + t * (b.x - a.x), y: 0 };
      },
    },
    {
      inside: (p) => p.y <= h,
      intersect: (a, b) => {
        const t = (h - a.y) / (b.y - a.y);
        return { x: a.x + t * (b.x - a.x), y: h };
      },
    },
  ];

  for (const edge of edges) {
    if (output.length === 0) break;
    const input = output;
    output = [];

    for (let i = 0; i < input.length; i++) {
      const current = input[i];
      const next = input[(i + 1) % input.length];
      const curInside = edge.inside(current);
      const nextInside = edge.inside(next);

      if (curInside) {
        output.push(current);
        if (!nextInside) {
          output.push(edge.intersect(current, next));
        }
      } else if (nextInside) {
        output.push(edge.intersect(current, next));
      }
    }
  }

  return output;
}

/* ──────────────────────────────────────
   Pure math: Lloyd relaxation
   ────────────────────────────────────── */

function lloydRelax(
  points: Point[],
  boundsW: number,
  boundsH: number
): Point[] {
  if (points.length < 3) return points;

  const delaunay = bowyerWatson(points, boundsW, boundsH);
  const cells = computeVoronoiCells(delaunay, boundsW, boundsH);

  const newPoints = [...points];

  for (const cell of cells) {
    if (cell.vertices.length < 3) continue;

    // Compute centroid of the cell
    let cx = 0, cy = 0;
    for (const v of cell.vertices) {
      cx += v.x;
      cy += v.y;
    }
    cx /= cell.vertices.length;
    cy /= cell.vertices.length;

    // Clamp to bounds
    cx = Math.max(5, Math.min(boundsW - 5, cx));
    cy = Math.max(5, Math.min(boundsH - 5, cy));

    newPoints[cell.siteIndex] = { x: cx, y: cy };
  }

  return newPoints;
}

/* ──────────────────────────────────────
   Pure math: Sweep line events for animation
   ────────────────────────────────────── */

function computeSweepEvents(points: Point[]): SweepEvent[] {
  const events: SweepEvent[] = [];

  // Site events (sorted by x)
  const sorted = points
    .map((p, i) => ({ ...p, index: i }))
    .sort((a, b) => a.x - b.x);

  for (const sp of sorted) {
    events.push({
      type: "site",
      x: sp.x,
      y: sp.y,
      siteIndex: sp.index,
    });
  }

  // Circle events from Delaunay triangulation
  if (points.length >= 3) {
    const delaunay = bowyerWatson(points, 10000, 10000);
    for (const tri of delaunay.triangles) {
      const cc = circumcircle(points[tri.a], points[tri.b], points[tri.c]);
      if (cc) {
        const rightmostX = cc.center.x + cc.radius;
        events.push({
          type: "circle",
          x: rightmostX,
          y: cc.center.y,
          radius: cc.radius,
          center: cc.center,
        });
      }
    }
  }

  // Sort all events by x
  events.sort((a, b) => a.x - b.x);
  return events;
}

/* ──────────────────────────────────────
   Point generation
   ────────────────────────────────────── */

function generatePoints(
  preset: PresetName,
  count: number,
  w: number,
  h: number,
  margin: number = 20
): Point[] {
  const ew = w - margin * 2;
  const eh = h - margin * 2;

  switch (preset) {
    case "random":
      return Array.from({ length: count }, () => ({
        x: margin + Math.random() * ew,
        y: margin + Math.random() * eh,
      }));

    case "grid": {
      const cols = Math.ceil(Math.sqrt(count * (ew / eh)));
      const rows = Math.ceil(count / cols);
      const points: Point[] = [];
      for (let r = 0; r < rows && points.length < count; r++) {
        for (let c = 0; c < cols && points.length < count; c++) {
          points.push({
            x: margin + (c + 0.5) * (ew / cols),
            y: margin + (r + 0.5) * (eh / rows),
          });
        }
      }
      return points;
    }

    case "spiral": {
      const points: Point[] = [];
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(ew, eh) / 2;
      for (let i = 0; i < count; i++) {
        const frac = i / count;
        const angle = frac * Math.PI * 2 * 5; // 5 turns
        const r = frac * maxR;
        points.push({
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
        });
      }
      return points;
    }

    case "clusters": {
      const numClusters = Math.max(3, Math.floor(count / 8));
      const centers: Point[] = Array.from({ length: numClusters }, () => ({
        x: margin + Math.random() * ew,
        y: margin + Math.random() * eh,
      }));
      const points: Point[] = [];
      for (let i = 0; i < count; i++) {
        const center = centers[i % numClusters];
        const spread = Math.min(ew, eh) * 0.08;
        points.push({
          x: Math.max(margin, Math.min(w - margin, center.x + (Math.random() - 0.5) * spread * 2)),
          y: Math.max(margin, Math.min(h - margin, center.y + (Math.random() - 0.5) * spread * 2)),
        });
      }
      return points;
    }

    case "poisson": {
      // Simple Poisson disk sampling via Bridson's algorithm
      const r = Math.sqrt((ew * eh) / (count * Math.PI)) * 1.5;
      const cellSize = r / Math.SQRT2;
      const gridCols = Math.ceil(ew / cellSize);
      const gridRows = Math.ceil(eh / cellSize);
      const grid: (Point | null)[] = new Array(gridCols * gridRows).fill(null);
      const points: Point[] = [];
      const active: number[] = [];

      const gridIdx = (p: Point): number => {
        const col = Math.floor((p.x - margin) / cellSize);
        const row = Math.floor((p.y - margin) / cellSize);
        return row * gridCols + col;
      };

      const addPoint = (p: Point): void => {
        points.push(p);
        active.push(points.length - 1);
        const idx = gridIdx(p);
        if (idx >= 0 && idx < grid.length) grid[idx] = p;
      };

      // Start with a random point
      addPoint({
        x: margin + Math.random() * ew,
        y: margin + Math.random() * eh,
      });

      const k = 30; // rejection limit
      while (active.length > 0 && points.length < count) {
        const activeIdx = Math.floor(Math.random() * active.length);
        const point = points[active[activeIdx]];
        let found = false;

        for (let attempt = 0; attempt < k; attempt++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = r + Math.random() * r;
          const candidate: Point = {
            x: point.x + Math.cos(angle) * dist,
            y: point.y + Math.sin(angle) * dist,
          };

          if (
            candidate.x < margin ||
            candidate.x > w - margin ||
            candidate.y < margin ||
            candidate.y > h - margin
          )
            continue;

          // Check neighbors in grid
          const col = Math.floor((candidate.x - margin) / cellSize);
          const row = Math.floor((candidate.y - margin) / cellSize);
          let tooClose = false;

          for (let dr = -2; dr <= 2 && !tooClose; dr++) {
            for (let dc = -2; dc <= 2 && !tooClose; dc++) {
              const nr = row + dr;
              const nc = col + dc;
              if (nr < 0 || nr >= gridRows || nc < 0 || nc >= gridCols) continue;
              const neighbor = grid[nr * gridCols + nc];
              if (neighbor) {
                const dx = candidate.x - neighbor.x;
                const dy = candidate.y - neighbor.y;
                if (dx * dx + dy * dy < r * r) {
                  tooClose = true;
                }
              }
            }
          }

          if (!tooClose) {
            addPoint(candidate);
            found = true;
            break;
          }
        }

        if (!found) {
          active.splice(activeIdx, 1);
        }
      }

      return points;
    }
  }
}

/* ──────────────────────────────────────
   Color utilities
   ────────────────────────────────────── */

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function getCellColor(
  mode: ColorMode,
  index: number,
  total: number,
  siteX: number,
  siteY: number,
  boundsW: number,
  boundsH: number,
  paletteName: string
): string {
  switch (mode) {
    case "random": {
      const rng = seededRandom(index * 7919 + 13);
      const h = rng() * 360;
      const s = 0.5 + rng() * 0.3;
      const l = 0.3 + rng() * 0.25;
      return hslToHex(h, s, l);
    }

    case "gradient": {
      const dx = siteX / boundsW;
      const dy = siteY / boundsH;
      const dist = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
      const h = dist * 300;
      return hslToHex(h, 0.7, 0.35);
    }

    case "palette": {
      const palette = PALETTE_SETS[paletteName] ?? PALETTE_SETS["ocean"];
      return palette[index % palette.length];
    }

    case "monochrome":
      return "transparent";
  }
}

/* ──────────────────────────────────────
   Canvas rendering helpers
   ────────────────────────────────────── */

function getComputedColor(varName: string): string {
  if (typeof document === "undefined") return "#ffffff";
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim() || "#ffffff"
  );
}

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function drawVoronoiCells(
  ctx: CanvasRenderingContext2D,
  cells: VoronoiCell[],
  points: Point[],
  colorMode: ColorMode,
  paletteName: string,
  w: number,
  h: number,
  highlightIndex: number | null
): void {
  for (const cell of cells) {
    if (cell.vertices.length < 3) continue;

    const fillColor = getCellColor(
      colorMode,
      cell.siteIndex,
      points.length,
      points[cell.siteIndex].x,
      points[cell.siteIndex].y,
      w,
      h,
      paletteName
    );

    ctx.beginPath();
    ctx.moveTo(cell.vertices[0].x, cell.vertices[0].y);
    for (let i = 1; i < cell.vertices.length; i++) {
      ctx.lineTo(cell.vertices[i].x, cell.vertices[i].y);
    }
    ctx.closePath();

    if (colorMode !== "monochrome") {
      ctx.fillStyle = fillColor;
      if (cell.siteIndex === highlightIndex) {
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 0.6;
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (cell.siteIndex === highlightIndex) {
      ctx.fillStyle = colorMode === "monochrome"
        ? "rgba(79, 143, 247, 0.15)"
        : fillColor;
      ctx.globalAlpha = colorMode === "monochrome" ? 1 : 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Cell border
    const borderColor = getComputedColor("--color-text-muted");
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawDelaunayTriangles(
  ctx: CanvasRenderingContext2D,
  triangles: Triangle[],
  points: Point[],
  primaryColor: string
): void {
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;

  for (const tri of triangles) {
    const a = points[tri.a];
    const b = points[tri.b];
    const c = points[tri.c];
    if (!a || !b || !c) continue;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawDualGraph(
  ctx: CanvasRenderingContext2D,
  triangles: Triangle[],
  points: Point[],
  accentColor: string
): void {
  // Draw edges between circumcenters of adjacent triangles
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.globalAlpha = 0.6;

  for (let i = 0; i < triangles.length; i++) {
    for (let j = i + 1; j < triangles.length; j++) {
      const ti = triangles[i];
      const tj = triangles[j];

      // Check if they share an edge (2 common vertices)
      const vertsI = [ti.a, ti.b, ti.c];
      const vertsJ = [tj.a, tj.b, tj.c];
      let shared = 0;
      for (const v of vertsI) {
        if (vertsJ.includes(v)) shared++;
      }

      if (shared >= 2) {
        const ccI = circumcircle(
          points[ti.a],
          points[ti.b],
          points[ti.c]
        );
        const ccJ = circumcircle(
          points[tj.a],
          points[tj.b],
          points[tj.c]
        );
        if (ccI && ccJ) {
          ctx.beginPath();
          ctx.moveTo(ccI.center.x, ccI.center.y);
          ctx.lineTo(ccJ.center.x, ccJ.center.y);
          ctx.stroke();
        }
      }
    }
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Draw circumcenter dots
  for (const tri of triangles) {
    const cc = circumcircle(points[tri.a], points[tri.b], points[tri.c]);
    if (cc) {
      ctx.beginPath();
      ctx.arc(cc.center.x, cc.center.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = accentColor;
      ctx.fill();
    }
  }
}

function drawPoints(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  highlightIndex: number | null,
  accentColor: string,
  headingColor: string
): void {
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const isHighlighted = i === highlightIndex;
    const radius = isHighlighted ? POINT_HOVER_RADIUS : POINT_RADIUS;

    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);

    if (isHighlighted) {
      ctx.fillStyle = accentColor;
      ctx.fill();
      ctx.strokeStyle = headingColor;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = headingColor;
      ctx.fill();
    }
  }
}

function drawSweepLine(
  ctx: CanvasRenderingContext2D,
  sweepX: number,
  h: number,
  events: SweepEvent[],
  currentEventIndex: number
): void {
  // Sweep line
  ctx.strokeStyle = "#ff6b6b";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(sweepX, 0);
  ctx.lineTo(sweepX, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw parabolic arcs (beach line approximation)
  const siteEvents = events
    .filter((e, i) => e.type === "site" && i <= currentEventIndex)
    .map((e) => ({ x: e.x, y: e.y }));

  if (siteEvents.length > 0) {
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    // For each y position, find the site that creates the closest parabola
    for (let y = 0; y < h; y += 2) {
      let minX = -Infinity;

      for (const site of siteEvents) {
        if (Math.abs(sweepX - site.x) < 1e-6) continue;

        // Parabola equation: x = (y - site.y)^2 / (2 * (sweepX - site.x)) + (sweepX + site.x) / 2
        const dy = y - site.y;
        const dx = sweepX - site.x;
        if (dx <= 0) continue;
        const px = (dy * dy) / (2 * dx) + (sweepX + site.x) / 2;
        if (px > minX) minX = px;
      }

      if (minX > -Infinity && minX < sweepX + 50) {
        if (y === 0) ctx.moveTo(minX, y);
        else ctx.lineTo(minX, y);
      }
    }
    ctx.stroke();
  }

  // Draw circle events that have been encountered
  for (let i = 0; i <= currentEventIndex && i < events.length; i++) {
    const e = events[i];
    if (e.type === "circle" && e.center && e.radius) {
      ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(e.center.x, e.center.y, e.radius, 0, Math.PI * 2);
      ctx.stroke();

      // Circle event vertex
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(e.center.x, e.center.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function VoronoiViz(): preact.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const lloydIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 560 });
  const [points, setPoints] = useState<Point[]>(() =>
    generatePoints("random", DEFAULT_POINT_COUNT, 800, 560)
  );
  const [displayMode, setDisplayMode] = useState<DisplayMode>("voronoi");
  const [colorMode, setColorMode] = useState<ColorMode>("random");
  const [paletteName, setPaletteName] = useState("ocean");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showDual, setShowDual] = useState(false);
  const [pointCount, setPointCount] = useState(DEFAULT_POINT_COUNT);

  const [sweep, setSweep] = useState<SweepState>({
    running: false,
    sweepX: 0,
    speed: 1,
    events: [],
    currentEventIndex: -1,
  });

  const [lloyd, setLloyd] = useState<LloydState>({
    running: false,
    iterations: 0,
  });

  const dragRef = useRef<DragState | null>(null);
  const isDraggingRef = useRef(false);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = (): void => {
      const rect = container.getBoundingClientRect();
      const w = Math.floor(rect.width);
      const h = Math.max(400, Math.min(600, Math.floor(w * 0.65)));
      setCanvasSize({ w, h });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Compute Delaunay and Voronoi
  const delaunay = useCallback((): DelaunayResult => {
    return bowyerWatson(points, canvasSize.w, canvasSize.h);
  }, [points, canvasSize]);

  const voronoiCells = useCallback((): VoronoiCell[] => {
    const d = delaunay();
    return computeVoronoiCells(d, canvasSize.w, canvasSize.h);
  }, [delaunay]);

  // Stats
  const computeStats = useCallback(() => {
    const d = delaunay();
    const edgeSet = new Set<string>();
    for (const tri of d.triangles) {
      const sorted = [tri.a, tri.b, tri.c].sort((a, b) => a - b);
      edgeSet.add(`${sorted[0]}-${sorted[1]}`);
      edgeSet.add(`${sorted[1]}-${sorted[2]}`);
      edgeSet.add(`${sorted[0]}-${sorted[2]}`);
    }

    return {
      points: points.length,
      triangles: d.triangles.length,
      edges: edgeSet.size,
      faces: points.length,
    };
  }, [points, delaunay]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const w = canvasSize.w;
    const h = canvasSize.h;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const bgColor = getComputedColor("--color-bg");
    const primaryColor = getComputedColor("--color-primary");
    const accentColor = getComputedColor("--color-accent");
    const headingColor = getComputedColor("--color-heading");

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    if (points.length < 3) {
      // Not enough points for Voronoi/Delaunay
      drawPoints(ctx, points, hoverIndex, accentColor, headingColor);

      ctx.fillStyle = getComputedColor("--color-text-muted");
      ctx.font = "14px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        points.length === 0
          ? "Click to add points (need at least 3)"
          : `Need ${3 - points.length} more point${3 - points.length > 1 ? "s" : ""}`,
        w / 2,
        h / 2
      );
      return;
    }

    const d = delaunay();
    const cells = computeVoronoiCells(d, w, h);

    // Draw Voronoi cells
    if (displayMode === "voronoi" || displayMode === "both") {
      drawVoronoiCells(ctx, cells, points, colorMode, paletteName, w, h, hoverIndex);
    }

    // Draw Delaunay triangulation
    if (displayMode === "delaunay" || displayMode === "both") {
      drawDelaunayTriangles(ctx, d.triangles, points, primaryColor);
    }

    // Dual graph
    if (showDual && d.triangles.length > 0) {
      drawDualGraph(ctx, d.triangles, points, accentColor);
    }

    // Sweep line animation
    if (sweep.running) {
      drawSweepLine(ctx, sweep.sweepX, h, sweep.events, sweep.currentEventIndex);
    }

    // Points
    drawPoints(ctx, points, hoverIndex, accentColor, headingColor);
  }, [
    points,
    canvasSize,
    displayMode,
    colorMode,
    paletteName,
    hoverIndex,
    showDual,
    sweep,
    delaunay,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Sweep line animation loop
  useEffect(() => {
    if (!sweep.running) return;

    let lastTime: number | null = null;

    const tick = (time: number): void => {
      if (lastTime === null) lastTime = time;
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      setSweep((prev) => {
        if (!prev.running) return prev;

        const newX = prev.sweepX + dt * prev.speed * 200;

        // Find current event index based on sweep position
        let eventIdx = prev.currentEventIndex;
        while (
          eventIdx + 1 < prev.events.length &&
          prev.events[eventIdx + 1].x <= newX
        ) {
          eventIdx++;
        }

        if (newX > canvasSize.w + 50) {
          return { ...prev, running: false };
        }

        return { ...prev, sweepX: newX, currentEventIndex: eventIdx };
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [sweep.running, sweep.speed, canvasSize.w]);

  // Lloyd relaxation interval
  useEffect(() => {
    if (!lloyd.running) {
      if (lloydIntervalRef.current) {
        clearInterval(lloydIntervalRef.current);
        lloydIntervalRef.current = null;
      }
      return;
    }

    lloydIntervalRef.current = setInterval(() => {
      setPoints((prev) => lloydRelax(prev, canvasSize.w, canvasSize.h));
      setLloyd((prev) => ({
        ...prev,
        iterations: prev.iterations + 1,
      }));
    }, LLOYD_INTERVAL_MS);

    return () => {
      if (lloydIntervalRef.current) {
        clearInterval(lloydIntervalRef.current);
        lloydIntervalRef.current = null;
      }
    };
  }, [lloyd.running, canvasSize]);

  // Mouse interaction
  const getCanvasPoint = useCallback(
    (e: MouseEvent | TouchEvent): Point => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();

      let clientX: number, clientY: number;
      if ("touches" in e) {
        const touch = e.touches[0] ?? (e as TouchEvent).changedTouches[0];
        clientX = touch.clientX;
        clientY = touch.clientY;
      } else {
        clientX = (e as MouseEvent).clientX;
        clientY = (e as MouseEvent).clientY;
      }

      return {
        x: ((clientX - rect.left) / rect.width) * canvasSize.w,
        y: ((clientY - rect.top) / rect.height) * canvasSize.h,
      };
    },
    [canvasSize]
  );

  const findNearestPoint = useCallback(
    (pos: Point): number | null => {
      let bestIdx: number | null = null;
      let bestDist = POINT_RADIUS * 3;

      for (let i = 0; i < points.length; i++) {
        const d = dist(pos, points[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      return bestIdx;
    },
    [points]
  );

  const findNearestSite = useCallback(
    (pos: Point): number | null => {
      if (points.length === 0) return null;
      let bestIdx = 0;
      let bestDist = Infinity;

      for (let i = 0; i < points.length; i++) {
        const d = dist(pos, points[i]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }

      return bestIdx;
    },
    [points]
  );

  const handleMouseDown = useCallback(
    (e: MouseEvent): void => {
      if (e.button === 2) return; // Right-click handled by contextmenu
      const pos = getCanvasPoint(e);
      const hit = findNearestPoint(pos);

      if (hit !== null) {
        dragRef.current = {
          pointIndex: hit,
          offsetX: points[hit].x - pos.x,
          offsetY: points[hit].y - pos.y,
        };
        isDraggingRef.current = true;
      } else {
        // Add a new point
        setPoints((prev) => [...prev, { x: pos.x, y: pos.y }]);
      }
    },
    [getCanvasPoint, findNearestPoint, points]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent): void => {
      const pos = getCanvasPoint(e);

      if (isDraggingRef.current && dragRef.current) {
        const { pointIndex, offsetX, offsetY } = dragRef.current;
        setPoints((prev) => {
          const newPoints = [...prev];
          newPoints[pointIndex] = {
            x: Math.max(0, Math.min(canvasSize.w, pos.x + offsetX)),
            y: Math.max(0, Math.min(canvasSize.h, pos.y + offsetY)),
          };
          return newPoints;
        });
      } else {
        // Hover: find nearest site
        const nearest = findNearestSite(pos);
        setHoverIndex(nearest);
      }
    },
    [getCanvasPoint, findNearestSite, canvasSize]
  );

  const handleMouseUp = useCallback((): void => {
    dragRef.current = null;
    isDraggingRef.current = false;
  }, []);

  const handleContextMenu = useCallback(
    (e: MouseEvent): void => {
      e.preventDefault();
      const pos = getCanvasPoint(e);
      const hit = findNearestPoint(pos);
      if (hit !== null) {
        setPoints((prev) => prev.filter((_, i) => i !== hit));
      }
    },
    [getCanvasPoint, findNearestPoint]
  );

  const handleMouseLeave = useCallback((): void => {
    setHoverIndex(null);
    handleMouseUp();
  }, [handleMouseUp]);

  // Touch support
  const handleTouchStart = useCallback(
    (e: TouchEvent): void => {
      e.preventDefault();
      if (e.touches.length !== 1) return;
      const pos = getCanvasPoint(e);
      const hit = findNearestPoint(pos);

      if (hit !== null) {
        dragRef.current = {
          pointIndex: hit,
          offsetX: points[hit].x - pos.x,
          offsetY: points[hit].y - pos.y,
        };
        isDraggingRef.current = true;
      } else {
        setPoints((prev) => [...prev, { x: pos.x, y: pos.y }]);
      }
    },
    [getCanvasPoint, findNearestPoint, points]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent): void => {
      e.preventDefault();
      if (!isDraggingRef.current || !dragRef.current) return;
      const pos = getCanvasPoint(e);
      const { pointIndex, offsetX, offsetY } = dragRef.current;
      setPoints((prev) => {
        const newPoints = [...prev];
        newPoints[pointIndex] = {
          x: Math.max(0, Math.min(canvasSize.w, pos.x + offsetX)),
          y: Math.max(0, Math.min(canvasSize.h, pos.y + offsetY)),
        };
        return newPoints;
      });
    },
    [getCanvasPoint, canvasSize]
  );

  const handleTouchEnd = useCallback(
    (e: TouchEvent): void => {
      e.preventDefault();
      handleMouseUp();
    },
    [handleMouseUp]
  );

  // Actions
  const generateNewPoints = useCallback(
    (preset: PresetName): void => {
      setPoints(generatePoints(preset, pointCount, canvasSize.w, canvasSize.h));
      setLloyd({ running: false, iterations: 0 });
      setSweep((prev) => ({ ...prev, running: false }));
    },
    [pointCount, canvasSize]
  );

  const clearPoints = useCallback((): void => {
    setPoints([]);
    setLloyd({ running: false, iterations: 0 });
    setSweep((prev) => ({ ...prev, running: false }));
  }, []);

  const toggleSweep = useCallback((): void => {
    setSweep((prev) => {
      if (prev.running) {
        return { ...prev, running: false };
      }
      const events = computeSweepEvents(points);
      return {
        running: true,
        sweepX: 0,
        speed: prev.speed,
        events,
        currentEventIndex: -1,
      };
    });
  }, [points]);

  const toggleLloyd = useCallback((): void => {
    setLloyd((prev) => ({
      running: !prev.running,
      iterations: prev.running ? prev.iterations : 0,
    }));
  }, []);

  const stats = points.length >= 3 ? computeStats() : null;

  /* ──────── Render ──────── */
  return (
    <div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div class="flex flex-col lg:flex-row">
        {/* Canvas */}
        <div class="flex-1 relative" ref={containerRef}>
          <canvas
            ref={canvasRef}
            class="w-full cursor-crosshair touch-none"
            style={{ display: "block" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />

          {/* Hover info overlay */}
          {hoverIndex !== null && points[hoverIndex] && (
            <div
              class="absolute top-2 left-2 rounded px-2 py-1 text-xs font-mono"
              style={{
                background:
                  "color-mix(in srgb, var(--color-surface) 90%, transparent)",
                color: "var(--color-text-muted)",
              }}
            >
              Site {hoverIndex} ({points[hoverIndex].x.toFixed(0)},{" "}
              {points[hoverIndex].y.toFixed(0)})
            </div>
          )}

          {/* Lloyd iterations counter */}
          {lloyd.iterations > 0 && (
            <div
              class="absolute bottom-2 left-2 rounded px-2 py-1 text-xs font-mono"
              style={{
                background:
                  "color-mix(in srgb, var(--color-surface) 90%, transparent)",
                color: "var(--color-accent)",
              }}
            >
              Lloyd iterations: {lloyd.iterations}
            </div>
          )}
        </div>

        {/* Controls Panel */}
        <div
          class="w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-[var(--color-border)] p-4 overflow-y-auto"
          style={{ maxHeight: `${canvasSize.h}px` }}
        >
          {/* Display Mode */}
          <Section title="Display">
            <div class="flex flex-wrap gap-1 mb-2">
              {(["voronoi", "delaunay", "both"] as const).map((mode) => (
                <ModeBtn
                  key={mode}
                  label={mode.charAt(0).toUpperCase() + mode.slice(1)}
                  active={displayMode === mode}
                  onClick={() => setDisplayMode(mode)}
                />
              ))}
            </div>
            <Toggle
              label="Dual graph"
              checked={showDual}
              onChange={setShowDual}
            />
          </Section>

          {/* Color Mode */}
          <Section title="Colors">
            <div class="flex flex-wrap gap-1 mb-2">
              {(["random", "gradient", "palette", "monochrome"] as const).map(
                (mode) => (
                  <ModeBtn
                    key={mode}
                    label={mode.charAt(0).toUpperCase() + mode.slice(1)}
                    active={colorMode === mode}
                    onClick={() => setColorMode(mode)}
                  />
                )
              )}
            </div>
            {colorMode === "palette" && (
              <select
                class="w-full rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] text-xs px-2 py-1"
                value={paletteName}
                onChange={(e) =>
                  setPaletteName((e.target as HTMLSelectElement).value)
                }
              >
                {Object.keys(PALETTE_SETS).map((name) => (
                  <option key={name} value={name}>
                    {name.charAt(0).toUpperCase() + name.slice(1)}
                  </option>
                ))}
              </select>
            )}
          </Section>

          {/* Point Generation */}
          <Section title="Points">
            <div class="mb-2">
              <label class="text-xs text-[var(--color-text-muted)]">
                Count: {pointCount}
              </label>
              <input
                type="range"
                min={MIN_POINTS}
                max={MAX_POINTS}
                step={1}
                value={pointCount}
                onInput={(e) =>
                  setPointCount(
                    parseInt((e.target as HTMLInputElement).value, 10)
                  )
                }
                class="w-full accent-[var(--color-primary)]"
              />
            </div>
            <div class="flex flex-wrap gap-1 mb-2">
              {(
                ["random", "grid", "spiral", "clusters", "poisson"] as const
              ).map((preset) => (
                <Btn
                  key={preset}
                  onClick={() => generateNewPoints(preset)}
                >
                  {preset.charAt(0).toUpperCase() + preset.slice(1)}
                </Btn>
              ))}
            </div>
            <Btn onClick={clearPoints} full>
              Clear All
            </Btn>
          </Section>

          {/* Sweep Line */}
          <Section title="Sweep Line">
            <div class="flex gap-1 mb-2">
              <Btn onClick={toggleSweep} full>
                {sweep.running ? "Stop Sweep" : "Animate Sweep"}
              </Btn>
            </div>
            {sweep.running && (
              <div>
                <label class="text-xs text-[var(--color-text-muted)]">
                  Speed
                </label>
                <input
                  type="range"
                  min={0.2}
                  max={3}
                  step={0.1}
                  value={sweep.speed}
                  onInput={(e) =>
                    setSweep((prev) => ({
                      ...prev,
                      speed: parseFloat(
                        (e.target as HTMLInputElement).value
                      ),
                    }))
                  }
                  class="w-full accent-[var(--color-primary)]"
                />
                <span class="text-xs font-mono text-[var(--color-text-muted)]">
                  {sweep.speed.toFixed(1)}x
                </span>
              </div>
            )}
          </Section>

          {/* Lloyd Relaxation */}
          <Section title="Lloyd Relaxation">
            <div class="flex gap-1">
              <Btn onClick={toggleLloyd} full>
                {lloyd.running ? "Stop" : "Start Relaxation"}
              </Btn>
            </div>
            {lloyd.iterations > 0 && (
              <div class="mt-1 text-xs text-[var(--color-text-muted)]">
                Iterations: {lloyd.iterations}
              </div>
            )}
          </Section>

          {/* Stats */}
          {stats && (
            <Section title="Stats">
              <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <StatItem label="Points" value={stats.points} />
                <StatItem label="Triangles" value={stats.triangles} />
                <StatItem label="Edges" value={stats.edges} />
                <StatItem label="Voronoi cells" value={stats.faces} />
              </div>
            </Section>
          )}

          {/* Help */}
          <Section title="Controls">
            <div class="text-xs text-[var(--color-text-muted)] space-y-1">
              <p>Click canvas to add points</p>
              <p>Drag points to move them</p>
              <p>Right-click to remove a point</p>
              <p>Hover to highlight nearest cell</p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────
   Sub-components
   ────────────────────────────────────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: preact.ComponentChildren;
}): preact.JSX.Element {
  return (
    <div class="mb-4">
      <h3
        class="text-xs font-bold uppercase tracking-wider mb-2"
        style={{ color: "var(--color-heading)" }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): preact.JSX.Element {
  return (
    <label class="flex items-center gap-2 py-0.5 cursor-pointer text-xs text-[var(--color-text)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        class="accent-[var(--color-primary)]"
      />
      {label}
    </label>
  );
}

function Btn({
  onClick,
  children,
  disabled,
  full,
  title,
}: {
  onClick: () => void;
  children: preact.ComponentChildren;
  disabled?: boolean;
  full?: boolean;
  title?: string;
}): preact.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      class={`rounded px-2 py-1 text-xs font-medium transition-colors border border-[var(--color-border)] hover:border-[var(--color-primary)] ${
        full ? "w-full" : ""
      }`}
      style={{
        background: "var(--color-bg)",
        color: disabled ? "var(--color-text-muted)" : "var(--color-text)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function ModeBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): preact.JSX.Element {
  return (
    <button
      class="rounded px-2 py-1 text-xs font-medium transition-colors border"
      style={{
        background: active ? "var(--color-primary)" : "var(--color-bg)",
        color: active ? "#ffffff" : "var(--color-text-muted)",
        borderColor: active ? "var(--color-primary)" : "var(--color-border)",
        cursor: "pointer",
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function StatItem({
  label,
  value,
}: {
  label: string;
  value: number;
}): preact.JSX.Element {
  return (
    <>
      <span class="text-[var(--color-text-muted)]">{label}</span>
      <span class="text-[var(--color-heading)] font-mono text-right">
        {value}
      </span>
    </>
  );
}
