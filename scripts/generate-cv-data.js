#!/usr/bin/env node
/**
 * Generates data/cv-data.js from data/cv-data.json after validating against data/cv-schema.json.
 * Usage:
 *   node scripts/generate-cv-data.js        # validate & write JS file
 *   node scripts/generate-cv-data.js --check  # validate only (CI)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const jsonPath = path.join(dataDir, 'cv-data.json');
const schemaPath = path.join(dataDir, 'cv-schema.json');
const jsOutPath = path.join(dataDir, 'cv-data.js');

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function validate(data, schema) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFn = ajv.compile(schema);
  const ok = validateFn(data);
  if (!ok) {
    const msgs = validateFn.errors.map(e => `${e.instancePath || '(root)'} ${e.message}`);
    throw new Error('CV data validation failed:\n' + msgs.join('\n'));
  }
}

function generate(jsData) {
  const banner = '// CV Data for direct file:// access (auto-generated from cv-data.json)\n';
  const body = 'window.cvData = ' + JSON.stringify(jsData, null, 2) + ';\n';
  return banner + body;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const data = loadJSON(jsonPath);
  const schema = loadJSON(schemaPath);
  validate(data, schema);
  if (checkOnly) {
    console.log('CV data valid.');
    return;
  }
  const output = generate(data);
  fs.writeFileSync(jsOutPath, output, 'utf8');
  console.log('Generated', path.relative(root, jsOutPath));
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
