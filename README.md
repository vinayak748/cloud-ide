# Cloud IDE

A browser-based code editor with a live execution backend. Write JavaScript
or Python in a Monaco-powered editor (the same engine used by VS Code) and
run it with one click — output and errors stream back into an output panel.

This is an original build, structured as an MVP with a clear path to
production hardening (see "Roadmap" below).

## Architecture

```
frontend/   React + Vite app. Monaco editor, language selector, run button,
            output panel. Talks to the backend over /api (proxied to the
            Express server in dev).

backend/    Express API with a single POST /run endpoint. Writes the
            submitted code to a temp file and executes it with the matching
            interpreter (node / python3), enforcing a timeout and output
            size cap so a bad snippet can't hang or flood the response.
```

## Running locally

**Backend**
```
cd backend
npm install
npm start        # listens on http://localhost:4000
```

**Frontend** (separate terminal)
```
cd frontend
npm install
npm run dev       # opens http://localhost:5173
```

The frontend dev server proxies `/api/*` to the backend automatically
(see `frontend/vite.config.js`), so no CORS setup is needed locally.

## Current scope

- Languages: JavaScript (Node) and Python 3
- Sandboxed execution: each run happens in a fresh, locked-down Docker
  container (see "Sandboxing" below)
- 6s hard timeout and 20k character output cap
- No auth, no persistence, no multi-user collaboration yet — see Roadmap

## Sandboxing (`backend/dockerRunner.js`)

By default (`EXECUTOR=docker`, the default if unset) every submission runs
in its own `docker run`, locked down like this:

| Flag | Why |
|---|---|
| `--network none` | no outbound network from inside the sandbox |
| `--read-only` + `--tmpfs /tmp` | container's own filesystem can't be written to, only a small scratch `/tmp` |
| `--memory 128m` / `--cpus 0.5` | bounds resource usage per run |
| `--pids-limit 64` | blocks fork-bomb style attacks |
| `--user 1000:1000` | submitted code never runs as root |
| `-v <tmpdir>:/code:ro` | code is mounted read-only; can't modify itself |
| `timeout -k 2 6s docker ...` | guarantees the process tree dies even if the code ignores signals |
| unique `--name` + `docker rm -f` after | belt-and-suspenders cleanup if `--rm` doesn't fire |

Images are pinned (`node:20-alpine`, `python:3.12-alpine`), not `latest`,
so the sandbox behavior doesn't silently change on you.

Set `EXECUTOR=local` to skip Docker and run directly on the host via
`node`/`python3` — only useful if you're developing without Docker
installed locally. **Never use `local` mode for anything deployed
publicly** — it lets a submitter's code touch your actual machine.

### Testing the sandbox yourself

This was written and reasoned through carefully, but built and packaged in
an environment without a Docker daemon, so it hasn't been run end-to-end
against real Docker yet. Before you trust it, run through this checklist
locally (with Docker Desktop or Docker Engine installed and running):

1. `cd backend && npm install && npm start` (leave `EXECUTOR` unset so it
   defaults to `docker`)
2. Basic execution: submit `console.log(2+2)` (JS) and `print(1+1)`
   (Python) via the frontend or `curl -X POST http://localhost:4000/run
   -d '{"code":"console.log(2+2)","language":"javascript"}' -H
   "Content-Type: application/json"` — confirm you get `4` back.
3. Timeout: submit `while(true){}` — confirm it comes back after ~6s with
   `"timedOut": true`, and check `docker ps` immediately after to confirm
   no orphaned container is left running.
4. Network isolation: submit something that tries to make a network call
   (e.g. Python `import urllib.request; urllib.request.urlopen("http://example.com")`)
   and confirm it fails inside the sandbox.
5. Resource limits: submit something memory-hungry (e.g. a JS array grown
   in a loop to consume >128MB) and confirm the container is killed rather
   than affecting your host.
6. Cleanup: run several requests back-to-back, then check `docker ps -a`
   to confirm no containers are piling up.

If anything in that checklist doesn't hold, treat it as a bug to fix
before you rely on this for anything beyond your own local testing.

## Persistence & auth

Registered users can save, reload, and delete code snippets, backed by
MongoDB and protected by JWT auth.

- `backend/models/User.js`, `backend/models/Snippet.js` — Mongoose schemas
- `backend/auth.js` — password hashing (bcrypt) and JWT sign/verify
- `backend/middleware/requireAuth.js` — rejects requests without a valid
  Bearer token
- `backend/routes/auth.js` — `POST /auth/register`, `POST /auth/login`
- `backend/routes/snippets.js` — full CRUD, every query scoped to the
  logged-in user's own `owner` id (one user can never read/edit another's
  snippet, even by guessing an id)
- Frontend: `src/AuthPanel.jsx` (login/register) and a sidebar in `App.jsx`
  listing saved snippets, with Save / Load / Delete / New

### Setup

1. Get a MongoDB connection string — the free tier of
   [MongoDB Atlas](https://www.mongodb.com/atlas) works fine for this.
2. Copy `backend/.env.example` to `backend/.env` and fill in `MONGODB_URI`
   and a random `JWT_SECRET`.
3. `cd backend && npm install && npm start`

Without a `.env` configured, the server still boots and `/run` still
works — `/auth/*` and `/snippets/*` return a clear `503` instead of
hanging, so you always know why saving isn't working rather than getting
a silent failure.

### What's actually been tested vs. not

Built in an environment without a MongoDB instance available, so — like
the Docker sandbox — the database-dependent paths are untested by me.
What **was** tested directly:
- Password hashing round-trip (hash → compare correct password → true,
  wrong password → false)
- JWT sign → verify round-trip, and that a tampered token is rejected
- The server boots correctly with no `.env` at all, `/run` keeps working,
  and `/auth`/`/snippets` fail fast with a clear `503` rather than hanging
- Frontend builds clean with the new auth panel and sidebar

**Before you trust this, verify locally once you have a real
`MONGODB_URI`:**
1. Register a user via the UI, confirm you're logged in and the sidebar
   appears
2. Save a snippet, refresh the page, confirm it's still logged in (token
   persisted) and the snippet is still listed
3. Log out, log back in, confirm your snippets still load
4. Try loading/deleting a snippet's id while logged in as a *different*
   user (e.g. via curl with another user's token) — confirm you get a 404,
   not someone else's snippet
5. Restart the server with `MONGODB_URI` unset — confirm `/run` still
   works and `/auth`, `/snippets` return `503` instead of hanging

## Roadmap (in priority order)

1. ~~Docker-based sandboxing~~ — done, see above (pending your own
   verification per its checklist)
2. ~~Persistence & auth~~ — done, see above (pending your own verification
   per the checklist above)
3. **Real-time collaboration** — Socket.IO-based shared editing sessions.
4. **More languages** — extendable via the `LANGUAGES` config object in
   `backend/server.js` and `DOCKER_LANGUAGES` in `dockerRunner.js`.

## Deployment notes

- The frontend (`frontend/dist` after `npm run build`) can be deployed to
  Vercel/Netlify.
- The backend needs a host that supports long-running Node processes (and,
  once Dockerized, Docker itself) — a small VPS (Railway, Render, or a
  DigitalOcean droplet) rather than a serverless platform.
