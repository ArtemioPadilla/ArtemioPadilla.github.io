import { useEffect, useRef } from "preact/hooks";
import type { FunctionalComponent } from "preact";
import type { KnowledgeNode, KnowledgeEdge } from "../../types/knowledge";
import { DOMAIN_COLORS, getNodeDomain } from "../../types/knowledge";

interface Props {
  node: KnowledgeNode | null;
  edges: KnowledgeEdge[];
  nodes: KnowledgeNode[];
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
}

const TYPE_BADGES: Record<string, string> = {
  domain: "Domain",
  topic: "Topic",
  concept: "Concept",
  claim: "Claim",
  source: "Source",
};

const RELATION_LABELS: Record<string, string> = {
  "is-part-of": "Part of",
  "relates-to": "Related to",
  causes: "Causes",
  contradicts: "Contradicts",
  supports: "Supports",
  "inspired-by": "Inspired by",
  "applies-to": "Applies to",
  generalizes: "Generalizes",
  specializes: "Specializes",
  "analogous-to": "Analogous to",
};

const DetailPanel: FunctionalComponent<Props> = ({
  node,
  edges,
  nodes,
  onClose,
  onNavigate,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!node) return null;

  const domain = getNodeDomain(node.id);
  const domainColor = DOMAIN_COLORS[domain] || "#888888";

  // Find connected edges and nodes
  const connectedEdges = edges.filter(
    (e) => e.source === node.id || e.target === node.id,
  );

  const connections = connectedEdges.map((edge) => {
    const isSource = edge.source === node.id;
    const otherId = isSource ? edge.target : edge.source;
    const otherNode = nodes.find((n) => n.id === otherId);
    const direction = isSource ? "outgoing" : "incoming";
    return { edge, otherId, otherNode, direction };
  });

  // Group by relation type
  const grouped: Record<string, typeof connections> = {};
  for (const conn of connections) {
    const key = conn.edge.relation;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(conn);
  }

  const pathParts = node.id.split("/");
  const breadcrumb = pathParts.map((part, i) => ({
    label: part.replace(/-/g, " "),
    id: pathParts.slice(0, i + 1).join("/"),
  }));

  const importance = node.metadata?.importance;
  const status = node.metadata?.status;

  return (
    <div
      ref={panelRef}
      class="detail-panel"
      style={{
        "--domain-color": domainColor,
      }}
    >
      {/* Header */}
      <div class="detail-panel-header">
        <button
          onClick={onClose}
          class="detail-panel-close"
          aria-label="Close panel"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Breadcrumb */}
        <div class="detail-breadcrumb">
          {breadcrumb.map((crumb, i) => (
            <span key={crumb.id}>
              {i > 0 && <span class="detail-breadcrumb-sep">/</span>}
              <button
                onClick={() => {
                  const target = nodes.find((n) => n.id === crumb.id);
                  if (target) onNavigate(crumb.id);
                }}
                class="detail-breadcrumb-link"
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        {/* Title */}
        <h2 class="detail-title" style={{ color: domainColor }}>
          {node.label}
        </h2>

        {/* Badges */}
        <div class="detail-badges">
          <span class="detail-badge" style={{ borderColor: domainColor, color: domainColor }}>
            {TYPE_BADGES[node.type]}
          </span>
          {importance && (
            <span class="detail-badge detail-badge-muted">
              {"★".repeat(importance)}
            </span>
          )}
          {status && (
            <span class="detail-badge detail-badge-muted">
              {status}
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      {node.summary && (
        <p class="detail-summary">{node.summary}</p>
      )}

      {/* Content */}
      {node.content && (
        <div class="detail-content">
          {node.content.split("\n\n").map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {/* Tags */}
      {node.tags.length > 0 && (
        <div class="detail-tags">
          {node.tags.map((tag) => (
            <span key={tag} class="detail-tag">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Connections */}
      {Object.keys(grouped).length > 0 && (
        <div class="detail-connections">
          <h3 class="detail-connections-title">Connections</h3>
          {Object.entries(grouped).map(([relation, conns]) => (
            <div key={relation} class="detail-connection-group">
              <span class="detail-relation-label">
                {RELATION_LABELS[relation] || relation}
              </span>
              {conns.map((conn) => (
                <button
                  key={conn.otherId}
                  onClick={() => onNavigate(conn.otherId)}
                  class="detail-connection-node"
                >
                  <span
                    class="detail-connection-dot"
                    style={{
                      backgroundColor: conn.otherNode
                        ? DOMAIN_COLORS[getNodeDomain(conn.otherId)] || "#888"
                        : "#888",
                    }}
                  />
                  <span class="detail-connection-label">
                    {conn.otherNode?.label || conn.otherId}
                  </span>
                  <span class="detail-connection-arrow">
                    {conn.direction === "outgoing" ? "→" : "←"}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Links */}
      {node.links && node.links.length > 0 && (
        <div class="detail-links">
          <h3 class="detail-connections-title">References</h3>
          {node.links.map((link) => (
            <a
              key={link}
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              class="detail-ext-link"
            >
              {new URL(link).hostname}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          ))}
        </div>
      )}

      {/* Full page link */}
      <a href={`/brain/${node.id}`} class="detail-fullpage-link">
        Open full page →
      </a>

      {/* Metadata */}
      {node.metadata?.added && (
        <div class="detail-meta">
          Added {node.metadata.added}
          {node.metadata.updated && ` · Updated ${node.metadata.updated}`}
        </div>
      )}
    </div>
  );
};

export default DetailPanel;
