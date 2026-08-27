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
      // Without this, @vite-pwa/astro's manifest transform strips precache
      // keys down to a bare directory name with no trailing slash (e.g.
      // "lab" instead of "lab/" or "lab/index.html"). Workbox's own
      // generateURLVariations() never produces that exact bare-no-slash
      // candidate for a real request to /lab/ — its directoryIndex logic
      // only appends "index.html" when the URL already ends in "/". The
      // net effect: precache matching for every one of this site's own
      // pages has silently never worked for real navigations; it only
      // ever "worked" online because a browser navigation that misses the
      // SW's routes falls through to a real network fetch, which happens
      // to succeed when online. This flag emits additional precache
      // entries in the trailing-slash/index.html shapes Workbox actually
      // matches against, fixing precache matching for real — verified
      // against the sibling resident-evil-4-guide repo, which already
      // uses this flag and (unlike this site, until now) genuinely serves
      // its own pages from cache when offline.
      experimental: { directoryAndTrailingSlashHandler: true },
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
        screenshots: [
          {
            src: "screenshots/desktop.png",
            sizes: "1920x1080",
            type: "image/png",
            form_factor: "wide",
            label: "Home — Artemio Padilla",
          },
          {
            src: "screenshots/mobile.png",
            sizes: "375x667",
            type: "image/png",
            form_factor: "narrow",
            label: "Home — Artemio Padilla",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // mexico-weather-site is the only sibling app actually vendored into this
        // repo's own public/ dir (checked into git, built into this site's own
        // dist/) — everything else (watchboard, finsight-ai, the game guides, and
        // any future addition) lives in a completely separate repo/deployment and
        // was never a candidate for this glob in the first place.
        globIgnores: ["**/mexico-weather-site/**"],
        // navigateFallback (a vite-plugin-pwa default of "index.html" when this
        // key is left unset — verified in node_modules/vite-plugin-pwa) makes
        // workbox register a NavigationRoute that unconditionally serves that
        // one fallback page for EVERY navigation request matching its allowlist,
        // even when a real precache entry already exists for the exact URL
        // requested (verified directly: with a fallback active, fetch('/lab/')
        // through the SW correctly returns the Lab page, but an actual browser
        // navigation to /lab/ returns the homepage instead — NavigationRoute
        // takes priority over the precache match for navigation-mode requests).
        // That's the SPA-shell pattern, and it's wrong for this site: every
        // route here is a real static page, not client-routed, so there is no
        // shell to fall back to — every internal page already has its own
        // precached HTML served correctly by the default precache route, and
        // an unrecognized path (a sibling app under this domain, present or
        // future, or a genuine typo) should just hit the network normally
        // instead of being silently replaced by the homepage. Setting this to
        // `undefined` (not simply omitting the key) is required to override
        // vite-plugin-pwa's own default via its `Object.assign(default, user)`
        // merge — omitting it would leave the "index.html" default in place.
        navigateFallback: void 0,
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
