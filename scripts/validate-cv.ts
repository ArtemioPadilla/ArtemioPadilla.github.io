import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..");

function main() {
  const dataPath = join(root, "src", "content", "cv", "cv-data.json");
  const schemaPath = join(root, "src", "content", "cv", "cv-schema.json");

  const data = JSON.parse(readFileSync(dataPath, "utf-8"));
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (!valid) {
    console.error("CV data validation FAILED:");
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || "(root)"} ${err.message}`);
    }
    process.exit(1);
  }

  console.log("CV data validation passed.");

  if (!process.argv.includes("--check")) {
    console.log("(No generation step needed — Astro imports JSON directly)");
  }
}

main();
