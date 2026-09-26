const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

// Per-language Docker image + how to invoke the file inside the container.
// Images are pinned to specific tags (not `latest`) so builds are
// reproducible and you're not surprised by an upstream image change.
const DOCKER_LANGUAGES = {
  javascript: {
    ext: "js",
    image: "node:20-alpine",
    cmd: (fileName) => ["node", `/code/${fileName}`],
  },
  python: {
    ext: "py",
    image: "python:3.12-alpine",
    cmd: (fileName) => ["python3", `/code/${fileName}`],
  },
};

const TIMEOUT_SECONDS = 6; // hard wall-clock limit for the whole `docker run`
const MAX_OUTPUT_CHARS = 20000;
const MEMORY_LIMIT = "128m";
const CPU_LIMIT = "0.5";
const PIDS_LIMIT = "64"; // caps fork bombs

function truncate(text) {
  if (!text) return "";
  return text.length > MAX_OUTPUT_CHARS
    ? text.slice(0, MAX_OUTPUT_CHARS) + "\n...output truncated"
    : text;
}

/**
 * Runs `code` inside a locked-down, single-use Docker container and
 * resolves with { stdout, stderr, timedOut }.
 *
 * Isolation choices, and why:
 * - --network none        no outbound network access from inside the sandbox
 * - --read-only            container's own filesystem can't be written to
 * - --tmpfs /tmp           still gives the interpreter a writable scratch dir
 * - --memory / --cpus      bounds resource usage per run
 * - --pids-limit           blocks fork-bomb style attacks
 * - --user 1000:1000       never runs the submitted code as root
 * - -v <dir>:/code:ro      code is mounted read-only; container can't alter it
 * - JS-level timer          guarantees the process tree dies even if the
 *                           code inside spins forever or ignores signals —
 *                           implemented in Node rather than the Unix
 *                           `timeout` coreutil so this also works on Windows
 * - unique --name + `docker rm -f` afterwards  belt-and-suspenders cleanup
 *   in case --rm doesn't fire (e.g. the process was hard-killed)
 */
function runInDocker(code, language) {
  return new Promise((resolve) => {
    const config = DOCKER_LANGUAGES[language];
    if (!config) {
      resolve({
        stdout: "",
        stderr: `Unsupported language "${language}".`,
        timedOut: false,
      });
      return;
    }

    const runId = uuidv4();
    const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), `cide-${runId}-`));
    const fileName = `snippet.${config.ext}`;
    const hostFilePath = path.join(hostDir, fileName);
    const containerName = `cloud-ide-${runId}`;

    fs.writeFileSync(hostFilePath, code);
    // Files mounted read-only into the container still need to be
    // world-readable on the host side for the container's non-root user.
    fs.chmodSync(hostFilePath, 0o644);
    fs.chmodSync(hostDir, 0o755);

    const dockerArgs = [
      "run",
      "--name", containerName,
      "--rm",
      "--network", "none",
      "--memory", MEMORY_LIMIT,
      "--memory-swap", MEMORY_LIMIT,
      "--cpus", CPU_LIMIT,
      "--pids-limit", PIDS_LIMIT,
      "--read-only",
      "--tmpfs", "/tmp:rw,size=16m",
      "-v", `${hostDir}:/code:ro`,
      "-w", "/code",
      "--user", "1000:1000",
      config.image,
      ...config.cmd(fileName),
    ];

    let timedOut = false;
    let killTimer = null;
    let wallTimer = null;

    const child = execFile(
      "docker",
      dockerArgs,
      { maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        clearTimeout(wallTimer);
        clearTimeout(killTimer);
        cleanup();
        resolve({
          stdout: truncate(stdout),
          stderr: timedOut
            ? "Execution timed out."
            : truncate(stderr || (error ? error.message : "")),
          timedOut,
        });
      }
    );

    // Enforce the wall-clock timeout ourselves: send SIGTERM at N seconds,
    // and if the `docker run` client hasn't exited 2 seconds later,
    // escalate to SIGKILL. (On Windows there's no real signal delivery —
    // child.kill() just terminates the process outright, which is fine.)
    // Either way, cleanup() below removes the container itself via
    // `docker rm -f`, regardless of what happens to this client process.
    wallTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 2000);
    }, TIMEOUT_SECONDS * 1000);

    function cleanup() {
      fs.rm(hostDir, { recursive: true, force: true }, () => {});
      // Best-effort: if --rm didn't get to run because the container was
      // force-killed, make sure it isn't left behind.
      execFile("docker", ["rm", "-f", containerName], () => {});
    }
  });
}

module.exports = { runInDocker, DOCKER_LANGUAGES };
