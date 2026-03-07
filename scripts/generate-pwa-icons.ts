/**
 * Generate PWA icon assets from SVG templates.
 *
 * Produces four PNG files in public/icons/:
 *   - icon-192x192.png          (standard)
 *   - icon-512x512.png          (standard)
 *   - icon-512x512-maskable.png (maskable, full-bleed background)
 *   - apple-touch-icon-180x180.png
 *
 * Run: npx tsx scripts/generate-pwa-icons.ts
 */

import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "icons");

const BG_COLOR = "#09090b";
const TEXT_COLOR = "#4f8ff7";
const FONT_FAMILY = "Inter, system-ui, -apple-system, sans-serif";

// ---------------------------------------------------------------------------
// SVG generators
// ---------------------------------------------------------------------------

function buildStandardSvg(size: number): string {
  const circleRadius = size * 0.44;
  const center = size / 2;
  const fontSize = size * 0.36;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${center}" cy="${center}" r="${circleRadius}" fill="${BG_COLOR}" />
  <text
    x="${center}"
    y="${center}"
    dy="0.35em"
    text-anchor="middle"
    font-family="${FONT_FAMILY}"
    font-weight="700"
    font-size="${fontSize}"
    fill="${TEXT_COLOR}"
  >AP</text>
</svg>`;
}

function buildMaskableSvg(size: number): string {
  // Maskable icons must fill the entire square.
  // Safe zone is the inner 80%, so the circle lives within that.
  const center = size / 2;
  const safeRadius = size * 0.4 * 0.88; // circle within safe zone
  const fontSize = size * 0.28;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG_COLOR}" />
  <circle cx="${center}" cy="${center}" r="${safeRadius}" fill="${BG_COLOR}" stroke="${TEXT_COLOR}" stroke-width="${size * 0.005}" stroke-opacity="0.15" />
  <text
    x="${center}"
    y="${center}"
    dy="0.35em"
    text-anchor="middle"
    font-family="${FONT_FAMILY}"
    font-weight="700"
    font-size="${fontSize}"
    fill="${TEXT_COLOR}"
  >AP</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Icon definitions
// ---------------------------------------------------------------------------

interface IconSpec {
  filename: string;
  size: number;
  svg: string;
}

function buildIconSpecs(): IconSpec[] {
  return [
    {
      filename: "icon-192x192.png",
      size: 192,
      svg: buildStandardSvg(192),
    },
    {
      filename: "icon-512x512.png",
      size: 512,
      svg: buildStandardSvg(512),
    },
    {
      filename: "icon-512x512-maskable.png",
      size: 512,
      svg: buildMaskableSvg(512),
    },
    {
      filename: "apple-touch-icon-180x180.png",
      size: 180,
      svg: buildStandardSvg(180),
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
  }

  const specs = buildIconSpecs();

  for (const spec of specs) {
    const outPath = join(OUT_DIR, spec.filename);
    const svgBuffer = Buffer.from(spec.svg);

    await sharp(svgBuffer)
      .resize(spec.size, spec.size)
      .png()
      .toFile(outPath);

    console.log(`  Created ${spec.filename} (${spec.size}x${spec.size})`);
  }

  console.log(`\nAll ${specs.length} icons written to public/icons/`);
}

main().catch((err: unknown) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
