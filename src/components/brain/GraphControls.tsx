import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import type { FunctionalComponent } from "preact";
import type { KnowledgeNode } from "../../types/knowledge";
import { DOMAIN_COLORS, getNodeDomain } from "../../types/knowledge";

interface Props {
  nodes: KnowledgeNode[];
  viewMode: "2d" | "3d";
  onViewModeChange: (mode: "2d" | "3d") => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters: { domains: string[]; types: string[] };
  onFiltersChange: (filters: { domains: string[]; types: string[] }) => void;
  onNodeSelect: (node: KnowledgeNode) => void;
}

const GraphControls: FunctionalComponent<Props> = ({
  nodes,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  filters,
  onFiltersChange,
  onNodeSelect,
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<KnowledgeNode[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const fuseRef = useRef<any>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  // Initialize Fuse.js
  useEffect(() => {
    const initFuse = async () => {
      const { default: Fuse } = await import("fuse.js");
      fuseRef.current = new Fuse(nodes, {
        keys: [
          { name: "label", weight: 2 },
          { name: "summary", weight: 1 },
          { name: "tags", weight: 1.5 },
          { name: "id", weight: 0.5 },
        ],
        threshold: 0.4,
        includeScore: true,
      });
    };
    initFuse();
  }, [nodes]);

  // Search
  useEffect(() => {
    if (!searchQuery.trim() || !fuseRef.current) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const results = fuseRef.current.search(searchQuery).slice(0, 8);
    setSearchResults(results.map((r: any) => r.item));
    setShowResults(true);
  }, [searchQuery]);

  // Keyboard shortcut
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement;
        if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "2" && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement;
        if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;
        onViewModeChange("2d");
      }
      if (e.key === "3" && !e.ctrlKey && !e.metaKey) {
        const active = document.activeElement;
        if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;
        onViewModeChange("3d");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onViewModeChange]);

  // Close filter dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Get unique domains and types
  const domains = [...new Set(nodes.map((n) => getNodeDomain(n.id)))];
  const types = [...new Set(nodes.map((n) => n.type))];

  const toggleDomain = useCallback((domain: string) => {
    const newDomains = filters.domains.includes(domain)
      ? filters.domains.filter((d) => d !== domain)
      : [...filters.domains, domain];
    onFiltersChange({ ...filters, domains: newDomains });
  }, [filters, onFiltersChange]);

  const toggleType = useCallback((type: string) => {
    const newTypes = filters.types.includes(type)
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type];
    onFiltersChange({ ...filters, types: newTypes });
  }, [filters, onFiltersChange]);

  const clearFilters = useCallback(() => {
    onFiltersChange({ domains: [], types: [] });
  }, [onFiltersChange]);

  const hasActiveFilters = filters.domains.length > 0 || filters.types.length > 0;

  return (
    <div class="graph-controls">
      {/* Search */}
      <div class="graph-search-container">
        <div class="graph-search-wrapper">
          <svg class="graph-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder='Search nodes...  (press "/")'
            value={searchQuery}
            onInput={(e) => onSearchChange((e.target as HTMLInputElement).value)}
            onFocus={() => {
              if (searchResults.length > 0) setShowResults(true);
            }}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            class="graph-search-input"
          />
          {searchQuery && (
            <button
              onClick={() => {
                onSearchChange("");
                searchRef.current?.focus();
              }}
              class="graph-search-clear"
            >
              ×
            </button>
          )}
        </div>

        {/* Search results dropdown */}
        {showResults && searchResults.length > 0 && (
          <div class="graph-search-results">
            {searchResults.map((node) => (
              <button
                key={node.id}
                class="graph-search-result"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onNodeSelect(node);
                  onSearchChange("");
                  setShowResults(false);
                }}
              >
                <span
                  class="graph-search-result-dot"
                  style={{ backgroundColor: DOMAIN_COLORS[getNodeDomain(node.id)] || "#888" }}
                />
                <div class="graph-search-result-text">
                  <span class="graph-search-result-label">{node.label}</span>
                  <span class="graph-search-result-path">{node.id}</span>
                </div>
                <span class="graph-search-result-type">{node.type}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View mode toggle */}
      <div class="graph-view-toggle">
        <button
          onClick={() => onViewModeChange("2d")}
          class={`graph-view-btn ${viewMode === "2d" ? "active" : ""}`}
        >
          2D
        </button>
        <button
          onClick={() => onViewModeChange("3d")}
          class={`graph-view-btn ${viewMode === "3d" ? "active" : ""}`}
        >
          3D
        </button>
      </div>

      {/* Filter button */}
      <div ref={filterRef} class="graph-filter-container">
        <button
          onClick={() => setShowFilters(!showFilters)}
          class={`graph-filter-btn ${hasActiveFilters ? "active" : ""}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          {hasActiveFilters && (
            <span class="graph-filter-badge">
              {filters.domains.length + filters.types.length}
            </span>
          )}
        </button>

        {showFilters && (
          <div class="graph-filter-dropdown">
            <div class="graph-filter-section">
              <div class="graph-filter-section-header">
                <span>Domains</span>
                {hasActiveFilters && (
                  <button onClick={clearFilters} class="graph-filter-clear">Clear all</button>
                )}
              </div>
              {domains.map((domain) => (
                <label key={domain} class="graph-filter-option">
                  <input
                    type="checkbox"
                    checked={filters.domains.includes(domain)}
                    onChange={() => toggleDomain(domain)}
                  />
                  <span
                    class="graph-filter-dot"
                    style={{ backgroundColor: DOMAIN_COLORS[domain] || "#888" }}
                  />
                  <span class="graph-filter-label">{domain}</span>
                </label>
              ))}
            </div>
            <div class="graph-filter-divider" />
            <div class="graph-filter-section">
              <span class="graph-filter-section-header">Types</span>
              {types.map((type) => (
                <label key={type} class="graph-filter-option">
                  <input
                    type="checkbox"
                    checked={filters.types.includes(type)}
                    onChange={() => toggleType(type)}
                  />
                  <span class="graph-filter-label">{type}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Domain legend */}
      <div class="graph-legend">
        {domains.map((domain) => (
          <div key={domain} class="graph-legend-item">
            <span
              class="graph-legend-dot"
              style={{ backgroundColor: DOMAIN_COLORS[domain] || "#888" }}
            />
            <span class="graph-legend-label">{domain}</span>
          </div>
        ))}
      </div>

      {/* Keyboard hints */}
      <div class="graph-hints">
        <span><kbd>/</kbd> search</span>
        <span><kbd>2</kbd>/<kbd>3</kbd> view</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  );
};

export default GraphControls;
