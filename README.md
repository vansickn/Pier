# Pier

Pier is a macOS menu-bar app and CLI for orchestrating local dev services
across tmux. Each project can have any number of named services (web, worker,
assets, docker compose, …) plus ad-hoc terminals, all running in a single tmux
session per project so you can detach, re-attach, and inspect logs without
losing state.

The CLI ships in the same package and is fully scriptable, so agents and
shell scripts can drive Pier the same way the UI does.

State lives in:

- `~/.pier/projects.json` – projects, services, autostart, last-running set
- `~/Library/Logs/Pier/<project>-<service>.log` – per-service log files
- `tmux` session `pier-<project-id>` – one window per service or terminal

## Requirements

- macOS (the Electron menu-bar UI is mac-only; the CLI itself is mac/Linux)
- Node.js 18+ and `npm`
- `tmux` on `PATH`

```bash
brew install tmux
```

## Install

```bash
git clone <this repo> ~/Development/pier
cd ~/Development/pier
npm install
```

### Run the menu-bar app from source

```bash
npm run app
```

This launches Electron in dev mode with the Pier glyph in the menu bar.
Opening `src/renderer/index.html` directly only shows the HTML shell — it
cannot reach the native backend.

### Install as a clickable app

```bash
npm run install:app
open ~/Applications/Pier.app
```

The build script:

- Generates the app icon and menu-bar template from `assets/pier.svg`
  (via Electron — no native deps needed)
- Bundles the source into `dist/Pier.app`
- Copies the bundle to `~/Applications/Pier.app`

If Pier is already running when you reinstall, quit it from its menu first or
just `killall Pier && open ~/Applications/Pier.app`.

### CLI

Use `node bin/pier.js` during development:

```bash
node bin/pier.js list
```

Or link it globally:

```bash
npm link
pier list
```

## Quick Start

```bash
# Add a project. Pier auto-detects npm/yarn/pnpm/bundle/rails commands.
pier add ~/Development/control-panel --port 3000

# Start every service marked autostart.
pier start control-panel

# See running/total services and ports.
pier status control-panel

# Tail one service's logs.
pier logs control-panel web -n 200

# Open a fresh interactive shell in the project's tmux session.
pier shell control-panel "rails c"
```

## CLI Reference

```text
Project commands
  pier list [--json]
  pier add <folder> [--name N] [--port P] [--cmd "..."]
  pier status [project] [--json]
  pier start   <project> [service] [--port P]
  pier stop    <project> [service]
  pier restart <project> [service] [--port P]
  pier reclaim <project> <service>     # kill external port-holder, then start
  pier open    <project> [service]
  pier remove  <project>

Service commands
  pier services       <project>
  pier add-service    <project> --name N --cmd "..." [--port P] [--autostart]
  pier update-service <project> <service> [--name N] [--cmd C] [--port P]
                                          [--autostart] [--no-autostart]
  pier remove-service <project> <service>
  pier primary        <project> <service>     # service used by `open`

Logs
  pier logs       <project> [service] [-n LINES]
  pier clear-logs <project> <service>

Terminals (ad-hoc tmux windows in the project session)
  pier shell       <project> [name] [--cmd "..."]
  pier shell-close <project> <name>
  pier attach      <project>          # prints `tmux attach -t pier-<id>`

Misc
  pier doctor
```

Every read command (`list`, `status`, `services`, `logs`) supports `--json`
or returns structured data, making it safe to use from scripts and agents.

## Tmux Layout

Pier owns one session per project, named `pier-<project-id>`. Inside that
session:

- One tmux window per service (`web`, `worker`, `assets`, …)
- One tmux window per ad-hoc terminal you spawn from the UI or `pier shell`
- Stopping a service kills only that window. Stopping the project kills the
  whole session.

You can attach manually any time:

```bash
tmux attach -t pier-control-panel
tmux kill-session -t pier-control-panel
```

## Ports

When a service has a `port`, Pier injects `PORT=<port>` into its environment
before running the command, and detects whether the port is currently held by
that service or by an external process. The UI shows external listeners with a
**Reclaim** button (and `pier reclaim` does the same): it kills the
port-holder (and its process group / children), waits, and then starts the
service.

If a process is stuck in uninterruptible kernel sleep (`STAT UE`), Pier
reports that explicitly and suggests either rebooting or changing the port —
nothing in user-space can free those.

## Agent Skill

A ready-to-copy skill lives at `agent-skill/SKILL.md`. It documents the data
model, every CLI verb, the JSON shapes, and recipes like "start one service",
"reclaim a port", and "open an ad-hoc shell". Drop it into your agent's
skills directory so it can drive Pier instead of guessing which process owns
a port.

## Repo Layout

```
assets/                 SVG source + generated app & tray icons
bin/pier.js             CLI entry point
scripts/make-icons.js   Build app + tray icons from assets/pier.svg
scripts/render-icon.js  Electron-based SVG → PNG renderer
scripts/build-app.js    Bundle Electron + sources into Pier.app
src/core/pier.js        Project / service / tmux backend (used by UI + CLI)
src/electron/           Menu-bar app (main + preload)
src/renderer/           UI (HTML / CSS / renderer JS)
agent-skill/SKILL.md    Skill documentation for AI agents
```

## Troubleshooting

- **Menu-bar icon missing after install** — `killall Pier; open ~/Applications/Pier.app`
- **Stale Dock icon** — `killall Dock` (Pier's own LaunchServices registration runs on install)
- **Port can't be freed** — see the message Pier prints; if the holder is in
  `STAT UE`, only a reboot will release it
- **`tmux: command not found`** — `brew install tmux`

## License

MIT — see [`LICENSE`](./LICENSE).
