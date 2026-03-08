# PWA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the entire Astro static site a PWA with full offline support, installability, and auto-update.

**Architecture:** Use `@vite-pwa/astro` integration which wraps `vite-plugin-pwa` + Workbox. The plugin hooks into Astro's build to auto-generate a service worker that precaches all static output, plus runtime-caches external resources (Google Fonts, GitHub API). Manifest and SW registration are injected automatically.

**Tech Stack:** @vite-pwa/astro, Workbox (generateSW), Web App Manifest

---

### Task 1: Generate PWA Icons

**Files:**
- Create: `scripts/generate-pwa-icons.ts`
- Create: `public/icons/icon-192x192.png`
- Create: `public/icons/icon-512x512.png`
- Create: `public/icons/icon-512x512-maskable.png`

**Step 1: Create icon generation script**

Uses Node.js canvas-free approach — generates SVGs and converts to PNG via `sharp` (or alternatively, create the SVGs and use a simple script). Since we want to keep it simple, we'll use a standalone Node script with the `canvas` package or just create static SVG files and convert them.

Simplest approach: create the icons as SVGs first, then use `sharp` to convert.

```typescript
// scripts/generate-pwa-icons.ts
import { writeFileSync, mkdirSync, existsSync } from "fs";

const sizes = [
  { name: "icon-192x192.png", size: 192, maskable: false },
  { name: "icon-512x512.png", size: 512, maskable: false },
  { name: "icon-512x512-maskable.png", size: 512, maskable: true },
];

function generateSVG(size: number, maskable: boolean): string {
  const padding = maskable ? size * 0.1 : 0;
  const circleR = size / 2 - padding;
  const cx = size / 2;
  const cy = size / 2;
  const fontSize = size * 0.35;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${maskable ? `<rect width="${size}" height="${size}" fill="#09090b"/>` : ""}
  <circle cx="${cx}" cy="${cy}" r="${circleR}" fill="#09090b"/>
  <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
    font-family="'Inter', 'Helvetica Neue', Arial, sans-serif"
    font-weight="700" font-size="${fontSize}" fill="#4f8ff7">AP</text>
</svg>`;
}

const dir = "public/icons";
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

for (const { name, size, maskable } of sizes) {
  const svgName = name.replace(".png", ".svg");
  writeFileSync(`${dir}/${svgName}`, generateSVG(size, maskable));
  console.log(`Generated ${dir}/${svgName}`);
}

console.log("\nSVG icons generated. Convert to PNG with:");
console.log("  npx sharp-cli -i public/icons/icon-192x192.svg -o public/icons/icon-192x192.png resize 192 192");
console.log("  npx sharp-cli -i public/icons/icon-512x512.svg -o public/icons/icon-512x512.png resize 512 512");
console.log("  npx sharp-cli -i public/icons/icon-512x512-maskable.svg -o public/icons/icon-512x512-maskable.png resize 512 512");
```

**Step 2: Run the script and convert SVGs to PNGs**

```bash
npx tsx scripts/generate-pwa-icons.ts
npx sharp-cli -i public/icons/icon-192x192.svg -o public/icons/icon-192x192.png resize 192 192
npx sharp-cli -i public/icons/icon-512x512.svg -o public/icons/icon-512x512.png resize 512 512
npx sharp-cli -i public/icons/icon-512x512-maskable.svg -o public/icons/icon-512x512-maskable.png resize 512 512
```

Expected: 3 PNG files in `public/icons/`

**Step 3: Add apple-touch-icon (180x180)**

```bash
npx sharp-cli -i public/icons/icon-512x512.svg -o public/icons/apple-touch-icon-180x180.png resize 180 180
```

**Step 4: Commit**

```bash
git add public/icons/ scripts/generate-pwa-icons.ts
git commit -m "feat: add PWA icon assets"
```

---

### Task 2: Install @vite-pwa/astro and configure

**Files:**
- Modify: `package.json`
- Modify: `astro.config.mjs`

**Step 1: Install the package**

```bash
npm install -D @vite-pwa/astro
```

**Step 2: Update astro.config.mjs**

Replace the entire file with:

```javascript
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";
import AstroPWA from "@vite-pwa/astro";

export default defineConfig({
  site: "https://artemiopadilla.github.io",
  output: "static",
  integrations: [
    preact(),
    sitemap(),
    AstroPWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Artemio Padilla",
        short_name: "AP",
        description: "Artemio Padilla — Deep Learning Architect. From atomic force microscopy to neural networks.",
        theme_color: "#09090b",
        background_color: "#09090b",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-512x512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/api\.github\.com\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "github-api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  markdown: {
    shikiConfig: {
      themes: {
        dark: "github-dark-dimmed",
        light: "github-light",
      },
    },
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["jspdf", "fuse.js"],
    },
  },
});
```

**Step 3: Verify build works**

```bash
npm run build
```

Expected: Build succeeds, `dist/` contains `manifest.webmanifest` and `sw.js`.

**Step 4: Commit**

```bash
git add package.json package-lock.json astro.config.mjs
git commit -m "feat: add @vite-pwa/astro with full offline caching"
```

---

### Task 3: Update BaseLayout with PWA meta tags

**Files:**
- Modify: `src/components/layout/BaseLayout.astro`

**Step 1: Add PWA meta tags to the `<head>`**

After the existing `<link rel="icon">` line (line 48), add:

```html
<!-- PWA -->
<meta name="theme-color" content="#09090b" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon-180x180.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

Also add `crossorigin="anonymous"` to the Google Fonts stylesheet links for proper SW caching.

Change line 68 from:
```html
<link href="https://fonts.googleapis.com/css2?..." rel="stylesheet" media="print" onload="this.media='all'" />
```
To:
```html
<link href="https://fonts.googleapis.com/css2?..." rel="stylesheet" crossorigin="anonymous" media="print" onload="this.media='all'" />
```

And the noscript fallback (line 75) similarly gets `crossorigin="anonymous"`.

**Step 2: Verify build works**

```bash
npm run build
```

Expected: Build succeeds, `dist/index.html` contains theme-color and apple-touch-icon meta tags.

**Step 3: Commit**

```bash
git add src/components/layout/BaseLayout.astro
git commit -m "feat: add PWA meta tags and Apple touch icon to BaseLayout"
```

---

### Task 4: Test the PWA locally

**Step 1: Build and preview**

```bash
npm run build && npm run preview
```

**Step 2: Verify in browser**

Open `http://localhost:4321` and check:
- DevTools > Application > Manifest shows correct name, icons, colors
- DevTools > Application > Service Workers shows active SW
- DevTools > Application > Cache Storage shows precached assets
- Lighthouse PWA audit passes (DevTools > Lighthouse > check "Progressive Web App")
- Install prompt appears in browser (Chrome address bar install icon)

**Step 3: Test offline**

- In DevTools > Network, check "Offline"
- Reload the page — should still work
- Navigate to /cv, /blog, /lab — all should load from cache

**Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: PWA adjustments from local testing"
```

---

### Task 5: Clean up

**Step 1: Remove icon generation script (optional)**

The script was a one-time tool. Keep it if you want to regenerate icons later, or remove:

```bash
# Optional: remove if not needed
# rm scripts/generate-pwa-icons.ts
```

**Step 2: Delete intermediate SVG files**

```bash
rm public/icons/*.svg
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: clean up PWA icon generation artifacts"
```
