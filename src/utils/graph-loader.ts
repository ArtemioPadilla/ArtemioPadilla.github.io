import Ajv from "ajv";
import addFormats from "ajv-formats";
import graphData from "../content/knowledge/graph.json";
import graphSchema from "../content/knowledge/graph-schema.json";
import type { KnowledgeGraph } from "../types/knowledge";

let cachedData: KnowledgeGraph | null = null;

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
