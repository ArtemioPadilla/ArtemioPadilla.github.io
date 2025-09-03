# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is Artemio Padilla's personal portfolio website built as a static site with multiple HTML pages. The site is self-hosted on a Raspberry Pi 4b and uses Cloudflared for DNS management.

## Architecture

### Main Site Structure
- **Main Portfolio** (`index.html`): Landing page with sections for overview, projects, and social feed. Built with Shorthand CSS framework
- **CV Page** (`cv.html`): Detailed curriculum vitae with Bootstrap styling
- **Landing Tree** (`landing-tree/`): Alternative landing page with particle.js effects and typed.js animations
- **2024 Update** (`2024-update/Personal/`): Newer portfolio template with multiple pages (about, contact, portfolio, resume, services)

### Technology Stack
- **CSS Frameworks**: Shorthand CSS (main site), Bootstrap (CV page)
- **JavaScript Libraries**:
  - jQuery for DOM manipulation
  - Feather Icons for iconography
  - Slick Carousel for sliders
  - Smooth Scroll for navigation
  - Particle.js for background effects (landing tree)
  - Typed.js for text animations (landing tree)
- **Analytics**: Amplitude tracking integrated across pages

## Key Files

- `index.html`: Main portfolio page
- `cv.html`: Curriculum vitae page
- `landing-tree/landing-tree.html`: Alternative landing page with animations
- `assets/js/script.js`: Main JavaScript functionality
- `css/styles.css`: CV page Bootstrap-based styles

## External Dependencies

All external libraries are loaded via CDN:
- Shorthand CSS
- Bootstrap
- jQuery
- Feather Icons
- Slick Carousel
- Font Awesome
- Amplitude Analytics

## Navigation Structure

The site uses anchor-based navigation with smooth scrolling between sections:
- Home
- Overview
- Projects
- CV (separate page)
- Link Tree (external)
- About