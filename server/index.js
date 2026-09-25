// Minimal GitHub integration backend for PMS (no dependencies, Node 22+).
//
// Works like Jira's GitHub app:
//   1. The user connects their GitHub account via OAuth.
//   2. They pick which repositories to link to PMS.
//   3. For any task key (e.g. PMS-9) we find branches, commits and pull
//      requests in those repos that mention the key.
//
// Sessions live in memory, so restarting the server disconnects everyone.

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3001);
const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const CALLBACK_URL = `${APP_URL}/api/auth/github/callback`;
const MAX_LINKED_REPOS = 10;

const sessions = new Map(); // sid -> { token, user, repos, oauthState }

// ---------- helpers ----------

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function getSession(req, res, create = false) {
  let sid = parseCookies(req).pms_sid;
  if (sid && sessions.has(sid)) return sessions.get(sid);
  if (!create) return null;
  sid = crypto.randomBytes(24).toString("hex");
  const session = { sid, token: null, user: null, repos: [], oauthState: null };
  sessions.set(sid, session);
  res.setHeader("Set-Cookie", `pms_sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
  return session;
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function gh(session, path) {
  const r = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "pms-app",
    },
  });
  if (r.status === 401) {
    // Token revoked on GitHub's side: drop the connection.
    session.token = null;
    session.user = null;
    throw new GitHubError(401, "GitHub authorization expired. Please reconnect.");
  }
  if (!r.ok) throw new GitHubError(r.status, `GitHub API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function ghGraphql(session, query, variables) {
  const r = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      "User-Agent": "pms-app",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 401) {
    session.token = null;
    session.user = null;
    throw new GitHubError(401, "GitHub authorization expired. Please reconnect.");
  }
  const body = await r.json();
  if (body.errors?.length) {
    const scoped = body.errors.some((e) => e.type === "INSUFFICIENT_SCOPES");
    throw new GitHubError(
      scoped ? 403 : 502,
      scoped ? "Missing GitHub permission. Disconnect and reconnect GitHub to grant it." : body.errors[0].message
    );
  }
  return body.data;
}

// Every task key (e.g. "PMS-9") mentioned in a piece of text.
function taskKeys(...texts) {
  const keys = new Set();
  for (const t of texts) for (const m of (t || "").matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)) keys.add(m[0]);
  return [...keys];
}

// Matches "PMS-9" in "feature/PMS-9-login" or "PMS-9: fix", but not in "PMS-90".
function keyMatcher(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?![0-9])`, "i");
}

// ---------- routes ----------

async function startOAuth(req, res) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.writeHead(500, { "Content-Type": "text/html" });
    return res.end(
      "<h2>GitHub is not configured</h2><p>Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in <code>.env</code> " +
        "and restart the server. See <code>.env.example</code>.</p>"
    );
  }
  const session = getSession(req, res, true);
  session.oauthState = crypto.randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: CALLBACK_URL,
    scope: "repo read:user read:project",
    state: session.oauthState,
    allow_signup: "false",
  });
  redirect(res, `https://github.com/login/oauth/authorize?${params}`);
}

async function oauthCallback(req, res, url) {
  const session = getSession(req, res);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!session || !code || !state || state !== session.oauthState) {
    return redirect(res, `${APP_URL}/?github=error`);
  }
  session.oauthState = null;

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      redirect_uri: CALLBACK_URL,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return redirect(res, `${APP_URL}/?github=error`);

  session.token = tokenData.access_token;
  const user = await gh(session, "/user");
  session.user = { login: user.login, name: user.name, avatarUrl: user.avatar_url, url: user.html_url };
  redirect(res, `${APP_URL}/?github=connected`);
}

function status(req, res) {
  const session = getSession(req, res);
  if (!session?.token) return json(res, 200, { connected: false, configured: Boolean(CLIENT_ID) });
  json(res, 200, { connected: true, configured: true, user: session.user, repos: session.repos });
}

function disconnect(req, res) {
  const session = getSession(req, res);
  if (session) sessions.delete(session.sid);
  res.setHeader("Set-Cookie", "pms_sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
  json(res, 200, { connected: false });
}

async function listRepos(session, res) {
  const repos = await gh(session, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
  json(
    res,
    200,
    repos.map((r) => ({ fullName: r.full_name, private: r.private, url: r.html_url, updatedAt: r.updated_at }))
  );
}

async function linkRepos(session, req, res) {
  const { repos } = await readJson(req);
  if (!Array.isArray(repos) || repos.some((r) => typeof r !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(r))) {
    return json(res, 400, { error: "repos must be an array of 'owner/name' strings" });
  }
  session.repos = [...new Set(repos)].slice(0, MAX_LINKED_REPOS);
  json(res, 200, { repos: session.repos });
}

// Branches, commits and PRs across linked repos that mention the task key.
async function development(session, url, res) {
  const key = (url.searchParams.get("key") || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key)) return json(res, 400, { error: "Invalid task key" });
  const matches = keyMatcher(key);
  const repos = session.repos;
  if (repos.length === 0) return json(res, 200, { branches: [], commits: [], pullRequests: [] });

  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const [branches, pulls] = await Promise.all([
        gh(session, `/repos/${repo}/branches?per_page=100`),
        gh(session, `/repos/${repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`),
      ]);
      return {
        branches: branches
          .filter((b) => matches.test(b.name))
          .map((b) => ({
            repo,
            name: b.name,
            url: `https://github.com/${repo}/tree/${encodeURIComponent(b.name)}`,
          })),
        pullRequests: pulls
          .filter((p) => matches.test(p.title) || matches.test(p.head.ref) || matches.test(p.body || ""))
          .map((p) => ({
            repo,
            number: p.number,
            title: p.title,
            url: p.html_url,
            branch: p.head.ref,
            author: p.user?.login,
            status: p.merged_at ? "merged" : p.state === "closed" ? "closed" : p.draft ? "draft" : "open",
            updatedAt: p.updated_at,
          })),
      };
    })
  );

  // Commit search covers every linked repo in a single request.
  const q = encodeURIComponent(`"${key}" ${repos.map((r) => `repo:${r}`).join(" ")}`);
  const search = await gh(session, `/search/commits?q=${q}&sort=committer-date&order=desc&per_page=50`);
  const commits = search.items
    .filter((c) => matches.test(c.commit.message))
    .map((c) => ({
      repo: c.repository.full_name,
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      url: c.html_url,
      author: c.author?.login || c.commit.author?.name,
      date: c.commit.committer?.date || c.commit.author?.date,
    }));

  json(res, 200, {
    branches: perRepo.flatMap((r) => r.branches),
    commits,
    pullRequests: perRepo.flatMap((r) => r.pullRequests),
  });
}

// ---------- repository explorer ----------

const splitRepo = (repo) => {
  const [owner, name] = repo.split("/");
  return { owner, name };
};

async function repoOverview(session, repo, res) {
  const [r, languages] = await Promise.all([gh(session, `/repos/${repo}`), gh(session, `/repos/${repo}/languages`)]);
  const total = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
  json(res, 200, {
    fullName: r.full_name,
    description: r.description,
    url: r.html_url,
    homepage: r.homepage,
    private: r.private,
    archived: r.archived,
    defaultBranch: r.default_branch,
    stars: r.stargazers_count,
    forks: r.forks_count,
    watchers: r.subscribers_count,
    openIssues: r.open_issues_count, // GitHub counts open PRs here too
    sizeKb: r.size,
    license: r.license?.name,
    topics: r.topics || [],
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
    owner: { login: r.owner.login, avatarUrl: r.owner.avatar_url },
    languages: Object.entries(languages).map(([name, bytes]) => ({ name, percent: (bytes / total) * 100 })),
  });
}

// GraphQL gives each branch's latest commit in one request (REST would need one call per branch).
async function repoBranches(session, repo, res) {
  const data = await ghGraphql(
    session,
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef { name }
        refs(refPrefix: "refs/heads/", first: 100, orderBy: { field: ALPHABETICAL, direction: ASC }) {
          totalCount
          nodes {
            name
            branchProtectionRule { id }
            associatedPullRequests(first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) {
              nodes { number state isDraft url }
            }
            target { ... on Commit {
              oid messageHeadline committedDate url
              author { name user { login } }
            } }
          }
        }
      }
    }`,
    splitRepo(repo)
  );
  const { defaultBranchRef, refs } = data.repository;
  json(res, 200, {
    total: refs.totalCount,
    branches: refs.nodes
      .map((b) => {
      const pr = b.associatedPullRequests.nodes[0];
      return {
        name: b.name,
        url: `https://github.com/${repo}/tree/${encodeURIComponent(b.name)}`,
        isDefault: b.name === defaultBranchRef?.name,
        protected: Boolean(b.branchProtectionRule),
        taskKeys: taskKeys(b.name),
        lastCommit: b.target && {
          sha: b.target.oid,
          message: b.target.messageHeadline,
          date: b.target.committedDate,
          url: b.target.url,
          author: b.target.author?.user?.login || b.target.author?.name,
        },
        pullRequest: pr && {
          number: pr.number,
          url: pr.url,
          status: pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.isDraft ? "draft" : "open",
        },
      };
    })
      // Default branch first, then most recently committed.
      .sort((a, b) => b.isDefault - a.isDefault || (b.lastCommit?.date || "").localeCompare(a.lastCommit?.date || "")),
  });
}

async function repoCommits(session, repo, url, res) {
  const branch = url.searchParams.get("branch");
  const qs = new URLSearchParams({ per_page: "50", ...(branch && { sha: branch }) });
  // GitHub answers 409 for a repository with no commits yet.
  const commits = await gh(session, `/repos/${repo}/commits?${qs}`).catch((e) => {
    if (e.status === 409) return [];
    throw e;
  });
  json(
    res,
    200,
    commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split("\n")[0],
      body: c.commit.message.split("\n").slice(1).join("\n").trim(),
      url: c.html_url,
      author: c.author?.login || c.commit.author?.name,
      avatarUrl: c.author?.avatar_url,
      date: c.commit.committer?.date || c.commit.author?.date,
      taskKeys: taskKeys(c.commit.message),
    }))
  );
}

async function repoPulls(session, repo, res) {
  const pulls = await gh(session, `/repos/${repo}/pulls?state=all&per_page=50&sort=updated&direction=desc`);
  json(
    res,
    200,
    pulls.map((p) => ({
      number: p.number,
      title: p.title,
      url: p.html_url,
      status: p.merged_at ? "merged" : p.state === "closed" ? "closed" : p.draft ? "draft" : "open",
      author: p.user?.login,
      avatarUrl: p.user?.avatar_url,
      head: p.head.ref,
      base: p.base.ref,
      labels: p.labels.map((l) => ({ name: l.name, color: l.color })),
      reviewers: p.requested_reviewers.map((u) => u.login),
      assignees: p.assignees.map((u) => u.login),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      mergedAt: p.merged_at,
      taskKeys: taskKeys(p.title, p.head.ref, p.body),
    }))
  );
}

async function repoIssues(session, repo, res) {
  const issues = await gh(session, `/repos/${repo}/issues?state=all&per_page=50&sort=updated&direction=desc`);
  json(
    res,
    200,
    issues
      .filter((i) => !i.pull_request) // the issues API also returns PRs
      .map((i) => ({
        number: i.number,
        title: i.title,
        url: i.html_url,
        state: i.state,
        author: i.user?.login,
        labels: i.labels.map((l) => ({ name: l.name, color: l.color })),
        assignees: i.assignees.map((u) => u.login),
        comments: i.comments,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        taskKeys: taskKeys(i.title, i.body),
      }))
  );
}

// GitHub Projects (v2) linked to the repository. Needs the read:project scope.
async function repoProjects(session, repo, res) {
  const data = await ghGraphql(
    session,
    `query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        projectsV2(first: 20, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            number title shortDescription url closed updatedAt
            items(first: 50) {
              totalCount
              nodes {
                fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
                content {
                  __typename
                  ... on Issue { number title url state }
                  ... on PullRequest { number title url state }
                  ... on DraftIssue { title }
                }
              }
            }
          }
        }
      }
    }`,
    splitRepo(repo)
  );
  json(
    res,
    200,
    data.repository.projectsV2.nodes.map((p) => ({
      number: p.number,
      title: p.title,
      description: p.shortDescription,
      url: p.url,
      closed: p.closed,
      updatedAt: p.updatedAt,
      itemCount: p.items.totalCount,
      items: p.items.nodes
        .filter((i) => i.content)
        .map((i) => ({
          type: i.content.__typename,
          number: i.content.number,
          title: i.content.title,
          url: i.content.url,
          state: i.content.state?.toLowerCase(),
          status: i.fieldValueByName?.name || "No status",
        })),
    }))
  );
}

async function repoRoute(session, route, url, res) {
  const repo = url.searchParams.get("repo") || "";
  if (!session.repos.includes(repo)) return json(res, 403, { error: "Repository is not linked to PMS" });
  if (route === "GET /api/github/repo") return repoOverview(session, repo, res);
  if (route === "GET /api/github/repo/branches") return repoBranches(session, repo, res);
  if (route === "GET /api/github/repo/commits") return repoCommits(session, repo, url, res);
  if (route === "GET /api/github/repo/pulls") return repoPulls(session, repo, res);
  if (route === "GET /api/github/repo/issues") return repoIssues(session, repo, res);
  if (route === "GET /api/github/repo/projects") return repoProjects(session, repo, res);
  json(res, 404, { error: "Not found" });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === "GET /api/auth/github") return await startOAuth(req, res);
    if (route === "GET /api/auth/github/callback") return await oauthCallback(req, res, url);
    if (route === "GET /api/github/status") return status(req, res);
    if (route === "POST /api/github/disconnect") return disconnect(req, res);

    if (url.pathname.startsWith("/api/github/")) {
      const session = getSession(req, res);
      if (!session?.token) return json(res, 401, { error: "Not connected to GitHub" });
      if (route === "GET /api/github/repos") return await listRepos(session, res);
      if (route === "PUT /api/github/linked-repos") return await linkRepos(session, req, res);
      if (route === "GET /api/github/development") return await development(session, url, res);
      if (url.pathname.startsWith("/api/github/repo") && url.pathname !== "/api/github/repos")
        return await repoRoute(session, route, url, res);
    }
    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    json(res, err instanceof GitHubError ? err.status : 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`PMS API listening on http://localhost:${PORT}`);
  if (!CLIENT_ID || !CLIENT_SECRET) console.warn("⚠  GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not set — see .env.example");
  else console.log(`   OAuth callback URL: ${CALLBACK_URL}`);
});
