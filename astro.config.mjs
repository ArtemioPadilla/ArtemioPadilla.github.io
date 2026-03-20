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
        navigateFallbackDenylist: [/^\/watchboard/],
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
