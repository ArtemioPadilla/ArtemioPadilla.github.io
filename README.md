# Artemio Padilla — Personal Portfolio

[![Deploy to GitHub Pages](https://github.com/ArtemioPadilla/ArtemioPadilla.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/ArtemioPadilla/ArtemioPadilla.github.io/actions/workflows/deploy.yml)
[![Validate CV Data](https://github.com/ArtemioPadilla/ArtemioPadilla.github.io/actions/workflows/cv-data.yml/badge.svg)](https://github.com/ArtemioPadilla/ArtemioPadilla.github.io/actions/workflows/cv-data.yml)
[![Lighthouse CI](https://github.com/ArtemioPadilla/ArtemioPadilla.github.io/actions/workflows/lighthouse.yml/badge.svg)](https://github.com/ArtemioPadilla/ArtemioPadilla.github.io/actions/workflows/lighthouse.yml)

![Astro](https://img.shields.io/badge/Astro-5-BC52EE?logo=astro&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Preact](https://img.shields.io/badge/Preact-10-673AB8?logo=preact&logoColor=white)

[![Website](https://img.shields.io/website?url=https%3A%2F%2Fartemiopadilla.github.io&label=artemiopadilla.github.io)](https://artemiopadilla.github.io)

A high-performance personal portfolio built with **Astro 5**, featuring a data-driven CV, a blog with search, and **53 interactive lab tools** — all statically generated with zero client JS by default and selective Preact islands for interactivity.

---

## Pages

| Route | Description |
|-------|-------------|
| **`/`** | Hub landing with animated card grid linking to all sections |
| **`/cv`** | Full CV rendered from JSON at build time, with client-side PDF export (full / resume / summary) |
| **`/blog`** | Blog with fuzzy search (Fuse.js), tag filtering, reading time, and RSS feed |
| **`/lab`** | 53 interactive tools across 9 categories — ML, algorithms, graphics, dev tools, and more |
| **`/projects`** | Live GitHub activity chart and repo grid fetched from the GitHub API |
| **`/links`** | Link hub with particle background and typed.js tagline |
| **`/404`** | Custom 404 with glitch animation |

---

## Lab Tools

53 browser-based interactive tools built with Canvas, WebGL, Web Audio, and Web Crypto — no external servers, no heavy ML libraries. Organized into 9 categories:

| Category | Count | Highlights |
|----------|------:|------------|
| Machine Learning & AI | 19 | Neural network playground, backprop visualizer, attention viz, GAN, RL, neuroevolution |
| Mathematics & Statistics | 9 | Fourier transforms, probability distributions, linear algebra, Markov chains |
| Algorithms & Data Structures | 7 | Sorting visualizer, pathfinding, graph algorithms, cellular automata |
| Computer Science Theory | 7 | Turing machine, finite state machine, regex automaton, CPU pipeline simulator |
| Graphics & Creative | 6 | Shader playground (GLSL), ray tracer, pixel art editor, fractal explorer |
| Developer Tools | 12 | Regex tester, JSON validator, JWT decoder, SQL playground, diff viewer |
| Audio & Music | 2 | Audio visualizer, music theory (piano, circle of fifths, Web Audio) |
| Python | 2 | In-browser Python REPL, Python tutor |
| Systems & Networking | 10 | Blockchain simulator, physics sandbox, fluid dynamics, orbital mechanics |

---

## CV Data Pipeline

The CV is fully data-driven — swap the JSON file and everything re-renders.

```
src/content/cv/cv-data.json    ← source of truth
src/content/cv/cv-schema.json  ← JSON Schema (draft-07) validation
src/utils/cv-loader.ts         ← Ajv validation + typed CVData output
src/components/cv/             ← 12 Astro components (static HTML, zero JS)
src/utils/pdf-generator.ts     ← Client-side jsPDF (3 export formats)
```

Build fails if the CV data doesn't validate — no invalid data can be deployed.

---

## Architecture

```
src/
├── pages/                 Routes: index, cv, blog, lab, projects, links, 404, rss.xml
├── components/
│   ├── home/              Hub landing: IdentityStrip, HubCard variants
│   ├── cv/                12 section components + CvLayout + SocialIcons
│   ├── cv-interactive/    Preact islands: PdfDownloader, CopyToClipboard, VCardDownload
│   ├── blog/              PostCard, BlogSearch, PostHeader, TableOfContents
│   ├── links/             ParticlesBackground, TypedTagline (Preact)
│   ├── projects/          RepoGrid (Preact, live GitHub API)
│   └── layout/            BaseLayout, Navigation, Footer, ThemeToggle
├── content/
│   ├── cv/                CV JSON data + schema
│   ├── blog/              Markdown blog posts
│   └── lab/               Markdown tool definitions (53 tools)
├── types/cv.ts            TypeScript interfaces for all CV data
├── utils/                 cv-loader, pdf-generator, github, text-sanitizer, date-formatter
├── data/site-data.ts      Home page content (independent from CV)
└── styles/global.css      Tailwind v4 @theme + dark/light CSS variables
```

### Key Design Decisions

- **Zero JS by default** — all content pages are pre-built static HTML; Preact islands only where interaction is required
- **Dark mode default** — light mode via `html.light` class, persisted in localStorage
- **Semantic CSS variables** — all colors use `var(--color-*)` so components adapt to theme changes automatically
- **CV is portable** — swap `cv-data.json` and every section + PDF export re-renders from the new data

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro 5 (static output) |
| Language | TypeScript 5 (strict mode) |
| Styling | Tailwind CSS v4 with `@theme` CSS custom properties |
| Islands | Preact 10 (PDF export, clipboard, particles, typed.js, repo grid) |
| PDF | jsPDF (dynamically imported, client-side only) |
| Search | Fuse.js (fuzzy matching for blog) |
| Particles | tsparticles-slim |
| Validation | Ajv + ajv-formats (JSON Schema, build-time) |
| CI/CD | GitHub Actions → GitHub Pages |
| Lighthouse | 0.9+ targets across all categories |

---

## Development

```bash
npm install              # Install dependencies
npm run dev              # Dev server at http://localhost:4321
npm run build            # Validate CV + build static site to dist/
npm run preview          # Preview built site locally
```

### CV Scripts

```bash
npm run validate:cv         # Validate cv-data.json against schema
npm run format:cv           # Format cv-data.json with Prettier
npm run prepare:cv-release  # Bump version + update lastUpdated
```

---

## CI/CD

Three GitHub Actions workflows run on every push to `main`:

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| **Deploy** | Push to `main` | Validate CV → Astro build → deploy to GitHub Pages |
| **CV Data** | CV file changes | Schema validation gate for CV data |
| **Lighthouse** | Push / PR to `main` | Performance, accessibility, SEO, and best practices audit |

---

## Theming

Dark mode is the default. All components use semantic CSS variables that flip automatically.

```
Dark                          Light
──────────────────────────    ──────────────────────────
--color-primary: #4f8ff7      --color-primary: #2563eb
--color-accent:  #34d399      --color-accent:  #059669
--color-bg:      #09090b      --color-bg:      #fafafa
--color-heading: #ffffff      --color-heading: #18181b
--color-text:    #e4e4e7      --color-text:    #27272a
```

**Fonts:** Inter (body) · Saira Extra Condensed (headings) · JetBrains Mono (code)

---

## License

MIT
