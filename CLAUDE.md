# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is Artemio Padilla's personal portfolio website built as a static site with multiple HTML pages. The site is self-hosted on a Raspberry Pi 4b and uses Cloudflared for DNS management.

## Architecture

### Main Site Structure
- **Main Portfolio** (`index.html`): Landing page with sections for overview, projects, and social feed. Built with Shorthand CSS framework
- **CV Page** (`cv.html`): Dynamic curriculum vitae with data-driven rendering from JSON source, supports multi-format PDF export
- **CV Backup** (`cv-backup.html`): Static HTML fallback for CV (no JavaScript dependency)
- **Landing Tree** (`landing-tree/`): Alternative landing page with particle.js effects and typed.js animations
- **2024 Update** (`2024-update/Personal/`): Newer portfolio template with multiple pages (about, contact, portfolio, resume, services)

### Directory Structure
- `data/`: Canonical structured CV data (JSON) with schema validation
- `js/`: CV rendering engine and PDF generation scripts
- `scripts/`: Node.js automation tools for validation, generation, and hooks
- `assets/`: Shared images, fonts, and legacy JavaScript
- `.github/`: CI/CD workflows for automated testing

### Technology Stack
- **CSS Frameworks**: Shorthand CSS (main site), Bootstrap (CV page)
- **JavaScript Libraries**:
  - jQuery for DOM manipulation
  - Feather Icons for iconography
  - Slick Carousel for sliders
  - Smooth Scroll for navigation
  - Particle.js for background effects (landing tree)
  - Typed.js for text animations (landing tree)
  - jsPDF for PDF generation with custom layouts
- **Build Tools**:
  - Node.js for automation scripts
  - Ajv for JSON schema validation
  - Git hooks for pre-commit validation
- **Analytics**: Amplitude tracking integrated across pages

## Key Files

### Core Pages
- `index.html`: Main portfolio page
- `cv.html`: Dynamic curriculum vitae page with PDF export
- `cv-backup.html`: Static CV fallback (no JavaScript required)
- `landing-tree/landing-tree.html`: Alternative landing page with animations

### Data Files
- `data/cv-data.json`: Canonical CV data source (single source of truth)
- `data/cv-schema.json`: JSON schema for CV data validation
- `data/cv-data.js`: Auto-generated JavaScript fallback for offline support

### JavaScript Components
- `js/cv-renderer.js`: Dynamic CV rendering engine
- `js/pdf-generator.js`: Multi-format PDF export (full/resume/summary)
- `js/nav-collapsible.js`: Navigation collapse functionality
- `assets/js/script.js`: Main site JavaScript functionality

### Automation Scripts
- `scripts/generate-cv-data.js`: Validates and generates JS fallback from JSON
- `scripts/update-cv-metadata.js`: Updates version and lastUpdated fields
- `scripts/install-hooks.js`: Sets up git pre-commit hooks

### Styles
- `css/styles.css`: CV page Bootstrap-based styles

## CV Data Pipeline

The CV system uses a data-driven architecture:

1. **Source of Truth**: `data/cv-data.json` - All CV content in structured JSON format
2. **Validation**: JSON schema validation via `data/cv-schema.json` using Ajv
3. **Fallback Generation**: Auto-generated `data/cv-data.js` for offline/file:// protocol support
4. **Dynamic Rendering**: `js/cv-renderer.js` transforms JSON data into HTML
5. **PDF Export**: `js/pdf-generator.js` supports three formats:
   - Full CV (comprehensive with all details)
   - Resume (condensed 2-page version)
   - Summary (1-page executive summary)

### Automation Workflow
- **Pre-commit Hook**: Validates JSON and regenerates JS fallback automatically
- **CI/CD**: GitHub Actions workflow verifies data integrity on every push
- **Version Management**: Automated version bumping and metadata updates

## Development Scripts

```bash
# Install dependencies and set up git hooks
npm install
npm run setup:hooks

# CV Data Management
npm run validate:cv        # Validate cv-data.json against schema
npm run build:cv          # Validate and generate JS fallback
npm run format:cv         # Format cv-data.json with Prettier

# Release Workflow
npm run prepare:cv-release # Bump version and update lastUpdated
npm run release:cv        # Build and commit CV artifacts
```

## External Dependencies

### CDN Libraries
- Shorthand CSS
- Bootstrap
- jQuery
- Feather Icons
- Slick Carousel
- Font Awesome
- Amplitude Analytics
- jsPDF (for PDF generation)

### Development Dependencies (npm)
- Ajv & ajv-formats (JSON schema validation)
- Node.js (build automation)

## Navigation Structure

The site uses anchor-based navigation with smooth scrolling between sections:
- Home
- Overview
- Projects
- CV (separate page with dynamic content)
- Link Tree (external)
- About