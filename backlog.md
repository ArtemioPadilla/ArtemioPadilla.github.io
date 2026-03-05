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
- [x] **Convolution Visualizer** — Animated kernel sliding across grids, stride/padding controls, preset kernels (edge detect, blur, sharpen).
- [x] **Activation Function Gallery** — 10 functions (ReLU, GELU, Swish, etc.) with derivatives, overlay comparison, properties panel.
- [x] **Loss Function Explorer** — 8 loss functions with curve + interactive modes, drag predictions, gradient view, parameter controls.
- [x] **Diffusion Process Visualizer** — Forward/reverse diffusion on 2D point clouds, 6 shapes, 3 noise schedules, density heatmap.
- [x] **Fourier Transform Visualizer** — Draw signals, DFT decomposition, epicycle animation, magnitude/phase spectrum, harmonic reconstruction.
- [x] **Probability Distribution Explorer** — 15 distributions (continuous + discrete), parameter sliders, CDF toggle, sampling, probability calculator.
- [x] **JWT Decoder** — Decode JWTs with color-coded parts, claims table, live expiry countdown, preset tokens.
- [x] **Cron Expression Parser** — Human-readable descriptions, visual SVG timeline, next 10 executions, field reference.
- [x] **Diff Viewer** — Side-by-side and unified diff with word-level highlighting, LCS algorithm, scroll sync.
- [x] **Confusion Matrix Builder** — Paste CSV or build manually, precision/recall/F1 per class, normalization modes, Cohen's Kappa.
- [x] **Color Palette Generator** — Sequential/diverging/categorical modes, WCAG contrast matrix, colorblind simulation, chart preview.
- [x] **Embedding Space Explorer** — PCA + t-SNE from scratch, 2D/3D Canvas visualization, KNN, preset datasets, animated t-SNE clustering.
- [ ] **Transformer Attention Visualizer** — Paste text, see self-attention heatmaps across layers/heads. Uses ONNX Runtime Web with a tiny model.
- [x] **Sorting Visualizer** — 10 sorting algorithms with bar-chart animation, race mode, and sound. Generator-based stepping.
- [x] **Bezier Curve Editor** — Cubic/quadratic curves, de Casteljau animation, drag control points, continuity joining.
- [x] **Cellular Automata** — 2D Game of Life + 1D Wolfram rules, pattern library, ImageData rendering.
- [x] **Shader Playground** — WebGL fragment shader editor, 10 GLSL presets, live uniforms, fullscreen mode.
- [x] **Graph Algorithms Visualizer** — 8 algorithms (BFS, DFS, Dijkstra, A*, Kruskal, Prim, topo sort, SCC), Canvas graph editor.
- [x] **Data Structure Visualizer** — 7 structures (stack, queue, BST, min-heap, hash table, linked list, trie) with step-by-step animation.
- [x] **State Machine Designer** — DFA/NFA visual editor, string simulation, NFA→DFA conversion, export DOT.
- [x] **Linear Algebra Playground** — Matrix operations, eigenvalues, SVD, 2D grid deformation visualization.
- [x] **Hash Generator** — MD5 + CRC32 from scratch, SHA-1/256/384/512 via Web Crypto, file hashing, HMAC.
- [x] **Timestamp Converter** — Unix↔human-readable, timezone support, duration calculator, ISO 8601.
- [x] **Base Converter** — Binary/octal/decimal/hex, arbitrary base 2–36, IEEE 754 float inspector with clickable bits.
- [x] **Audio Visualizer** — Microphone + file input, waveform/frequency/spectrogram views, Web Audio API.
- [x] **QR Code Generator** — From-scratch Reed-Solomon QR encoding, SVG/Canvas output, customizable colors.
- [x] **Physics Sandbox** — 2D rigid body simulation, gravity, collisions, springs, Canvas rendering.
- [x] **Markov Chain Simulator** — State diagram editor, transition matrix, stationary distribution, random walk animation.
- [x] **Regex to NFA/DFA** — Thompson's construction, subset construction, minimization, visual state diagrams.
- [x] **MCMC Visualizer** — Metropolis-Hastings, HMC, 2D target distributions, trace/density plots, diagnostics.

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
