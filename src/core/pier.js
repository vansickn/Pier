const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");

const CONFIG_DIR = path.join(os.homedir(), ".pier");
const PROJECTS_FILE = path.join(CONFIG_DIR, "projects.json");
const LOG_DIR = path.join(os.homedir(), "Library", "Logs", "Pier");
const DEFAULT_DEV_ROOT = path.join(os.homedir(), "Development");
const DEFAULT_PORT_START = 3000;
const ICON_CANDIDATES = [
  "src/app/favicon.ico",
  "src/app/icon.png",
  "src/app/apple-icon.png",
  "app/favicon.ico",
  "app/icon.png",
  "public/favicon.ico",
  "public/favicon.png",
  "public/icon.png",
  "favicon.ico"
];

// ──────────────────────────────────────────────────────────────────────────
// Filesystem + config
// ──────────────────────────────────────────────────────────────────────────

function ensureDirs() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify({ projects: [] }, null, 2));
  }
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "x";
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeProjects(projects) {
  ensureDirs();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify({ projects }, null, 2));
}

// ──────────────────────────────────────────────────────────────────────────
// Detection helpers
// ──────────────────────────────────────────────────────────────────────────

function detectCommand(projectPath) {
  if (fs.existsSync(path.join(projectPath, "Gemfile"))) {
    if (fs.existsSync(path.join(projectPath, "bin/dev"))) return "bin/dev";
    if (fs.existsSync(path.join(projectPath, "bin/rails"))) return "bin/rails s";
    return "bundle exec rails s";
  }
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = readJson(pkgPath, {});
    if (pkg.scripts?.dev) return "npm run dev";
    if (pkg.scripts?.start) return "npm start";
  }
  if (fs.existsSync(path.join(projectPath, "manage.py"))) {
    return "python manage.py runserver";
  }
  return "npm run dev";
}

function mimeForIcon(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function detectIconPath(projectPath) {
  for (const candidate of ICON_CANDIDATES) {
    const file = path.join(projectPath, candidate);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

function iconDataUrl(project) {
  const iconPath = project.iconPath || detectIconPath(project.path);
  if (!iconPath) return null;
  try {
    const data = fs.readFileSync(iconPath);
    return `data:${mimeForIcon(iconPath)};base64,${data.toString("base64")}`;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Project + service migration
// ──────────────────────────────────────────────────────────────────────────

function migrateProject(project) {
  if (Array.isArray(project.services) && project.services.length) return project;
  const command = project.command || detectCommand(project.path);
  const service = {
    id: "dev",
    name: "Dev",
    command,
    port: project.port || null,
    autostart: true,
    env: {}
  };
  const next = {
    id: project.id,
    name: project.name,
    path: project.path,
    createdAt: project.createdAt,
    iconPath: project.iconPath,
    portStart: project.portStart || DEFAULT_PORT_START,
    services: [service],
    primaryServiceId: "dev"
  };
  return next;
}

function loadProjects() {
  ensureDirs();
  const data = readJson(PROJECTS_FILE, { projects: [] });
  const raw = Array.isArray(data.projects) ? data.projects : [];
  let mutated = false;
  const projects = raw.map((project) => {
    const migrated = migrateProject(project);
    if (migrated !== project) mutated = true;
    return migrated;
  });
  if (mutated) writeProjects(projects);
  return projects;
}

function listProjects() {
  return loadProjects();
}

function getProject(id) {
  const project = loadProjects().find(
    (candidate) => candidate.id === id || candidate.name === id
  );
  if (!project) throw new Error(`Unknown project: ${id}`);
  return project;
}

function findService(project, serviceRef) {
  const services = project.services || [];
  return services.find((svc) => svc.id === serviceRef || svc.name === serviceRef) || null;
}

function uniqueServiceId(project, base) {
  const taken = new Set((project.services || []).map((svc) => svc.id));
  const root = slug(base);
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Project CRUD
// ──────────────────────────────────────────────────────────────────────────

function addProject(projectPath, options = {}) {
  ensureDirs();
  const fullPath = path.resolve(projectPath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    throw new Error(`Not a directory: ${fullPath}`);
  }

  const projects = loadProjects();
  const existing = projects.find((project) => project.path === fullPath);
  if (existing) return existing;

  const name = options.name || path.basename(fullPath);
  let id = slug(name);
  let suffix = 2;
  while (projects.some((project) => project.id === id)) {
    id = `${slug(name)}-${suffix++}`;
  }

  const initialService = {
    id: "dev",
    name: "Dev",
    command: options.command || detectCommand(fullPath),
    port: Number(options.port) || null,
    autostart: true,
    env: {}
  };

  const project = {
    id,
    name,
    path: fullPath,
    portStart: Number(options.portStart) || DEFAULT_PORT_START,
    createdAt: new Date().toISOString(),
    services: [initialService],
    primaryServiceId: "dev"
  };

  projects.push(project);
  writeProjects(projects);
  return project;
}

function updateProject(id, patch) {
  const projects = loadProjects();
  const index = projects.findIndex((project) => project.id === id);
  if (index === -1) throw new Error(`Unknown project: ${id}`);
  const next = { ...projects[index], ...patch, id };
  // Never let patches clobber services array unintentionally
  if (patch.services && Array.isArray(patch.services)) next.services = patch.services;
  projects[index] = next;
  writeProjects(projects);
  return projects[index];
}

function removeProject(id) {
  const project = getProject(id);
  stopProject(project.id);
  const projects = loadProjects().filter((p) => p.id !== project.id);
  writeProjects(projects);
}

// ──────────────────────────────────────────────────────────────────────────
// Service CRUD
// ──────────────────────────────────────────────────────────────────────────

function addService(projectId, input = {}) {
  const project = getProject(projectId);
  const baseName = (input.name || input.id || "service").trim() || "service";
  const id = input.id ? slug(input.id) : uniqueServiceId(project, baseName);
  if ((project.services || []).some((svc) => svc.id === id)) {
    throw new Error(`Service id already exists: ${id}`);
  }
  const service = {
    id,
    name: input.name || baseName,
    command: (input.command || "").trim() || "echo 'no command'",
    port: input.port ? Number(input.port) : null,
    autostart: input.autostart === undefined ? false : Boolean(input.autostart),
    env: input.env && typeof input.env === "object" ? input.env : {}
  };
  const services = [...(project.services || []), service];
  const patch = { services };
  if (!project.primaryServiceId && service.port) patch.primaryServiceId = service.id;
  updateProject(project.id, patch);
  return service;
}

function updateService(projectId, serviceRef, patch) {
  const project = getProject(projectId);
  const services = (project.services || []).slice();
  const index = services.findIndex((svc) => svc.id === serviceRef || svc.name === serviceRef);
  if (index === -1) throw new Error(`Unknown service: ${serviceRef}`);
  const normalised = { ...patch };
  if (normalised.port !== undefined) {
    normalised.port = normalised.port ? Number(normalised.port) : null;
  }
  if (normalised.autostart !== undefined) normalised.autostart = Boolean(normalised.autostart);
  services[index] = { ...services[index], ...normalised, id: services[index].id };
  updateProject(project.id, { services });
  return services[index];
}

function removeService(projectId, serviceRef) {
  const project = getProject(projectId);
  const service = findService(project, serviceRef);
  if (!service) throw new Error(`Unknown service: ${serviceRef}`);
  if (windowExists(project, service.id)) stopService(project.id, service.id);
  const services = (project.services || []).filter((svc) => svc.id !== service.id);
  const patch = { services };
  if (project.primaryServiceId === service.id) {
    patch.primaryServiceId = services.find((s) => s.port)?.id || services[0]?.id || null;
  }
  updateProject(project.id, patch);
}

function setPrimaryService(projectId, serviceRef) {
  const project = getProject(projectId);
  const service = findService(project, serviceRef);
  if (!service) throw new Error(`Unknown service: ${serviceRef}`);
  updateProject(project.id, { primaryServiceId: service.id });
  return service;
}

// ──────────────────────────────────────────────────────────────────────────
// Tmux
// ──────────────────────────────────────────────────────────────────────────

function sessionName(project) {
  return `pier-${project.id}`;
}

function serviceLogPath(project, service) {
  return path.join(LOG_DIR, `${project.id}-${service.id}.log`);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

// macOS GUI apps inherit a minimal PATH that excludes Homebrew, so resolve
// tmux at startup from common locations rather than relying on `tmux` being
// on PATH. Falls back to `which tmux` and finally to a bare "tmux" name.
function resolveTmuxBin() {
  const candidates = [
    "/opt/homebrew/bin/tmux",   // Apple Silicon Homebrew
    "/usr/local/bin/tmux",      // Intel Homebrew
    "/opt/local/bin/tmux",      // MacPorts
    "/usr/bin/tmux"             // System-installed
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const which = spawnSync("/usr/bin/which", ["tmux"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  return "tmux";
}

const TMUX_BIN = resolveTmuxBin();

function tmuxExists() {
  return run(TMUX_BIN, ["-V"]).status === 0;
}

function isSessionRunning(project) {
  return run(TMUX_BIN, ["has-session", "-t", sessionName(project)]).status === 0;
}

function listWindows(project) {
  if (!isSessionRunning(project)) return [];
  const result = run(TMUX_BIN, ["list-windows", "-t", sessionName(project), "-F", "#{window_name}"]);
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function windowExists(project, name) {
  return listWindows(project).includes(name);
}

function portInUse(port) {
  if (!port) return false;
  const result = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  return result.status === 0 && result.stdout.includes(`:${port}`);
}

function findOpenPort(start = DEFAULT_PORT_START) {
  for (let port = Number(start) || DEFAULT_PORT_START; port < 65535; port += 1) {
    if (!portInUse(port)) return port;
  }
  throw new Error(`No open ports found from ${start}`);
}

function portProcess(port) {
  if (!port) return null;
  const result = run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (result.status !== 0) return null;
  const lines = result.stdout.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const columns = lines[1].trim().split(/\s+/);
  return { command: columns[0], pid: columns[1], raw: lines[1] };
}

function portHolderPids(port) {
  if (!port) return [];
  const result = run("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (result.status !== 0) return [];
  return result.stdout.split(/\s+/).filter(Boolean);
}

function processGroupId(pid) {
  const result = run("ps", ["-o", "pgid=", "-p", String(pid)]);
  if (result.status !== 0) return null;
  const pgid = result.stdout.trim();
  return pgid && pgid !== "0" ? pgid : null;
}

function childPids(pid) {
  const result = run("pgrep", ["-P", String(pid)]);
  if (result.status !== 0) return [];
  return result.stdout.split(/\s+/).filter(Boolean);
}

function killPidTree(pid, signal) {
  // Try process group first (catches detached/spawned children)
  const pgid = processGroupId(pid);
  if (pgid) run("kill", [signal, `-${pgid}`]);
  // Then walk explicit children
  for (const child of childPids(pid)) killPidTree(child, signal);
  // And the pid itself
  run("kill", [signal, String(pid)]);
}

function processStat(pid) {
  const result = run("ps", ["-o", "stat=", "-p", String(pid)]);
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function isUninterruptible(pid) {
  return /^U/.test(processStat(pid));
}

function killPortHolder(port) {
  const initialPids = portHolderPids(port);
  if (!initialPids.length) return !portInUse(port);

  // Round 1: SIGTERM the whole tree (process group + children + self)
  for (const pid of initialPids) killPidTree(pid, "-TERM");
  for (let i = 0; i < 40; i += 1) {
    if (!portInUse(port)) return true;
    spawnSync("sleep", ["0.1"]);
  }

  // Round 2: SIGKILL the whole tree of whoever's still holding it
  const stubborn = portHolderPids(port);
  for (const pid of stubborn) killPidTree(pid, "-9");
  for (let i = 0; i < 25; i += 1) {
    if (!portInUse(port)) return true;
    spawnSync("sleep", ["0.1"]);
  }

  // Round 3: last-ditch — kill any remaining listener and its parent chain
  const survivors = portHolderPids(port);
  for (const pid of survivors) {
    run("kill", ["-9", String(pid)]);
    const psParent = run("ps", ["-o", "ppid=", "-p", String(pid)]);
    const ppid = psParent.stdout.trim();
    if (ppid && ppid !== "1" && ppid !== "0") run("kill", ["-9", ppid]);
  }
  for (let i = 0; i < 15; i += 1) {
    if (!portInUse(port)) return true;
    spawnSync("sleep", ["0.1"]);
  }
  return !portInUse(port);
}

function buildEnvLine(extra = {}) {
  const base = {
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
  };
  const merged = { ...base, ...extra };
  return Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join(" ");
}

function startService(projectId, serviceRef, options = {}) {
  if (!tmuxExists()) throw new Error(`tmux is required (looked for ${TMUX_BIN}). Install it with: brew install tmux`);
  const project = getProject(projectId);
  const service = findService(project, serviceRef);
  if (!service) throw new Error(`Unknown service: ${serviceRef}`);
  if (windowExists(project, service.id)) return statusService(project, service);

  let port = service.port;
  const requestedPort = options.port ? Number(options.port) : null;
  if (requestedPort) port = requestedPort;
  if (port === null && hasPortPlaceholder(service)) {
    port = findOpenPort(project.portStart || DEFAULT_PORT_START);
  }
  if (port && portInUse(port)) {
    if (options.reclaim) {
      const freed = killPortHolder(port);
      if (!freed) {
        const holder = portProcess(port);
        let detail = "";
        if (holder) {
          if (isUninterruptible(holder.pid)) {
            detail = ` ${holder.command} (pid ${holder.pid}) is stuck in uninterruptible kernel sleep — not even SIGKILL will free it. The OS is waiting on a syscall. Either reboot, or change this service's port (Edit → Port).`;
          } else {
            detail = ` Still held by ${holder.command} (pid ${holder.pid}). Try: sudo kill -9 ${holder.pid}`;
          }
        }
        throw new Error(`Could not free port ${port}.${detail}`);
      }
    } else {
      throw new Error(`Port ${port} is already in use. Stop the existing process or pick reclaim.`);
    }
  }
  if (port && port !== service.port) {
    updateService(project.id, service.id, { port });
    service.port = port;
  }

  const file = serviceLogPath(project, service);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const envExtras = {
    PIER_PROJECT: project.id,
    PIER_SERVICE: service.id,
    ...(port ? { PORT: String(port) } : {}),
    ...(service.env || {})
  };
  const envLine = buildEnvLine(envExtras);
  const command = `${envLine} ${service.command} 2>&1 | tee -a ${shellQuote(file)}`;

  const result = isSessionRunning(project)
    ? run(TMUX_BIN, ["new-window", "-d", "-t", `${sessionName(project)}:`, "-n", service.id, "-c", project.path, command])
    : run(TMUX_BIN, ["new-session", "-d", "-s", sessionName(project), "-n", service.id, "-c", project.path, command]);

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Failed to start service ${service.id}`);
  }
  return statusService(project, { ...service, port });
}

function hasPortPlaceholder(service) {
  // A service is considered "web-like" if it explicitly has a port set,
  // OR its command references $PORT. Otherwise we leave port unset.
  if (service.port) return true;
  return /\$PORT/.test(service.command || "");
}

function stopService(projectId, serviceRef) {
  const project = getProject(projectId);
  const service = findService(project, serviceRef);
  if (!service) throw new Error(`Unknown service: ${serviceRef}`);
  if (!windowExists(project, service.id)) return statusService(project, service);
  run(TMUX_BIN, ["send-keys", "-t", `${sessionName(project)}:${service.id}`, "C-c"]);
  run(TMUX_BIN, ["kill-window", "-t", `${sessionName(project)}:${service.id}`]);
  return statusService(project, service);
}

function restartService(projectId, serviceRef, options = {}) {
  stopService(projectId, serviceRef);
  return startService(projectId, serviceRef, options);
}

function startProject(id, options = {}) {
  const project = typeof id === "object" ? id : getProject(id);
  const services = project.services || [];
  const targetIds = options.serviceIds && Array.isArray(options.serviceIds) && options.serviceIds.length
    ? options.serviceIds
    : services.filter((svc) => svc.autostart || options.all).map((svc) => svc.id);
  for (const sid of targetIds) {
    try { startService(project.id, sid); } catch (e) { /* surface via per-service status */ }
  }
  return statusProject(project.id);
}

function stopProject(id) {
  const project = typeof id === "object" ? id : getProject(id);
  if (!isSessionRunning(project)) return statusProject(project.id);
  run(TMUX_BIN, ["kill-session", "-t", sessionName(project)]);
  return statusProject(project.id);
}

function restartProject(id, options = {}) {
  const project = typeof id === "object" ? id : getProject(id);
  const wasRunning = (project.services || []).filter((svc) => windowExists(project, svc.id)).map((svc) => svc.id);
  stopProject(project.id);
  if (wasRunning.length) {
    return startProject(project.id, { serviceIds: wasRunning, ...options });
  }
  return startProject(project.id, options);
}

// ──────────────────────────────────────────────────────────────────────────
// Ad-hoc terminals (windows that don't match a service id)
// ──────────────────────────────────────────────────────────────────────────

function adHocWindowName(project, base) {
  const taken = new Set(listWindows(project));
  const serviceIds = new Set((project.services || []).map((svc) => svc.id));
  const rootRaw = base ? slug(base) : "term";
  const root = serviceIds.has(rootRaw) ? `${rootRaw}-x` : rootRaw;
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

function spawnTerminal(projectId, options = {}) {
  if (!tmuxExists()) throw new Error(`tmux is required (looked for ${TMUX_BIN}). Install it with: brew install tmux`);
  const project = getProject(projectId);
  const name = adHocWindowName(project, options.name);
  const initial = options.command ? `${options.command}; ` : "";
  const launchCommand = `${initial}exec $SHELL -l`;

  const result = isSessionRunning(project)
    ? run(TMUX_BIN, ["new-window", "-d", "-t", `${sessionName(project)}:`, "-n", name, "-c", project.path, launchCommand])
    : run(TMUX_BIN, ["new-session", "-d", "-s", sessionName(project), "-n", name, "-c", project.path, launchCommand]);

  if (result.status !== 0) throw new Error(result.stderr.trim() || "Failed to spawn terminal");
  return { name, running: true };
}

function closeTerminal(projectId, name) {
  const project = getProject(projectId);
  if (!windowExists(project, name)) return false;
  run(TMUX_BIN, ["kill-window", "-t", `${sessionName(project)}:${name}`]);
  return true;
}

function renameTerminal(projectId, oldName, newName) {
  const project = getProject(projectId);
  if (!windowExists(project, oldName)) throw new Error(`Unknown terminal: ${oldName}`);
  const sanitized = adHocWindowName(project, newName);
  run(TMUX_BIN, ["rename-window", "-t", `${sessionName(project)}:${oldName}`, sanitized]);
  return sanitized;
}

function sendTerminalInput(projectId, name, parts = []) {
  const project = getProject(projectId);
  if (!windowExists(project, name)) throw new Error(`Unknown terminal: ${name}`);
  if (!parts.length) return false;
  const args = ["send-keys", "-t", `${sessionName(project)}:${name}`, ...parts];
  const result = run(TMUX_BIN, args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || "send-keys failed");
  return true;
}

function reclaimService(projectId, serviceRef) {
  return startService(projectId, serviceRef, { reclaim: true });
}

function listTerminals(project) {
  const serviceIds = new Set((project.services || []).map((svc) => svc.id));
  return listWindows(project)
    .filter((name) => !serviceIds.has(name))
    .map((name) => ({ name, running: true }));
}

// ──────────────────────────────────────────────────────────────────────────
// Status
// ──────────────────────────────────────────────────────────────────────────

function statusService(project, service) {
  const running = windowExists(project, service.id);
  const portInfo = service.port ? portProcess(service.port) : null;
  const lifecycle = running ? "running" : portInfo ? "external" : "stopped";
  return {
    id: service.id,
    name: service.name,
    command: service.command,
    port: service.port || null,
    autostart: Boolean(service.autostart),
    env: service.env || {},
    running,
    lifecycle,
    url: service.port ? `http://localhost:${service.port}` : null,
    logPath: serviceLogPath(project, service),
    process: portInfo
  };
}

function statusProject(id) {
  const project = typeof id === "object" ? id : getProject(id);
  const services = (project.services || []).map((svc) => statusService(project, svc));
  const terminals = listTerminals(project);
  const anyRunning = services.some((s) => s.running) || terminals.length > 0;
  const primaryService =
    services.find((s) => s.id === project.primaryServiceId && s.url) ||
    services.find((s) => s.id === project.primaryServiceId) ||
    services.find((s) => s.url) ||
    services[0] ||
    null;
  const resolvedIconPath = project.iconPath || detectIconPath(project.path);
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    portStart: project.portStart || DEFAULT_PORT_START,
    createdAt: project.createdAt,
    primaryServiceId: primaryService?.id || null,
    services,
    terminals,
    session: sessionName(project),
    iconPath: resolvedIconPath,
    iconDataUrl: iconDataUrl({ ...project, iconPath: resolvedIconPath }),
    running: anyRunning,
    lifecycle: anyRunning ? "running" : "stopped",
    url: primaryService?.url || null
  };
}

function statusAll() {
  return loadProjects().map((project) => statusProject(project));
}

// ──────────────────────────────────────────────────────────────────────────
// Logs
// ──────────────────────────────────────────────────────────────────────────

function readServiceLogs(projectId, serviceRef, lines = 200) {
  const project = getProject(projectId);
  const service = findService(project, serviceRef);
  if (!service) throw new Error(`Unknown service: ${serviceRef}`);
  const file = serviceLogPath(project, service);
  if (!fs.existsSync(file)) return "";
  const count = Math.max(1, Number(lines) || 200);
  try {
    return execFileSync("tail", ["-n", String(count), file], { encoding: "utf8" });
  } catch {
    return fs.readFileSync(file, "utf8");
  }
}

function readAllLogs(projectId, lines = 200) {
  const project = getProject(projectId);
  const services = project.services || [];
  return services
    .map((svc) => {
      const log = readServiceLogs(project.id, svc.id, lines);
      const header = `── ${svc.name} (${svc.id}) ─────────────────────────────`;
      return `${header}\n${log}`;
    })
    .join("\n");
}

function clearServiceLogs(projectId, serviceRef) {
  const project = getProject(projectId);
  const service = findService(project, serviceRef);
  if (!service) throw new Error(`Unknown service: ${serviceRef}`);
  fs.writeFileSync(serviceLogPath(project, service), "");
}

function readTerminalCapture(projectId, name, lines = 400) {
  const project = getProject(projectId);
  if (!windowExists(project, name)) return "";
  const result = run(TMUX_BIN, [
    "capture-pane",
    "-p",
    "-S", `-${Math.max(1, Number(lines) || 400)}`,
    "-t", `${sessionName(project)}:${name}`
  ]);
  if (result.status !== 0) return "";
  return result.stdout;
}

// ──────────────────────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────────────────────

module.exports = {
  CONFIG_DIR,
  PROJECTS_FILE,
  LOG_DIR,
  DEFAULT_DEV_ROOT,
  DEFAULT_PORT_START,
  TMUX_BIN,

  listProjects,
  getProject,
  addProject,
  updateProject,
  removeProject,

  addService,
  updateService,
  removeService,
  setPrimaryService,

  startService,
  stopService,
  restartService,
  startProject,
  stopProject,
  restartProject,

  spawnTerminal,
  closeTerminal,
  renameTerminal,
  sendTerminalInput,
  reclaimService,
  killPortHolder,

  statusProject,
  statusAll,
  statusService,

  readServiceLogs,
  readAllLogs,
  readTerminalCapture,
  clearServiceLogs,

  findOpenPort
};
