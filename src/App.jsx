import { useCallback, useEffect, useState } from "react";
import { github } from "./github.js";
import { GitHubConnect, RepoPicker } from "./GitHubConnect.jsx";
import TaskPanel from "./TaskPanel.jsx";
import RepoExplorer from "./RepoExplorer.jsx";

const columns = [
  {
    title: "To do",
    tasks: [
      { id: "PMS-12", title: "Set up sprint board filters", assignee: "AK" },
      { id: "PMS-14", title: "Write release notes for v1.2", assignee: "TS" },
    ],
  },
  {
    title: "In progress",
    tasks: [
      { id: "PMS-9", title: "Link commits to tasks", assignee: "PR" },
      { id: "PMS-11", title: "Design DevOps tracking page", assignee: "AB" },
    ],
  },
  {
    title: "Done",
    tasks: [{ id: "PMS-7", title: "User login and roles", assignee: "TS" }],
  },
];

// Task key -> task, so GitHub mentions like "PMS-9" can open the task.
const taskIndex = Object.fromEntries(
  columns.flatMap((col) => col.tasks.map((t) => [t.id, { ...t, status: col.title }]))
);

export default function App() {
  const [page, setPage] = useState("home"); // "home" | "repos"
  const [connection, setConnection] = useState({ loading: true, connected: false, repos: [] });
  const [notice, setNotice] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeTask, setActiveTask] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const s = await github.status();
      setConnection({ loading: false, repos: [], ...s });
      return s;
    } catch {
      setConnection({ loading: false, connected: false, repos: [] });
      setNotice("Can't reach the PMS API. Is `npm run server` running?");
      return null;
    }
  }, []);

  // On load, check the connection and handle the return from GitHub's OAuth screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("github");
    if (result) window.history.replaceState({}, "", window.location.pathname);

    refresh().then((s) => {
      if (result === "error") setNotice("GitHub connection failed. Please try again.");
      if (result === "connected" && s?.connected) {
        setNotice(`Connected to GitHub as ${s.user.login}.`);
        if (!s.repos.length) setPickerOpen(true); // next step, like Jira: pick repos
      }
    });
  }, [refresh]);

  const closePicker = useCallback(() => setPickerOpen(false), []);
  const closeTask = useCallback(() => setActiveTask(null), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">P</span>
          <span className="brand-name">PMS</span>
        </div>

        <button
          className="menu-toggle"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>

        <nav className={`menu ${menuOpen ? "open" : ""}`}>
          <a href="#" className={page === "home" ? "active" : ""} onClick={(e) => { e.preventDefault(); setPage("home"); }}>
            Home
          </a>
          <a href="#">Projects</a>
          <a href="#" className={page === "repos" ? "active" : ""} onClick={(e) => { e.preventDefault(); setPage("repos"); }}>
            Repositories
          </a>
          <a href="#">Reports</a>
          <GitHubConnect connection={connection} onChange={refresh} onManageRepos={() => setPickerOpen(true)} />
        </nav>
      </header>

      {notice && (
        <div className="notice" role="status">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice("")}>✕</button>
        </div>
      )}

      {page === "repos" && (
        <main className="home">
          <RepoExplorer
            connection={connection}
            tasks={taskIndex}
            onOpenTask={setActiveTask}
            onManageRepos={() => setPickerOpen(true)}
          />
        </main>
      )}

      {page === "home" && <main className="home">
        <div className="home-head">
          <h1>Website revamp</h1>
          <p>Sprint 4 ends Friday. 5 tasks on the board.</p>
        </div>

        <section className="board">
          {columns.map((col) => (
            <div className="column" key={col.title}>
              <h2>
                {col.title} <span className="count">{col.tasks.length}</span>
              </h2>
              {col.tasks.map((task) => (
                <article className="task" key={task.id}>
                  <button className="task-open" onClick={() => setActiveTask({ ...task, status: col.title })}>
                    <p className="task-title">{task.title}</p>
                    <div className="task-meta">
                      <span className="task-id">{task.id}</span>
                      <span className="avatar">{task.assignee}</span>
                    </div>
                  </button>
                </article>
              ))}
            </div>
          ))}
        </section>
      </main>}

      {activeTask && (
        <TaskPanel
          task={activeTask}
          connection={connection}
          onClose={closeTask}
          onManageRepos={() => setPickerOpen(true)}
        />
      )}

      {pickerOpen && connection.connected && (
        <RepoPicker
          linked={connection.repos}
          onClose={closePicker}
          onSaved={async () => {
            setPickerOpen(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
