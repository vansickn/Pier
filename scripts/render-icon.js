#!/usr/bin/env electron
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const assetsDir = path.join(root, "assets");
const svgPath = path.join(assetsDir, "pier.svg");
const svg = fs.readFileSync(svgPath, "utf8");

app.disableHardwareAcceleration();

async function renderHtmlToPng(html, size, outputPath) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    useContentSize: true,
    webPreferences: {
      offscreen: false,
      backgroundThrottling: false
    }
  });

  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((resolve) => setTimeout(resolve, 250));
  let image = await win.webContents.capturePage();
  const captured = image.getSize();
  if (captured.width !== size || captured.height !== size) {
    image = image.resize({ width: size, height: size, quality: "best" });
  }
  fs.writeFileSync(outputPath, image.toPNG());
  win.close();
}

function appIconHtml(svgMarkup) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; }
    body { width: 1024px; height: 1024px; }
    .card {
      position: absolute;
      inset: 0;
      margin: 108px;
      width: calc(100% - 216px);
      height: calc(100% - 216px);
      border-radius: 22.5%;
      overflow: hidden;
      background:
        radial-gradient(120% 90% at 18% 8%, rgba(120, 150, 200, 0.28) 0%, transparent 55%),
        radial-gradient(140% 100% at 80% 100%, rgba(40, 90, 130, 0.18) 0%, transparent 60%),
        linear-gradient(180deg, #1c1f25 0%, #0d0f13 100%);
      box-shadow:
        inset 0 4px 14px rgba(255, 255, 255, 0.06),
        inset 0 -2px 12px rgba(0, 0, 0, 0.4);
    }
    .pier {
      position: absolute;
      inset: 0;
    }
    .pier svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .pier svg path {
      fill: url(#pierGrad);
    }
    .gradient-defs {
      position: absolute;
      width: 0;
      height: 0;
      pointer-events: none;
    }
  </style></head><body>
    <div class="card">
      <svg class="gradient-defs" aria-hidden="true">
        <defs>
          <linearGradient id="pierGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7cc4ff"/>
            <stop offset="55%" stop-color="#5db5e6"/>
            <stop offset="100%" stop-color="#54d6b5"/>
          </linearGradient>
        </defs>
      </svg>
      <div class="pier">${svgMarkup}</div>
    </div>
  </body></html>`;
}

function trayHtml(svgMarkup, size) {
  // The artwork only spans roughly (140, 110) → (870, 830) inside the
  // 1024×1024 viewBox, so retarget to crop out the empty padding and let the
  // pier fill more of the menu-bar icon.
  const cropped = svgMarkup.replace(
    /viewBox="[^"]+"/,
    'viewBox="130 100 760 740" preserveAspectRatio="xMidYMid meet"'
  );
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; }
    body { width: ${size}px; height: ${size}px; }
    svg { width: 100%; height: 100%; display: block; }
    svg path { fill: #000; }
  </style></head><body>${cropped}</body></html>`;
}

app.whenReady().then(async () => {
  try {
    await renderHtmlToPng(appIconHtml(svg), 1024, path.join(assetsDir, "icon-1024.png"));
    await renderHtmlToPng(trayHtml(svg, 16), 16, path.join(assetsDir, "TrayTemplate.png"));
    await renderHtmlToPng(trayHtml(svg, 32), 32, path.join(assetsDir, "TrayTemplate@2x.png"));
    console.log("Rendered icon-1024.png, TrayTemplate.png, TrayTemplate@2x.png");
    app.quit();
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
