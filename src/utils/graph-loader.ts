import Ajv from "ajv";
import addFormats from "ajv-formats";
import graphData from "../content/knowledge/graph.json";
import graphSchema from "../content/knowledge/graph-schema.json";
import type { KnowledgeGraph } from "../types/knowledge";

let cachedData: KnowledgeGraph | null = null;
let cachedSubgraphs: Record<string, KnowledgeGraph> | null = null;

export function loadAndValidateGraph(): KnowledgeGraph {
  if (cachedData) return cachedData;

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(graphSchema);
  const valid = validate(graphData);

  if (!valid) {
    const errors = validate.errors?.map(
      (e) => `  ${e.instancePath || "(root)"} ${e.message}`,
    );
    throw new Error(
      `Knowledge graph validation failed:\n${errors?.join("\n") ?? "Unknown error"}`,
    );
  }

  cachedData = graphData as KnowledgeGraph;
  return cachedData;
}

export function loadAndValidateSubgraphs(): Record<string, KnowledgeGraph> {
  if (cachedSubgraphs) return cachedSubgraphs;

  const modules = import.meta.glob(
    "../content/knowledge/subgraphs/*.json",
    { eager: true },
  );
  const subgraphs: Record<string, KnowledgeGraph> = {};

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(graphSchema);

  for (const [path, mod] of Object.entries(modules)) {
    const filename = path.split("/").pop()!;
    const data = (mod as any).default || mod;

    if (!validate(data)) {
      const errors = validate.errors?.map(
        (e) => `  ${e.instancePath || "(root)"} ${e.message}`,
      );
      throw new Error(
        `Subgraph ${filename} validation failed:\n${errors?.join("\n") ?? "Unknown error"}`,
      );
    }
    subgraphs[filename] = data as KnowledgeGraph;
  }

  cachedSubgraphs = subgraphs;
  return cachedSubgraphs;
}
