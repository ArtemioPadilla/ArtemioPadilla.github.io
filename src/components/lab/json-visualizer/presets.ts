/* ──────────────────────────────────────
   Preset JSON examples
   ────────────────────────────────────── */

export interface Preset {
  label: string;
  json: string;
}

const API_RESPONSE = {
  status: "success",
  data: {
    users: [
      { id: 1, name: "Alice Chen", email: "alice@example.com", role: "admin", active: true },
      { id: 2, name: "Bob Smith", email: "bob@example.com", role: "editor", active: true },
      { id: 3, name: "Carol Jones", email: "carol@example.com", role: "viewer", active: false },
    ],
    pagination: { page: 1, perPage: 25, total: 3, totalPages: 1 },
  },
  meta: { requestId: "req_abc123", timestamp: "2026-03-05T12:00:00Z", version: "2.1.0" },
};

const GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-122.4194, 37.7749] },
      properties: { name: "San Francisco", population: 873965, country: "US" },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [2.3522, 48.8566] },
      properties: { name: "Paris", population: 2161000, country: "FR" },
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[-73.97, 40.77], [-73.97, 40.73], [-73.94, 40.73], [-73.94, 40.77], [-73.97, 40.77]]],
      },
      properties: { name: "Central Park", area_km2: 3.41 },
    },
  ],
};

const PACKAGE_JSON = {
  name: "my-awesome-app",
  version: "3.2.1",
  description: "A full-stack application with modern tooling",
  main: "dist/index.js",
  scripts: {
    dev: "vite",
    build: "tsc && vite build",
    test: "vitest",
    lint: "eslint src/",
    format: "prettier --write src/",
  },
  dependencies: {
    preact: "^10.19.0",
    "preact-hooks": "^0.4.1",
    zod: "^3.22.0",
  },
  devDependencies: {
    typescript: "^5.3.0",
    vite: "^5.0.0",
    vitest: "^1.0.0",
    eslint: "^8.56.0",
    prettier: "^3.2.0",
  },
  engines: { node: ">=18.0.0" },
  license: "MIT",
  repository: { type: "git", url: "https://github.com/user/my-awesome-app" },
};

const DEEPLY_NESTED = {
  level1: {
    level2: {
      level3: {
        level4: {
          level5: {
            value: "deep!",
            siblings: ["a", "b", "c"],
            metadata: { created: "2026-01-01", tags: ["nested", "deep", "example"] },
          },
        },
        otherBranch: { items: [1, 2, 3], active: true },
      },
    },
    config: { theme: "dark", language: "en", features: { beta: true, experimental: false } },
  },
};

const LARGE_ARRAY = {
  dataset: "Sensor Readings",
  unit: "celsius",
  readings: Array.from({ length: 30 }, (_, i) => ({
    timestamp: `2026-03-05T${String(i).padStart(2, "0")}:00:00Z`,
    value: +(20 + Math.sin(i / 3) * 5).toFixed(2),
    quality: i % 7 === 0 ? "warning" : "ok",
  })),
  summary: { min: 15.0, max: 25.0, avg: 20.0, count: 30 },
};

export const PRESETS: Preset[] = [
  { label: "API Response", json: JSON.stringify(API_RESPONSE, null, 2) },
  { label: "GeoJSON", json: JSON.stringify(GEOJSON, null, 2) },
  { label: "package.json", json: JSON.stringify(PACKAGE_JSON, null, 2) },
  { label: "Deeply Nested", json: JSON.stringify(DEEPLY_NESTED, null, 2) },
  { label: "Large Array", json: JSON.stringify(LARGE_ARRAY, null, 2) },
];
