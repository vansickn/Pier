// Tests for src/core/pier.js — the project / service / config layer.
// These exercise the pure parts (no tmux side effects). They run via
// `npm test` (powered by node:test, built into Node 18+).
//
// Each test file gets its own ~/.pier override via setupTestEnv() so
// real config is never touched and tests can run in parallel.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setupTestEnv, cleanupTestEnv, makeFakeProjectDir } = require("./helpers");

const ROOT = setupTestEnv();
const core = require("../src/core/pier");

after(() => cleanupTestEnv(ROOT));

// Wipe projects.json between tests so they don't see each other's state.
function reset() {
  fs.writeFileSync(
    path.join(process.env.PIER_CONFIG_DIR, "projects.json"),
    JSON.stringify({ projects: [] }, null, 2)
  );
}

before(() => {
  fs.mkdirSync(process.env.PIER_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(process.env.PIER_LOG_DIR, { recursive: true });
  reset();
});

// ──────────────────────────────────────────────────────────────────────────
// addProject
// ──────────────────────────────────────────────────────────────────────────

test("addProject creates a default 'dev' service from auto-detection", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "rails-app", { Gemfile: "" });
  const project = core.addProject(dir);
  assert.equal(project.name, "rails-app");
  assert.equal(project.id, "rails-app");
  assert.equal(project.services.length, 1);
  assert.equal(project.services[0].id, "dev");
  assert.equal(project.services[0].command, "bundle exec rails s");
});

test("addProject suffixes the id when one already exists", () => {
  reset();
  const a = makeFakeProjectDir(ROOT, "shared-name-a", { Gemfile: "" });
  const b = makeFakeProjectDir(ROOT, "shared-name-b", { Gemfile: "" });
  const first = core.addProject(a, { name: "shared" });
  const second = core.addProject(b, { name: "shared" });
  assert.equal(first.id, "shared");
  assert.equal(second.id, "shared-2");
});

test("addProject is idempotent on the same path", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "idem", { Gemfile: "" });
  const first = core.addProject(dir);
  const again = core.addProject(dir);
  assert.equal(first.id, again.id);
  assert.equal(core.listProjects().length, 1);
});

test("addProject rejects a non-directory path", () => {
  reset();
  assert.throws(() => core.addProject("/nonexistent/path/here"), /Not a directory/);
});

// ──────────────────────────────────────────────────────────────────────────
// detectCommand (via addProject's auto-detection)
// ──────────────────────────────────────────────────────────────────────────

test("detection: Gemfile + bin/dev → bin/dev", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "rails-bindev", {
    Gemfile: "",
    "bin/dev": "#!/bin/bash\n"
  });
  const project = core.addProject(dir);
  assert.equal(project.services[0].command, "bin/dev");
});

test("detection: Gemfile + bin/rails (no bin/dev) → bin/rails s", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "rails-binrails", {
    Gemfile: "",
    "bin/rails": "#!/bin/bash\n"
  });
  const project = core.addProject(dir);
  assert.equal(project.services[0].command, "bin/rails s");
});

test("detection: package.json with dev script → npm run dev", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "node-dev", {
    "package.json": JSON.stringify({ scripts: { dev: "next dev" } })
  });
  const project = core.addProject(dir);
  assert.equal(project.services[0].command, "npm run dev");
});

test("detection: package.json with start (no dev) → npm start", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "node-start", {
    "package.json": JSON.stringify({ scripts: { start: "node ." } })
  });
  const project = core.addProject(dir);
  assert.equal(project.services[0].command, "npm start");
});

test("detection: manage.py → python manage.py runserver", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "django", { "manage.py": "" });
  const project = core.addProject(dir);
  assert.equal(project.services[0].command, "python manage.py runserver");
});

test("detection: empty folder falls back to npm run dev", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "empty");
  const project = core.addProject(dir);
  assert.equal(project.services[0].command, "npm run dev");
});

// ──────────────────────────────────────────────────────────────────────────
// addService / updateService / removeService
// ──────────────────────────────────────────────────────────────────────────

test("addService appends a service and slugifies the id", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "svc-add", { Gemfile: "" });
  const project = core.addProject(dir);
  const worker = core.addService(project.id, { name: "Background Worker", command: "bundle exec sidekiq" });
  assert.equal(worker.id, "background-worker");
  assert.equal(worker.command, "bundle exec sidekiq");
  const refreshed = core.getProject(project.id);
  assert.equal(refreshed.services.length, 2);
});

test("addService throws on duplicate id", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "svc-dup", { Gemfile: "" });
  const project = core.addProject(dir);
  core.addService(project.id, { id: "worker", name: "worker", command: "x" });
  assert.throws(
    () => core.addService(project.id, { id: "worker", name: "worker", command: "x" }),
    /already exists/
  );
});

test("updateService coerces port to a number and autostart to a bool", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "svc-coerce", { Gemfile: "" });
  const project = core.addProject(dir);
  const updated = core.updateService(project.id, "dev", { port: "4500", autostart: 0 });
  assert.equal(updated.port, 4500);
  assert.equal(typeof updated.port, "number");
  assert.equal(updated.autostart, false);
});

test("updateService coerces a non-string setup to '' (null, number, etc.)", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "svc-setup", { Gemfile: "" });
  const project = core.addProject(dir);
  // setup: undefined is a no-op (patch semantics: 'don't change'); but
  // any explicit non-string value is normalised away so we never persist
  // garbage shapes to disk.
  const updated = core.updateService(project.id, "dev", { setup: null });
  assert.equal(updated.setup, "");
});

test("removeService rebinds primaryServiceId when the primary is removed", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "svc-primary", { Gemfile: "" });
  const project = core.addProject(dir);
  core.addService(project.id, { id: "web2", name: "web2", command: "x", port: 4001 });
  core.setPrimaryService(project.id, "dev");
  core.removeService(project.id, "dev");
  const refreshed = core.getProject(project.id);
  assert.equal(refreshed.primaryServiceId, "web2");
});

// ──────────────────────────────────────────────────────────────────────────
// reorderProjects
// ──────────────────────────────────────────────────────────────────────────

test("reorderProjects rotates the on-disk order", () => {
  reset();
  ["alpha", "bravo", "charlie"].forEach((name) => {
    const dir = makeFakeProjectDir(ROOT, name, { Gemfile: "" });
    core.addProject(dir);
  });
  const before = core.listProjects().map((p) => p.id);
  core.reorderProjects([before[2], before[0], before[1]]);
  const after = core.listProjects().map((p) => p.id);
  assert.deepEqual(after, [before[2], before[0], before[1]]);
});

test("reorderProjects rejects wrong-length, unknown, and duplicate ids", () => {
  reset();
  ["x", "y"].forEach((name) => {
    const dir = makeFakeProjectDir(ROOT, name, { Gemfile: "" });
    core.addProject(dir);
  });
  assert.throws(() => core.reorderProjects(["x"]), /expected 2 ids, got 1/);
  assert.throws(() => core.reorderProjects(["x", "ghost"]), /unknown id ghost/);
  assert.throws(() => core.reorderProjects(["x", "x"]), /duplicate id x/);
});

// ──────────────────────────────────────────────────────────────────────────
// removeProject
// ──────────────────────────────────────────────────────────────────────────

test("removeProject drops the entry from the on-disk list", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "drop-me", { Gemfile: "" });
  core.addProject(dir);
  core.removeProject("drop-me");
  assert.equal(core.listProjects().length, 0);
});

test("removeProject throws on unknown id", () => {
  reset();
  assert.throws(() => core.removeProject("never-existed"), /Unknown project/);
});

// ──────────────────────────────────────────────────────────────────────────
// migrateProject (via loadProjects on a hand-rolled v1 file)
// ──────────────────────────────────────────────────────────────────────────

test("loadProjects migrates a v1 single-command project to a services array", () => {
  reset();
  // v1 shape: top-level command, no services array.
  const dir = makeFakeProjectDir(ROOT, "v1-app");
  fs.writeFileSync(
    path.join(process.env.PIER_CONFIG_DIR, "projects.json"),
    JSON.stringify({
      projects: [{ id: "v1-app", name: "v1-app", path: dir, command: "bin/rails s", port: 3000 }]
    }, null, 2)
  );
  const projects = core.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].services.length, 1);
  assert.equal(projects[0].services[0].command, "bin/rails s");
  assert.equal(projects[0].services[0].port, 3000);
  assert.equal(projects[0].primaryServiceId, "dev");
});

// ──────────────────────────────────────────────────────────────────────────
// writeProjects atomicity (no .tmp leak after success)
// ──────────────────────────────────────────────────────────────────────────

test("writeProjects leaves no .tmp file behind after a successful write", () => {
  reset();
  const dir = makeFakeProjectDir(ROOT, "atomic", { Gemfile: "" });
  core.addProject(dir);
  const configDir = process.env.PIER_CONFIG_DIR;
  const tmps = fs.readdirSync(configDir).filter((f) => f.includes(".tmp"));
  assert.equal(tmps.length, 0, `unexpected tmp files: ${tmps.join(", ")}`);
});
