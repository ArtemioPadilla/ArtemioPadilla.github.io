import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..");

interface GraphNode {
  id: string;
  label: string;
  type: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function validateReferentialIntegrity(data: GraphData): string[] {
  const nodeIds = new Set(data.nodes.map((n) => n.id));
  const errors: string[] = [];

  for (let i = 0; i < data.edges.length; i++) {
    const edge = data.edges[i];
    if (!nodeIds.has(edge.source)) {
      errors.push(
        `  Edge[${i}]: source "${edge.source}" does not reference an existing node`,
      );
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(
        `  Edge[${i}]: target "${edge.target}" does not reference an existing node`,
      );
    }
  }

  const duplicateIds = data.nodes
    .map((n) => n.id)
    .filter((id, idx, arr) => arr.indexOf(id) !== idx);
  for (const id of new Set(duplicateIds)) {
    errors.push(`  Duplicate node ID: "${id}"`);
  }

  return errors;
}

function main() {
  const dataPath = join(root, "src", "content", "knowledge", "graph.json");
  const schemaPath = join(
    root,
    "src",
    "content",
    "knowledge",
    "graph-schema.json",
  );

  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (!valid) {
    console.error("Knowledge graph schema validation FAILED:");
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || "(root)"} ${err.message}`);
    }
    process.exit(1);
  }

  console.log("Schema validation passed.");

  const integrityErrors = validateReferentialIntegrity(data as GraphData);
  if (integrityErrors.length > 0) {
    console.error("Referential integrity check FAILED:");
    for (const err of integrityErrors) {
      console.error(err);
    }
    process.exit(1);
  }

  console.log("Referential integrity check passed.");
  console.log(
    `Graph: ${data.nodes.length} nodes, ${data.edges.length} edges, version ${data.version}`,
  );
}

main();
