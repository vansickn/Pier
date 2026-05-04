#!/usr/bin/env node
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const core = require("../src/core/pier");

function print(value) {
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(stripIconData(value), null, 2)}\n`);
  }
}

function stripIconData(value) {
  if (Array.isArray(value)) return value.map(stripIconData);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (key !== "iconDataUrl") next[key] = stripIconData(child);
  }
  return next;
}

function usage() {
  print(`pier - local dev server manager

Project commands:
  pier list [--json]
  pier add <folder> [--name NAME] [--port PORT] [--cmd COMMAND]
  pier status [id] [--json]
  pier start <project> [service] [--port PORT]
  pier stop <project> [service]
  pier restart <project> [service] [--port PORT]
  pier reclaim <project> <service>     # kill external process on the port and start
  pier open <project> [service]
  pier remove <project>

Service commands:
  pier services <project>
  pier add-service <project> --name NAME --cmd COMMAND [--port PORT] [--autostart]
  pier update-service <project> <service> [--name N] [--cmd C] [--port P] [--autostart] [--no-autostart]
  pier remove-service <project> <service>
  pier primary <project> <service>

Logs:
  pier logs <project> [service] [-n LINES]
  pier clear-logs <project> <service>

Terminals (ad-hoc shells):
  pier shell <project> [name] [--cmd "rails c"]
  pier shell-close <project> <name>
  pier attach <project>          # prints tmux attach command

Misc:
  pier doctor
`);
}

function argValue(args, ...flags) {
  for (const flag of flags) {
    const index = args.indexOf(flag);
    if (index !== -1) return args[index + 1] || null;
  }
  return null;
}

function has(args, flag) {
  return args.includes(flag);
}

function summary(project) {
  const running = project.services.filter((s) => s.running).length;
  const total = project.services.length;
  const url = project.url || "no port";
  return `${project.id.padEnd(20)} ${`${running}/${total}`.padEnd(6)} ${url.padEnd(22)} ${project.path}`;
}

function serviceLine(svc) {
  const status = svc.running ? "running" : svc.lifecycle === "external" ? "extern" : "stopped";
  const port = svc.port ? `:${svc.port}` : "";
  return `  ${svc.id.padEnd(14)} ${status.padEnd(8)} ${port.padEnd(7)} ${svc.command}`;
}

function openUrl(url) {
  spawnSync("open", [url], { stdio: "ignore" });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      usage();
      return;
    }

    if (command === "list") {
      const projects = core.statusAll();
      if (has(args, "--json")) print(projects);
      else projects.forEach((project) => print(summary(project)));
      return;
    }

    if (command === "status") {
      const id = args[1] && !args[1].startsWith("--") ? args[1] : null;
      if (id) {
        const project = core.statusProject(id);
        if (has(args, "--json")) print(project);
        else {
          print(summary(project));
          project.services.forEach((svc) => print(serviceLine(svc)));
          if (project.terminals.length) {
            print(`  terminals: ${project.terminals.map((t) => t.name).join(", ")}`);
          }
        }
        return;
      }
      const projects = core.statusAll();
      if (has(args, "--json")) print(projects);
      else projects.forEach((p) => print(summary(p)));
      return;
    }

    if (command === "add") {
      const folder = args[1];
      if (!folder) throw new Error("Missing folder");
      const project = core.addProject(path.resolve(folder), {
        name: argValue(args, "--name"),
        port: argValue(args, "--port"),
        command: argValue(args, "--cmd")
      });
      print(core.statusProject(project.id));
      return;
    }

    if (command === "start") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      const service = args[2] && !args[2].startsWith("--") ? args[2] : null;
      const port = argValue(args, "--port");
      if (service) print(core.startService(id, service, port ? { port } : {}));
      else print(core.startProject(id));
      return;
    }

    if (command === "stop") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      const service = args[2] && !args[2].startsWith("--") ? args[2] : null;
      if (service) print(core.stopService(id, service));
      else print(core.stopProject(id));
      return;
    }

    if (command === "restart") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      const service = args[2] && !args[2].startsWith("--") ? args[2] : null;
      const port = argValue(args, "--port");
      if (service) print(core.restartService(id, service, port ? { port } : {}));
      else print(core.restartProject(id, port ? { port } : {}));
      return;
    }

    if (command === "open") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      const service = args[2] && !args[2].startsWith("--") ? args[2] : null;
      const project = core.statusProject(id);
      const target = service
        ? project.services.find((svc) => svc.id === service || svc.name === service)
        : project.services.find((svc) => svc.id === project.primaryServiceId) || project.services.find((svc) => svc.url);
      if (!target?.url) throw new Error(`No URL for ${service || id}`);
      openUrl(target.url);
      print(target.url);
      return;
    }

    if (command === "remove" || command === "rm") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      core.removeProject(id);
      print(`Removed ${id}`);
      return;
    }

    if (command === "reclaim") {
      const id = args[1];
      const service = args[2];
      if (!id || !service) throw new Error("Usage: pier reclaim <project> <service>");
      print(core.reclaimService(id, service));
      return;
    }

    if (command === "services") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      const project = core.statusProject(id);
      project.services.forEach((svc) => print(serviceLine(svc)));
      return;
    }

    if (command === "add-service") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      const service = core.addService(id, {
        name: argValue(args, "--name"),
        command: argValue(args, "--cmd"),
        port: argValue(args, "--port"),
        autostart: has(args, "--autostart")
      });
      print(service);
      return;
    }

    if (command === "update-service") {
      const id = args[1];
      const service = args[2];
      if (!id || !service) throw new Error("Usage: pier update-service <project> <service> [...flags]");
      const patch = {};
      const name = argValue(args, "--name");
      const cmd = argValue(args, "--cmd");
      const port = argValue(args, "--port");
      if (name) patch.name = name;
      if (cmd) patch.command = cmd;
      if (port !== null) patch.port = port;
      if (has(args, "--autostart")) patch.autostart = true;
      if (has(args, "--no-autostart")) patch.autostart = false;
      print(core.updateService(id, service, patch));
      return;
    }

    if (command === "remove-service") {
      const id = args[1];
      const service = args[2];
      if (!id || !service) throw new Error("Usage: pier remove-service <project> <service>");
      core.removeService(id, service);
      print(`Removed service ${service} from ${id}`);
      return;
    }

    if (command === "primary") {
      const id = args[1];
      const service = args[2];
      if (!id || !service) throw new Error("Usage: pier primary <project> <service>");
      print(core.setPrimaryService(id, service));
      return;
    }

    if (command === "logs") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      const lines = argValue(args, "-n", "--lines") || 200;
      const service = args[2] && !args[2].startsWith("--") ? args[2] : null;
      if (service) {
        process.stdout.write(core.readServiceLogs(id, service, lines));
      } else {
        process.stdout.write(core.readAllLogs(id, lines));
      }
      return;
    }

    if (command === "clear-logs") {
      const id = args[1];
      const service = args[2];
      if (!id || !service) throw new Error("Usage: pier clear-logs <project> <service>");
      core.clearServiceLogs(id, service);
      print(`Cleared logs for ${id}:${service}`);
      return;
    }

    if (command === "shell") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      const name = args[2] && !args[2].startsWith("--") ? args[2] : null;
      const cmd = argValue(args, "--cmd");
      const term = core.spawnTerminal(id, { name, command: cmd });
      print(`Spawned ${term.name}. Attach with: tmux attach -t pier-${id} \\; select-window -t ${term.name}`);
      return;
    }

    if (command === "shell-close") {
      const id = args[1];
      const name = args[2];
      if (!id || !name) throw new Error("Usage: pier shell-close <project> <name>");
      core.closeTerminal(id, name);
      print(`Closed ${name}`);
      return;
    }

    if (command === "attach") {
      const id = args[1];
      if (!id) throw new Error("Missing project id");
      print(`tmux attach -t pier-${id}`);
      return;
    }

    if (command === "doctor") {
      const tmuxVersion = spawnSync(core.TMUX_BIN, ["-V"], { encoding: "utf8" }).stdout.trim();
      print({
        configDir: core.CONFIG_DIR,
        logDir: core.LOG_DIR,
        tmuxBin: core.TMUX_BIN,
        tmux: tmuxVersion,
        projects: core.statusAll()
      });
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    process.stderr.write(`pier: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main();
