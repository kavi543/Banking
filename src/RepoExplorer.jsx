import { useEffect, useState } from "react";
import { github, timeAgo } from "./github.js";
import { GitHubIcon } from "./GitHubConnect.jsx";

const TABS = [
  { id: "tasks", label: "Tasks" },
  { id: "branches", label: "Branches" },
  { id: "commits", label: "Commits" },
  { id: "pulls", label: "Pull requests" },
  { id: "issues", label: "Issues" },
  { id: "projects", label: "Projects" },
];

// Loads `load()` whenever `key` changes; returns { data, error }.
function useLoad(key, load) {
  const [state, setState] = useState({ data: null, error: "" });
  useEffect(() => {
    let cancelled = false;
    setState({ data: null, error: "" });
    load().then(
      (data) => !cancelled && setState({ data, error: "" }),
      (e) => !cancelled && setState({ data: null, error: e.message })
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

function Loading({ state, empty, children }) {
  if (state.error) return <p className="gh-error">{state.error}</p>;
  if (!state.data) return <p className="gh-empty">Loading…</p>;
  if (Array.isArray(state.data) && !state.data.length) return <p className="gh-empty">{empty}</p>;
  return children(state.data);
}

// PMS task keys found in GitHub text. Known tasks open their panel.
function TaskChips({ keys, tasks, onOpenTask }) {
  if (!keys?.length) return null;
  return keys.map((k) =>
    tasks[k] ? (
      <button key={k} className="task-chip" onClick={() => onOpenTask(tasks[k])}>{k}</button>
    ) : (
      <span key={k} className="task-chip unknown" title="Not a task on this board">{k}</span>
    )
  );
}

function Labels({ labels }) {
  return labels?.map((l) => (
    <span key={l.name} className="label" style={{ "--label": `#${l.color}` }}>{l.name}</span>
  ));
}

function Overview({ repo }) {
  const state = useLoad(repo, () => github.repo(repo));
  return (
    <Loading state={state}>
      {(r) => (
        <section className="repo-overview">
          <div className="repo-title">
            <img src={r.owner.avatarUrl} alt="" className="repo-owner" />
            <div>
              <h1>
                <a href={r.url} target="_blank" rel="noreferrer">{r.fullName}</a>
                <span className="tag">{r.private ? "Private" : "Public"}</span>
                {r.archived && <span className="tag">Archived</span>}
              </h1>
              {r.description && <p>{r.description}</p>}
            </div>
          </div>
          <dl className="repo-stats">
            <div><dt>Default branch</dt><dd>{r.defaultBranch}</dd></div>
            <div><dt>Stars</dt><dd>{r.stars}</dd></div>
            <div><dt>Forks</dt><dd>{r.forks}</dd></div>
            <div><dt>Watchers</dt><dd>{r.watchers}</dd></div>
            <div><dt>Open issues + PRs</dt><dd>{r.openIssues}</dd></div>
            <div><dt>Last push</dt><dd>{timeAgo(r.pushedAt)}</dd></div>
            <div><dt>Created</dt><dd>{new Date(r.createdAt).toLocaleDateString()}</dd></div>
            {r.license && <div><dt>License</dt><dd>{r.license}</dd></div>}
          </dl>
          {r.languages.length > 0 && (
            <div className="languages">
              <div className="lang-bar">
                {r.languages.map((l) => (
                  <span key={l.name} style={{ width: `${l.percent}%` }} title={`${l.name} ${l.percent.toFixed(1)}%`} />
                ))}
              </div>
              <p>
                {r.languages.map((l) => `${l.name} ${l.percent.toFixed(1)}%`).join(" · ")}
              </p>
            </div>
          )}
          {r.topics.length > 0 && (
            <p className="topics">{r.topics.map((t) => <span key={t} className="tag">{t}</span>)}</p>
          )}
        </section>
      )}
    </Loading>
  );
}

function Branches({ repo, chips }) {
  const state = useLoad(repo, () => github.repo(repo, "branches"));
  return (
    <Loading state={state}>
      {({ total, branches }) => (
        <>
          <p className="gh-empty">{total} branches{total > branches.length && ` (showing ${branches.length})`}</p>
          <ul className="repo-list">
            {branches.map((b) => (
              <li key={b.name}>
                <div className="row-main">
                  <a href={b.url} target="_blank" rel="noreferrer" className="mono">{b.name}</a>
                  {b.isDefault && <span className="tag">default</span>}
                  {b.protected && <span className="tag">protected</span>}
                  {b.pullRequest && (
                    <a href={b.pullRequest.url} target="_blank" rel="noreferrer" className={`pr-status ${b.pullRequest.status}`}>
                      #{b.pullRequest.number} {b.pullRequest.status}
                    </a>
                  )}
                  {chips(b.taskKeys)}
                </div>
                {b.lastCommit && (
                  <span className="dev-meta">
                    <a href={b.lastCommit.url} target="_blank" rel="noreferrer"><code>{b.lastCommit.sha.slice(0, 7)}</code></a>{" "}
                    {b.lastCommit.message} · {b.lastCommit.author} · {timeAgo(b.lastCommit.date)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Loading>
  );
}

function Commits({ repo, chips }) {
  const [branch, setBranch] = useState("");
  const branches = useLoad(repo, () => github.repo(repo, "branches"));
  const state = useLoad(`${repo}@${branch}`, () => github.repo(repo, "commits", branch ? { branch } : {}));
  return (
    <>
      <label className="branch-select">
        Branch{" "}
        <select value={branch} onChange={(e) => setBranch(e.target.value)}>
          <option value="">Default branch</option>
          {branches.data?.branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
        </select>
      </label>
      <Loading state={state} empty="No commits yet. Push a first commit to this repository to see it here.">
        {(commits) => (
          <ul className="repo-list">
            {commits.map((c) => (
              <li key={c.sha}>
                <div className="row-main">
                  {c.avatarUrl && <img src={c.avatarUrl} alt="" className="gh-avatar" />}
                  <a href={c.url} target="_blank" rel="noreferrer">{c.message}</a>
                  {chips(c.taskKeys)}
                </div>
                <span className="dev-meta">
                  <code>{c.sha.slice(0, 7)}</code> · {c.author} · {timeAgo(c.date)}
                </span>
                {c.body && <pre className="commit-body">{c.body}</pre>}
              </li>
            ))}
          </ul>
        )}
      </Loading>
    </>
  );
}

function Pulls({ repo, chips }) {
  const state = useLoad(repo, () => github.repo(repo, "pulls"));
  return (
    <Loading state={state} empty="No pull requests.">
      {(pulls) => (
        <ul className="repo-list">
          {pulls.map((p) => (
            <li key={p.number}>
              <div className="row-main">
                <span className={`pr-status ${p.status}`}>{p.status}</span>
                <a href={p.url} target="_blank" rel="noreferrer">#{p.number} {p.title}</a>
                <Labels labels={p.labels} />
                {chips(p.taskKeys)}
              </div>
              <span className="dev-meta">
                <code>{p.head}</code> → <code>{p.base}</code> · by {p.author} · opened {timeAgo(p.createdAt)}
                {p.mergedAt ? ` · merged ${timeAgo(p.mergedAt)}` : ` · updated ${timeAgo(p.updatedAt)}`}
                {p.reviewers.length > 0 && ` · reviewers: ${p.reviewers.join(", ")}`}
                {p.assignees.length > 0 && ` · assignees: ${p.assignees.join(", ")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Loading>
  );
}

function Issues({ repo, chips }) {
  const state = useLoad(repo, () => github.repo(repo, "issues"));
  return (
    <Loading state={state} empty="No issues. (Issues may be disabled for this repository.)">
      {(issues) => (
        <ul className="repo-list">
          {issues.map((i) => (
            <li key={i.number}>
              <div className="row-main">
                <span className={`pr-status ${i.state === "open" ? "open" : "closed"}`}>{i.state}</span>
                <a href={i.url} target="_blank" rel="noreferrer">#{i.number} {i.title}</a>
                <Labels labels={i.labels} />
                {chips(i.taskKeys)}
              </div>
              <span className="dev-meta">
                by {i.author} · opened {timeAgo(i.createdAt)} · updated {timeAgo(i.updatedAt)} · {i.comments} comments
                {i.assignees.length > 0 && ` · assignees: ${i.assignees.join(", ")}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Loading>
  );
}

function Projects({ repo }) {
  const state = useLoad(repo, () => github.repo(repo, "projects"));
  return (
    <Loading state={state} empty="No GitHub Projects are linked to this repository.">
      {(projects) =>
        projects.map((p) => {
          const byStatus = {};
          for (const i of p.items) (byStatus[i.status] ??= []).push(i);
          return (
            <section key={p.number} className="project">
              <h3>
                <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a>
                {p.closed && <span className="tag">closed</span>}
              </h3>
              <p className="dev-meta">
                {p.description && `${p.description} · `}
                {p.itemCount} items · updated {timeAgo(p.updatedAt)}
              </p>
              <div className="project-columns">
                {Object.entries(byStatus).map(([status, items]) => (
                  <div key={status} className="project-column">
                    <h4>{status} <span className="count">{items.length}</span></h4>
                    {items.map((i, n) => (
                      <div key={n} className="project-item">
                        {i.url ? <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> : i.title}
                        <span className="dev-meta">
                          {i.type === "DraftIssue" ? "Draft" : `${i.type === "PullRequest" ? "PR" : "Issue"} #${i.number} · ${i.state}`}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })
      }
    </Loading>
  );
}

// Everything in the repo that mentions a PMS task key, grouped by task.
function LinkedTasks({ repo, tasks, onOpenTask }) {
  const state = useLoad(repo, async () => {
    const [b, c, p] = await Promise.all([
      github.repo(repo, "branches"),
      github.repo(repo, "commits"),
      github.repo(repo, "pulls"),
    ]);
    const groups = {};
    const add = (kind, item) => {
      for (const k of item.taskKeys) {
        groups[k] ??= { branches: [], commits: [], pulls: [] };
        groups[k][kind].push(item);
      }
    };
    b.branches.forEach((x) => add("branches", x));
    c.forEach((x) => add("commits", x));
    p.forEach((x) => add("pulls", x));
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  });
  return (
    <Loading
      state={state}
      empty="No branches, recent commits or pull requests mention a task key (e.g. PMS-9) yet."
    >
      {(groups) => (
        <div className="task-groups">
          {groups.map(([key, g]) => (
            <section key={key} className="task-group">
              <h3>
                {tasks[key] ? (
                  <button className="task-chip" onClick={() => onOpenTask(tasks[key])}>{key}</button>
                ) : (
                  <span className="task-chip unknown">{key}</span>
                )}
                {tasks[key] ? ` ${tasks[key].title}` : " Not on this board"}
                {tasks[key] && <span className="tag">{tasks[key].status}</span>}
              </h3>
              <p className="dev-meta">
                {g.branches.length} branches · {g.commits.length} commits · {g.pulls.length} pull requests
              </p>
              <ul className="dev-list">
                {g.branches.map((x) => (
                  <li key={`b${x.name}`}>
                    <a href={x.url} target="_blank" rel="noreferrer">Branch <code>{x.name}</code></a>
                  </li>
                ))}
                {g.pulls.map((x) => (
                  <li key={`p${x.number}`}>
                    <a href={x.url} target="_blank" rel="noreferrer">
                      <span className={`pr-status ${x.status}`}>{x.status}</span> #{x.number} {x.title}
                    </a>
                  </li>
                ))}
                {g.commits.map((x) => (
                  <li key={`c${x.sha}`}>
                    <a href={x.url} target="_blank" rel="noreferrer">
                      <code>{x.sha.slice(0, 7)}</code> {x.message}
                    </a>
                    <span className="dev-meta">{x.author} · {timeAgo(x.date)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Loading>
  );
}

export default function RepoExplorer({ connection, tasks, onOpenTask, onManageRepos }) {
  const [selected, setSelected] = useState(connection.repos?.[0] || "");
  const [tab, setTab] = useState("tasks");
  const repo = connection.repos?.includes(selected) ? selected : connection.repos?.[0];

  if (!connection.connected) {
    return <p className="gh-empty">Connect GitHub from the top bar to browse your repositories.</p>;
  }
  if (!repo) {
    return (
      <p className="gh-empty">
        No repositories linked. <button className="link-btn" onClick={onManageRepos}>Link repositories</button>
      </p>
    );
  }

  const chips = (keys) => <TaskChips keys={keys} tasks={tasks} onOpenTask={onOpenTask} />;
  const props = { repo, chips, tasks, onOpenTask };

  return (
    <div className="explorer">
      <aside className="repo-sidebar">
        <p className="gh-dropdown-label">Linked repositories</p>
        {connection.repos.map((r) => (
          <button key={r} className={`repo-pick ${r === repo ? "active" : ""}`} onClick={() => setSelected(r)}>
            <GitHubIcon size={14} /> {r}
          </button>
        ))}
        <button className="link-btn" onClick={onManageRepos}>Manage repositories</button>
      </aside>

      <div className="repo-main">
        <Overview key={`o${repo}`} repo={repo} />
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="tab-body" key={repo}>
          {tab === "tasks" && <LinkedTasks {...props} />}
          {tab === "branches" && <Branches {...props} />}
          {tab === "commits" && <Commits {...props} />}
          {tab === "pulls" && <Pulls {...props} />}
          {tab === "issues" && <Issues {...props} />}
          {tab === "projects" && <Projects {...props} />}
        </div>
      </div>
    </div>
  );
}
