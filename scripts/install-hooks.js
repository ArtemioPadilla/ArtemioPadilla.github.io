#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const gitDir = path.join(repoRoot, '.git');
const hooksDir = path.join(gitDir, 'hooks');

if (!fs.existsSync(gitDir)) {
  console.error('Not a git repository (no .git directory).');
  process.exit(1);
}
if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir);

const hookPath = path.join(hooksDir, 'pre-commit');
const hookScript = `#!/bin/sh
# Auto-generated pre-commit hook: validate & regenerate cv-data.js if needed

echo "[pre-commit] Validating CV data..."
node scripts/generate-cv-data.js --check 2> .git/hooks/.cv_errors.tmp
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo "[pre-commit] Validation failed:" >&2
  cat .git/hooks/.cv_errors.tmp >&2
  rm -f .git/hooks/.cv_errors.tmp
  echo "[pre-commit] Aborting commit." >&2
  exit 1
fi
rm -f .git/hooks/.cv_errors.tmp

# Regenerate JS file (in case JSON changed)
echo "[pre-commit] Regenerating cv-data.js..."
node scripts/generate-cv-data.js || exit 1

git add data/cv-data.js

echo "[pre-commit] Done."
`;

fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
console.log('Installed pre-commit hook at', hookPath);
