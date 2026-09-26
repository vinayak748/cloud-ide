require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { runInDocker } = require("./dockerRunner");
const authRoutes = require("./routes/auth");
const snippetRoutes = require("./routes/snippets");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 4000;
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => {
      console.error("MongoDB connection failed:", err.message);
      // Don't crash the whole server over this — /run still works without
      // a database; only /api/auth/* and /api/snippets/* need it.
    });
} else {
  console.warn(
    "MONGODB_URI is not set — auth and saved snippets are disabled. " +
      "Code execution (/run) still works. See backend/.env.example."
  );
}

function requireDb(req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: "Database not connected. Set MONGODB_URI to use auth/snippets.",
    });
  }
  next();
}

// Mounted without an /api prefix here because the frontend's Vite dev
// proxy strips /api before forwarding (see frontend/vite.config.js) — so
// a browser call to /api/auth/login arrives here as /auth/login.
app.use("/auth", requireDb, authRoutes);
app.use("/snippets", requireDb, snippetRoutes);

// EXECUTOR=docker (default) sandboxes every run in a locked-down container —
// use this for anything beyond your own local testing.
// EXECUTOR=local runs directly on the host via node/python3 — only useful
// if you're developing without Docker installed; never use this for a
// deployment that accepts code from anyone but you.
const EXECUTOR = process.env.EXECUTOR || "docker";

// Per-language run config. Each entry writes the submitted code to a temp
// file with the right extension, then runs it with the given interpreter.
// NOTE: this uses the host's node/python directly. That's fine for local
// dev and demos, but before deploying this publicly, swap the exec call
// below for the Docker-based runner described in dockerRunner.js (step 4
// of the plan) so untrusted code can't touch the host machine.
const LANGUAGES = {
  javascript: {
    ext: "js",
    command: "node",
    args: (file) => [file],
  },
  python: {
    ext: "py",
    command: "python3",
    args: (file) => [file],
  },
};

const EXECUTION_TIMEOUT_MS = 5000;
const MAX_OUTPUT_CHARS = 20000;

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/run", (req, res) => {
  const { code, language } = req.body || {};

  if (typeof code !== "string" || !code.trim()) {
    return res.status(400).json({ error: "`code` is required." });
  }

  const config = LANGUAGES[language];
  if (!config) {
    return res.status(400).json({
      error: `Unsupported language "${language}". Supported: ${Object.keys(LANGUAGES).join(", ")}`,
    });
  }

  if (EXECUTOR === "docker") {
    return runInDocker(code, language).then((result) => res.json(result));
  }

  const tmpDir = os.tmpdir();
  const fileName = `snippet-${uuidv4()}.${config.ext}`;
  const filePath = path.join(tmpDir, fileName);

  fs.writeFile(filePath, code, (writeErr) => {
    if (writeErr) {
      return res.status(500).json({ error: "Failed to prepare code for execution." });
    }

    const child = execFile(
      config.command,
      config.args(filePath),
      { timeout: EXECUTION_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        // Clean up the temp file regardless of outcome
        fs.unlink(filePath, () => {});

        if (error && error.killed) {
          return res.json({
            stdout: truncate(stdout),
            stderr: "Execution timed out.",
            timedOut: true,
          });
        }

        return res.json({
          stdout: truncate(stdout),
          stderr: truncate(stderr || (error ? error.message : "")),
          timedOut: false,
        });
      }
    );
  });
});

function truncate(text) {
  if (!text) return "";
  return text.length > MAX_OUTPUT_CHARS
    ? text.slice(0, MAX_OUTPUT_CHARS) + "\n...output truncated"
    : text;
}

app.listen(PORT, () => {
  console.log(`Cloud IDE execution API running on http://localhost:${PORT}`);
});
