#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const APP_NAME = "Pier";
const BUNDLE_ID = "com.pier.app";

const root = path.resolve(__dirname, "..");
const distDir = path.join(root, "dist");
const appPath = path.join(distDir, `${APP_NAME}.app`);
const sourceApp = path.join(root, "node_modules", "electron", "dist", "Electron.app");
const resourcesDir = path.join(appPath, "Contents", "Resources");
const appResources = path.join(resourcesDir, "app");
const iconPath = path.join(root, "assets", "Pier.icns");
const trayIconPath = path.join(root, "assets", "TrayTemplate.png");
const install = process.argv.includes("--install");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", ...options });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result;
}

if (!fs.existsSync(sourceApp)) {
  throw new Error("Electron is not installed. Run npm install first.");
}

if (!fs.existsSync(iconPath) || !fs.existsSync(trayIconPath)) {
  run("node", [path.join(root, "scripts", "make-icons.js")], { stdio: "inherit" });
}

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(appPath, { recursive: true, force: true });
run("cp", ["-R", sourceApp, appPath]);
fs.rmSync(appResources, { recursive: true, force: true });
fs.mkdirSync(appResources, { recursive: true });

for (const name of ["package.json", "bin", "src", "assets", "agent-skill", "README.md"]) {
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
plistSet("CFBundleShortVersionString", "0.2.0");
plistSet("CFBundleVersion", "0.2.0");
run("plutil", ["-remove", "LSUIElement", plist], { allowFailure: true });

console.log(`Built ${appPath}`);

if (install) {
  const userApps = path.join(process.env.HOME, "Applications");
  fs.mkdirSync(userApps, { recursive: true });
  const installed = path.join(userApps, `${APP_NAME}.app`);
  fs.rmSync(installed, { recursive: true, force: true });
  run("cp", ["-R", appPath, installed]);
  console.log(`Installed ${installed}`);
}
