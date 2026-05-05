const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Each test file calls setupTestEnv() at the top BEFORE requiring
// src/core/pier.js. CONFIG_DIR / LOG_DIR are captured at module load
// time, so the env vars must be in place first. Returns the tmp dir
// so individual tests can also drop fake project folders into it.
function setupTestEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pier-test-"));
  process.env.PIER_CONFIG_DIR = path.join(root, "config");
  process.env.PIER_LOG_DIR = path.join(root, "logs");
  return root;
}

// Best-effort recursive cleanup; tempdirs are unique per file so leaks
// across runs aren't a correctness concern, but tidiness matters.
function cleanupTestEnv(root) {
  if (!root) return;
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}

// Build a directory that looks like a project Pier might pick up.
// Pass `files` as { "Gemfile": "", "bin/dev": "#!/bin/bash\n" } etc.
function makeFakeProjectDir(root, name, files = {}) {
  const dir = path.join(root, "fixtures", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

module.exports = { setupTestEnv, cleanupTestEnv, makeFakeProjectDir };
