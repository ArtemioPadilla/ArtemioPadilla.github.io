## Artemio Padilla – Personal Site Monorepo

This repository hosts multiple static site surfaces for my personal presence:

| Area | Path / Entry | Tech / Notes |
|------|--------------|--------------|
| Main Landing Page | `index.html` | Shorthand CSS + custom hero, overview, project slider, social embeds |
| Curriculum Vitae | `cv.html` | Dynamic CV renderer (JSON → HTML + PDF generator) |
| Static CV Backup | `cv-backup.html` | Pure HTML fallback (no JS dependency) |
| Link / Profile Hub | `landing-tree/landing-tree.html` | Animated link tree (Particles.js, Typed.js) |
| PDF Resource | `rsc/resume.pdf` | Pre-generated resume asset |
| Experimental 2024 Theme | `2024-update/Personal/` | BootstrapMade “Personal” template sandbox |

![CV Data Workflow](https://github.com/ArtemioPadilla/ArtemioPadilla.github.io/actions/workflows/cv-data.yml/badge.svg)

---
### 1. Repository Structure (Key Directories)
```
data/          Canonical structured data (cv-data.json + schema + generated JS)
js/            CV rendering & PDF scripts
assets/        Shared images, fonts, icons
landing-tree/  Link hub micro-landing
2024-update/   Experimental new Bootstrap-based site variant
rsc/           Static resources (PDF resume)
scripts/       Automation: validation, generation, hooks, metadata update
.github/       CI workflows
```

---
### 2. CV Data Pipeline
Canonical source: `data/cv-data.json` (validated via `data/cv-schema.json`).

Generated fallback: `data/cv-data.js` (auto-created; do not edit manually) ensures offline / `file://` support.

`cv.html` loads the data and supports multi-format PDF generation (full/resume/summary) through custom layout logic in `js/pdf-generator.js`.

---
### 3. Automation & Tooling
| Feature | Mechanism |
|---------|-----------|
| Schema validation | Ajv (`scripts/generate-cv-data.js`) |
| Auto JS fallback build | `npm run build:cv` |
| Pre-commit guard | Installed via `npm run setup:hooks` (validates + regenerates) |
| Metadata/version bump | `npm run prepare:cv-release` updates version & lastUpdated |
| CI verification | `.github/workflows/cv-data.yml` diff-checks generated output |

---
### 4. Local Development
Serve locally (choose one):
```
# Python
python3 -m http.server 8000

# Or Node (if installed)
npx http-server -p 8000
```
Open: `http://localhost:8000/`

Install tooling + hooks:
```
npm install
npm run setup:hooks
```
Edit `data/cv-data.json`; commit triggers validation & regeneration.

---
### 5. Useful Scripts
```
npm run validate:cv        # schema validation only
npm run build:cv           # validate + regenerate JS fallback
npm run format:cv          # Prettier format cv-data.json
npm run prepare:cv-release # bump patch version + lastUpdated
npm run release:cv         # build & commit cv artifacts
```

---
### 6. Future Improvements
* Unify styling between legacy landing and 2024 Bootstrap variant
* Lighthouse CI for performance & accessibility baselines
* Deterministic PDF resume build from same JSON (replace manual pdf)
* I18n layer (e.g., `data/i18n/es.json`)
* Theming toggle (dark/light) persisted in localStorage
* Critical CSS inlining for faster LCP

---
### 7. Accessibility & Performance Notes
* `<noscript>` fallback + static CV backup page
* Potential image optimization: WebP / AVIF + lazy loading
* Candidate: defer analytics & add consent dialogue

---
### 8. Credits
* Shorthand CSS framework
* Hook Theme
* BootstrapMade "Personal" template (sandbox section)
* Icons: Feather, Font Awesome, Bootstrap Icons
* Libraries: Slick Carousel, Particles.js, Typed.js, jsPDF

---
### 9. License
MIT (template/theme components under their respective licenses)
