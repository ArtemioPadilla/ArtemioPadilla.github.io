# Backlog

## Done
- [x] Light mode on /links
- [x] Functional blog with search, tags, RSS, comments infrastructure
- [x] Hub dashboard home page (replaced long-scroll landing)
- [x] /projects page (GitHub repos grid)
- [x] /lab page + Python REPL (Pyodide + NumPy)
- [x] /lab Python Tutor — client-side execution visualizer (sys.settrace + Pyodide)
- [x] GitHub activity calendar on /projects page (ghchart.rshah.org)
- [x] Contact card simplified (removed non-functional social badges, shows email only)
- [x] Projects page repos fetched client-side (CSR via Preact, always fresh)
- [x] Navigation: Lab + Projects added, Links moved to footer

---

## Quick Wins (low effort, ready to wire)
- [x] Wire `GiscusComments.astro` into blog post layout (already integrated)
- [x] Wire `TableOfContents.astro` into blog posts (mobile + desktop sidebar)
- [x] Wire `PostNavigation.astro` (prev/next) into blog posts (already integrated)
- [x] Add reading progress bar (global in BaseLayout, all pages)
- [x] Mobile menu: theme toggle in mobile nav drawer (already in Navigation.astro)
- [x] Scroll-to-top button on long pages (global in BaseLayout, appears after 400px scroll)

---

## Blog Content
- [ ] Write first real post: "Building a WhatsApp Scheduling Agent with Bedrock Agent Core & Strands"
- [ ] Post: "From Nanoscience to Neural Networks — My Path to Deep Learning"
- [ ] Post: "45 Days to Production: How AWS GenAI Innovation Center Delivers"
- [ ] Post: "Building This Site: Astro 5 + Zero JS CV Rendering"
- [ ] Add post categories (Tutorial, Deep Dive, Opinion, Tool) alongside tags

---

## Lab Tools (interactive browser-based, no server)
- [x] **Regex Tester** — Live regex testing with match highlighting, group extraction, replace mode. Pure JS RegExp.
- [x] **JSON Schema Validator** — Paste JSON + schema, validate with Ajv. Detailed error reporting with paths.
- [x] **Gradient Descent Animator** — 2D loss landscapes with 5 optimizers (SGD, Momentum, Adam, AdaGrad, RMSProp). Canvas heatmap + contours.
- [x] **Tokenizer Playground** — BPE visualization, token chip coloring, model comparison (GPT-4, Claude, Llama). Step-by-step merge animation.
- [x] **Neural Network Playground** — Build small networks, train on 6 toy datasets, watch decision boundaries evolve. From-scratch backprop.
- [ ] **Transformer Attention Visualizer** — Paste text, see self-attention heatmaps across layers/heads. Uses ONNX Runtime Web with a tiny model.
- [ ] **Confusion Matrix Builder** — Upload predictions CSV or paste data, get interactive confusion matrix + precision/recall/F1 per class. Plotly or D3.
- [ ] **Embedding Space Explorer** — Upload embeddings, visualize with t-SNE/UMAP in 3D (Three.js). Color by label, hover for details.
- [ ] **Color Palette Generator** — Generate accessible color palettes for data visualization. Contrast checks, colorblind simulation.

---

## CV Enhancements
- [ ] Scroll-triggered timeline animation on experience section
- [ ] Skills section as interactive tag cloud or radar chart
- [x] Mini GitHub contribution heatmap (ghchart on /projects)
- [ ] Collapsible experience details (show/hide bullet points)
- [ ] "Download as PDF" button directly visible without scrolling (sticky)

---

## Home Page & Design
- [x] Global search (Cmd+K / Ctrl+K) across blog, lab tools, CV sections
- [ ] "Latest from blog" live preview in BlogCard (show first 2 lines of latest post)
- [ ] Animated counter for repo count / blog posts (count-up on scroll)
- [ ] Unify /links page into main design system (use CSS vars, site typography)
- [ ] Dark mode easter egg (triple-click logo → special theme)

---

## Infrastructure & Performance
- [x] Lighthouse CI in GitHub Actions (baseline audit on every push)
- [ ] Add responsive images (srcset) for profile photo and art thumbnails
- [ ] Bundle analysis — check what ships to client, optimize
- [x] Add structured data (JSON-LD) for blog posts and person schema
- [ ] Privacy-friendly analytics (Plausible or Umami self-hosted)
- [ ] Playwright smoke tests for all pages (build → serve → screenshot)

---

## Future (bigger scope)
- [ ] Speaking/talks page (if applicable)
- [ ] Newsletter signup (Substack or custom)
- [ ] Auth-gated lab tools (Firebase Auth, switch to hybrid SSR)
- [ ] Jupyter-style notebook renderer in lab (markdown + executable code cells)
- [ ] Multi-language support (EN/ES)
- [ ] AI chatbot trained on CV + blog posts (embedded on /contact or home)
