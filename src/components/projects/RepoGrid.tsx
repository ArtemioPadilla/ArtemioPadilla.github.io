import { useState, useEffect } from "preact/hooks";

const GITHUB_USER = "ArtemioPadilla";

const EXCLUDED_REPOS = new Set([
  "ArtemioPadilla",
  "ArtemioPadilla.github.io",
  "CursoDatosMasivosI",
  "LCD-CC-2020-I",
  "learnGitBranching",
  "data",
  "digital-transformation-basics",
  "mna-calculadora",
  "travel-plan",
  "TravelHub",
]);

const LANGUAGE_COLORS: Record<string, string> = {
  Python: "#3572A5",
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  "Jupyter Notebook": "#DA5B0B",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  "C++": "#f34b7d",
  Rust: "#dea584",
  Go: "#00ADD8",
};

interface Repo {
  name: string;
  description: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  topics: string[];
  pushed_at: string;
}

function humanize(name: string) {
  return name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function RepoCard({ repo }: { repo: Repo }) {
  const langColor = repo.language
    ? LANGUAGE_COLORS[repo.language] || "#8b8b8b"
    : null;

  return (
    <a
      href={repo.html_url}
      target="_blank"
      rel="noopener noreferrer"
      class="project-card group relative flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 no-underline transition-all duration-500 hover:border-[var(--color-primary)]/30 sm:p-8"
    >
      <div class="card-glow" />
      <div class="relative z-10 flex flex-1 flex-col">
        <div class="flex items-start justify-between gap-4">
          <h3 class="text-lg font-semibold text-[var(--color-heading)] transition-colors duration-300 group-hover:text-[var(--color-primary)] sm:text-xl">
            {humanize(repo.name)}
          </h3>
          <svg
            class="mt-1 h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-all duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--color-primary)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 17L17 7M17 7H7M17 7v10"
            />
          </svg>
        </div>

        <p class="mt-3 flex-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
          {repo.description}
        </p>

        <div class="mt-6 flex flex-wrap items-center gap-3">
          {repo.language && langColor && (
            <span class="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <span
                class="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: langColor }}
              />
              {repo.language}
            </span>
          )}
          {repo.stargazers_count > 0 && (
            <span class="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
              <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z" />
              </svg>
              {repo.stargazers_count}
            </span>
          )}
        </div>

        {repo.topics.length > 0 && (
          <div class="mt-3 flex flex-wrap gap-2">
            {repo.topics.slice(0, 4).map((tag) => (
              <span
                key={tag}
                class="rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-all duration-300 group-hover:border-[var(--color-primary)]/20 group-hover:text-[var(--color-primary)]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

function SkeletonCard() {
  return (
    <div class="animate-pulse rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 sm:p-8">
      <div class="h-5 w-3/4 rounded bg-[var(--color-border)]" />
      <div class="mt-4 space-y-2">
        <div class="h-3 w-full rounded bg-[var(--color-border)]" />
        <div class="h-3 w-5/6 rounded bg-[var(--color-border)]" />
      </div>
      <div class="mt-6 flex gap-3">
        <div class="h-3 w-16 rounded bg-[var(--color-border)]" />
        <div class="h-3 w-10 rounded bg-[var(--color-border)]" />
      </div>
    </div>
  );
}

export default function RepoGrid() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(
      `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=updated`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      }
    )
      .then((res) => {
        if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
        return res.json();
      })
      .then((data: Repo[]) => {
        if (cancelled) return;
        const filtered = data
          .filter(
            (r) => !r.fork && !EXCLUDED_REPOS.has(r.name) && r.description
          )
          .sort(
            (a, b) =>
              b.stargazers_count - a.stargazers_count ||
              Date.parse(b.pushed_at) - Date.parse(a.pushed_at)
          );
        setRepos(filtered);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div class="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p class="mt-16 text-center text-[var(--color-text-muted)]">
        Could not load repositories: {error}
      </p>
    );
  }

  if (repos.length === 0) {
    return (
      <p class="mt-16 text-center text-[var(--color-text-muted)]">
        No repositories found.
      </p>
    );
  }

  return (
    <div class="grid gap-4 sm:grid-cols-2">
      {repos.map((repo) => (
        <RepoCard key={repo.name} repo={repo} />
      ))}
    </div>
  );
}
