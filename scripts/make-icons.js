#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "assets");
const iconsetDir = path.join(assetsDir, "Pier.iconset");
const basePng = path.join(assetsDir, "icon-1024.png");
const icnsPath = path.join(assetsDir, "Pier.icns");
const trayTemplatePath = path.join(assetsDir, "TrayTemplate.png");
const trayTemplate2xPath = path.join(assetsDir, "TrayTemplate@2x.png");
const renderScript = path.join(__dirname, "render-icon.js");
const electronBinary = require("electron");

fs.mkdirSync(assetsDir, { recursive: true });
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

// 1. Render the source PNGs from the SVG using Electron (gives us a real
//    rasteriser without adding a native dep).
const renderResult = spawnSync(electronBinary, [renderScript], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "1" }
});
if (renderResult.status !== 0) {
  throw new Error("Failed to render icon PNGs from SVG");
}

for (const file of [basePng, trayTemplatePath, trayTemplate2xPath]) {
  if (!fs.existsSync(file)) throw new Error(`Renderer did not produce ${file}`);
}

// 2. Resize the 1024px master into every iconset slot.
const sizes = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"]
];

for (const [size, name] of sizes) {
  const output = path.join(iconsetDir, name);
  const result = spawnSync("sips", ["-z", String(size), String(size), basePng, "--out", output], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Failed to create ${name}`);
}

// 3. Assemble the .icns.
const icnsResult = spawnSync("iconutil", ["-c", "icns", iconsetDir, "-o", icnsPath], { encoding: "utf8" });
if (icnsResult.status !== 0) throw new Error(icnsResult.stderr || icnsResult.stdout || "Failed to create icns");

console.log(`Wrote ${icnsPath}`);
console.log(`Wrote ${trayTemplatePath}`);
console.log(`Wrote ${trayTemplate2xPath}`);
