import type { KnowledgeNode, KnowledgeEdge, EdgeRelation } from "../../types/knowledge";
import { getNodeDomain, getNodeDepth, getParentId } from "../../types/knowledge";

export type Positions = Record<string, { x: number; y: number }>;

/**
 * Build a temporary graphology graph containing only edges of a specific relation.
 * All visible nodes are kept; only edge connectivity changes.
 * Returns the subgraph and the set of nodes connected by the filtered edges.
 */
export async function buildSubgraph(
  fullGraph: any,
  edges: KnowledgeEdge[],
  relation: EdgeRelation,
): Promise<{ subgraph: any; connectedNodes: Set<string> }> {
  const { default: Graph } = await import("graphology");
  const subgraph = new Graph();
  const connectedNodes = new Set<string>();

  // Copy all nodes with their current attributes
  fullGraph.forEachNode((id: string, attrs: any) => {
    subgraph.addNode(id, { ...attrs });
  });

  // Add only edges matching the relation
  for (const edge of edges) {
    if (edge.relation !== relation) continue;
    if (!subgraph.hasNode(edge.source) || !subgraph.hasNode(edge.target)) continue;
    try {
      subgraph.addEdge(edge.source, edge.target, {
        relation: edge.relation,
        weight: edge.weight || 0.5,
      });
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    } catch {
      // skip duplicates
    }
  }

  return { subgraph, connectedNodes };
}

/**
 * Place disconnected nodes in a ring around the periphery of the connected layout.
 * Connected positions are used to compute the bounding box, then disconnected
 * nodes are arranged in an arc below/around the main layout.
 */
export function placeDisconnectedNodes(
  positions: Positions,
  allNodeIds: string[],
  connectedNodes: Set<string>,
): Positions {
  const disconnected = allNodeIds.filter(
    (id) => !connectedNodes.has(id) && !positions[id],
  );
  if (disconnected.length === 0) return positions;

  // Find bounding box of connected positions
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pos of Object.values(positions)) {
    if (pos.x < minX) minX = pos.x;
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.y > maxY) maxY = pos.y;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const extent = Math.max(maxX - minX, maxY - minY, 200);
  const peripheryRadius = extent * 0.8;

  // Spread disconnected nodes in an arc at the bottom
  const arcStart = Math.PI * 0.3;  // ~55 degrees from bottom-left
  const arcEnd = Math.PI * 0.7;    // ~125 degrees to bottom-right
  const arcRange = arcEnd - arcStart;

  // Sort by domain for visual grouping
  disconnected.sort((a, b) => getNodeDomain(a).localeCompare(getNodeDomain(b)));

  for (let i = 0; i < disconnected.length; i++) {
    const t = disconnected.length === 1 ? 0.5 : i / (disconnected.length - 1);
    const angle = arcStart + t * arcRange + Math.PI / 2; // offset so arc is at bottom
    positions[disconnected[i]] = {
      x: cx + Math.cos(angle) * peripheryRadius,
      y: cy + Math.sin(angle) * peripheryRadius,
    };
  }

  return positions;
}

/**
 * Compute force-directed layout using ForceAtlas2.
 * This is called with an already-constructed graphology graph.
 */
export async function computeForceLayout(graph: any): Promise<Positions> {
  const forceAtlas2 = await import("graphology-layout-forceatlas2");
  forceAtlas2.assign(graph, {
    iterations: 100,
    settings: {
      gravity: 1,
      scalingRatio: 10,
      barnesHutOptimize: true,
      slowDown: 5,
      strongGravityMode: true,
    },
  });

  const positions: Positions = {};
  graph.forEachNode((id: string, attrs: any) => {
    positions[id] = { x: attrs.x, y: attrs.y };
  });
  return positions;
}

/**
 * Compute hierarchy (tree) layout.
 * y = depth level, x = sibling index centered under parent.
 */
export function computeHierarchyLayout(
  graph: any,
  nodes: KnowledgeNode[],
): Positions {
  const positions: Positions = {};
  const levelSpacing = 150;

  // Group nodes by depth
  const byDepth: Map<number, string[]> = new Map();
  const graphNodes = new Set<string>();
  graph.forEachNode((id: string) => graphNodes.add(id));

  for (const node of nodes) {
    if (!graphNodes.has(node.id)) continue;
    const depth = getNodeDepth(node.id);
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node.id);
  }

  // Sort siblings within each depth by parent then by domain
  for (const [depth, ids] of byDepth) {
    ids.sort((a, b) => {
      const pa = getParentId(a) || "";
      const pb = getParentId(b) || "";
      if (pa !== pb) return pa.localeCompare(pb);
      return a.localeCompare(b);
    });

    const totalWidth = ids.length * 120;
    const startX = -totalWidth / 2;
    for (let i = 0; i < ids.length; i++) {
      positions[ids[i]] = {
        x: startX + i * 120 + 60,
        y: depth * levelSpacing,
      };
    }
  }

  return positions;
}

/**
 * Compute radial (BFS rings) layout from a center node.
 */
export function computeRadialLayout(
  graph: any,
  centerId: string,
): Positions {
  const positions: Positions = {};
  const ringSpacing = 150;

  // BFS from center
  const distances: Map<string, number> = new Map();
  const visited = new Set<string>();
  const queue: { id: string; dist: number }[] = [];

  // If center isn't in graph, pick first node
  const actualCenter = graph.hasNode(centerId)
    ? centerId
    : graph.nodes()[0];

  if (!actualCenter) return positions;

  distances.set(actualCenter, 0);
  visited.add(actualCenter);
  queue.push({ id: actualCenter, dist: 0 });

  while (queue.length > 0) {
    const { id, dist } = queue.shift()!;
    const neighbors: string[] = graph.neighbors(id);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        distances.set(neighbor, dist + 1);
        queue.push({ id: neighbor, dist: dist + 1 });
      }
    }
  }

  // Handle disconnected nodes
  graph.forEachNode((id: string) => {
    if (!distances.has(id)) {
      distances.set(id, Math.max(...Array.from(distances.values())) + 1);
    }
  });

  // Group by ring distance
  const rings: Map<number, string[]> = new Map();
  for (const [id, dist] of distances) {
    if (!rings.has(dist)) rings.set(dist, []);
    rings.get(dist)!.push(id);
  }

  // Sort within each ring by domain for consistent ordering
  for (const [ring, ids] of rings) {
    ids.sort((a, b) => {
      const da = getNodeDomain(a);
      const db = getNodeDomain(b);
      return da.localeCompare(db) || a.localeCompare(b);
    });

    if (ring === 0) {
      // Center node
      positions[ids[0]] = { x: 0, y: 0 };
    } else {
      const radius = ring * ringSpacing;
      const angleStep = (2 * Math.PI) / ids.length;
      for (let i = 0; i < ids.length; i++) {
        const angle = angleStep * i - Math.PI / 2; // Start from top
        positions[ids[i]] = {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        };
      }
    }
  }

  return positions;
}

/**
 * Compute cluster layout grouping nodes by domain.
 */
export function computeClusterLayout(
  graph: any,
  nodes: KnowledgeNode[],
): Positions {
  const positions: Positions = {};

  // Group by domain
  const graphNodes = new Set<string>();
  graph.forEachNode((id: string) => graphNodes.add(id));

  const domainGroups: Map<string, string[]> = new Map();
  for (const node of nodes) {
    if (!graphNodes.has(node.id)) continue;
    const domain = getNodeDomain(node.id);
    if (!domainGroups.has(domain)) domainGroups.set(domain, []);
    domainGroups.get(domain)!.push(node.id);
  }

  const domains = Array.from(domainGroups.keys()).sort();
  const clusterRadius = 300; // Distance from center to cluster centroid
  const domainAngleStep = (2 * Math.PI) / domains.length;

  for (let d = 0; d < domains.length; d++) {
    const domain = domains[d];
    const ids = domainGroups.get(domain)!;
    const angle = domainAngleStep * d - Math.PI / 2;
    const cx = Math.cos(angle) * clusterRadius;
    const cy = Math.sin(angle) * clusterRadius;

    // Arrange nodes in a small circle around centroid
    const intraRadius = 30 + ids.length * 18;
    if (ids.length === 1) {
      positions[ids[0]] = { x: cx, y: cy };
    } else {
      const intraStep = (2 * Math.PI) / ids.length;
      // Sort by depth so domains are center, topics next, concepts outer
      ids.sort((a, b) => getNodeDepth(a) - getNodeDepth(b));
      for (let i = 0; i < ids.length; i++) {
        const iAngle = intraStep * i;
        positions[ids[i]] = {
          x: cx + Math.cos(iAngle) * intraRadius,
          y: cy + Math.sin(iAngle) * intraRadius,
        };
      }
    }
  }

  return positions;
}
