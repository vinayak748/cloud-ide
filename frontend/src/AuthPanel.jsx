import { useState } from "react";
import { login, register } from "./api";

export default function AuthPanel({ onAuthed }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const action = mode === "login" ? login : register;
      const data = await action(username, password);
      onAuthed(data.username);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-panel" onSubmit={handleSubmit}>
      <div className="auth-tabs">
        <button
          type="button"
          className={mode === "login" ? "auth-tab active" : "auth-tab"}
          onClick={() => setMode("login")}
        >
          Log in
        </button>
        <button
          type="button"
          className={mode === "register" ? "auth-tab active" : "auth-tab"}
          onClick={() => setMode("register")}
        >
          Register
        </button>
      </div>

      <input
        className="auth-input"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
      />
      <input
        className="auth-input"
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />

      {error && <div className="auth-error">{error}</div>}

      <button className="auth-submit" type="submit" disabled={busy}>
        {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}
