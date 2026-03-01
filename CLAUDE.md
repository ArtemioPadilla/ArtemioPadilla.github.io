# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Artemio Padilla's personal portfolio website built with **Astro 5 + TypeScript + Tailwind CSS v4**. Deployed to GitHub Pages via GitHub Actions.

## Architecture

### Tech Stack
- **Framework**: Astro 5 (static output, zero JS by default)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4 with `@theme` CSS custom properties
- **Interactive Islands**: Preact (PDF generation, clipboard, vCard, particles, typed.js)
- **PDF Generation**: jsPDF (dynamically imported, client-side only)
- **Validation**: Ajv + ajv-formats (JSON Schema, build-time)
- **Deployment**: GitHub Pages via GitHub Actions

### Pages
- `/` — Home page with hero, about, featured projects, contact (content from `src/data/site-data.ts`)
- `/cv` — Full CV rendered from JSON data at build time (12 Astro components, zero client JS for content)
- `/links` — Link hub with particles background, typed.js tagline, social icons, external links
- `/404` — Custom 404 page with glitch animation

### CV Data Pipeline
1. **Source of Truth**: `src/content/cv/cv-data.json`
2. **Schema Validation**: `src/content/cv/cv-schema.json` (JSON Schema draft-07)
3. **Build-time Loading**: `src/utils/cv-loader.ts` validates with Ajv and returns typed `CVData`
4. **Static Rendering**: 12 Astro components render CV sections as pre-built HTML
5. **PDF Export**: `src/utils/pdf-generator.ts` generates 3 formats (full/resume/summary) client-side
6. **Build fails** if CV data doesn't validate — no invalid data can be deployed

### Project Structure
```
src/
├── content/cv/           # CV JSON data + schema (source of truth)
├── types/cv.ts           # TypeScript interfaces for all CV data
├── utils/                # cv-loader, date-formatter, text-sanitizer, pdf-generator
├── components/
│   ├── layout/           # BaseLayout, Navigation, Footer, ThemeToggle
│   ├── home/             # Hero, About, ProjectCard, Contact
│   ├── cv/               # 12 section components + CvLayout + SocialIcons
│   ├── cv-interactive/   # Preact islands (PdfDownloader, CopyToClipboard, VCardDownload)
│   └── links/            # ParticlesBackground.tsx, TypedTagline.tsx
├── pages/                # index, cv, links, 404
├── data/site-data.ts     # Home page content (separate from CV)
└── styles/global.css     # Tailwind v4 @theme + dark/light mode + global styles
scripts/
├── validate-cv.ts        # Ajv validation script (run via npm run validate:cv)
└── update-cv-metadata.ts # Version bumping for CV releases
.github/workflows/
├── deploy.yml            # Build + deploy to GitHub Pages
└── cv-data.yml           # Validate CV data on push/PR
```

## Development Commands

```bash
npm run dev              # Start dev server (http://localhost:4321)
npm run build            # Validate CV + build static site to dist/
npm run preview          # Preview built site locally
npm run validate:cv      # Validate cv-data.json against schema
npm run format:cv        # Format cv-data.json with Prettier
npm run prepare:cv-release  # Bump version + update lastUpdated
```

## Theming / Dark & Light Mode

- **Dark mode is default**. Light mode toggled via `html.light` class (persisted in localStorage)
- All colors use CSS custom properties defined in `src/styles/global.css` under `@theme`
- Light mode overrides ALL semantic variables in an `html.light {}` block
- Components use semantic Tailwind classes (`text-text`, `bg-surface`, `border-border`) or explicit `var(--color-*)` references — both adapt automatically to theme changes
- Key variable: `--color-heading` — white in dark mode, near-black in light mode. Use `text-[var(--color-heading)]` instead of `text-white` for any heading text that should flip with the theme

### CSS Variables (dark mode defaults)
```
--color-primary: #4f8ff7      --color-accent: #34d399
--color-bg: #09090b           --color-surface: #111111
--color-text: #e4e4e7         --color-text-muted: #a1a1aa
--color-border: #27272a       --color-heading: #ffffff
--font-sans: Inter             --font-heading: Saira Extra Condensed
```

## Design Principles

- **Home page content is independent from CV** — `src/data/site-data.ts` vs `src/content/cv/cv-data.json`
- **CV is reusable** — swap the JSON file and everything re-renders (TypeScript types document the contract)
- **Zero JS for CV content** — all sections are build-time static HTML; only PDF/clipboard/vCard are interactive Preact islands
- **Never use `text-white` for headings** — use `text-[var(--color-heading)]` so it adapts to light/dark mode
- **All borders and dividers use `var(--color-border)`** — never hardcode rgba values
- **Component-scoped styles** use `<style>` blocks with `var(--color-*)` for theme adaptation
- **Light mode overrides** use `:global(html.light)` in component `<style>` blocks when CSS-variable-based approach isn't sufficient
