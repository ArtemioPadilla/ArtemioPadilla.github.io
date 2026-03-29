# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Finance Simulator: Real vs Nominal Value Toggle** — inflation-adjusted chart views with "Real $" / "Nominal $" pill toggle, deflates net worth, cashflow, balances, and debt charts plus comparison scenario overlays; yearly summary table also deflates income, expenses, loan payments, assets, debt, and net worth columns; Y-axis label updates to show "(real)" suffix

- **Finance Simulator: PPR Support** — Plan Personal de Retiro (PPR) with Art.151/Art.185 contribution tracking, annual caps (UMA-based), compound interest, ISR tax refund simulation, dedicated PPR tab with full CRUD, dashboard integration (PPR Growth chart mode, KPI cards, tooltip breakdown), Gantt timeline rows, and a "PPR Retirement Planning" scenario

- **Database Index Visualizer** (`/lab/db-index-viz`) — B-Tree, B+ Tree, Hash Index with animated insert/delete/search, node splits, comparison mode
- **Strange Attractors** (`/lab/strange-attractors`) — Lorenz, Rossler, double pendulum, Henon map, logistic bifurcation with 3D rotation and Lyapunov exponent estimation
- **Backpropagation Visualizer** (`/lab/backprop-viz`) — step-by-step forward/backward pass, gradient flow, chain rule, vanishing gradient demo
- **Markdown Previewer** (`/lab/markdown-preview`) — split-pane editor with from-scratch GFM parser, toolbar, TOC, word count
- **Neuroevolution Playground** (`/lab/neuroevolution`) — evolve neural networks via GA for Cart-Pole, Flappy Bird, Maze Runner
- **JSON Visualizer** (`/lab/json-visualizer`) — collapsible tree, graph view, code view, JSONPath queries, statistics
- **Clustering Visualizer** (`/lab/clustering`) — K-Means, DBSCAN, Hierarchical (dendrogram), Mean Shift with preset datasets
- **Turing Machine Simulator** (`/lab/turing-machine`) — visual tape, state diagram, editable transition table, 7 presets including Busy Beaver
- **Pixel Art Editor** (`/lab/pixel-art`) — 7 drawing tools, 4 layers, animation with onion skinning, PNG + GIF export (custom LZW encoder)
- **Compression Visualizer** (`/lab/compression-viz`) — step-by-step Huffman, LZW, and RLE with tree animation and statistics
- **Music Theory Visualizer** (`/lab/music-theory`) — piano keyboard, circle of fifths, scales, chords, progressions, staff notation with Web Audio
- **Blockchain Visualizer** (`/lab/blockchain`) — proof-of-work mining, tamper detection cascade, Merkle trees, peer consensus simulation
- **Voronoi / Delaunay** (`/lab/voronoi`) — Bowyer-Watson, Fortune's sweep animation, Lloyd relaxation, Poisson disk sampling
- **Ray Tracer** (`/lab/ray-tracer`) — Phong shading, reflections, refractions (Snell's law + Fresnel), progressive scanline rendering
- **Genetic Algorithm** (`/lab/genetic-algorithm`) — TSP, function optimization (Rastrigin/Ackley), target string evolution
- **L-System Fractals** (`/lab/l-system`) — turtle graphics, 9 presets (Koch, Sierpinski, Dragon, Hilbert), color modes, PNG/SVG export
- **Regex Automaton** (`/lab/regex-automaton`) — Thompson's NFA construction, subset construction to DFA, step-through matching
- **Physics Sandbox** (`/lab/physics-sandbox`) — pendulum, spring, projectile, collisions, orbital mechanics with RK4 integration
- **Data Structures** (`/lab/data-structures`) — BST, AVL, heap, hash table, linked list, stack, queue with step-by-step animation
- **State Machine Designer** (`/lab/state-machine`) — DFA/NFA editor, string simulation, NFA→DFA conversion, DOT export
- **Base Converter** (`/lab/base-converter`) — binary/hex/decimal/octal, IEEE 754 float inspector, bitwise operations, two's complement
- **Sorting Visualizer** (`/lab/sorting-viz`) — 10 algorithms, race mode, sound toggle, complexity reference
- **Shader Playground** (`/lab/shader-playground`) — GLSL fragment shader editor, 10 presets, live WebGL preview, mouse uniform
- **Cellular Automata** (`/lab/cellular-automata`) — Game of Life + Wolfram 256 rules, drawing tools, zoom/pan, 4 color modes
- **Bezier Curve Editor** (`/lab/bezier-editor`) — de Casteljau animation, up to order 7, continuity joining, SVG/JSON export
- **Cron Parser** (`/lab/cron-parser`) — human-readable descriptions, SVG timeline, next 10 executions, field validation
- **Activation Functions** (`/lab/activation-functions`) — 10 functions with derivatives, overlay comparison, properties panel
- **Gradient Descent** (`/lab/gradient-descent`) — 5 optimizers racing across 6 loss landscapes, adjustable hyperparameters
- **Tokenizer Playground** (`/lab/tokenizer`) — BPE visualization, model comparison (GPT-4o, Claude, Llama 3), pricing reference
- **Regex Tester** (`/lab/regex-tester`) — live match highlighting, capture groups, replace mode, quick reference
- **Neural Network Playground** (`/lab/neural-network`) — build/train networks on 6 toy datasets, from-scratch backprop, decision boundary viz
- **Convolution Visualizer** (`/lab/convolution-viz`) — animated kernel sliding, stride/padding controls, preset kernels
- **Loss Function Explorer** (`/lab/loss-explorer`) — 8 loss functions, curve + interactive modes, gradient view
- **JWT Decoder** (`/lab/jwt-decoder`) — color-coded header/payload/signature, claims table, live expiry countdown
- **Timestamp Converter** (`/lab/timestamp`) — Unix↔human-readable, timezone support, date math, epoch reference
- **Probability Distributions** (`/lab/distributions`) — 15 distributions, parameter sliders, CDF, sampling, probability calculator
