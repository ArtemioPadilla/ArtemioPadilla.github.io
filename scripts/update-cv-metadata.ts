import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, "..");
const dataPath = join(root, "src", "content", "cv", "cv-data.json");

function main() {
  const data = JSON.parse(readFileSync(dataPath, "utf-8"));

  // Update lastUpdated
  const today = new Date().toISOString().split("T")[0];
  data.metadata.lastUpdated = today;

  // Bump patch version
  const parts = data.metadata.version.split(".");
  parts[2] = String(parseInt(parts[2], 10) + 1);
  data.metadata.version = parts.join(".");

  writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");

  console.log(`Updated version to ${data.metadata.version}`);
  console.log(`Updated lastUpdated to ${data.metadata.lastUpdated}`);
}

main();
