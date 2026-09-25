import { useEffect, useRef, useState } from "react";
import { github } from "./github.js";

export function GitHubIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
        0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
        -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
        .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
        -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
        1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
        1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
        1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// Top-bar control: "Connect to GitHub" when disconnected, account menu when connected.
export function GitHubConnect({ connection, onChange, onManageRepos }) {
  const [open, setOpen] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (connection.loading) {
    return (
      <button className="github-btn connecting" disabled>
        <GitHubIcon /> Checking GitHub…
      </button>
    );
  }

  if (!connection.connected) {
    return (
      <button
        className={`github-btn ${redirecting ? "connecting" : ""}`}
        disabled={redirecting}
        onClick={() => {
          setRedirecting(true);
          github.connect();
        }}
      >
        <GitHubIcon />
        {redirecting ? "Redirecting to GitHub…" : "Connect to GitHub"}
      </button>
    );
  }

  const { user, repos } = connection;
  return (
    <div className="gh-account" ref={ref}>
      <button className="github-btn connected" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <img src={user.avatarUrl} alt="" className="gh-avatar" />
        {user.login}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="gh-dropdown" role="menu">
          <p className="gh-dropdown-label">Linked repositories</p>
          {repos.length ? (
            <ul className="gh-repo-list">
              {repos.map((r) => (
                <li key={r}>
                  <a href={`https://github.com/${r}`} target="_blank" rel="noreferrer">{r}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="gh-empty">No repositories linked yet.</p>
          )}
          <button
            className="gh-menu-item"
            onClick={() => {
              setOpen(false);
              onManageRepos();
            }}
          >
            Manage repositories
          </button>
          <button
            className="gh-menu-item danger"
            onClick={async () => {
              setOpen(false);
              await github.disconnect();
              onChange();
            }}
          >
            Disconnect GitHub
          </button>
        </div>
      )}
    </div>
  );
}

// Modal to choose which repositories are linked to PMS (like Jira's "Add repositories").
export function RepoPicker({ linked, onClose, onSaved }) {
  const [repos, setRepos] = useState(null);
  const [selected, setSelected] = useState(() => new Set(linked));
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    github.repos().then(setRepos, (e) => setError(e.message));
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (name) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await github.linkRepos([...selected]);
      onSaved();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const visible = (repos || []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="repo-picker-title">
        <h2 id="repo-picker-title">Link GitHub repositories</h2>
        <p className="modal-sub">
          Branches, commits and pull requests that mention a task key (e.g. <code>PMS-9</code>) will show up on that
          task.
        </p>
        <input
          className="modal-search"
          placeholder="Filter repositories"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
        <div className="repo-options">
          {error && <p className="gh-error">{error}</p>}
          {!repos && !error && <p className="gh-empty">Loading repositories…</p>}
          {repos && visible.length === 0 && <p className="gh-empty">No repositories found.</p>}
          {visible.map((r) => (
            <label key={r.fullName} className="repo-option">
              <input type="checkbox" checked={selected.has(r.fullName)} onChange={() => toggle(r.fullName)} />
              <span>{r.fullName}</span>
              {r.private && <span className="tag">Private</span>}
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <span className="gh-empty">{selected.size} selected (max 10)</span>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || selected.size > 10}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
