import { useState, useMemo } from "preact/hooks";
import Fuse from "fuse.js";

interface SearchItem {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  date: string;
}

interface Props {
  items: SearchItem[];
}

export default function BlogSearch({ items }: Props) {
  const [query, setQuery] = useState("");

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: [
          { name: "title", weight: 0.4 },
          { name: "description", weight: 0.3 },
          { name: "tags", weight: 0.3 },
        ],
        threshold: 0.3,
        includeScore: true,
      }),
    [items],
  );

  const results = useMemo(() => {
    if (query.length <= 1) return null;
    return fuse.search(query).map((result) => result.item);
  }, [query, fuse]);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {/* Search input */}
      <div style={{ position: "relative" }}>
        <svg
          style={{
            position: "absolute",
            left: "0.875rem",
            top: "50%",
            transform: "translateY(-50%)",
            width: "1.25rem",
            height: "1.25rem",
            color: "var(--color-text-muted)",
            pointerEvents: "none",
          }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search posts..."
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          style={{
            width: "100%",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
            borderRadius: "0.75rem",
            padding: "0.75rem 1rem 0.75rem 2.75rem",
            fontSize: "0.875rem",
            fontFamily: "var(--font-sans)",
            outline: "none",
            transition: "border-color 0.2s ease",
          }}
          onFocus={(e) => {
            (e.target as HTMLInputElement).style.borderColor =
              "var(--color-primary)";
          }}
          onBlur={(e) => {
            (e.target as HTMLInputElement).style.borderColor =
              "var(--color-border)";
          }}
        />
      </div>

      {/* Results dropdown */}
      {results !== null && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "0.5rem",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
            zIndex: 50,
            maxHeight: "24rem",
            overflowY: "auto",
          }}
        >
          {results.length === 0 ? (
            <div
              style={{
                padding: "1rem 1.25rem",
                color: "var(--color-text-muted)",
                fontSize: "0.875rem",
                textAlign: "center",
              }}
            >
              No posts found
            </div>
          ) : (
            results.map((item) => (
              <a
                key={item.slug}
                href={`/blog/${item.slug}/`}
                style={{
                  display: "block",
                  padding: "0.875rem 1.25rem",
                  textDecoration: "none",
                  borderBottom: "1px solid var(--color-border)",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
                    "var(--color-surface-light)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.backgroundColor =
                    "transparent";
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    color: "var(--color-heading)",
                    marginBottom: "0.25rem",
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--color-text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.description}
                </div>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
