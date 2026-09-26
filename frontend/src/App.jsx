import { useState, useRef, useEffect, useCallback } from "react";
import Editor from "@monaco-editor/react";
import AuthPanel from "./AuthPanel";
import {
  getToken,
  getStoredUsername,
  clearSession,
  listSnippets,
  getSnippet,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  apiUrl,
} from "./api";

const LANGUAGE_OPTIONS = [
  { value: "javascript", label: "JavaScript", monaco: "javascript" },
  { value: "python", label: "Python", monaco: "python" },
];

const DEFAULT_SNIPPETS = {
  javascript: `// Write JavaScript and hit Run\nfunction greet(name) {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet("world"));\n`,
  python: `# Write Python and hit Run\ndef greet(name):\n    return f"Hello, {name}!"\n\nprint(greet("world"))\n`,
};

export default function App() {
  const [language, setLanguage] = useState("javascript");
  const [code, setCode] = useState(DEFAULT_SNIPPETS.javascript);
  const [output, setOutput] = useState("");
  const [errorOutput, setErrorOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const editorRef = useRef(null);

  // --- Auth state ---
  const [username, setUsername] = useState(getStoredUsername());
  const isLoggedIn = Boolean(username && getToken());

  // --- Saved snippets state ---
  const [snippets, setSnippets] = useState([]);
  const [activeSnippetId, setActiveSnippetId] = useState(null);
  const [title, setTitle] = useState("Untitled snippet");
  const [snippetStatus, setSnippetStatus] = useState(""); // transient save/load feedback

  const refreshSnippets = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const list = await listSnippets();
      setSnippets(list);
    } catch (err) {
      setSnippetStatus(err.message);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    refreshSnippets();
  }, [refreshSnippets]);

  function handleLanguageChange(e) {
    const newLang = e.target.value;
    setLanguage(newLang);
    setCode((prev) =>
      Object.values(DEFAULT_SNIPPETS).includes(prev)
        ? DEFAULT_SNIPPETS[newLang]
        : prev
    );
  }

  async function handleRun() {
    setIsRunning(true);
    setOutput("");
    setErrorOutput("");
    try {
      const res = await fetch(apiUrl("/api/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorOutput(data.error || "Something went wrong.");
      } else {
        setOutput(data.stdout || "");
        setErrorOutput(data.stderr || "");
      }
    } catch (err) {
      setErrorOutput(
        "Could not reach the execution server. Is the backend running on port 4000?"
      );
    } finally {
      setIsRunning(false);
    }
  }

  function handleAuthed(name) {
    setUsername(name);
  }

  function handleLogout() {
    clearSession();
    setUsername(null);
    setSnippets([]);
    setActiveSnippetId(null);
  }

  async function handleSave() {
    setSnippetStatus("Saving…");
    try {
      if (activeSnippetId) {
        await updateSnippet(activeSnippetId, { title, code });
      } else {
        const created = await createSnippet({ title, language, code });
        setActiveSnippetId(created._id);
      }
      await refreshSnippets();
      setSnippetStatus("Saved.");
    } catch (err) {
      setSnippetStatus(err.message);
    }
  }

  async function handleLoadSnippet(id) {
    setSnippetStatus("Loading…");
    try {
      const snippet = await getSnippet(id);
      setActiveSnippetId(snippet._id);
      setTitle(snippet.title);
      setLanguage(snippet.language);
      setCode(snippet.code);
      setSnippetStatus("");
    } catch (err) {
      setSnippetStatus(err.message);
    }
  }

  async function handleDeleteSnippet(id, e) {
    e.stopPropagation();
    try {
      await deleteSnippet(id);
      if (activeSnippetId === id) {
        setActiveSnippetId(null);
      }
      await refreshSnippets();
    } catch (err) {
      setSnippetStatus(err.message);
    }
  }

  function handleNewSnippet() {
    setActiveSnippetId(null);
    setTitle("Untitled snippet");
    setCode(DEFAULT_SNIPPETS[language]);
    setSnippetStatus("");
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-dot" />
          Cloud IDE
        </div>

        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!isLoggedIn}
          title={isLoggedIn ? "Snippet title" : "Log in to name and save snippets"}
        />

        <select
          className="language-select"
          value={language}
          onChange={handleLanguageChange}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button className="run-button" onClick={handleRun} disabled={isRunning}>
          {isRunning ? "Running…" : "▶ Run"}
        </button>

        {isLoggedIn && (
          <button className="save-button" onClick={handleSave}>
            Save
          </button>
        )}

        <div className="account">
          {isLoggedIn ? (
            <>
              <span className="account-name">{username}</span>
              <button className="logout-button" onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <span className="account-hint">Log in to save your work</span>
          )}
        </div>
      </header>

      <main className="workspace">
        {isLoggedIn && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <span>My Snippets</span>
              <button className="new-snippet-button" onClick={handleNewSnippet}>
                + New
              </button>
            </div>
            {snippetStatus && <div className="snippet-status">{snippetStatus}</div>}
            <ul className="snippet-list">
              {snippets.map((s) => (
                <li
                  key={s._id}
                  className={s._id === activeSnippetId ? "snippet-item active" : "snippet-item"}
                  onClick={() => handleLoadSnippet(s._id)}
                >
                  <span className="snippet-title">{s.title}</span>
                  <span className="snippet-lang">{s.language}</span>
                  <button
                    className="snippet-delete"
                    onClick={(e) => handleDeleteSnippet(s._id, e)}
                    title="Delete"
                  >
                    ×
                  </button>
                </li>
              ))}
              {snippets.length === 0 && (
                <li className="snippet-empty">No saved snippets yet.</li>
              )}
            </ul>
          </aside>
        )}

        {!isLoggedIn && (
          <aside className="sidebar sidebar-auth">
            <AuthPanel onAuthed={handleAuthed} />
          </aside>
        )}

        <section className="editor-pane">
          <Editor
            height="100%"
            theme="vs-dark"
            language={LANGUAGE_OPTIONS.find((o) => o.value === language).monaco}
            value={code}
            onChange={(value) => setCode(value ?? "")}
            onMount={(editor) => (editorRef.current = editor)}
            options={{
              fontSize: 14,
              minimap: { enabled: false },
              automaticLayout: true,
              scrollBeyondLastLine: false,
            }}
          />
        </section>

        <section className="output-pane">
          <div className="output-header">Output</div>
          <pre className="output-stdout">{output || " "}</pre>
          {errorOutput && <pre className="output-stderr">{errorOutput}</pre>}
        </section>
      </main>
    </div>
  );
}
