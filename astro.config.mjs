import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://artemiopadilla.github.io",
  output: "static",
  integrations: [preact(), sitemap()],
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
