export interface GitHubRepo {
  name: string;
  description: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  topics: string[];
  updated_at: string;
  pushed_at: string;
}

const GITHUB_USER = "ArtemioPadilla";

// Repos to always exclude (profile readme, this site, coursework, misc)
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

// Language colors matching GitHub's language colors
export const LANGUAGE_COLORS: Record<string, string> = {
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

export async function fetchGitHubRepos(): Promise<GitHubRepo[]> {
  const url = `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=updated`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "ArtemioPadilla-Portfolio",
    },
  });

  if (!response.ok) {
    console.warn(`GitHub API returned ${response.status}, falling back to empty list`);
    return [];
  }

  const repos: GitHubRepo[] = await response.json();

  return repos
    .filter((r) => !r.fork && !EXCLUDED_REPOS.has(r.name) && r.description)
    .sort((a, b) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at));
}
