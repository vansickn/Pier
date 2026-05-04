#!/usr/bin/env node
// Copies agent-skill/SKILL.md into every known agent skills directory on this
// machine. Idempotent — re-running just refreshes the file. Skips hosts whose
// base directory doesn't exist (so we never create stuff for tools you don't
// have installed).
//
// Usage:
//   node scripts/install-skill.js              # all detected hosts
//   node scripts/install-skill.js cursor       # one host
//   node scripts/install-skill.js cursor claude
//   node scripts/install-skill.js --uninstall  # remove from all hosts
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "agent-skill", "SKILL.md");
const SKILL_NAME = "pier";

const HOSTS = [
  {
    id: "cursor",
    label: "Cursor",
    skillsDir: path.join(os.homedir(), ".cursor", "skills")
  },
  {
    id: "claude",
    label: "Claude Code",
    skillsDir: path.join(os.homedir(), ".claude", "skills")
  },
  {
    id: "codex",
    label: "Codex CLI",
    skillsDir: path.join(os.homedir(), ".codex", "skills")
  },
  {
    id: "agents",
    label: "~/.agents (generic)",
    skillsDir: path.join(os.homedir(), ".agents", "skills")
  }
];

function targetFile(host) {
  return path.join(host.skillsDir, SKILL_NAME, "SKILL.md");
}

function isInstalled(host) {
  return fs.existsSync(targetFile(host));
}

function install(host) {
  const dir = path.join(host.skillsDir, SKILL_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SOURCE, path.join(dir, "SKILL.md"));
}

function uninstall(host) {
  const dir = path.join(host.skillsDir, SKILL_NAME);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Skill source not found: ${SOURCE}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const uninstallFlag = args.includes("--uninstall");
  const requested = args.filter((a) => !a.startsWith("--"));
  const selected = requested.length
    ? HOSTS.filter((h) => requested.includes(h.id))
    : HOSTS;

  if (requested.length && selected.length !== requested.length) {
    const known = HOSTS.map((h) => h.id).join(", ");
    console.error(`Unknown host. Known hosts: ${known}`);
    process.exit(1);
  }

  let acted = 0;
  for (const host of selected) {
    const hostExists = fs.existsSync(host.skillsDir) || fs.existsSync(path.dirname(host.skillsDir));
    if (!hostExists && !uninstallFlag) {
      console.log(`skip   ${host.label.padEnd(22)} (${host.skillsDir} not found — host not installed)`);
      continue;
    }

    if (uninstallFlag) {
      if (isInstalled(host)) {
        uninstall(host);
        console.log(`removed ${host.label.padEnd(21)} ${targetFile(host)}`);
        acted += 1;
      } else {
        console.log(`absent  ${host.label.padEnd(21)} ${targetFile(host)}`);
      }
      continue;
    }

    install(host);
    console.log(`✓ ${host.label.padEnd(22)} ${targetFile(host)}`);
    acted += 1;
  }

  if (!acted) {
    console.log("\nNo agent hosts detected on this machine. Nothing to do.");
    console.log("Supported hosts:", HOSTS.map((h) => h.id).join(", "));
  }
}

main();
