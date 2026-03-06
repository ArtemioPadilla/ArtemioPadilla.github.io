import { useState, useCallback } from "preact/hooks";
import type { FunctionalComponent } from "preact";
import type { KnowledgeNode, KnowledgeEdge } from "../../types/knowledge";
import GraphCanvas from "./GraphCanvas";
import DetailPanel from "./DetailPanel";
import GraphControls from "./GraphControls";

interface Props {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

const BrainApp: FunctionalComponent<Props> = ({ nodes, edges }) => {
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<{ domains: string[]; types: string[] }>({
    domains: [],
    types: [],
  });

  const handleNodeSelect = useCallback(
    (node: KnowledgeNode | null) => {
      setSelectedNode(node);
      // Update URL without navigation
      if (node) {
        const url = new URL(window.location.href);
        url.searchParams.set("node", node.id);
        window.history.replaceState({}, "", url.toString());
      } else {
        const url = new URL(window.location.href);
        url.searchParams.delete("node");
        window.history.replaceState({}, "", url.toString());
      }
    },
    [],
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

  // Check URL for initial node selection
  useState(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const nodeId = params.get("node");
      if (nodeId) {
        const node = nodes.find((n) => n.id === nodeId);
        if (node) setSelectedNode(node);
      }
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
      />

      {/* Floating controls */}
      <GraphControls
        nodes={nodes}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filters={filters}
        onFiltersChange={setFilters}
        onNodeSelect={handleSearchSelect}
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
