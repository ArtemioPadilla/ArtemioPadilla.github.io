import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import type { KnowledgeNode, KnowledgeEdge } from "../../types/knowledge";
import { DOMAIN_COLORS, getNodeDomain, getNodeDepth } from "../../types/knowledge";
import type { FunctionalComponent } from "preact";

interface Props {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  onNodeSelect: (node: KnowledgeNode | null) => void;
  selectedNodeId: string | null;
  searchQuery: string;
  viewMode: "2d" | "3d";
  filters: { domains: string[]; types: string[] };
}

const NODE_SIZE_MAP: Record<string, number> = {
  domain: 16,
  topic: 10,
  concept: 7,
  claim: 5,
  source: 4,
};

const EDGE_COLORS: Record<string, string> = {
  "is-part-of": "#555555",
  "relates-to": "#888888",
  causes: "#f59e0b",
  contradicts: "#ef4444",
  supports: "#22c55e",
  "inspired-by": "#a78bfa",
  "applies-to": "#06b6d4",
  generalizes: "#94a3b8",
  specializes: "#94a3b8",
  "analogous-to": "#ec4899",
};

function getNodeColor(node: KnowledgeNode): string {
  const domain = getNodeDomain(node.id);
  return DOMAIN_COLORS[domain] || "#888888";
}

function getNodeSize(node: KnowledgeNode): number {
  return NODE_SIZE_MAP[node.type] || 6;
}

function filterNodes(
  nodes: KnowledgeNode[],
  filters: Props["filters"],
): Set<string> {
  const visible = new Set<string>();
  for (const node of nodes) {
    const domain = getNodeDomain(node.id);
    const domainMatch = filters.domains.length === 0 || filters.domains.includes(domain);
    const typeMatch = filters.types.length === 0 || filters.types.includes(node.type);
    if (domainMatch && typeMatch) visible.add(node.id);
  }
  return visible;
}

const GraphCanvas: FunctionalComponent<Props> = ({
  nodes,
  edges,
  onNodeSelect,
  selectedNodeId,
  searchQuery,
  viewMode,
  filters,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<any>(null);
  const graphRef = useRef<any>(null);
  const fg3dRef = useRef<any>(null);
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.classList.contains("light"));
    const observer = new MutationObserver(() => {
      setIsLight(document.documentElement.classList.contains("light"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const visibleNodes = filterNodes(nodes, filters);

  // Cleanup functions
  const cleanup2D = useCallback(() => {
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }
    graphRef.current = null;
  }, []);

  const cleanup3D = useCallback(() => {
    if (fg3dRef.current) {
      fg3dRef.current._destructor?.();
      fg3dRef.current = null;
    }
    if (containerRef.current) {
      const canvas3d = containerRef.current.querySelector("canvas");
      if (canvas3d) canvas3d.remove();
    }
  }, []);

  // 2D Sigma.js renderer
  useEffect(() => {
    if (viewMode !== "2d" || !containerRef.current) return;
    cleanup3D();

    let destroyed = false;

    const init = async () => {
      const { default: Graph } = await import("graphology");
      const { default: Sigma } = await import("sigma");
      const forceAtlas2 = await import("graphology-layout-forceatlas2");

      if (destroyed || !containerRef.current) return;

      const graph = new Graph();

      // Add nodes
      for (const node of nodes) {
        if (!visibleNodes.has(node.id)) continue;
        const depth = getNodeDepth(node.id);
        const angle = Math.random() * 2 * Math.PI;
        const radius = 50 + depth * 80 + Math.random() * 40;
        graph.addNode(node.id, {
          label: node.label,
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          size: getNodeSize(node),
          color: getNodeColor(node),
          type: "circle",
          _nodeData: node,
        });
      }

      // Add edges
      for (const edge of edges) {
        if (!visibleNodes.has(edge.source) || !visibleNodes.has(edge.target)) continue;
        if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
        try {
          graph.addEdge(edge.source, edge.target, {
            color: EDGE_COLORS[edge.relation] || "#666666",
            size: (edge.weight || 0.5) * 3,
            type: edge.relation === "contradicts" ? "line" : "line",
            label: edge.label,
            _edgeData: edge,
          });
        } catch {
          // skip duplicate edges
        }
      }

      // Run ForceAtlas2 layout
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

      if (destroyed || !containerRef.current) return;

      // Clear container
      containerRef.current.innerHTML = "";

      const bgColor = isLight ? "#fafafa" : "#09090b";

      const renderer = new Sigma(graph, containerRef.current, {
        renderLabels: true,
        labelColor: { color: isLight ? "#18181b" : "#e4e4e7" },
        labelFont: "Inter, sans-serif",
        labelSize: 12,
        labelWeight: "500",
        labelRenderedSizeThreshold: 6,
        defaultEdgeColor: isLight ? "#d4d4d8" : "#333333",
        defaultNodeColor: "#888888",
        stagePadding: 40,
        nodeReducer: (nodeId: string, data: any) => {
          const res = { ...data };
          // Highlight logic
          if (selectedNodeId) {
            if (nodeId === selectedNodeId) {
              res.highlighted = true;
              res.size = data.size * 1.5;
              res.zIndex = 2;
            } else if (
              graph.hasEdge(selectedNodeId, nodeId) ||
              graph.hasEdge(nodeId, selectedNodeId)
            ) {
              res.highlighted = true;
              res.zIndex = 1;
            } else {
              res.color = isLight ? "#d4d4d8" : "#333333";
              res.label = "";
              res.zIndex = 0;
            }
          }
          // Search highlighting
          if (searchQuery) {
            const nodeData = nodes.find((n) => n.id === nodeId);
            const matches =
              nodeData?.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
              nodeData?.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())) ||
              nodeData?.summary?.toLowerCase().includes(searchQuery.toLowerCase());
            if (!matches) {
              res.color = isLight ? "#d4d4d8" : "#333333";
              res.label = "";
            } else {
              res.highlighted = true;
              res.size = data.size * 1.3;
            }
          }
          return res;
        },
        edgeReducer: (edgeId: string, data: any) => {
          const res = { ...data };
          if (selectedNodeId) {
            const [source, target] = graph.extremities(edgeId);
            if (source !== selectedNodeId && target !== selectedNodeId) {
              res.hidden = true;
            }
          }
          return res;
        },
      });

      // Click handler
      renderer.on("clickNode", ({ node }: any) => {
        const nodeData = nodes.find((n) => n.id === node);
        if (nodeData) onNodeSelect(nodeData);
      });

      renderer.on("clickStage", () => {
        onNodeSelect(null);
      });

      // Hover effects
      renderer.on("enterNode", ({ node }: any) => {
        containerRef.current!.style.cursor = "pointer";
      });
      renderer.on("leaveNode", () => {
        containerRef.current!.style.cursor = "default";
      });

      sigmaRef.current = renderer;
      graphRef.current = graph;

      // Set background
      containerRef.current!.style.backgroundColor = bgColor;
    };

    init();

    return () => {
      destroyed = true;
      cleanup2D();
    };
  }, [viewMode, isLight, visibleNodes.size, filters.domains.join(","), filters.types.join(",")]);

  // Update node highlights reactively
  useEffect(() => {
    if (sigmaRef.current) {
      sigmaRef.current.refresh();
    }
  }, [selectedNodeId, searchQuery]);

  // 3D renderer
  useEffect(() => {
    if (viewMode !== "3d" || !containerRef.current) return;
    cleanup2D();

    let destroyed = false;

    const init = async () => {
      const ForceGraph3DModule = await import("3d-force-graph");
      const ForceGraph3D = ForceGraph3DModule.default;

      if (destroyed || !containerRef.current) return;

      containerRef.current.innerHTML = "";

      const bgColor = isLight ? "#fafafa" : "#09090b";

      const filteredNodes = nodes
        .filter((n) => visibleNodes.has(n.id))
        .map((n) => ({
          id: n.id,
          label: n.label,
          color: getNodeColor(n),
          size: getNodeSize(n),
          _nodeData: n,
        }));

      const filteredEdges = edges
        .filter((e) => visibleNodes.has(e.source) && visibleNodes.has(e.target))
        .map((e) => ({
          source: e.source,
          target: e.target,
          color: EDGE_COLORS[e.relation] || "#666666",
          width: (e.weight || 0.5) * 2,
          _edgeData: e,
        }));

      const graph = ForceGraph3D()(containerRef.current)
        .graphData({ nodes: filteredNodes, links: filteredEdges })
        .backgroundColor(bgColor)
        .nodeLabel((node: any) => node.label)
        .nodeColor((node: any) => node.color)
        .nodeVal((node: any) => node.size)
        .nodeOpacity(0.9)
        .linkColor((link: any) => link.color)
        .linkWidth((link: any) => link.width)
        .linkOpacity(0.4)
        .linkDirectionalParticles(1)
        .linkDirectionalParticleWidth(1.5)
        .linkDirectionalParticleSpeed(0.005)
        .onNodeClick((node: any) => {
          if (node._nodeData) onNodeSelect(node._nodeData);
          // Fly to node
          const distance = 120;
          const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
          graph.cameraPosition(
            {
              x: node.x * distRatio,
              y: node.y * distRatio,
              z: node.z * distRatio,
            },
            node,
            1500,
          );
        })
        .onBackgroundClick(() => {
          onNodeSelect(null);
        })
        .width(containerRef.current.clientWidth)
        .height(containerRef.current.clientHeight);

      fg3dRef.current = graph;

      // Handle resize
      const handleResize = () => {
        if (containerRef.current && fg3dRef.current) {
          fg3dRef.current
            .width(containerRef.current.clientWidth)
            .height(containerRef.current.clientHeight);
        }
      };
      window.addEventListener("resize", handleResize);

      return () => window.removeEventListener("resize", handleResize);
    };

    init();

    return () => {
      destroyed = true;
      cleanup3D();
    };
  }, [viewMode, isLight, visibleNodes.size, filters.domains.join(","), filters.types.join(",")]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
      }}
    />
  );
};

export default GraphCanvas;
