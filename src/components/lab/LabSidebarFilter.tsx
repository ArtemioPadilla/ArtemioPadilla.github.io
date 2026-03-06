import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import Fuse from "fuse.js";

interface ToolEntry {
  slug: string;
  title: string;
  tags: string[];
  categoryKey: string;
}

interface Props {
  tools: ToolEntry[];
  tags: string[];
}

export default function LabSidebarFilter({ tools, tags }: Props) {
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const fuse = useMemo(
    () =>
      new Fuse(tools, {
        keys: [
          { name: "title", weight: 0.7 },
          { name: "tags", weight: 0.3 },
        ],
        threshold: 0.35,
        includeScore: true,
      }),
    [tools]
  );

  const hasFilters = query.trim() !== "" || selectedTags.size > 0;

  useEffect(() => {
    const searchMatches = query.trim()
      ? new Set(fuse.search(query).map((r) => r.item.slug))
      : null;

    const nav = document.getElementById("sidebar-nav");
    if (!nav) return;

    const links = nav.querySelectorAll<HTMLElement>(".sidebar-tool-link");
    const categoryDetails = nav.querySelectorAll<HTMLDetailsElement>(".sidebar-category");

    const visibleCategories = new Map<string, number>();

    links.forEach((link) => {
      const slug = link.dataset.slug || "";
      const linkTags = (link.dataset.tags || "").split(",").filter(Boolean);

      const matchesSearch = searchMatches === null || searchMatches.has(slug);
      const matchesTags =
        selectedTags.size === 0 ||
        [...selectedTags].every((t) => linkTags.includes(t));
      const visible = matchesSearch && matchesTags;

      link.style.display = visible ? "" : "none";

      if (visible) {
        const details = link.closest<HTMLDetailsElement>(".sidebar-category");
        const catKey = details?.dataset.category || "";
        visibleCategories.set(catKey, (visibleCategories.get(catKey) || 0) + 1);
      }
    });

    categoryDetails.forEach((details) => {
      const catKey = details.dataset.category || "";
      const count = visibleCategories.get(catKey) || 0;
      if (count === 0) {
        details.style.display = "none";
      } else {
        details.style.display = "";
        if (hasFilters) {
          details.open = true;
        }
      }
    });
  }, [query, selectedTags, fuse, hasFilters]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setSelectedTags(new Set());
  }

  return (
    <div class="border-b border-[var(--color-border)] px-3 py-3">
      {/* Search input */}
      <div class="relative">
        <svg
          class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]"
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
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Search tools..."
          aria-label="Search lab tools"
          class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1.5 pl-8 pr-3 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] outline-none transition-colors focus:border-[var(--color-primary)]"
        />
        {hasFilters && (
          <button
            onClick={clearFilters}
            class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
            aria-label="Clear filters"
          >
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Tags toggle */}
      <button
        onClick={() => setTagsExpanded(!tagsExpanded)}
        class="mt-2 flex w-full items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-heading)]"
      >
        <svg
          class={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${tagsExpanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
        Tags
        {selectedTags.size > 0 && (
          <span class="rounded-full bg-[var(--color-primary)] px-1.5 py-px text-[9px] font-bold text-white">
            {selectedTags.size}
          </span>
        )}
      </button>

      {/* Tag chips */}
      {tagsExpanded && (
        <div class="mt-1.5 flex flex-wrap gap-1">
          {tags.map((tag) => {
            const isSelected = selectedTags.has(tag);
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                class={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  isSelected
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-surface-light)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-lighter)] hover:text-[var(--color-heading)]"
                }`}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
