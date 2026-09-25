import { useEffect, useState } from "react";
import { branchNameFor, github, timeAgo } from "./github.js";
import { GitHubIcon } from "./GitHubConnect.jsx";

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// Jira-style "Development" section: branches, commits and PRs linked by task key.
function Development({ task, connection, onManageRepos }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null); // "branches" | "commits" | "pullRequests"
  const [copied, setCopied] = useState(false);
  const branchCmd = `git checkout -b ${branchNameFor(task)}`;
  const repoKey = connection.repos?.join(",");

  useEffect(() => {
    if (!connection.connected || !connection.repos.length) return;
    let cancelled = false;
    setData(null);
    setError("");
    github.development(task.id).then(
      (d) => !cancelled && setData(d),
      (e) => !cancelled && setError(e.message)
    );
    return () => {
      cancelled = true;
    };
  }, [task.id, connection.connected, repoKey]);

  if (!connection.connected) {
    return (
      <p className="gh-empty">
        Connect GitHub from the top bar to see branches, commits and pull requests for {task.id}.
      </p>
    );
  }
  if (!connection.repos.length) {
    return (
      <p className="gh-empty">
        No repositories linked.{" "}
        <button className="link-btn" onClick={onManageRepos}>Link repositories</button>
      </p>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(branchCmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const prStatus = data?.pullRequests.length
    ? data.pullRequests.some((p) => p.status === "open")
      ? "open"
      : data.pullRequests[0].status
    : null;

  const rows = data && [
    { id: "branches", label: plural(data.branches.length, "branch", "branches"), count: data.branches.length },
    { id: "commits", label: plural(data.commits.length, "commit"), count: data.commits.length },
    { id: "pullRequests", label: plural(data.pullRequests.length, "pull request"), count: data.pullRequests.length, status: prStatus },
  ];

  return (
    <div className="dev">
      <div className="create-branch">
        <code>{branchCmd}</code>
        <button className="btn-secondary small" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>

      {error && <p className="gh-error">{error}</p>}
      {!data && !error && <p className="gh-empty">Loading development info…</p>}

      {rows?.map((row) => (
        <div key={row.id} className="dev-group">
          <button
            className="dev-row"
            disabled={!row.count}
            aria-expanded={open === row.id}
            onClick={() => setOpen(open === row.id ? null : row.id)}
          >
            <GitHubIcon size={14} />
            <span>{row.label}</span>
            {row.status && <span className={`pr-status ${row.status}`}>{row.status}</span>}
          </button>

          {open === "branches" && row.id === "branches" && (
            <ul className="dev-list">
              {data.branches.map((b) => (
                <li key={b.repo + b.name}>
                  <a href={b.url} target="_blank" rel="noreferrer">{b.name}</a>
                  <span className="dev-meta">{b.repo}</span>
                </li>
              ))}
            </ul>
          )}
          {open === "commits" && row.id === "commits" && (
            <ul className="dev-list">
              {data.commits.map((c) => (
                <li key={c.sha}>
                  <a href={c.url} target="_blank" rel="noreferrer">
                    <code>{c.sha.slice(0, 7)}</code> {c.message}
                  </a>
                  <span className="dev-meta">
                    {c.author} · {timeAgo(c.date)} · {c.repo}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {open === "pullRequests" && row.id === "pullRequests" && (
            <ul className="dev-list">
              {data.pullRequests.map((p) => (
                <li key={p.url}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    #{p.number} {p.title}
                  </a>
                  <span className="dev-meta">
                    <span className={`pr-status ${p.status}`}>{p.status}</span> {p.author} · {p.branch} · {p.repo}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <p className="dev-hint">
        Include <code>{task.id}</code> in a branch name, commit message or pull request title to link it here.
      </p>
    </div>
  );
}

export default function TaskPanel({ task, connection, onClose, onManageRepos }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="panel-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="task-panel-title">
        <div className="panel-head">
          <span className="task-id">{task.id}</span>
          <button className="panel-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <h2 id="task-panel-title">{task.title}</h2>
        <dl className="panel-fields">
          <dt>Status</dt>
          <dd>{task.status}</dd>
          <dt>Assignee</dt>
          <dd><span className="avatar">{task.assignee}</span></dd>
        </dl>
        <h3>Development</h3>
        <Development task={task} connection={connection} onManageRepos={onManageRepos} />
      </aside>
    </div>
  );
}
