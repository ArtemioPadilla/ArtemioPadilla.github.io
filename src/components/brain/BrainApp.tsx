import { useState, useCallback } from "preact/hooks";
import type { FunctionalComponent } from "preact";
import type { KnowledgeNode, KnowledgeEdge, LayoutMode, EdgeRelation } from "../../types/knowledge";
import GraphCanvas from "./GraphCanvas";
import DetailPanel from "./DetailPanel";
import GraphControls from "./GraphControls";

interface Props {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

function readUrlParams() {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  return {
    node: params.get("node"),
    layout: params.get("layout") as LayoutMode | null,
    relation: params.get("relation") as EdgeRelation | null,
    center: params.get("center"),
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

const BrainApp: FunctionalComponent<Props> = ({ nodes, edges }) => {
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
      const node = nodes.find((n) => n.id === nodeId);
      if (node) handleNodeSelect(node);
    },
    [nodes, handleNodeSelect],
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

  // Check URL for initial state
  useState(() => {
    if (typeof window !== "undefined") {
      const params = readUrlParams();
      if (params.node) {
        const node = nodes.find((n) => n.id === params.node);
        if (node) setSelectedNode(node);
      }
      if (params.layout) setLayoutMode(params.layout);
      if (params.relation) setRelationFilter(params.relation);
      if (params.center) setRadialCenter(params.center);
    }
  });

  return (
    <div class="brain-container">
      {/* Graph canvas (fills viewport) */}
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        onNodeSelect={handleNodeSelect}
        selectedNodeId={selectedNode?.id || null}
        searchQuery={searchQuery}
        viewMode={viewMode}
        filters={filters}
        layoutMode={layoutMode}
        relationFilter={relationFilter}
        radialCenter={radialCenter}
      />

      {/* Floating controls */}
      <GraphControls
        nodes={nodes}
        edges={edges}
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
      />

      {/* Detail panel */}
      <DetailPanel
        node={selectedNode}
        edges={edges}
        nodes={nodes}
        onClose={() => handleNodeSelect(null)}
        onNavigate={handleNavigate}
      />

      {/* Node count */}
      <div class="brain-stats">
        {nodes.length} nodes · {edges.length} edges
      </div>
    </div>
  );
};

export default BrainApp;
