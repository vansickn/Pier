#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const APP_NAME = "Pier";
const BUNDLE_ID = "com.pier.app";

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const appPath = path.join(distDir, `${APP_NAME}.app`);
const resourcesDir = path.join(appPath, "Contents", "Resources");
const appResources = path.join(resourcesDir, "app");
const iconPath = path.join(root, "assets", "Pier.icns");
const trayIconPath = path.join(root, "assets", "TrayTemplate.png");
const install = process.argv.includes("--install");

// --arch=x64 / --arch=arm64. Defaults to the host arch so `npm run build:app`
// keeps Just Working for normal local development. Cross-builds (host arm64,
// target x64 or vice versa) download the right Electron binary into
// dist/.electron-cache/ and use that as the bundle source — same Pier code,
// different Electron runtime stitched on top. This lets a single arm64
// MacBook publish releases for both archs without depending on GitHub's
// flaky macos-13 runner pool.
const archArg = process.argv.find(a => a.startsWith("--arch="));
const TARGET_ARCH = archArg ? archArg.split("=")[1] : os.arch();
if (TARGET_ARCH !== "arm64" && TARGET_ARCH !== "x64") {
  throw new Error(`Unsupported --arch: ${TARGET_ARCH}. Use arm64 or x64.`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result;
}

// Resolve the source Electron.app for TARGET_ARCH. If it matches the host
// arch, use the one npm already installed. Otherwise download the matching
// release zip from electron's GitHub release into a per-version cache dir
// so subsequent builds are instant.
function resolveSourceApp() {
  const hostArch = os.arch();
  if (TARGET_ARCH === hostArch) {
    const local = path.join(root, "node_modules", "electron", "dist", "Electron.app");
    if (!fs.existsSync(local)) {
      throw new Error("Electron is not installed. Run npm install first.");
    }
    return local;
  }
  const electronVersion = require(path.join(root, "node_modules", "electron", "package.json")).version;
  const cacheRoot = path.join(distDir, ".electron-cache", `${electronVersion}-${TARGET_ARCH}`);
  const cachedApp = path.join(cacheRoot, "Electron.app");
  if (fs.existsSync(cachedApp)) return cachedApp;
  fs.mkdirSync(cacheRoot, { recursive: true });
  const zipUrl = `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-darwin-${TARGET_ARCH}.zip`;
  const zipPath = path.join(cacheRoot, "electron.zip");
  console.log(`Cross-building for ${TARGET_ARCH}; fetching ${zipUrl}`);
  run("curl", ["-fsSL", "-o", zipPath, zipUrl], { stdio: "inherit" });
  run("unzip", ["-q", zipPath, "-d", cacheRoot], { stdio: "inherit" });
  fs.rmSync(zipPath, { force: true });
  if (!fs.existsSync(cachedApp)) {
    throw new Error(`Downloaded Electron zip didn't contain Electron.app at ${cachedApp}`);
  }
  return cachedApp;
}

const sourceApp = resolveSourceApp();

if (!fs.existsSync(iconPath) || !fs.existsSync(trayIconPath)) {
  run("node", [path.join(root, "scripts", "make-icons.js")], { stdio: "inherit" });
}

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(appPath, { recursive: true, force: true });
run("cp", ["-R", sourceApp, appPath]);
fs.rmSync(appResources, { recursive: true, force: true });
fs.mkdirSync(appResources, { recursive: true });

for (const name of ["package.json", "bin", "src", "scripts", "assets", "agent-skill", "README.md"]) {
  const source = path.join(root, name);
  if (fs.existsSync(source)) run("cp", ["-R", source, appResources]);
}

run("cp", [iconPath, path.join(resourcesDir, "Pier.icns")]);
const plist = path.join(appPath, "Contents", "Info.plist");
const plistSet = (key, value) => run("plutil", ["-replace", key, "-string", value, plist]);
plistSet("CFBundleName", APP_NAME);
plistSet("CFBundleDisplayName", APP_NAME);
plistSet("CFBundleExecutable", "Electron");
plistSet("CFBundleIdentifier", BUNDLE_ID);
plistSet("CFBundleIconFile", "Pier.icns");
plistSet("CFBundlePackageType", "APPL");
const VERSION = require(path.join(root, "package.json")).version;
plistSet("CFBundleShortVersionString", VERSION);
plistSet("CFBundleVersion", VERSION);
run("plutil", ["-remove", "LSUIElement", plist], { allowFailure: true });

console.log(`Built ${appPath} (${TARGET_ARCH})`);

if (install) {
  const userApps = path.join(process.env.HOME, "Applications");
  fs.mkdirSync(userApps, { recursive: true });
  const installed = path.join(userApps, `${APP_NAME}.app`);
  fs.rmSync(installed, { recursive: true, force: true });
  run("cp", ["-R", appPath, installed]);
  console.log(`Installed ${installed}`);
}
