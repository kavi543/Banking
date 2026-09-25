// Thin client for the PMS GitHub API (server/index.js, proxied at /api by Vite).

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
  return body;
}

export const github = {
  // Full-page redirect: GitHub's OAuth screen, then back to the app.
  connect: () => {
    window.location.href = "/api/auth/github";
  },
  status: () => request("/api/github/status"),
  disconnect: () => request("/api/github/disconnect", { method: "POST" }),
  repos: () => request("/api/github/repos"),
  linkRepos: (repos) => request("/api/github/linked-repos", { method: "PUT", body: JSON.stringify({ repos }) }),
  development: (key) => request(`/api/github/development?key=${encodeURIComponent(key)}`),
  // Repository explorer. `part` is "" (overview), "branches", "commits", "pulls", "issues" or "projects".
  repo: (repo, part = "", params = {}) =>
    request(`/api/github/repo${part && `/${part}`}?${new URLSearchParams({ repo, ...params })}`),
};

export function timeAgo(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  if (mins < 43200) return `${Math.round(mins / 1440)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Branch name suggestion, same shape Jira uses: "PMS-9-link-commits-to-tasks".
export function branchNameFor(task) {
  const slug = task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return `${task.id}-${slug}`;
}
