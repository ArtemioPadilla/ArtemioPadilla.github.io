import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import Fuse from "fuse.js";

interface ToolEntry {
  title: string;
  description: string;
  tags: string[];
  slug: string;
  categoryKey: string;
  subcategoryKey: string;
  createdDate: string;
}

interface CategoryInfo {
  key: string;
  label: string;
  count: number;
}

interface SubcategoryInfo {
  key: string;
  label: string;
  categoryKey: string;
  count: number;
}

interface Props {
  tools: ToolEntry[];
  categories: CategoryInfo[];
  subcategories: SubcategoryInfo[];
  totalCount: number;
}

type SortMode = "default" | "az" | "newest";
type ViewMode = "grid" | "list";

export default function LabFilter({ tools, categories, subcategories, totalCount }: Props) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeSubcategory, setActiveSubcategory] = useState("all");
  const [activeTag, setActiveTag] = useState("");
  const [sortBy, setSortBy] = useState<SortMode>("default");
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("lab-view-mode") as ViewMode) || "grid";
    }
    return "grid";
  });
  const [visibleCount, setVisibleCount] = useState(totalCount);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(tools, {
        keys: [
          { name: "title", weight: 0.5 },
          { name: "description", weight: 0.3 },
          { name: "tags", weight: 0.2 },
        ],
        threshold: 0.35,
        includeScore: true,
      }),
    [tools]
  );

  // Subcategories for the active category
  const visibleSubcategories = useMemo(() => {
    if (activeCategory === "all") return [];
    return subcategories.filter(
      (sc) => sc.categoryKey === activeCategory && sc.count > 0
    );
  }, [activeCategory, subcategories]);

  // Sorted tools for ordering
  const sortedSlugs = useMemo(() => {
    let sorted = [...tools];
    if (sortBy === "az") {
      sorted.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "newest") {
      sorted.sort(
        (a, b) =>
          new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
      );
    }
    return sorted.map((t) => t.slug);
  }, [tools, sortBy]);

  // Reset subcategory when category changes
  useEffect(() => {
    setActiveSubcategory("all");
    setActiveTag("");
  }, [activeCategory]);

  // Listen for tag-filter events from ToolCard
  useEffect(() => {
    function onTagFilter(e: Event) {
      const tag = (e as CustomEvent).detail;
      if (tag) {
        setActiveTag(tag);
        setActiveCategory("all");
        setActiveSubcategory("all");
        setQuery("");
      }
    }
    document.addEventListener("lab-tag-filter", onTagFilter);
    return () => document.removeEventListener("lab-tag-filter", onTagFilter);
  }, []);

  // Apply filter + sort to DOM
  useEffect(() => {
    const searchMatches = query.trim()
      ? new Set(fuse.search(query).map((r) => r.item.slug))
      : null;

    const wrappers = document.querySelectorAll<HTMLElement>(
      ".tool-card-wrapper"
    );
    const sections = document.querySelectorAll<HTMLElement>(
      ".category-section"
    );

    let count = 0;

    // Build slug → order map
    const orderMap = new Map<string, number>();
    sortedSlugs.forEach((slug, i) => orderMap.set(slug, i));

    wrappers.forEach((el) => {
      const slug = el.dataset.slug || "";
      const cat = el.dataset.category || "";
      const subcat = el.dataset.subcategory || "";
      const tags = el.dataset.tags || "";

      const matchesSearch = searchMatches === null || searchMatches.has(slug);
      const matchesCat = activeCategory === "all" || cat === activeCategory;
      const matchesSubcat =
        activeSubcategory === "all" || subcat === activeSubcategory;
      const matchesTag =
        !activeTag ||
        tags
          .split(",")
          .some((t) => t.trim().toLowerCase() === activeTag.toLowerCase());
      const visible = matchesSearch && matchesCat && matchesSubcat && matchesTag;

      el.classList.toggle("hidden", !visible);
      el.style.order = String(orderMap.get(slug) ?? 0);

      if (visible) count++;
    });

    // Show/hide category sections (hide if all cards in section are hidden)
    sections.forEach((sec) => {
      const cat = sec.dataset.category || "";
      const matchesCat = activeCategory === "all" || cat === activeCategory;

      if (!matchesCat) {
        sec.classList.add("hidden-cat");
        return;
      }

      // Check if any card in this section is visible
      const cards = sec.querySelectorAll<HTMLElement>(".tool-card-wrapper");
      let hasVisible = false;
      cards.forEach((c) => {
        if (!c.classList.contains("hidden")) hasVisible = true;
      });
      sec.classList.toggle("hidden-cat", !hasVisible);
    });

    // Toggle list/grid mode on the container
    const container = document.getElementById("categories-container");
    if (container) {
      container.classList.toggle("lab-list-mode", viewMode === "list");
    }

    setVisibleCount(count);
  }, [query, activeCategory, activeSubcategory, activeTag, sortBy, sortedSlugs, viewMode, fuse]);

  // Persist view mode
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("lab-view-mode", viewMode);
    }
  }, [viewMode]);

  // Keyboard: Escape clears search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && (query || activeTag)) {
        e.preventDefault();
        setQuery("");
        setActiveTag("");
        inputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [query, activeTag]);

  return (
    <div class="lab-filter-sticky mt-8 space-y-4">
      {/* Search + Sort + View row */}
      <div class="flex flex-wrap items-center gap-3">
        {/* Search input */}
        <div class="relative min-w-0 flex-1">
          <svg
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setActiveTag("");
            }}
            placeholder="Filter tools..."
            role="searchbox"
            aria-label="Search lab tools"
            class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none transition-colors focus:border-[var(--color-primary)]"
          />
          {(query || activeTag) && (
            <button
              onClick={() => {
                setQuery("");
                setActiveTag("");
              }}
              class="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
              aria-label="Clear search"
            >
              <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Sort dropdown */}
        <select
          value={sortBy}
          onChange={(e) =>
            setSortBy((e.target as HTMLSelectElement).value as SortMode)
          }
          aria-label="Sort tools"
          class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs text-[var(--color-text-muted)] outline-none transition-colors focus:border-[var(--color-primary)]"
        >
          <option value="default">Default order</option>
          <option value="az">A &rarr; Z</option>
          <option value="newest">Newest first</option>
        </select>

        {/* View mode toggle */}
        <div class="flex rounded-xl border border-[var(--color-border)] overflow-hidden">
          <button
            onClick={() => setViewMode("grid")}
            aria-label="Grid view"
            aria-pressed={viewMode === "grid"}
            class={`px-2.5 py-2 transition-colors ${
              viewMode === "grid"
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
            }`}
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode("list")}
            aria-label="List view"
            aria-pressed={viewMode === "list"}
            class={`px-2.5 py-2 transition-colors ${
              viewMode === "list"
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
            }`}
          >
            <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Category pills */}
      <div
        ref={pillsRef}
        class="cat-scroll flex gap-2"
        role="tablist"
        aria-label="Tool categories"
      >
        <button
          role="tab"
          aria-selected={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
          class={`cat-pill shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
            activeCategory === "all"
              ? "active border-[var(--color-primary)] bg-[var(--color-primary)]/8 text-[var(--color-primary)]"
              : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]"
          }`}
        >
          All ({totalCount})
        </button>
        {categories.map((cat) => (
          <button
            key={cat.key}
            role="tab"
            aria-selected={activeCategory === cat.key}
            onClick={() => setActiveCategory(cat.key)}
            class={`cat-pill shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
              activeCategory === cat.key
                ? "active border-[var(--color-primary)] bg-[var(--color-primary)]/8 text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-primary)]"
            }`}
          >
            {cat.label} ({cat.count})
          </button>
        ))}
      </div>

      {/* Subcategory pills — shown when a category is selected */}
      {visibleSubcategories.length > 0 && (
        <div
          class="cat-scroll flex gap-2"
          role="tablist"
          aria-label="Subcategories"
        >
          <button
            role="tab"
            aria-selected={activeSubcategory === "all"}
            onClick={() => setActiveSubcategory("all")}
            class={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
              activeSubcategory === "all"
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/8 text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
            }`}
          >
            All
          </button>
          {visibleSubcategories.map((sc) => (
            <button
              key={sc.key}
              role="tab"
              aria-selected={activeSubcategory === sc.key}
              onClick={() => setActiveSubcategory(sc.key)}
              class={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                activeSubcategory === sc.key
                  ? "border-[var(--color-accent)] bg-[var(--color-accent)]/8 text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-accent)]"
              }`}
            >
              {sc.label} ({sc.count})
            </button>
          ))}
        </div>
      )}

      {/* Active tag indicator */}
      {activeTag && (
        <div class="flex items-center gap-2">
          <span class="text-xs text-[var(--color-text-muted)]">Tag:</span>
          <button
            onClick={() => setActiveTag("")}
            class="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/8 px-2.5 py-0.5 text-xs font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/15"
          >
            {activeTag}
            <svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Result count */}
      <div role="status" aria-live="polite" class="text-xs text-[var(--color-text-muted)]">
        {visibleCount < totalCount
          ? `Showing ${visibleCount} of ${totalCount} tools`
          : `${totalCount} tools`}
      </div>
    </div>
  );
}
