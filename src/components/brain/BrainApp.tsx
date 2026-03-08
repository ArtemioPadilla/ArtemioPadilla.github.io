import { useState, useCallback } from "preact/hooks";
import type { FunctionalComponent } from "preact";
import type { KnowledgeNode, KnowledgeEdge, LayoutMode, EdgeRelation } from "../../types/knowledge";
import { SUBGRAPH_CONFIGS } from "../../types/knowledge";
import GraphCanvas from "./GraphCanvas";
import DetailPanel from "./DetailPanel";
import GraphControls from "./GraphControls";

interface GraphLevel {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  label: string;
  subgraphKey: string | null;
}

interface Props {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  subgraphs?: Record<string, { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }>;
}

function readUrlParams() {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    node: params.get("node"),
    layout: params.get("layout") as LayoutMode | null,
    relation: params.get("relation") as EdgeRelation | null,
    center: params.get("center"),
    subgraph: params.get("subgraph"),
  };
}

function updateUrlParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", url.toString());
}

const BrainApp: FunctionalComponent<Props> = ({ nodes, edges, subgraphs = {} }) => {
  const [graphStack, setGraphStack] = useState<GraphLevel[]>([
    { nodes, edges, label: "Brain", subgraphKey: null },
  ]);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<{ domains: string[]; types: string[] }>({
    domains: [],
    types: [],
  });
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("force");
  const [relationFilter, setRelationFilter] = useState<EdgeRelation | null>(null);
  const [radialCenter, setRadialCenter] = useState<string>("personal/curiosity");

  const currentGraph = graphStack[graphStack.length - 1];
  const currentSubgraphKey = currentGraph.subgraphKey;
  const subgraphConfig = currentSubgraphKey ? SUBGRAPH_CONFIGS[currentSubgraphKey] : null;
  const domainColors = subgraphConfig?.domainColors;

  const handleNodeSelect = useCallback(
    (node: KnowledgeNode | null) => {
      setSelectedNode(node);
      updateUrlParam("node", node?.id || null);
      // In radial mode, clicking a node also updates the radial center
      if (node && layoutMode === "radial") {
        setRadialCenter(node.id);
        updateUrlParam("center", node.id);
      }
    },
    [layoutMode],
  );

  const handleNavigate = useCallback(
    (nodeId: string) => {
      const node = currentGraph.nodes.find((n) => n.id === nodeId);
      if (node) handleNodeSelect(node);
    },
    [currentGraph.nodes, handleNodeSelect],
  );

  const handleSearchSelect = useCallback(
    (node: KnowledgeNode) => {
      handleNodeSelect(node);
      setSearchQuery("");
    },
    [handleNodeSelect],
  );

  const handleLayoutChange = useCallback((mode: LayoutMode) => {
    setLayoutMode(mode);
    updateUrlParam("layout", mode === "force" ? null : mode);
  }, []);

  const handleRelationFilterChange = useCallback((relation: EdgeRelation | null) => {
    setRelationFilter(relation);
    updateUrlParam("relation", relation);
  }, []);

  const handleDrillDown = useCallback(
    (subgraphKey: string) => {
      const sg = subgraphs[subgraphKey];
      if (!sg) return;

      const config = SUBGRAPH_CONFIGS[subgraphKey];
      const label = selectedNode?.label || subgraphKey.replace(".json", "");

      setGraphStack((prev) => [
        ...prev,
        { nodes: sg.nodes, edges: sg.edges, label, subgraphKey },
      ]);

      // Reset state for the new graph
      setSelectedNode(null);
      setSearchQuery("");
      setFilters({ domains: [], types: [] });
      setRelationFilter(null);
      setLayoutMode(config?.defaultLayout || "force");
      setRadialCenter(sg.nodes[0]?.id || "");

      updateUrlParam("subgraph", subgraphKey);
      updateUrlParam("node", null);
      updateUrlParam("layout", config?.defaultLayout || null);
      updateUrlParam("relation", null);
      updateUrlParam("center", null);
    },
    [subgraphs, selectedNode],
  );

  const handleNavigateToLevel = useCallback(
    (index: number) => {
      if (index >= graphStack.length - 1) return;

      setGraphStack((prev) => prev.slice(0, index + 1));
      setSelectedNode(null);
      setSearchQuery("");
      setFilters({ domains: [], types: [] });
      setRelationFilter(null);
      setLayoutMode("force");
      setRadialCenter("personal/curiosity");

      const level = graphStack[index];
      updateUrlParam("subgraph", level.subgraphKey);
      updateUrlParam("node", null);
      updateUrlParam("layout", null);
      updateUrlParam("relation", null);
      updateUrlParam("center", null);
    },
    [graphStack],
  );

  // Check URL for initial state
  useState(() => {
    if (typeof window !== "undefined") {
      const params = readUrlParams();

      // Handle subgraph deep link
      if (params.subgraph && subgraphs[params.subgraph]) {
        const sg = subgraphs[params.subgraph];
        const parentNode = nodes.find((n) => n.subgraph === params.subgraph);
        const config = SUBGRAPH_CONFIGS[params.subgraph];
        setGraphStack([
          { nodes, edges, label: "Brain", subgraphKey: null },
          {
            nodes: sg.nodes,
            edges: sg.edges,
            label: parentNode?.label || params.subgraph.replace(".json", ""),
            subgraphKey: params.subgraph,
          },
        ]);
        if (config?.defaultLayout) setLayoutMode(config.defaultLayout);
        if (sg.nodes[0]) setRadialCenter(sg.nodes[0].id);

        // Find node within subgraph
        if (params.node) {
          const node = sg.nodes.find((n) => n.id === params.node);
          if (node) setSelectedNode(node);
        }
      } else {
        if (params.node) {
          const node = nodes.find((n) => n.id === params.node);
          if (node) setSelectedNode(node);
        }
      }

      if (params.layout) setLayoutMode(params.layout);
      if (params.relation) setRelationFilter(params.relation);
      if (params.center) setRadialCenter(params.center);
    }
  });

  // Unique key forces GraphCanvas remount when switching graphs
  const graphKey = graphStack.map((l) => l.subgraphKey || "root").join("/");

  return (
    <div class="brain-container">
      {/* Graph canvas (fills viewport) */}
      <GraphCanvas
        key={graphKey}
        nodes={currentGraph.nodes}
        edges={currentGraph.edges}
        onNodeSelect={handleNodeSelect}
        selectedNodeId={selectedNode?.id || null}
        searchQuery={searchQuery}
        viewMode={viewMode}
        filters={filters}
        layoutMode={layoutMode}
        relationFilter={relationFilter}
        radialCenter={radialCenter}
        domainColors={domainColors}
      />

      {/* Floating controls */}
      <GraphControls
        nodes={currentGraph.nodes}
        edges={currentGraph.edges}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filters={filters}
        onFiltersChange={setFilters}
        onNodeSelect={handleSearchSelect}
        layoutMode={layoutMode}
        onLayoutChange={handleLayoutChange}
        relationFilter={relationFilter}
        onRelationFilterChange={handleRelationFilterChange}
        radialCenter={radialCenter}
        graphStack={graphStack}
        onNavigateToLevel={handleNavigateToLevel}
        domainColors={domainColors}
      />

      {/* Detail panel */}
      <DetailPanel
        node={selectedNode}
        edges={currentGraph.edges}
        nodes={currentGraph.nodes}
        onClose={() => handleNodeSelect(null)}
        onNavigate={handleNavigate}
        onDrillDown={handleDrillDown}
        domainColors={domainColors}
      />

      {/* Node count */}
      <div class="brain-stats">
        {currentGraph.nodes.length} nodes · {currentGraph.edges.length} edges
      </div>
    </div>
  );
};

export default BrainApp;
