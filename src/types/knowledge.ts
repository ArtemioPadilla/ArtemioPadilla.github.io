export type NodeType = "domain" | "topic" | "concept" | "claim" | "source";

export type LayoutMode = "force" | "hierarchy" | "radial" | "cluster";

export type EdgeRelation =
  | "is-part-of"
  | "relates-to"
  | "causes"
  | "contradicts"
  | "supports"
  | "inspired-by"
  | "applies-to"
  | "generalizes"
  | "specializes"
  | "analogous-to";

export interface KnowledgeNode {
  id: string;
  label: string;
  type: NodeType;
  content?: string;
  summary?: string;
  tags: string[];
  links?: string[];
  subgraph?: string;
  metadata?: {
    added: string;
    updated?: string;
    importance?: 1 | 2 | 3;
    status?: "seed" | "growing" | "mature";
  };
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  relation: EdgeRelation;
  label?: string;
  weight?: number;
}

export interface KnowledgeGraph {
  version: string;
  lastUpdated: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export const DOMAIN_COLORS: Record<string, string> = {
  science: "#4f8ff7",
  philosophy: "#a78bfa",
  technology: "#34d399",
  society: "#f59e0b",
  "art-culture": "#ec4899",
  personal: "#f97316",
  mathematics: "#06b6d4",
};

export interface SubgraphConfig {
  domainColors: Record<string, string>;
  defaultLayout?: LayoutMode;
}

export const SUBGRAPH_CONFIGS: Record<string, SubgraphConfig> = {
  "world-religions.json": {
    domainColors: {
      "middle-east": "#f59e0b",
      "south-asia": "#34d399",
      "east-asia": "#4f8ff7",
      "europe": "#a78bfa",
      "africa": "#ec4899",
      "americas": "#f97316",
      "global": "#06b6d4",
      "iran": "#f43f5e",
    },
    defaultLayout: "hierarchy",
  },
  "programming-languages.json": {
    domainColors: {
      "imperative": "#ef4444",
      "functional": "#a78bfa",
      "object-oriented": "#4f8ff7",
      "scripting": "#f59e0b",
      "systems": "#64748b",
      "logic-declarative": "#22c55e",
      "markup-data": "#06b6d4",
      "modern": "#ec4899",
    },
    defaultLayout: "hierarchy",
  },
  "philosophy-history.json": {
    domainColors: {
      "ancient": "#f59e0b",
      "medieval": "#94a3b8",
      "modern": "#4f8ff7",
      "contemporary": "#34d399",
      "eastern": "#ec4899",
      "analytic": "#a78bfa",
      "continental": "#f97316",
    },
    defaultLayout: "hierarchy",
  },
  "ai-ml-family.json": {
    domainColors: {
      "symbolic": "#f59e0b",
      "connectionist": "#4f8ff7",
      "probabilistic": "#a78bfa",
      "evolutionary": "#22c55e",
      "reinforcement": "#ef4444",
      "generative": "#ec4899",
      "applied": "#06b6d4",
      "foundations": "#94a3b8",
    },
    defaultLayout: "hierarchy",
  },
  "economic-schools.json": {
    domainColors: {
      "classical": "#f59e0b",
      "keynesian": "#4f8ff7",
      "austrian": "#ef4444",
      "marxian": "#dc2626",
      "institutional": "#22c55e",
      "neoclassical": "#a78bfa",
      "heterodox": "#ec4899",
      "modern": "#06b6d4",
    },
    defaultLayout: "force",
  },
  "musical-genres.json": {
    domainColors: {
      "african-roots": "#f59e0b",
      "classical-western": "#a78bfa",
      "rock": "#ef4444",
      "electronic": "#06b6d4",
      "hip-hop": "#f97316",
      "jazz-blues": "#4f8ff7",
      "latin": "#22c55e",
      "world": "#ec4899",
    },
    defaultLayout: "force",
  },
};

export function getNodeDomain(id: string): string {
  return id.split("/")[0];
}

export function getParentId(id: string): string | null {
  const parts = id.split("/");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join("/");
}

export function getNodeDepth(id: string): number {
  return id.split("/").length - 1;
}
