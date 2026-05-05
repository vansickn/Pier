# Pier — local dev server orchestrator

Use this skill when the user asks about:

- local development servers / running web apps / `localhost:<port>`
- starting, stopping, or restarting projects (Rails, Next.js, Django, etc.)
- inspecting logs from background processes
- multi-process projects (web + worker + asset pipeline + docker, etc.)
- ad-hoc terminals attached to a project (e.g. `bin/rails c`)
- Pier itself (the tray app, `~/.pier/projects.json`, tmux sessions named `pier-<id>`)

Pier manages a list of projects. Each project has one or more **services**
(e.g. `web`, `worker`, `assets`) and optionally **terminals** (ad-hoc tmux
windows for one-off commands). Each service runs in its own tmux window inside
a per-project session, with its own log file at
`~/Library/Logs/Pier/<project>-<service>.log`.

## Invocation

Prefer the `pier` CLI. If it isn't globally linked, use:

```bash
node /path/to/pier/bin/pier.js <command>
```

Get full help any time:

```bash
pier help
```

## Read-only inspection (always safe)

```bash
pier list                       # human-readable summary, one line per project
pier list --json                # full status as JSON

pier status                     # same as list, all projects
pier status <project> --json    # full project incl. services + terminals
pier services <project>         # one line per service

pier logs <project>             # combined logs for all services (with headers)
pier logs <project> <service>   # logs for one service only
pier logs <project> <service> -n 500

pier attach <project>           # prints `tmux attach -t pier-<project>`
pier doctor                     # diagnostics — config dirs, tmux version, all projects
```

Project status fields you'll see in JSON:

- `id`, `name`, `path`, `url` (primary service URL or `null`)
- `running` (bool — any service running)
- `lifecycle` — `running` | `stopped`
- `services[]` — each with `id`, `name`, `command`, `setup`, `port`,
  `autostart`, `running`, `lifecycle` (`running` | `stopped` | `external`),
  `url`, `logPath`, `process` (the `lsof` info for whoever is holding the
  port). `setup` is an optional shell block that runs before `command` in
  the user's login shell (good for `nvm use 18`, `bundle install`, etc.).
- `terminals[]` — `name`, `running` (ad-hoc tmux windows)
- `primaryServiceId` — which service the "Open" action targets

`lifecycle: "external"` means a port that Pier expected is held by a
process Pier did not start. **Do not kill it unless the user asks.**

## Project management

```bash
pier add <folder>                                   # auto-detects framework + creates a "dev" service
pier add <folder> --name "My App" --port 3001 --cmd "bin/rails s"
pier remove <project>                               # stops project then deletes from config
```

Auto-detection rules in `addProject`:

- `Gemfile` + `bin/dev` → `bin/dev`
- `Gemfile` + `bin/rails` → `bin/rails s`
- `Gemfile` only → `bundle exec rails s`
- `package.json` with `dev` script → `npm run dev`
- `package.json` with `start` script → `npm start`
- `manage.py` → `python manage.py runserver`
- otherwise → `npm run dev`

## Service management

A project starts with one auto-detected `dev` service. Add more for workers,
asset pipelines, sidecars, etc.

```bash
pier add-service <project> --name worker --cmd "bundle exec sidekiq" --autostart
pier add-service <project> --name assets --cmd "bin/vite dev"
pier add-service <project> --name docker --cmd "docker compose up" --autostart

pier update-service <project> <service> --cmd "new command"
pier update-service <project> <service> --port 3500
pier update-service <project> <service> --autostart
pier update-service <project> <service> --no-autostart
pier update-service <project> <service> --name "Sidekiq"
pier update-service <project> <service> --setup "nvm use 18 && bundle install"
pier update-service <project> <service> --no-setup

pier remove-service <project> <service>
pier primary <project> <service>             # which service the "Open" button uses
```

Notes:

- A service only gets a `PORT` env var if it has `port` set or its command
  references `$PORT`. Workers/non-web services should leave port blank.
- Service `id` is auto-derived from name (slugified). Use the id for all
  subsequent commands (or the name — both work).
- `--setup` is an optional shell block that runs *before* `--cmd` on every
  start, in the user's login shell. Use it for things like `nvm use 18`,
  `bundle install`, `yarn install`, `rbenv shell 3.3.0`. Setup is wrapped
  in `set -e` — if it fails, the main command never runs. Setup output is
  teed into the same log file as the service.

## Lifecycle

```bash
pier start <project>             # starts every service with autostart=true
pier start <project> <service>   # starts one specific service

pier stop <project>              # stops all services + terminals (kills the tmux session)
pier stop <project> <service>    # stops one service window only

pier restart <project>           # restarts whatever was running
pier restart <project> <service>

pier open <project>              # opens primary service URL in browser
pier open <project> <service>    # opens a specific service URL
```

If a service shows lifecycle `external`, a foreign process holds its port.
**Confirm with the user before reclaiming** — this kills the holder.

```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN     # see who has it
pier reclaim <project> <service>       # kill holder (incl. process group + children) then start
```

Reclaim cascades through SIGTERM → wait → SIGKILL → process-group kill →
parent-chain kill, so it handles orphaned daemons (e.g. detached
`next-server` processes that survived their parent shell).

## Logs

```bash
pier logs <project>                    # all services interleaved with headers
pier logs <project> <service>          # one service
pier logs <project> <service> -n 500   # tail 500 lines
pier clear-logs <project> <service>    # truncate that service's log file
```

Log files live at `~/Library/Logs/Pier/<project>-<service>.log`. They are
plain text (stdout+stderr teed via tmux). Use normal tools (`grep`, `tail
-f`, etc.) directly when you need streaming.

## Ad-hoc terminals

Terminals are tmux windows in the project's session that aren't tied to a
service definition — handy for `rails c`, `bin/rails db:migrate`, etc.

```bash
pier shell <project>                          # spawn fresh shell window named auto
pier shell <project> rails-c                  # spawn with a specific name
pier shell <project> migrate --cmd "bin/rails db:migrate"
pier shell-close <project> <name>             # close a terminal window
```

Spawned terminals run `<initial-cmd>; exec $SHELL -l`, so the shell stays
open even after the initial command completes. To interact with them
yourself, attach via tmux: `tmux attach -t pier-<project>`.

## Tmux model

```
pier-<project>                  ← session
├── web                         ← service window
├── worker                      ← service window
├── assets                      ← service window
└── rails-c                     ← ad-hoc terminal window
```

```bash
tmux ls                                    # all sessions, pier-* are managed by Pier
tmux attach -t pier-<project>              # full project rig
tmux attach -t pier-<project> \; select-window -t worker
tmux capture-pane -p -t pier-<project>:web -S -200   # last 200 lines
tmux kill-session -t pier-<project>        # kills everything in that project
```

## Workflow recipes

**"Is anything running?"**

```bash
pier list --json | jq '.[] | select(.running) | .id'
```

**"What's on port X?"**

```bash
pier list --json | jq '.[] | .services[] | select(.port == X)'
# or
lsof -nP -iTCP:X -sTCP:LISTEN
```

**"Show me what just broke in <project>"**

```bash
pier logs <project> -n 200
```

**"Add a new Rails project with web + worker + assets"**

```bash
pier add ~/Development/my-rails-app
pier add-service my-rails-app --name web --cmd "bin/rails s" --port 3000 --autostart
pier add-service my-rails-app --name worker --cmd "bundle exec sidekiq" --autostart
pier add-service my-rails-app --name assets --cmd "bin/vite dev" --autostart
pier primary my-rails-app web
pier start my-rails-app
```

**"Service is failing because `bundler: command not found: sidekiq` /
wrong Node version"** — that means dependencies aren't installed or the
runtime isn't on PATH. Add a `--setup` block:

```bash
pier update-service my-app worker --setup "bundle install"
pier update-service my-app frontend --setup "nvm use 18 && yarn install"
pier restart my-app
```

**"Run a one-off rails console"**

```bash
pier shell my-rails-app rails-c --cmd "bin/rails c"
pier attach my-rails-app   # then in your terminal: tmux attach -t pier-my-rails-app \; select-window -t rails-c
```

## Config & state

- Config: `~/.pier/projects.json` — JSON, hand-editable but the CLI is safer.
- Logs: `~/Library/Logs/Pier/`
- Session naming: `pier-<projectId>`
- Schema: `{ projects: [{ id, name, path, services: [...], primaryServiceId, ... }] }`
- Old single-command config auto-migrates on first read.

## Safety

- Don't `remove` projects, `clear-logs`, or `stop` running servers unless
  the user explicitly asks.
- A service in lifecycle `external` is held by something Pier didn't start.
  Don't kill it without the user's go-ahead.
- The CLI mutates state. `list`, `status`, `logs`, `services`, `attach`,
  `doctor` are read-only. Everything else writes config or sends signals.
