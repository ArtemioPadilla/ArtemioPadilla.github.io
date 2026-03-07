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
