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

This has now been run end-to-end against real Docker (previously it had
only been written and reasoned through, in an environment without a
Docker daemon). All six checks below passed locally on Windows (Docker
Desktop + WSL2 backend):

1. `cd backend && npm install && npm start` (leave `EXECUTOR` unset so it
   defaults to `docker`)
2. Basic execution: submit `console.log(2+2)` (JS) and `print(1+1)`
   (Python) via the frontend or `curl -X POST http://localhost:4000/run
   -d '{"code":"console.log(2+2)","language":"javascript"}' -H
   "Content-Type: application/json"` — confirm you get `4` back. ✅
3. Timeout: submit `while(true){}` — confirm it comes back after ~6s with
   `"timedOut": true`, and check `docker ps` immediately after to confirm
   no orphaned container is left running. ✅
4. Network isolation: submit something that tries to make a network call
   (e.g. Python `import urllib.request; urllib.request.urlopen("http://example.com")`)
   and confirm it fails inside the sandbox. ✅
5. Resource limits: submit something memory-hungry (e.g. a JS array grown
   in a loop to consume >128MB) and confirm the container is killed rather
   than affecting your host. ✅
6. Cleanup: run several requests back-to-back, then check `docker ps -a`
   to confirm no containers are piling up. ✅

**Cross-platform note:** the timeout was originally enforced by wrapping
`docker run` with the Unix `timeout` coreutil, which doesn't exist on
Windows (native Windows has its own unrelated `timeout.exe`, which broke
with a syntax error). It's now enforced with a plain Node.js
`setTimeout` that sends SIGTERM then escalates to SIGKILL, so it works
identically on Windows, Mac, and Linux — the container cleanup logic
(`docker rm -f` after) is unchanged.

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

Originally built in an environment without a MongoDB instance available,
so the database-dependent paths were untested by me at first. All of the
following has now been verified end-to-end against a real MongoDB Atlas
cluster:
- Password hashing round-trip (hash → compare correct password → true,
  wrong password → false)
- JWT sign → verify round-trip, and that a tampered token is rejected
- The server boots correctly with no `.env` at all, `/run` keeps working,
  and `/auth`/`/snippets` fail fast with a clear `503` rather than hanging
- Frontend builds clean with the new auth panel and sidebar
- Register → login → save a snippet → refresh → still logged in, snippet
  still listed → log out → log back in → snippets still load ✅
- **Cross-user access (IDOR) check:** logged in as a second user, tried
  loading/deleting the first user's snippet by id — correctly got `404`,
  not the other user's data, since every query is scoped to
  `{ _id, owner: req.userId }` ✅
- Restarting the server with `MONGODB_URI` unset — `/run` still works,
  `/auth`/`/snippets` return `503` instead of hanging ✅

**Bug found and fixed during this testing:** `GET/PUT/DELETE
/snippets/:id` had no `try/catch` around the Mongoose query, so a
malformed id (e.g. `/snippets/abc`, not a valid ObjectId) threw an
uncaught `CastError` and left the request hanging with no response
instead of a clean `400`. Same issue existed on `POST /snippets` for
Mongoose validation errors (e.g. a title over 100 characters). Both are
now wrapped in `try/catch` and return a proper `400` for invalid
input — see `backend/routes/snippets.js`.

## Roadmap (in priority order)

1. Docker-based sandboxing — done, see above (pending your own
   verification per its checklist)
2. Persistence & auth — done, see above (pending your own verification
   per the checklist above)
3. **Real-time collaboration** — Socket.IO-based shared editing sessions.
4. **More languages** — extendable via the `LANGUAGES` config object in
   `backend/server.js` and `DOCKER_LANGUAGES` in `dockerRunner.js`.

## Deployment notes

**Live demo:**
- Frontend: https://cloud-ide-alpha.vercel.app (Vercel)
- Backend: https://cloud-ide-9myo.onrender.com (Render, free tier — the
  first request after a period of inactivity can take 30-50s to wake up)

The frontend reads a `VITE_API_BASE` env var (set in Vercel's project
settings) to know which backend to call; when it's unset (local dev) it
falls back to relative `/api/*` paths proxied by Vite instead — see
`frontend/src/api.js`.

**Why `/run` (code execution) doesn't work on the hosted demo:** Render,
like most PaaS platforms (Railway, Vercel, Heroku, etc.), runs your app
inside its own container and doesn't allow spawning further Docker
containers from within it ("Docker-in-Docker" is blocked for security
reasons on shared infrastructure). Since the sandbox's whole design
depends on being able to run `docker run` on the host, that only works
somewhere you control the actual VM — a VPS (a DigitalOcean droplet, a
Hetzner/Linode box, or a self-managed EC2/Oracle Cloud instance) with
Docker installed directly on it, not a managed app platform.

So the deployed demo above showcases the auth + persistence layer
(register/login/save/reload/delete, with the IDOR protection verified —
see above) end-to-end; the Docker sandbox for code execution is fully
built, tested, and working (see the "Testing the sandbox yourself"
checklist above), but is demoed by running the project locally rather
than on this particular hosted backend.
- The frontend (`frontend/dist` after `npm run build`) can also be
  deployed to Netlify as an alternative to Vercel.
