# Feature Spec: Brain — Interactive Knowledge Graph

**Status:** Draft
**Author:** Artemio Padilla + Claude
**Date:** 2026-03-05
**Page:** `/brain`

---

## 1. Vision

A full-screen, immersive knowledge graph that maps Artemio's understanding across all domains — science, philosophy, technology, society, love, daily life. Visitors land on the page and the graph *is* the page: a living, navigable map of interconnected ideas.

Two visualization modes (2D and 3D) with a seamless toggle. Nodes carry rich content. Clicking a concept opens a quick-look panel; clicking through leads to a dedicated page. The entire graph is queryable by external LLMs via semantic search.

---

## 2. Data Model

### 2.1 Node

```typescript
interface KnowledgeNode {
  id: string;                   // path-based: "physics/thermodynamics/entropy"
  label: string;                // "Entropy"
  type: NodeType;               // hierarchy level
  content?: string;             // markdown body (rendered in detail view)
  summary?: string;             // 1-2 sentence summary (used in panel + embeddings)
  tags: string[];               // cross-cutting: ["information-theory", "arrow-of-time"]
  links?: string[];             // external references (URLs)
  metadata?: {
    added: string;              // ISO date
    updated?: string;
    importance?: 1 | 2 | 3;     // 1=foundational, 2=notable, 3=peripheral
    status?: "seed" | "growing" | "mature";
  };
}

type NodeType = "domain" | "topic" | "concept" | "claim" | "source";
```

### 2.2 Edge

```typescript
interface KnowledgeEdge {
  source: string;               // node id
  target: string;               // node id
  relation: EdgeRelation;       // controlled vocabulary
  label?: string;               // free-form annotation
  weight?: number;              // 0-1, strength of connection
}

type EdgeRelation =
  | "is-part-of"        // hierarchical (tree structure)
  | "relates-to"        // general association
  | "causes"            // causal relationship
  | "contradicts"       // tension / opposition
  | "supports"          // evidence / reinforcement
  | "inspired-by"       // intellectual lineage
  | "applies-to"        // practical application
  | "generalizes"       // abstraction
  | "specializes"       // concretization
  | "analogous-to";     // structural similarity across domains
```

### 2.3 Graph Data File

Single source of truth: `src/content/knowledge/graph.json`

```typescript
interface KnowledgeGraph {
  version: string;
  lastUpdated: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}
```

**Tree structure is implicit**: a node `physics/thermodynamics/entropy` is a child of `physics/thermodynamics`, which is a child of `physics`. The `is-part-of` edges are auto-generated from path hierarchy at build time. Cross-domain edges are the interesting ones — manually authored.

### 2.4 Schema Validation

`src/content/knowledge/graph-schema.json` — JSON Schema draft-07, validated at build time with Ajv (same pattern as CV pipeline). Build fails if graph data is invalid.

---

## 3. Architecture

### 3.1 Data Layer (Backend-Agnostic)

```typescript
interface GraphDataProvider {
  getGraph(): Promise<KnowledgeGraph>;
  getNode(id: string): Promise<KnowledgeNode | null>;
  getNeighbors(id: string, depth?: number): Promise<KnowledgeGraph>;
  search(query: string): Promise<KnowledgeNode[]>;
}
```

**Phase 1 implementation:** `StaticGraphProvider` — loads from build-time JSON.
**Future:** Swap to API-backed provider without touching viz or query layers.

### 3.2 Visualization Layer

Both 2D and 3D renderers consume the same `GraphDataProvider` interface.

| Feature | 2D | 3D |
|---|---|---|
| **Engine** | Sigma.js (WebGL) | 3d-force-graph (Three.js) |
| **Why** | Handles 10k+ nodes, GPU-accelerated, great API | Best 3D force graph out of the box |
| **Layout** | ForceAtlas2 (Sigma built-in) | Force-directed (d3-force-3d) |
| **Interaction** | Click, hover, zoom, pan, lasso select | Click, hover, orbit, zoom |
| **Mobile** | Full touch support | Orbit + tap (gyroscope optional) |

**Toggle:** A floating control switches between 2D/3D. Camera position / selected node persists across the switch.

### 3.3 Query Layer (Progressive)

| Phase | Tech | Capability | Cost |
|---|---|---|---|
| **1** | Fuse.js | Fuzzy text search over labels, summaries, tags | Free, client-side |
| **2** | WebLLM + pre-computed embeddings | Semantic search, "find concepts related to X" | Free, client-side |
| **3** | API-backed (optional) | Full RAG, LLM synthesis, MCP server | Paid |

---

## 4. Page Design

### 4.1 Layout: Full-Screen Immersive

```
+------------------------------------------------------------------+
|  [Artemio.]  Home  Blog  CV  Lab  Projects  Brain  Art      [O]  |  <- existing nav
+------------------------------------------------------------------+
|                                                                    |
|  [Search bar _________________________ ]    [2D|3D]  [Filters v]  |  <- floating controls
|                                                                    |
|                     G R A P H                                      |
|                  (full viewport)                                   |
|                                                                    |
|                                          +------------------------+|
|                                          | DETAIL PANEL (slide-in)||
|                                          |                        ||
|                                          | [Node Title]           ||
|                                          | [Summary]              ||
|                                          | [Tags]                 ||
|                                          | [Connections list]     ||
|                                          | [-> Full page]         ||
|                                          +------------------------+|
|                                                                    |
|  [domain legend]                              [zoom +/-] [reset]   |  <- floating controls
+------------------------------------------------------------------+
```

- Graph fills the entire viewport below the nav bar
- Controls float over the graph with glassmorphism/translucent style
- Detail panel slides in from the right on node click
- Mobile: panel slides up from the bottom (drawer)

### 4.2 Visual Encoding

| Property | Encoding |
|---|---|
| **Node type** | Size — domains largest, sources smallest |
| **Domain** | Color — each top-level domain gets a distinct hue |
| **Importance** | Opacity/glow — foundational nodes glow brighter |
| **Status** | Border style — seed=dashed, growing=solid, mature=solid+glow |
| **Edge relation** | Color + dash pattern — causal=solid, contradicts=red dashed, etc. |
| **Edge weight** | Thickness |
| **Hover** | Node enlarges, label appears, immediate neighbors highlight |
| **Selected** | Pulse animation, neighbors stay highlighted, rest dims |

### 4.3 Color Palette (by domain)

Derived from the site's existing CSS variable system. Each domain gets a hue:

```
Science       → #4f8ff7 (primary blue)
Philosophy    → #a78bfa (violet)
Technology    → #34d399 (accent green)
Society       → #f59e0b (amber)
Art & Culture → #ec4899 (pink)
Personal      → #f97316 (orange)
Mathematics   → #06b6d4 (cyan)
```

### 4.4 Detail Panel

On node click:
1. Panel slides in (right on desktop, bottom on mobile)
2. Shows: label, type badge, summary, rendered markdown content, tags, list of connections (grouped by relation type), "Open full page" link
3. Clicking a connected node in the list navigates the graph to that node
4. Close button or click elsewhere dismisses

### 4.5 Full Node Pages

Route: `/brain/[...slug]` — e.g., `/brain/physics/thermodynamics/entropy`

Full-page view with:
- Rendered markdown content
- Breadcrumb from path hierarchy
- Mini-graph showing immediate neighborhood (2-hop)
- Related nodes sidebar
- Back to full graph link

Generated statically at build time from graph.json (Astro dynamic routes).

---

## 5. Interactions

### 5.1 Search

- Floating search bar, always visible
- As-you-type results dropdown (Fuse.js)
- Selecting a result centers + zooms the graph on that node and opens the detail panel
- Phase 2: semantic search toggle ("Search by meaning")

### 5.2 Filters

- Filter by domain (checkbox list)
- Filter by node type
- Filter by tag
- Filter by importance level
- Filters reduce visible nodes; graph re-layouts smoothly

### 5.3 Navigation

- Click node: select + open panel
- Double-click node: zoom into neighborhood (hide distant nodes)
- Right-click / long-press: context menu (open full page, copy link, show path)
- Breadcrumb trail for navigation history
- URL updates on selection: `/brain?node=physics/thermodynamics/entropy` (shareable deep links)

### 5.4 Keyboard

- `/` — focus search
- `Escape` — close panel / deselect
- Arrow keys — navigate between connected nodes
- `2` / `3` — switch 2D/3D
- `f` — toggle fullscreen
- `r` — reset view

---

## 6. Node Pages (Static Generation)

Astro generates a page for each node using `getStaticPaths()`:

```typescript
// src/pages/brain/[...slug].astro
export async function getStaticPaths() {
  const graph = await loadGraph();
  return graph.nodes.map(node => ({
    params: { slug: node.id },
    props: { node, neighbors: getNeighbors(graph, node.id, 2) }
  }));
}
```

Each page includes:
- Full rendered markdown content
- Mini neighborhood graph (Preact island)
- Breadcrumb navigation
- Related nodes
- Metadata (date added, last updated, tags)

---

## 7. Tech Implementation

### 7.1 File Structure

```
src/
  content/knowledge/
    graph.json              # Source of truth
    graph-schema.json       # JSON Schema for validation
  types/
    knowledge.ts            # TypeScript interfaces
  utils/
    graph-loader.ts         # Load + validate graph data (like cv-loader.ts)
    graph-provider.ts       # GraphDataProvider interface + StaticGraphProvider
    graph-search.ts         # Fuse.js search index builder
  components/
    brain/
      BrainLayout.astro     # Full-screen layout wrapper
      GraphCanvas.tsx        # Preact island — main 2D/3D graph
      GraphControls.tsx      # Search, filters, view toggle
      DetailPanel.tsx        # Slide-in node detail
      MiniGraph.tsx          # Small neighborhood graph for node pages
      NodeBreadcrumb.astro   # Path hierarchy breadcrumb
      DomainLegend.tsx       # Color legend
  pages/
    brain/
      index.astro           # Main graph page
      [...slug].astro       # Individual node pages
scripts/
  validate-graph.ts         # Ajv validation (like validate-cv.ts)
```

### 7.2 Dependencies (new)

```
sigma                       # 2D graph rendering (WebGL)
graphology                  # Graph data structure (Sigma's backing lib)
graphology-layout-forceatlas2  # 2D layout algorithm
3d-force-graph              # 3D graph rendering
three                       # 3D engine (peer dep of 3d-force-graph)
fuse.js                     # Fuzzy search
```

### 7.3 Build Pipeline

1. `validate:graph` — Ajv validates `graph.json` against schema
2. `npm run build` calls `validate:graph` before Astro build
3. Astro build generates:
   - `/brain/index.html` — main graph page (JS-heavy Preact island)
   - `/brain/physics/thermodynamics/entropy/index.html` — one per node
4. Graph JSON is bundled as a static asset for client-side loading

### 7.4 Performance Considerations

- **Lazy load 3D engine** — Three.js is ~600KB. Only load when user toggles to 3D.
- **Web Workers** — Run ForceAtlas2 layout in a worker thread (Sigma supports this natively).
- **Progressive rendering** — Show domain-level nodes first, expand on zoom/click.
- **LOD (Level of Detail)** — In 3D, simplify distant nodes to dots.

---

## 8. Seed Content

~25 nodes across 6 domains to demonstrate the graph's potential:

### Science (5 nodes)
- `science` (domain)
- `science/physics` (topic)
- `science/physics/thermodynamics` (topic)
- `science/physics/thermodynamics/entropy` (concept) — "Measure of disorder; connects to information theory, arrow of time, and life"
- `science/physics/quantum-mechanics` (topic)

### Philosophy (4 nodes)
- `philosophy` (domain)
- `philosophy/epistemology` (topic)
- `philosophy/epistemology/knowledge-limits` (concept) — "What can we know? Godel, uncertainty, bounded rationality"
- `philosophy/consciousness` (topic)

### Technology (5 nodes)
- `technology` (domain)
- `technology/ai` (topic)
- `technology/ai/deep-learning` (topic)
- `technology/ai/deep-learning/transformers` (concept) — "Attention is all you need; self-attention, positional encoding"
- `technology/ai/embeddings` (concept) — "Dense vector representations; foundation of semantic search"

### Mathematics (3 nodes)
- `mathematics` (domain)
- `mathematics/information-theory` (topic)
- `mathematics/information-theory/shannons-entropy` (concept) — "H(X) = -sum(p log p); bridges physics and information"

### Society (4 nodes)
- `society` (domain)
- `society/systems-thinking` (topic)
- `society/systems-thinking/feedback-loops` (concept) — "Positive and negative feedback; governs markets, climate, relationships"
- `society/collective-intelligence` (concept) — "Wisdom of crowds, swarm intelligence, emergent knowledge"

### Personal (4 nodes)
- `personal` (domain)
- `personal/learning` (topic)
- `personal/learning/deliberate-practice` (concept) — "Purposeful, systematic, outside comfort zone"
- `personal/curiosity` (concept) — "The drive to understand; the root of all knowledge"

### Cross-Domain Edges (the interesting part)
- `shannons-entropy` --analogous-to--> `entropy` (information = thermodynamic entropy)
- `entropy` --relates-to--> `knowledge-limits` (unknowability at the edges)
- `embeddings` --applies-to--> `shannons-entropy` (learned representations encode information)
- `consciousness` --contradicts--> `knowledge-limits` (the hard problem)
- `feedback-loops` --applies-to--> `deliberate-practice` (practice as a feedback system)
- `collective-intelligence` --relates-to--> `transformers` (attention as collective information routing)
- `curiosity` --causes--> all domain nodes (the root motivation)

---

## 9. Progressive Delivery

### Phase 1: Core (MVP)
- [ ] Data model + schema + validation pipeline
- [ ] Graph loader (StaticGraphProvider)
- [ ] Seed content (25 nodes, ~10 cross-domain edges)
- [ ] `/brain` page with full-screen 2D graph (Sigma.js)
- [ ] 3D graph toggle (3d-force-graph, lazy-loaded)
- [ ] Node click -> detail panel
- [ ] Fuzzy search (Fuse.js)
- [ ] Domain color legend
- [ ] Visual encoding (size, color, opacity)
- [ ] Keyboard shortcuts
- [ ] Mobile responsive (touch, bottom drawer)
- [ ] Nav bar updated ("Brain" link)
- [ ] Build pipeline integration (validate:graph)

### Phase 2: Node Pages + Polish
- [ ] `/brain/[...slug]` static pages for each node (full markdown content)
- [ ] Mini neighborhood graph on node pages
- [ ] Filter panel (domain, type, tags)
- [ ] URL deep linking (`/brain?node=...`)
- [ ] Smooth 2D<->3D camera transition
- [ ] Navigation history / breadcrumbs
- [ ] Animation polish (hover, select, transitions)
- [ ] Graph metrics overlay (centrality, clustering, betweenness, PageRank)
- [ ] Export buttons (JSON-LD, RDF/Turtle)
- [ ] Graph versioning (`npm run prepare:graph-release`)
- [ ] CONTRIBUTING.md for public node/edge contributions

### Phase 3: Semantic Search + LLM
- [ ] Pre-computed embeddings (build-time, stored as JSON)
- [ ] WebLLM integration for client-side semantic search
- [ ] "Search by meaning" toggle
- [ ] API key fallback for hosted LLM
- [ ] Graph traversal queries ("what connects X to Y?")

### Phase 4: Authoring + Ingestion
- [ ] CLI tool: `npm run kg:add`
- [ ] Markdown folder scanner (reads .md files, generates nodes)
- [ ] LLM-assisted extraction (paste article -> nodes + edges)
- [ ] Blog post <-> graph bidirectional linking

### Phase 5: Scale + Backend
- [ ] GraphDataProvider backed by API
- [ ] Vector database for embeddings
- [ ] MCP server for external LLM querying
- [ ] Progressive loading (load neighborhood on demand)

---

## 10. Resolved Design Decisions

1. **Content depth** — Both. Nodes carry a short `summary` (1-2 sentences, used in panel + embeddings) AND a full `content` field (markdown, rendered on dedicated node pages). Ranges from a paragraph to a full essay depending on the concept.
2. **Versioning** — Yes. Graph has a `version` field (semver) and `lastUpdated`. A `npm run prepare:graph-release` script bumps version. Git history tracks evolution over time. Future: visual "time travel" to see the graph at any point.
3. **Public contribution** — Yes. Others can suggest nodes/edges via GitHub PRs. `CONTRIBUTING.md` will document the schema and conventions. Schema validation in CI catches malformed contributions.
4. **Graph metrics overlay** — Yes. Educational overlay showing centrality, clustering coefficient, betweenness, PageRank per node. Toggle-able panel. Bridges to the existing graph-algorithms lab tool.
5. **Export** — JSON-LD (for linked data / semantic web interop) + RDF/Turtle (most robust standard for knowledge representation, SPARQL-queryable, interoperable with Wikidata/DBpedia). Export buttons on the `/brain` page.

---

## 11. Acceptance Criteria (Phase 1)

- [ ] `/brain` loads a full-screen interactive graph with 25+ seed nodes
- [ ] 2D (Sigma.js) and 3D (3d-force-graph) views toggle smoothly
- [ ] Clicking a node opens a detail panel with summary, tags, and connections
- [ ] Search bar finds nodes by label, tags, or summary text
- [ ] Nodes are visually differentiated by domain (color) and type (size)
- [ ] Works on mobile (touch navigation, bottom drawer for details)
- [ ] Build validates graph.json schema — invalid data fails the build
- [ ] 3D engine lazy-loads (not in initial bundle)
- [ ] Page follows existing site theming (dark/light mode)
- [ ] Performance: graph renders in <2s with 25 nodes, <5s with 500 nodes
