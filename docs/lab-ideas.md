# Lab Tool Ideas — Research & Reference

> Curated list of interactive browser-based tool ideas for the Lab section.
> Each entry includes description, interactivity model, reference implementations, and estimated complexity.

---

## Table of Contents

1. [Finance & Economics](#finance--economics)
2. [Game Theory & Social Simulation](#game-theory--social-simulation)
3. [Physics & Engineering](#physics--engineering)
4. [Mathematics & Statistics](#mathematics--statistics)
5. [Machine Learning & AI](#machine-learning--ai)
6. [Computer Science & Systems](#computer-science--systems)
7. [Generative Art & Creative](#generative-art--creative)
8. [Education & Explorable Explanations](#education--explorable-explanations)

---

## Finance & Economics

### Investment Portfolio Simulator
**Description:** Monte Carlo simulation of portfolio growth with asset allocation sliders. Users drag-and-drop asset mix (stocks, bonds, crypto, real estate), adjust inflation rate, fees, and contribution schedule. Shows probability cones (10th/50th/90th percentile outcomes) over 1-40 year horizons.

**Interactivity:**
- Draggable pie chart for asset allocation
- Sliders for annual return, volatility, inflation, fees
- Monte Carlo fan chart (1000+ simulations)
- Toggle between nominal and real (inflation-adjusted) returns
- Compare up to 3 portfolio strategies side by side

**Reference implementations:**
- [SudoTool Investment Simulator](https://sudotool.com/tools/investment-simulator) — Monte Carlo with fees, taxes, inflation
- [Invest Simulator](https://investsimulator.com/) — Compound interest with dynamic graph
- [Investor.gov Compound Interest Calculator](https://www.investor.gov/financial-tools-calculators/calculators/compound-interest-calculator)

**Complexity:** High (Monte Carlo engine, Chart.js or custom canvas, multiple scenarios)

---

### Compound Interest Visualizer
**Description:** Animated visualization showing the "snowball effect" of compound interest. Instead of a standard line chart, use a growing particle system or expanding circles to make the exponential growth visceral. Side-by-side comparison of different rates, contributions, and compounding frequencies.

**Interactivity:**
- Sliders for principal, rate, monthly contribution, years
- Toggle compounding frequency (daily/monthly/annually)
- Animated particles or growing bars showing money accumulating
- "Time travel" scrubber to jump to any year
- Comparison mode: two scenarios side by side

**Reference implementations:**
- [NerdWallet Compound Interest Calculator](https://www.nerdwallet.com/calculator/compound-interest-calculator)
- [The Calculator Site](https://www.thecalculatorsite.com/finance/calculators/compoundinterestcalculator.php)

**Complexity:** Medium

---

### Supply & Demand Simulator
**Description:** Interactive microeconomics tool. Users drag supply and demand curves to see equilibrium price/quantity update in real-time. Add price floors, price ceilings, taxes, and subsidies. Shows consumer surplus, producer surplus, and deadweight loss as shaded areas.

**Interactivity:**
- Draggable curve control points (shift/rotate/elasticity)
- Toggle overlays: price floor, price ceiling, tax, subsidy
- Animated transitions when curves shift
- Shaded areas for surplus/deadweight loss with live calculations
- Preset scenarios (oil shock, minimum wage, carbon tax)

**Reference implementations:**
- [EconGraphs](https://www.econgraphs.org/) — Interactive graphs for economics concepts
- [Breakeven Supply & Demand Game](https://www.breakeven.app/games/sd/)
- [MRU Interactive Practice](https://practice.mru.org/interactive-practice-supply-and-demand/)
- [CoolEconTools](https://econreimagined.gsu.edu/tools.html) — GSU's active learning simulations

**Complexity:** Medium

---

### Amortization Race
**Description:** Extension of the mortgage calculator. Set up multiple repayment strategies and "race" them: minimum payments vs. extra $500/month vs. biweekly payments vs. refinancing at lower rate. Animated bar race chart showing balances declining over time.

**Interactivity:**
- Configure 2-4 repayment strategies
- Animated "bar chart race" as months tick forward
- Play/pause/speed controls
- Running scoreboard: total interest paid, months remaining
- "What if" slider: what if rates change at month X?

**Complexity:** Medium (builds on existing mortgage-calc)

---

## Game Theory & Social Simulation

### Evolution of Cooperation
**Description:** Prisoner's Dilemma tournament playground inspired by Nicky Case's "The Evolution of Trust." Users design strategies (tit-for-tat, always defect, random, grudger, pavlov, etc.) and pit them against each other in a population. Watch cooperation emerge or collapse through generations.

**Interactivity:**
- Strategy builder: code simple rules (if opponent defected last round, defect)
- Population grid showing strategy distribution with color coding
- Generation slider to step through evolution
- Adjustable parameters: noise/error rate, tournament rounds, population size
- Payoff matrix editor (customize the dilemma)
- Charts: cooperation rate over time, strategy fitness

**Reference implementations:**
- [Nicky Case — The Evolution of Trust](https://ncase.me/trust/) — The gold standard
- [Perth36 Prisoner's Dilemma Simulator](https://perthirtysix.com/tool/prisoners-dilemma-simulator)
- [GameTheory.net Evolutionary Applets](https://www.gametheory.net/applets/evolution.html)
- [Economics Network Game Theory Tutorials](https://economicsnetwork.ac.uk/teaching/Interactive%20Tutorials/Game%20Theory)

**Complexity:** High (agent-based simulation, multi-generational, strategy DSL)

---

### Segregation Simulator (Schelling Model)
**Description:** Implementation of Thomas Schelling's segregation model. Agents on a grid with mild preference for similar neighbors spontaneously produce dramatic segregation. Users adjust tolerance threshold and watch patterns emerge.

**Interactivity:**
- Grid of colored agents (2-4 groups)
- Tolerance slider (% of similar neighbors needed to stay)
- Step/play/reset controls
- Real-time segregation index metric
- Comparison: run multiple thresholds simultaneously

**Reference implementations:**
- [Nicky Case — Parable of the Polygons](https://ncase.me/polygons/)

**Complexity:** Medium

---

### Voting Systems Explorer
**Description:** Compare different voting systems (plurality, ranked-choice, approval, Condorcet, STAR) with the same set of voter preferences. Shows how the winner changes depending on the system used. Spatial model with draggable candidates and voter clusters.

**Interactivity:**
- 2D "political compass" with draggable candidate positions
- Voter clusters as gaussian blobs (draggable, adjustable spread)
- Side-by-side results for 5+ voting methods
- Animated ballot counting for ranked-choice
- Susceptibility-to-strategy visualization

**Reference implementations:**
- [Nicky Case — To Build A Better Ballot](https://ncase.me/ballot/)

**Complexity:** High

---

## Physics & Engineering

### Soft Body / Cloth Simulation
**Description:** Verlet integration physics playground. Drop cloth, jelly blobs, or rope into a scene. Interact by dragging, cutting, and pinning. Demonstrates particle-spring systems, constraint satisfaction, and real-time physics.

**Interactivity:**
- Click and drag cloth/rope/jelly
- Click to tear/cut cloth
- Pin points to create curtains, hammocks, bridges
- Gravity direction and strength sliders
- Wind force toggle
- Adjustable stiffness, damping, iterations

**Reference implementations:**
- [Pikuma Verlet Cloth Tutorial](https://pikuma.com/blog/verlet-integration-2d-cloth-physics-simulation)
- [JS Cloth Simulation (GitHub)](https://github.com/ConstantineB6/js-cloth-simulation)
- [Tearable Cloth Tutorial (Envato)](https://code.tutsplus.com/simulate-tearable-cloth-and-ragdolls-with-simple-verlet-integration--gamedev-519t)
- [The Coding Train — Soft Body Character](https://thecodingtrain.com/challenges/177-soft-body-character/)

**Complexity:** Medium-High (Verlet integration, constraint solver, canvas rendering)

---

### Electromagnetic Field Visualizer
**Description:** Place positive and negative charges on a 2D canvas. See electric field lines, vector field arrows, and equipotential surfaces update in real-time. Add dipoles, capacitor plates, and observe superposition.

**Interactivity:**
- Click to place charges (drag to position)
- Adjust charge magnitude with scroll wheel
- Toggle between field lines, vector arrows, and equipotential contours
- Add preset configurations: dipole, capacitor, quadrupole
- Test charge that follows field lines when released
- Color-coded potential heat map

**Reference implementations:**
- [PhET Charges and Fields](https://phet.colorado.edu/en/simulations/charges-and-fields) — Gold standard educational sim
- [Academo Electric Field Line Simulator](https://academo.org/demos/electric-field-line-simulator/)
- [Falstad 3D Electrostatic Field Simulation](https://www.falstad.com/vector3de/)
- [CemSim](https://cemsim.com/) — EM field simulation in browser
- [MIT Visual Tour of Classical EM](https://web.mit.edu/8.02t/www/802TEAL3D/visualizations/guidedtour/Tour.htm)

**Complexity:** Medium (field calculation per pixel, GPU-friendly with shaders)

---

### Optics Bench
**Description:** Virtual optical bench where users place lenses (convex, concave), mirrors, prisms, and apertures. Ray tracing shows how light bends, focuses, and disperses. Build telescopes, microscopes, and fiber optics.

**Interactivity:**
- Drag-and-drop optical elements onto a bench
- Adjust focal length, curvature, refractive index
- Toggle between ray mode and wave mode
- Light source: point, parallel beam, divergent
- Color dispersion through prisms (rainbow)
- Preset builds: Galilean telescope, microscope, periscope

**Reference implementations:**
- [Ray Optics Simulation (PhyDemo)](https://phydemo.app/ray-optics/) — The best free browser tool
- [PhET Geometric Optics](https://phet.colorado.edu/en/simulations/geometric-optics)
- [Physics Classroom Optics Bench](https://www.physicsclassroom.com/interactive/reflection-and-mirrors/optics-bench/launch)
- [OpticalRayTracer](https://arachnoid.com/OpticalRayTracer/)

**Complexity:** High (ray tracing engine, Snell's law, multiple element types)

---

### Entropy & Maxwell's Demon
**Description:** Interactive demonstration of the 2nd law of thermodynamics. A box of particles (hot=red, cold=blue) with a controllable door in the middle. Play as Maxwell's Demon: try to sort particles. Shows entropy, temperature, and information cost in real-time.

**Interactivity:**
- Particles bouncing in a divided box (color = speed)
- Click/key to open/close the door between chambers
- Real-time entropy graph and temperature displays per chamber
- "Demon's memory" meter showing information cost
- Auto-play mode: watch entropy increase without intervention
- Reset and try different strategies

**Reference implementations:**
- [Stanford CS107 Maxwell's Demon](https://web.stanford.edu/class/archive/cs/cs107/cs107.1246/assign1-maxwell/maxwell.html)
- [Khan Academy — Maxwell's Demon](https://www.khanacademy.org/science/physics/thermodynamics/laws-of-thermodynamics/v/maxwell-s-demon)

**Complexity:** Medium (particle simulation, collision detection, entropy calculation)

---

### Pendulum Lab
**Description:** Single, double, and triple pendulum simulator. The double pendulum is a classic chaotic system — tiny changes in initial conditions produce wildly different trajectories. Trace paths to create beautiful chaotic art.

**Interactivity:**
- Drag pendulum bob to set initial angle
- Toggle 1/2/3 pendulum modes
- Adjustable mass, length, gravity, damping
- Trail rendering with color gradient (time or velocity)
- Side-by-side comparison of nearly-identical initial conditions (chaos demo)
- Lyapunov exponent display

**Complexity:** Medium

---

## Mathematics & Statistics

### Bayesian Inference Playground
**Description:** Interactive Bayes' theorem visualizer. Start with a prior distribution, observe evidence, and watch the posterior update. Multiple contexts: coin flipping, medical testing, A/B testing, spam filtering.

**Interactivity:**
- Draggable prior distribution curve (beta distribution shape)
- Click "observe" to add data points one at a time
- Watch posterior update with animation
- Toggle between different scenarios (coins, medical, A/B test)
- Side-by-side: frequentist vs Bayesian interpretation
- Adjustable sample size and evidence strength

**Reference implementations:**
- [Seeing Theory — Bayesian Inference](https://seeing-theory.brown.edu/bayesian-inference/)
- [Maths4ML](https://maths4ml.com/) — Interactive ML math foundations

**Complexity:** Medium

---

### Calculus Visualizer
**Description:** Interactive tool showing the geometric meaning of derivatives and integrals. Draw a function, see its derivative and integral update in real-time. Riemann sums with adjustable rectangles. Fundamental theorem of calculus made visual.

**Interactivity:**
- Draw custom functions by clicking control points
- Toggle derivative/integral curves
- Riemann sum with draggable rectangle count (1 to 1000)
- Left/right/midpoint/trapezoidal sum comparison
- Animated "sweeping" integral area
- Taylor series approximation with adjustable terms

**Complexity:** Medium

---

### Probability Distribution Explorer
**Description:** Interactive gallery of all major probability distributions. Adjust parameters with sliders and see PDF, CDF, and samples update in real-time. Compare distributions. Demonstrate Central Limit Theorem.

**Interactivity:**
- Select from 15+ distributions (normal, binomial, Poisson, exponential, etc.)
- Parameter sliders with instant visualization
- Toggle PDF/CDF/PMF view
- Random sample generator with histogram overlay
- CLT demo: average N samples from any distribution, watch it become normal
- Distribution fitting: paste data, find best-fit distribution

**Complexity:** Medium (you already have `distributions` tool — this extends it)

---

### Complex Number Visualizer
**Description:** Explore complex number operations on the Argand plane. Visualize multiplication as rotation+scaling, see roots of unity, and watch conformal mappings transform the complex plane.

**Interactivity:**
- Click to place complex numbers on the plane
- Drag to multiply, see rotation and scaling
- Roots of unity for any n
- Conformal mapping gallery (z^2, 1/z, e^z, sin(z))
- Grid transformation visualization
- Mandelbrot/Julia set connection

**Complexity:** Medium-High

---

## Machine Learning & AI

### Gradient Boosting Visualizer
**Description:** Step through how gradient boosting (XGBoost/LightGBM) builds an ensemble tree by tree. At each step, see the residuals, the new tree fitted to those residuals, and the combined prediction improving.

**Interactivity:**
- Choose a 1D or 2D dataset (sine wave, step function, noisy data)
- Step forward/backward through boosting rounds
- See: data + current prediction, residuals, new tree, updated prediction
- Adjustable learning rate, max depth, number of trees
- Loss curve updating in real-time
- Compare: single deep tree vs. boosted shallow trees

**Reference implementations:**
- [Gradient Boosting Visualization (gradientboost.com)](https://gradientboost.com/) — Interactive XGBoost/LightGBM/CatBoost
- [Alex Rogozhnikov's Gradient Boosting Explained](https://arogozhnikov.github.io/2016/06/24/gradient_boosting_explained.html) — Interactive demo with adjustable params

**Complexity:** High (tree building algorithm, residual computation, multi-step visualization)

---

### Dimensionality Reduction Explorer
**Description:** Load a dataset (MNIST digits, Iris, word embeddings), apply PCA/t-SNE/UMAP and see the 2D projection animate. Adjust hyperparameters (perplexity, n_neighbors, min_dist) and watch clusters form and deform.

**Interactivity:**
- Pre-loaded datasets (MNIST subset, Iris, wine, custom CSV upload)
- Toggle between PCA, t-SNE, UMAP
- Animated transitions between projections
- Perplexity/neighbors/min_dist sliders with live update
- Color points by class label
- Hover for data point details
- Compare two methods side by side

**Reference implementations:**
- [Google PAIR — Understanding UMAP](https://pair-code.github.io/understanding-umap/)
- [Plotly t-SNE and UMAP](https://plotly.com/python/t-sne-and-umap-projections/)
- [TensorTonic ML Math](https://www.tensortonic.com/ml-math)

**Complexity:** High (t-SNE/UMAP implementations in JS, animated transitions, dataset handling)

---

### Neural Network Loss Landscape
**Description:** 3D visualization of a neural network's loss landscape. Users train a small network and watch the optimization path through the loss surface. Compare SGD, Adam, RMSprop trajectories on the same surface.

**Interactivity:**
- 3D rotatable loss surface
- Animated optimization paths for different optimizers
- Adjustable learning rate, momentum, batch size
- Toggle between 2D contour and 3D surface views
- "Drop a ball" mode: click on the surface, watch gradient descent from that point
- Saddle point and local minima demonstrations

**Complexity:** High (3D rendering, optimization algorithms, loss computation)

---

### Transformer Tokenizer Comparison
**Description:** Type text and see how different tokenizers (BPE, WordPiece, SentencePiece, character-level) break it down. Compare token counts, vocabulary efficiency, and handling of multilingual text.

**Interactivity:**
- Text input with real-time tokenization
- Side-by-side comparison of 3-4 tokenizer types
- Color-coded token boundaries
- Token count and efficiency metrics
- Multilingual examples showing tokenizer biases
- Vocabulary overlap visualization

**Complexity:** Medium (you already have `tokenizer` — this extends with comparison)

---

## Computer Science & Systems

### OS Process Scheduler
**Description:** Simulate CPU scheduling algorithms: FCFS, SJF, Round Robin, Priority, Multilevel Feedback Queue. Animated Gantt chart shows processes executing, waiting, and context switching. Compare algorithm performance metrics.

**Interactivity:**
- Add processes with burst time, arrival time, priority
- Select algorithm from dropdown
- Animated Gantt chart with color-coded processes
- Real-time metrics: avg wait time, avg turnaround, CPU utilization
- Compare 2 algorithms side by side
- Pre-built scenarios (I/O-bound mix, CPU-bound mix, interactive)

**Reference implementations:**
- [CPU Scheduling Visualizer](https://cpu-scheduling-visualizer-ribhav.vercel.app/) — Free web-based tool
- [CPU Scheduling Algorithm Visualiser (GitHub)](https://github.com/PrinceSinghhub/CPU-SCHEDULING-ALGORITHM-VISUALISER)

**Complexity:** Medium

---

### DNS Resolver Visualizer
**Description:** Type a domain name and watch the recursive DNS resolution process animate step by step. Shows the journey: browser cache -> OS cache -> recursive resolver -> root server -> TLD server -> authoritative server -> response.

**Interactivity:**
- Text input for domain name
- Animated packet journey through DNS hierarchy
- Each server node shows what it knows and what it asks
- Timing display for each hop
- Toggle: recursive vs iterative resolution
- Cache hit/miss visualization
- Common DNS record types (A, AAAA, CNAME, MX, TXT)

**Reference implementations:**
- [NetVis (GitHub)](https://github.com/dborzov/NetVis) — d3.js protocol visualizer

**Complexity:** Medium

---

### TCP Handshake & Congestion
**Description:** Visualize TCP connection lifecycle: 3-way handshake (SYN/SYN-ACK/ACK), data transfer with sliding window, and congestion control (slow start, congestion avoidance, fast retransmit). Animated packets traveling between client and server.

**Interactivity:**
- Step-by-step handshake animation
- Adjustable window size and RTT
- Simulate packet loss (click to "drop" a packet)
- Congestion window graph updating in real-time
- Compare TCP Reno vs Cubic vs BBR
- Bandwidth-delay product visualization

**Reference implementations:**
- [NetVis (GitHub)](https://github.com/dborzov/NetVis)

**Complexity:** Medium-High

---

### Virtual Memory & Page Replacement
**Description:** Simulate page replacement algorithms (FIFO, LRU, Optimal, Clock). Visualize page table, TLB, physical frames, and page faults. Users generate memory access patterns and compare algorithm performance.

**Interactivity:**
- Memory access sequence input (manual or random)
- Visual page table with frame mapping
- Animated page loading/eviction
- Page fault counter and hit rate
- Compare 2-3 algorithms simultaneously
- Adjustable number of frames

**Complexity:** Medium

---

### Compiler Pipeline Visualizer
**Description:** Type code and watch it transform through compiler stages: lexing -> parsing -> AST -> semantic analysis -> IR -> optimization -> code generation. Each stage is visualized with appropriate diagrams.

**Interactivity:**
- Code input (simple expression language)
- Step through pipeline stages with arrows
- Token stream visualization (lexer output)
- Interactive AST tree (expandable nodes)
- IR/bytecode output
- Optimization toggles (constant folding, dead code elimination)

**Complexity:** High (mini compiler implementation)

---

## Generative Art & Creative

### Flow Field Generator
**Description:** Perlin noise flow fields with thousands of particle trails. Adjust noise parameters, color palettes, particle behavior. Export as SVG or PNG for prints/wallpapers.

**Interactivity:**
- Sliders: noise scale, octaves, particle count, trail length
- Color palette picker (predefined + custom)
- Click to place attractor/repulsor points
- Seed control for reproducible art
- Real-time rendering at 60fps
- Export to SVG/PNG at high resolution

**Complexity:** Medium (Canvas 2D, Perlin noise, particle system)

---

### Tessellation Designer
**Description:** Create Escher-style tessellations by deforming a base tile (square, hexagon, triangle). As you drag control points on one edge, the opposite edge deforms to match, ensuring the pattern tiles perfectly. The full tiled plane updates in real-time.

**Interactivity:**
- Choose base tile shape (square, hex, triangle)
- Drag control points to deform edges
- Mirrored/rotated edges auto-update to maintain tileability
- Color individual tiles or auto-color
- Infinite pan/zoom of the tiled plane
- Export pattern as SVG

**Reference implementations:**
- [Tessellations Nicolas](https://en.tessellations-nicolas.com/method.php) — Free online tessellation method
- [Edkins Escher Tessellation Maker](https://www.theedkins.co.uk/jo/tess/sqtile2.htm)
- [Generative Escher Meshes](https://imagine.enpc.fr/~groueixt/escher/) — ENPC research

**Complexity:** High (edge constraint system, tiling rules, real-time pattern generation)

---

### Lissajous Curve Lab
**Description:** Draw Lissajous curves (parametric curves from two sine waves at right angles). Adjust frequencies, phase, and damping. Produces beautiful oscilloscope-like patterns.

**Interactivity:**
- Sliders for x-frequency, y-frequency, phase offset, damping
- Animated drawing with trail
- Frequency ratio display (musical intervals!)
- Color based on velocity or time
- 3D mode (add z-frequency)
- Audio output of the two frequencies

**Complexity:** Low-Medium

---

### Spirograph
**Description:** Digital spirograph with adjustable gear ratios. Choose inner/outer gear radii and pen position. The mathematical result (hypotrochoid/epitrochoid curves) creates stunning patterns.

**Interactivity:**
- Sliders for outer radius, inner radius, pen distance
- Animated pen drawing the curve
- Color gradient along the path
- Multiple layers (superimpose patterns)
- Preset gallery of classic spirograph patterns
- Export to SVG

**Complexity:** Low-Medium

---

## Education & Explorable Explanations

### How Search Engines Work
**Description:** Interactive explanation of web search: crawling, indexing, PageRank, and query matching. Users build a mini web graph, run a crawler, compute PageRank, and execute search queries.

**Interactivity:**
- Build a web graph: add pages (nodes) and links (edges)
- Run animated crawler visiting pages
- Watch the inverted index build up
- Compute PageRank (animated random walk or power iteration)
- Search bar: type query, see TF-IDF ranking + PageRank blend
- Show how link spam / SEO affects results

**Complexity:** High

---

### How Compression Works
**Description:** Type text and watch LZ77, Huffman, and other compression algorithms work step by step. See the sliding window, frequency table, and Huffman tree build in real-time. You already have `compression-viz` — this extends with more algorithms and side-by-side comparison.

**Interactivity:**
- Text input with character-by-character processing
- Animated sliding window (LZ77)
- Huffman tree building animation
- Comparison table: compression ratio for each algorithm
- Binary output visualization
- Image compression demo (JPEG DCT blocks)

**Complexity:** Medium (extends existing tool)

---

### How Git Works
**Description:** Visual explanation of Git's internal data model. Create commits, branches, merge, and rebase — see the DAG of commits, the tree objects, and blob storage. Demystifies Git's "plumbing."

**Interactivity:**
- Type git commands in a mini terminal
- DAG visualization updates with each command
- Explore commit objects, trees, and blobs
- Branch/merge/rebase animations
- Conflict resolution demo
- HEAD, refs, and reflog visualization

**Complexity:** High (mini Git implementation, DAG rendering)

---

### LOOPY-style System Dynamics
**Description:** Draw causal loop diagrams with nodes and arrows, then simulate how the system evolves. Great for understanding feedback loops in climate, economics, biology, and social systems.

**Interactivity:**
- Draw nodes (variables) and directed edges (causal links)
- Mark edges as positive (+) or negative (-) feedback
- Set initial values and run simulation
- Watch variables oscillate, grow, or stabilize
- Preset examples: predator-prey, thermostat, economic cycles, climate
- Export diagram as image

**Reference implementations:**
- [Nicky Case — LOOPY](https://ncase.me/loopy/) — The original tool for thinking in systems

**Complexity:** Medium-High

---

## Priority Matrix

| Tool | Wow Factor | Practicality | Uniqueness | Build Effort | Score |
|------|-----------|-------------|-----------|-------------|-------|
| Evolution of Cooperation | 5 | 3 | 5 | High | 13 |
| Soft Body / Cloth Sim | 5 | 2 | 4 | Medium-High | 11 |
| Investment Portfolio Sim | 3 | 5 | 3 | High | 11 |
| Optics Bench | 5 | 3 | 4 | High | 12 |
| Supply & Demand Sim | 3 | 4 | 4 | Medium | 11 |
| Bayesian Inference | 4 | 4 | 4 | Medium | 12 |
| Electromagnetic Field Viz | 5 | 3 | 4 | Medium | 12 |
| Flow Field Generator | 4 | 2 | 3 | Medium | 9 |
| Gradient Boosting Viz | 4 | 4 | 5 | High | 13 |
| OS Process Scheduler | 3 | 4 | 3 | Medium | 10 |
| Entropy / Maxwell's Demon | 5 | 3 | 5 | Medium | 13 |
| Tessellation Designer | 5 | 2 | 5 | High | 12 |
| DNS Resolver Viz | 3 | 4 | 4 | Medium | 11 |
| Dimensionality Reduction | 4 | 4 | 4 | High | 12 |
| Calculus Visualizer | 4 | 4 | 3 | Medium | 11 |
| TCP Congestion Viz | 3 | 3 | 4 | Medium-High | 10 |
| How Git Works | 4 | 5 | 4 | High | 13 |
| Compiler Pipeline | 4 | 3 | 5 | High | 12 |
| Voting Systems Explorer | 4 | 3 | 5 | High | 12 |
| Pendulum Lab | 4 | 2 | 3 | Medium | 9 |
| Lissajous Curve Lab | 3 | 1 | 3 | Low | 7 |
| Spirograph | 3 | 1 | 2 | Low | 6 |
| Amortization Race | 3 | 5 | 3 | Medium | 11 |
| Segregation Sim | 4 | 3 | 4 | Medium | 11 |
| LOOPY System Dynamics | 4 | 4 | 4 | Medium-High | 12 |
| Complex Number Viz | 4 | 3 | 4 | Medium-High | 11 |
| Virtual Memory Sim | 3 | 4 | 3 | Medium | 10 |
| Neural Net Loss Landscape | 5 | 3 | 5 | High | 13 |
| Compound Interest Viz | 3 | 5 | 2 | Medium | 10 |
| Search Engine Explainer | 4 | 4 | 5 | High | 13 |
| How Git Works | 4 | 5 | 4 | High | 13 |
| Tokenizer Comparison | 3 | 4 | 3 | Medium | 10 |
| Probability Dist Explorer | 3 | 4 | 2 | Medium | 9 |

> Scores: Wow + Practicality + Uniqueness (each 1-5, max 15). Higher = better candidate.

---

## Top Recommendations (Score >= 12)

1. **Evolution of Cooperation** (13) — Viral potential, game theory is captivating
2. **Entropy / Maxwell's Demon** (13) — Physics + gamification, unique concept
3. **Neural Net Loss Landscape** (13) — Stunning 3D viz, ML audience loves it
4. **Gradient Boosting Visualizer** (13) — Fills a real gap in ML education
5. **How Git Works** (13) — Extremely practical, wide audience
6. **Search Engine Explainer** (13) — Universal relevance, great story
7. **Optics Bench** (12) — Beautiful ray tracing, drag-and-drop physics
8. **Electromagnetic Field Viz** (12) — Classic physics sim, GPU-friendly
9. **Tessellation Designer** (12) — Art + math, shareable results
10. **Bayesian Inference Playground** (12) — Fills educational gap
11. **Voting Systems Explorer** (12) — Politically engaging, timely
12. **LOOPY System Dynamics** (12) — Systems thinking tool, broad applications
13. **Compiler Pipeline** (12) — CS education, unique interactive format
14. **Dimensionality Reduction** (12) — ML practitioners love this

---

## Sources

### General Collections
- [Awesome Creative Coding](https://github.com/terkelg/awesome-creative-coding)
- [Awesome Explorables](https://github.com/blob42/awesome-explorables)
- [Awesome Interactive Math](https://github.com/ubavic/awesome-interactive-math)
- [Chrome Experiments](https://experiments.withgoogle.com/collection/chrome)
- [Explorable Explanations Hub](https://explorabl.es/math/)
- [Nicky Case's Projects](https://ncase.me/projects/)

### Finance
- [SudoTool Investment Simulator](https://sudotool.com/tools/investment-simulator)
- [NerdWallet Calculator](https://www.nerdwallet.com/calculator/compound-interest-calculator)
- [EconGraphs](https://www.econgraphs.org/)

### Physics
- [PhET Simulations](https://phet.colorado.edu/)
- [Ray Optics Simulation](https://phydemo.app/ray-optics/)
- [Falstad Simulations](https://www.falstad.com/vector3de/)
- [CemSim EM Simulator](https://cemsim.com/)
- [Pikuma Verlet Integration](https://pikuma.com/blog/verlet-integration-2d-cloth-physics-simulation)

### ML & Data
- [Google PAIR — Understanding UMAP](https://pair-code.github.io/understanding-umap/)
- [GradientBoost.com](https://gradientboost.com/)
- [TensorTonic ML Math](https://www.tensortonic.com/ml-math)
- [Maths4ML](https://maths4ml.com/)

### CS & Systems
- [CPU Scheduling Visualizer](https://cpu-scheduling-visualizer-ribhav.vercel.app/)
- [NetVis Protocol Visualizer](https://github.com/dborzov/NetVis)

### Art & Creative
- [Tessellations Nicolas](https://en.tessellations-nicolas.com/method.php)
- [Edkins Tessellation Maker](https://www.theedkins.co.uk/jo/tess/sqtile2.htm)
