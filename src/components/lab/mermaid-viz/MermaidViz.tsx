import { useState, useEffect, useRef, useCallback } from "preact/hooks";

/* ──────────────────────────────────────
   Types
   ────────────────────────────────────── */

interface MermaidAPI {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
}

interface DiagramPreset {
  name: string;
  type: string;
  code: string;
}

type MermaidTheme = "default" | "dark" | "forest" | "neutral";
type FlowDirection = "TD" | "LR" | "BT" | "RL";
type ViewMode = "split" | "editor" | "preview";

/* ──────────────────────────────────────
   Constants
   ────────────────────────────────────── */

const MERMAID_CDN =
  "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

const DEBOUNCE_MS = 300;

const MERMAID_THEMES: { value: MermaidTheme; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "dark", label: "Dark" },
  { value: "forest", label: "Forest" },
  { value: "neutral", label: "Neutral" },
];

const FLOW_DIRECTIONS: { value: FlowDirection; label: string }[] = [
  { value: "TD", label: "Top-Down" },
  { value: "LR", label: "Left-Right" },
  { value: "BT", label: "Bottom-Top" },
  { value: "RL", label: "Right-Left" },
];

/* ──────────────────────────────────────
   Preset Diagrams
   ────────────────────────────────────── */

const PRESETS: DiagramPreset[] = [
  {
    name: "CI/CD Pipeline",
    type: "flowchart",
    code: `graph TD
    A[Push to Repo] --> B{Run Tests}
    B -->|Pass| C[Build Docker Image]
    B -->|Fail| D[Notify Developer]
    C --> E[Push to Registry]
    E --> F{Deploy to Staging}
    F -->|Pass QA| G[Deploy to Production]
    F -->|Fail QA| D
    G --> H[Health Check]
    H -->|Healthy| I[Route Traffic]
    H -->|Unhealthy| J[Rollback]
    J --> D`,
  },
  {
    name: "API Auth Flow",
    type: "sequence",
    code: `sequenceDiagram
    participant C as Client
    participant A as Auth Server
    participant R as Resource Server
    participant DB as Database

    C->>A: POST /auth/login (credentials)
    A->>DB: Validate credentials
    DB-->>A: User found
    A->>A: Generate JWT + Refresh Token
    A-->>C: 200 OK {access_token, refresh_token}

    C->>R: GET /api/data (Bearer token)
    R->>R: Validate JWT signature
    R->>DB: Fetch resource
    DB-->>R: Resource data
    R-->>C: 200 OK {data}

    Note over C,R: Token expires after 15 min

    C->>A: POST /auth/refresh (refresh_token)
    A->>DB: Validate refresh token
    DB-->>A: Token valid
    A-->>C: 200 OK {new_access_token}`,
  },
  {
    name: "Observer Pattern",
    type: "class",
    code: `classDiagram
    class Subject {
        -observers: Observer[]
        +attach(observer: Observer) void
        +detach(observer: Observer) void
        +notify() void
    }

    class Observer {
        <<interface>>
        +update(data: any) void
    }

    class ConcreteSubject {
        -state: string
        +getState() string
        +setState(state: string) void
    }

    class EmailNotifier {
        -email: string
        +update(data: any) void
    }

    class Logger {
        -logFile: string
        +update(data: any) void
    }

    class Dashboard {
        -metrics: Map
        +update(data: any) void
    }

    Subject <|-- ConcreteSubject
    Observer <|.. EmailNotifier
    Observer <|.. Logger
    Observer <|.. Dashboard
    Subject o-- Observer : observers`,
  },
  {
    name: "Order Lifecycle",
    type: "state",
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted : Place Order
    Submitted --> PaymentPending : Validate Items

    state PaymentPending {
        [*] --> Processing
        Processing --> Authorized : Payment OK
        Processing --> Declined : Payment Failed
        Declined --> Processing : Retry
    }

    PaymentPending --> Confirmed : Payment Authorized
    PaymentPending --> Cancelled : Payment Declined 3x
    Confirmed --> Shipped : Dispatch
    Shipped --> Delivered : Confirm Delivery
    Delivered --> [*]

    Confirmed --> Refunded : Cancel Before Ship
    Shipped --> ReturnRequested : Request Return
    ReturnRequested --> Refunded : Approve Return
    Refunded --> [*]
    Cancelled --> [*]`,
  },
  {
    name: "Blog DB Schema",
    type: "er",
    code: `erDiagram
    USER {
        int id PK
        string username UK
        string email UK
        string password_hash
        datetime created_at
        boolean is_active
    }

    POST {
        int id PK
        int author_id FK
        string title
        text content
        string slug UK
        enum status
        datetime published_at
        datetime updated_at
    }

    CATEGORY {
        int id PK
        string name UK
        string slug UK
        string description
    }

    TAG {
        int id PK
        string name UK
        string slug UK
    }

    COMMENT {
        int id PK
        int post_id FK
        int user_id FK
        text body
        datetime created_at
        boolean approved
    }

    USER ||--o{ POST : writes
    USER ||--o{ COMMENT : leaves
    POST ||--o{ COMMENT : has
    POST }o--o{ TAG : tagged
    POST }o--|| CATEGORY : belongs_to`,
  },
  {
    name: "Sprint Planning",
    type: "gantt",
    code: `gantt
    title Q1 Sprint Planning
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Design
    User Research        :done, des1, 2025-01-06, 5d
    Wireframes           :done, des2, after des1, 3d
    UI Mockups           :active, des3, after des2, 4d
    Design Review        :des4, after des3, 2d

    section Backend
    API Design           :done, be1, 2025-01-06, 3d
    Auth Module          :active, be2, after be1, 5d
    Data Models          :be3, after be1, 4d
    REST Endpoints       :be4, after be2, 6d
    Integration Tests    :be5, after be4, 3d

    section Frontend
    Component Library    :fe1, after des3, 5d
    Page Templates       :fe2, after fe1, 4d
    API Integration      :fe3, after be4, 4d
    E2E Tests            :fe4, after fe3, 3d

    section Release
    Staging Deploy       :rel1, after be5, 2d
    UAT                  :rel2, after rel1, 3d
    Production Release   :milestone, rel3, after rel2, 0d`,
  },
  {
    name: "Tech Stack",
    type: "pie",
    code: `pie showData
    title Technology Stack Distribution
    "TypeScript" : 35
    "Python" : 25
    "Rust" : 15
    "Go" : 10
    "SQL" : 8
    "Shell" : 5
    "Other" : 2`,
  },
  {
    name: "Feature Branch Workflow",
    type: "git",
    code: `gitGraph
    commit id: "init"
    commit id: "setup"
    branch develop
    checkout develop
    commit id: "dev-config"
    branch feature/auth
    checkout feature/auth
    commit id: "login-ui"
    commit id: "auth-api"
    commit id: "jwt-tokens"
    checkout develop
    merge feature/auth id: "merge-auth"
    branch feature/dashboard
    checkout feature/dashboard
    commit id: "layout"
    commit id: "charts"
    checkout develop
    branch hotfix/security
    checkout hotfix/security
    commit id: "patch-xss"
    checkout develop
    merge hotfix/security id: "merge-hotfix"
    checkout main
    merge develop id: "release-v1"
    checkout develop
    merge feature/dashboard id: "merge-dashboard"
    checkout main
    merge develop id: "release-v2"`,
  },
  {
    name: "System Architecture",
    type: "mindmap",
    code: `mindmap
  root((System Architecture))
    Frontend
      React SPA
        Components
        State Management
        Routing
      Mobile App
        iOS (Swift)
        Android (Kotlin)
    Backend
      API Gateway
        Rate Limiting
        Auth Middleware
      Microservices
        User Service
        Order Service
        Payment Service
        Notification Service
    Data Layer
      PostgreSQL
        Read Replicas
        Partitioning
      Redis Cache
        Session Store
        Query Cache
      S3 Storage
        Media Files
        Backups
    Infrastructure
      Kubernetes
        Auto-scaling
        Health Checks
      CI/CD Pipeline
        GitHub Actions
        ArgoCD
      Monitoring
        Prometheus
        Grafana
        PagerDuty`,
  },
  {
    name: "Project Milestones",
    type: "timeline",
    code: `timeline
    title Product Launch Timeline
    section Phase 1 - Foundation
        January 2025 : Team Formation
                     : Tech Stack Decision
                     : Architecture Design
        February 2025 : Core API Development
                      : Database Schema
                      : CI/CD Pipeline
    section Phase 2 - Development
        March 2025 : User Authentication
                   : Dashboard MVP
                   : Payment Integration
        April 2025 : Notification System
                   : Admin Panel
                   : Mobile App Start
    section Phase 3 - Testing
        May 2025 : Integration Testing
                 : Security Audit
                 : Performance Tuning
        June 2025 : Beta Launch
                  : User Feedback
                  : Bug Fixes
    section Phase 4 - Launch
        July 2025 : Production Deploy
                  : Marketing Campaign
                  : Public Launch`,
  },
];

/* ──────────────────────────────────────
   Cheat Sheet Data
   ────────────────────────────────────── */

const CHEAT_SHEET_SECTIONS = [
  {
    title: "Flowchart",
    items: [
      "graph TD (top-down) / LR (left-right)",
      "A[Rectangle] B(Rounded) C{Diamond} D((Circle))",
      "A --> B (arrow) A --- B (line) A -.-> B (dotted)",
      'A -->|text| B (labeled arrow)',
    ],
  },
  {
    title: "Sequence Diagram",
    items: [
      "sequenceDiagram",
      "participant A as Alice",
      "A->>B: Message (solid arrow)",
      "A-->>B: Response (dashed arrow)",
      "Note over A,B: Note text",
      "loop Loop text ... end",
      "alt Condition ... else ... end",
    ],
  },
  {
    title: "Class Diagram",
    items: [
      "classDiagram",
      "class Name { +method() type }",
      "A <|-- B (inheritance)",
      "A *-- B (composition)",
      "A o-- B (aggregation)",
      "A --> B (association)",
    ],
  },
  {
    title: "State Diagram",
    items: [
      "stateDiagram-v2",
      "[*] --> State (start)",
      "State --> [*] (end)",
      "State --> State2 : Event",
      "state Fork <<fork>>",
    ],
  },
  {
    title: "ER Diagram",
    items: [
      "erDiagram",
      "ENTITY { type name PK/FK }",
      "A ||--o{ B : rel (one-to-many)",
      "A }o--o{ B : rel (many-to-many)",
    ],
  },
  {
    title: "Other Types",
    items: [
      'pie title "Title" "Label" : value',
      "gantt title ... dateFormat YYYY-MM-DD",
      "gitGraph commit branch name",
      "mindmap root((text)) child grandchild",
      "timeline title ... section Name",
    ],
  },
];

/* ──────────────────────────────────────
   Helpers
   ────────────────────────────────────── */

let renderCounter = 0;

function uniqueRenderID(): string {
  renderCounter += 1;
  return `mermaid-render-${renderCounter}`;
}

/* ──────────────────────────────────────
   Component
   ────────────────────────────────────── */

export default function MermaidViz() {
  /* --- State --- */
  const [code, setCode] = useState(PRESETS[0].code);
  const [svgOutput, setSvgOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mermaidTheme, setMermaidTheme] = useState<MermaidTheme>("default");
  const [flowDirection, setFlowDirection] = useState<FlowDirection>("TD");
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCheatSheet, setShowCheatSheet] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  /* --- Pan & Zoom state --- */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOffset = useRef({ x: 0, y: 0 });

  /* --- Refs --- */
  const mermaidRef = useRef<MermaidAPI | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeRef = useRef(code);
  const previewRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const fullscreenRef = useRef<HTMLDivElement>(null);

  codeRef.current = code;

  /* ── Load Mermaid from CDN ── */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    async function loadMermaid() {
      try {
        const mod = await import(/* @vite-ignore */ MERMAID_CDN);
        if (cancelled) return;

        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "loose",
        });
        mermaidRef.current = mermaid;
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(
          `Failed to load Mermaid library: ${err instanceof Error ? err.message : String(err)}`
        );
        setLoading(false);
      }
    }

    loadMermaid();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Render diagram ── */
  const renderDiagram = useCallback(async (source: string) => {
    const mermaid = mermaidRef.current;
    if (!mermaid) return;

    try {
      const id = uniqueRenderID();
      const { svg } = await mermaid.render(id, source);
      setSvgOutput(svg);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      setError(message);
    }
  }, []);

  /* ── Re-init Mermaid when theme changes ── */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mermaid = mermaidRef.current;
    if (!mermaid) return;

    mermaid.initialize({
      startOnLoad: false,
      theme: mermaidTheme,
      securityLevel: "loose",
    });
    renderDiagram(codeRef.current);
  }, [mermaidTheme, renderDiagram]);

  /* ── Initial render when loaded ── */
  useEffect(() => {
    if (!loading && mermaidRef.current) {
      renderDiagram(codeRef.current);
    }
  }, [loading, renderDiagram]);

  /* ── Debounced auto-render ── */
  const scheduleRender = useCallback(
    (source: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        renderDiagram(source);
      }, DEBOUNCE_MS);
    },
    [renderDiagram]
  );

  /* ── Handle code change ── */
  const handleCodeChange = useCallback(
    (newCode: string) => {
      setCode(newCode);
      scheduleRender(newCode);
    },
    [scheduleRender]
  );

  /* ── Preset selection ── */
  const handlePresetChange = useCallback(
    (index: number) => {
      setSelectedPreset(index);
      const preset = PRESETS[index];
      setCode(preset.code);
      renderDiagram(preset.code);
    },
    [renderDiagram]
  );

  /* ── Direction toggle for flowcharts ── */
  const handleDirectionChange = useCallback(
    (dir: FlowDirection) => {
      setFlowDirection(dir);
      const updated = code.replace(
        /^(graph|flowchart)\s+(TD|LR|BT|RL)/m,
        `$1 ${dir}`
      );
      if (updated !== code) {
        setCode(updated);
        renderDiagram(updated);
      }
    },
    [code, renderDiagram]
  );

  /* ── Fit to view ── */
  const fitToView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /* ── Pan handlers ── */
  const handlePreviewMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 0) return;
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      panOffset.current = { ...pan };
    },
    [pan]
  );

  const handlePreviewMouseMove = useCallback((e: MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setPan({
      x: panOffset.current.x + dx,
      y: panOffset.current.y + dy,
    });
  }, []);

  const handlePreviewMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  /* ── Zoom handler (wheel) ── */
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setZoom((prev) => {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      return Math.min(Math.max(prev * factor, 0.1), 5);
    });
  }, []);

  /* ── Export: SVG download ── */
  const downloadSVG = useCallback(() => {
    if (!svgOutput) return;
    const blob = new Blob([svgOutput], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = "mermaid-diagram.svg";
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }, [svgOutput]);

  /* ── Export: PNG download ── */
  const downloadPNG = useCallback(() => {
    if (!svgOutput) return;

    const svgEl = new DOMParser().parseFromString(
      svgOutput,
      "image/svg+xml"
    ).documentElement;

    const width = parseInt(svgEl.getAttribute("width") || "800", 10);
    const height = parseInt(svgEl.getAttribute("height") || "600", 10);

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);

    const svgBlob = new Blob([svgOutput], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      const link = document.createElement("a");
      link.download = "mermaid-diagram.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = url;
  }, [svgOutput]);

  /* ── Copy SVG to clipboard ── */
  const copySVG = useCallback(async () => {
    if (!svgOutput) return;
    try {
      await navigator.clipboard.writeText(svgOutput);
      setCopyFeedback("SVG copied!");
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback("Copy failed");
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [svgOutput]);

  /* ── Copy Mermaid code to clipboard ── */
  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopyFeedback("Code copied!");
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setCopyFeedback("Copy failed");
      setTimeout(() => setCopyFeedback(null), 2000);
    }
  }, [code]);

  /* ── Fullscreen toggle ── */
  const toggleFullscreen = useCallback(() => {
    const container = fullscreenRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  /* ── Scroll sync for line numbers ── */
  const handleEditorScroll = useCallback((e: Event) => {
    const textarea = e.target as HTMLTextAreaElement;
    if (gutterRef.current) {
      gutterRef.current.scrollTop = textarea.scrollTop;
    }
  }, []);

  /* ── Cleanup debounce ── */
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  /* ── Derived values ── */
  const lineCount = code.split("\n").length;
  const isFlowchart = /^(graph|flowchart)\s+(TD|LR|BT|RL)/m.test(code);

  /* ── Render ── */
  return (
    <div class="flex flex-col gap-4">
      {/* Toolbar Row 1: Presets + Theme + Direction */}
      <div class="flex flex-wrap items-center gap-3">
        <select
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          value={selectedPreset}
          onChange={(e) =>
            handlePresetChange(
              parseInt((e.target as HTMLSelectElement).value, 10)
            )
          }
        >
          {PRESETS.map((preset, i) => (
            <option key={i} value={i}>
              {preset.name} ({preset.type})
            </option>
          ))}
        </select>

        <select
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
          value={mermaidTheme}
          onChange={(e) =>
            setMermaidTheme((e.target as HTMLSelectElement).value as MermaidTheme)
          }
        >
          {MERMAID_THEMES.map((t) => (
            <option key={t.value} value={t.value}>
              Theme: {t.label}
            </option>
          ))}
        </select>

        {isFlowchart && (
          <select
            class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            value={flowDirection}
            onChange={(e) =>
              handleDirectionChange(
                (e.target as HTMLSelectElement).value as FlowDirection
              )
            }
          >
            {FLOW_DIRECTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                Dir: {d.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Toolbar Row 2: View mode + Actions */}
      <div class="flex flex-wrap items-center gap-3">
        {/* View mode buttons */}
        <div class="flex rounded border border-[var(--color-border)] overflow-hidden">
          {(
            [
              { mode: "split" as ViewMode, label: "Split" },
              { mode: "editor" as ViewMode, label: "Editor" },
              { mode: "preview" as ViewMode, label: "Preview" },
            ] as const
          ).map(({ mode, label }) => (
            <button
              key={mode}
              class={`px-3 py-1.5 text-sm transition-colors ${
                viewMode === mode
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-[var(--color-surface)] text-[var(--color-text)] hover:text-[var(--color-heading)]"
              }`}
              onClick={() => setViewMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>

        <div class="h-4 w-px bg-[var(--color-border)]" />

        {/* Export buttons */}
        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)] disabled:opacity-40"
          onClick={downloadSVG}
          disabled={!svgOutput}
          title="Download SVG"
        >
          SVG
        </button>
        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)] disabled:opacity-40"
          onClick={downloadPNG}
          disabled={!svgOutput}
          title="Download PNG"
        >
          PNG
        </button>
        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)] disabled:opacity-40"
          onClick={copySVG}
          disabled={!svgOutput}
          title="Copy SVG to clipboard"
        >
          Copy SVG
        </button>
        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          onClick={copyCode}
          title="Copy Mermaid code"
        >
          Copy Code
        </button>

        <div class="h-4 w-px bg-[var(--color-border)]" />

        <button
          class="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-heading)]"
          onClick={() => setShowCheatSheet((v) => !v)}
        >
          {showCheatSheet ? "Hide" : "Cheat Sheet"}
        </button>

        {/* Copy feedback */}
        {copyFeedback && (
          <span class="text-xs text-[var(--color-accent)]">{copyFeedback}</span>
        )}
      </div>

      {/* Cheat Sheet Panel */}
      {showCheatSheet && (
        <div
          class="rounded-lg border border-[var(--color-border)] p-4"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--color-surface) 60%, transparent)",
          }}
        >
          <div class="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Mermaid Syntax Quick Reference
          </div>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CHEAT_SHEET_SECTIONS.map((section) => (
              <div key={section.title}>
                <div
                  class="mb-1 text-xs font-semibold"
                  style={{ color: "var(--color-primary)" }}
                >
                  {section.title}
                </div>
                <ul class="space-y-0.5">
                  {section.items.map((item, i) => (
                    <li
                      key={i}
                      class="text-xs text-[var(--color-text-muted)]"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Panels */}
      <div
        class={`flex gap-4 ${
          viewMode === "split"
            ? "flex-col lg:flex-row"
            : "flex-col"
        }`}
        style={{ minHeight: "500px" }}
      >
        {/* Editor Panel */}
        {viewMode !== "preview" && (
          <div
            class={`flex flex-col ${
              viewMode === "split" ? "lg:w-1/2" : "w-full"
            }`}
          >
            <div
              class="relative flex-1 overflow-hidden rounded-lg border border-[var(--color-border)]"
              style={{ minHeight: viewMode === "editor" ? "500px" : "400px" }}
            >
              <div class="flex h-full">
                {/* Line numbers gutter */}
                <div
                  ref={gutterRef}
                  class="select-none border-r border-[var(--color-border)] py-3 text-right"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                    lineHeight: "1.5",
                    width: "3rem",
                    color: "var(--color-text-muted)",
                    backgroundColor:
                      "color-mix(in srgb, var(--color-surface) 80%, transparent)",
                    overflow: "hidden",
                  }}
                >
                  <div class="px-2">
                    {Array.from({ length: lineCount }, (_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                </div>

                {/* Textarea */}
                <textarea
                  class="h-full flex-1 resize-none border-none bg-[var(--color-surface)] p-3 text-[var(--color-text)] outline-none"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                    lineHeight: "1.5",
                    tabSize: 2,
                  }}
                  value={code}
                  onInput={(e) =>
                    handleCodeChange(
                      (e.target as HTMLTextAreaElement).value
                    )
                  }
                  onScroll={handleEditorScroll}
                  spellcheck={false}
                  autocapitalize="off"
                  autocomplete="off"
                  placeholder="Enter Mermaid diagram code..."
                />
              </div>
            </div>

            {/* Error display */}
            {error && (
              <div
                class="mt-2 rounded px-3 py-2 text-xs"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "#ef4444",
                  backgroundColor:
                    "color-mix(in srgb, #ef4444 10%, transparent)",
                  maxHeight: "80px",
                  overflow: "auto",
                }}
              >
                {error}
              </div>
            )}

            {/* Syntax hints */}
            <div class="mt-2 text-xs text-[var(--color-text-muted)]">
              Supported: flowchart, sequence, class, state, er, gantt, pie, gitGraph, mindmap, timeline
            </div>
          </div>
        )}

        {/* Preview Panel */}
        {viewMode !== "editor" && (
          <div
            ref={fullscreenRef}
            class={`flex flex-col ${
              viewMode === "split" ? "lg:w-1/2" : "w-full"
            }`}
          >
            <div
              class="relative flex-1 overflow-hidden rounded-lg border border-[var(--color-border)]"
              style={{
                minHeight: viewMode === "preview" ? "500px" : "400px",
                backgroundColor: "#ffffff",
                cursor: isPanning.current ? "grabbing" : "grab",
              }}
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={handlePreviewMouseUp}
              onMouseLeave={handlePreviewMouseUp}
              onWheel={handleWheel}
            >
              {loading ? (
                <div class="flex h-full items-center justify-center">
                  <div class="flex flex-col items-center gap-3">
                    <div
                      class="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]"
                    />
                    <span class="text-sm text-gray-500">
                      Loading Mermaid...
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  ref={previewRef}
                  class="flex h-full items-center justify-center p-4"
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: "center center",
                    userSelect: "none",
                  }}
                  dangerouslySetInnerHTML={{ __html: svgOutput }}
                />
              )}

              {/* Zoom controls overlay */}
              <div
                class="absolute bottom-2 left-2 flex items-center gap-1 rounded px-2 py-1"
                style={{ backgroundColor: "rgba(255,255,255,0.9)" }}
              >
                <button
                  class="px-1.5 py-0.5 text-xs text-gray-600 hover:text-gray-900 transition-colors"
                  onClick={() =>
                    setZoom((z) => Math.min(z * 1.2, 5))
                  }
                  title="Zoom in"
                >
                  +
                </button>
                <span class="text-xs text-gray-500 min-w-[3rem] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  class="px-1.5 py-0.5 text-xs text-gray-600 hover:text-gray-900 transition-colors"
                  onClick={() =>
                    setZoom((z) => Math.max(z * 0.8, 0.1))
                  }
                  title="Zoom out"
                >
                  -
                </button>
                <div class="mx-1 h-3 w-px bg-gray-300" />
                <button
                  class="px-1.5 py-0.5 text-xs text-gray-600 hover:text-gray-900 transition-colors"
                  onClick={fitToView}
                  title="Fit to view"
                >
                  Fit
                </button>
              </div>

              {/* Fullscreen toggle */}
              <button
                class="absolute right-2 top-2 rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:text-gray-800"
                style={{ backgroundColor: "rgba(255,255,255,0.9)" }}
                onClick={toggleFullscreen}
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? "Exit FS" : "Fullscreen"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
