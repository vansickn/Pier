const path = require("node:path");
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, shell, clipboard } = require("electron");
const core = require("../core/pier");

let tray;
let mainWindow;

function appAssetPath(...parts) {
  const packagedAsset = path.join(process.resourcesPath || "", "app", "assets", ...parts);
  const sourceAsset = path.join(__dirname, "../../assets", ...parts);
  return require("node:fs").existsSync(packagedAsset) ? packagedAsset : sourceAsset;
}

function trayIcon() {
  const image = nativeImage.createFromPath(appAssetPath("TrayTemplate.png"));
  image.setTemplateImage(true);
  return image;
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 540,
    minHeight: 480,
    title: "Pier",
    icon: appAssetPath("Pier.icns"),
    backgroundColor: "#00000000",
    transparent: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 22, y: 22 },
    vibrancy: "hud",
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}

function rebuildTrayMenu() {
  if (!tray) return;
  const projects = core.statusAll();
  const projectItems = projects.length
    ? projects.map((project) => {
        const runningCount = project.services.filter((svc) => svc.running).length;
        const total = project.services.length;
        const label = `${project.running ? "●" : "○"} ${project.name} (${runningCount}/${total})`;
        const serviceSubmenu = project.services.map((svc) => ({
          label: `${svc.running ? "●" : "○"} ${svc.name}${svc.port ? ` :${svc.port}` : ""}`,
          submenu: [
            {
              label: svc.running ? "Stop" : "Start",
              click: () => {
                try {
                  if (svc.running) core.stopService(project.id, svc.id);
                  else core.startService(project.id, svc.id);
                } catch (e) { /* noop */ }
                notifyProjectsChanged();
              }
            },
            {
              label: "Open URL",
              enabled: Boolean(svc.url),
              click: () => svc.url && shell.openExternal(svc.url)
            },
            {
              label: "Copy Logs",
              click: () => clipboard.writeText(core.readServiceLogs(project.id, svc.id, 500))
            }
          ]
        }));
        return {
          label,
          submenu: [
            { label: "Open URL", enabled: Boolean(project.url), click: () => project.url && shell.openExternal(project.url) },
            { label: "Start All Autostart", click: () => { try { core.startProject(project.id); } catch {} ; notifyProjectsChanged(); } },
            { label: "Stop All", click: () => { try { core.stopProject(project.id); } catch {} ; notifyProjectsChanged(); } },
            { type: "separator" },
            ...serviceSubmenu
          ]
        };
      })
    : [{ label: "No projects yet", enabled: false }];

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Pier", click: () => createWindow() },
    { type: "separator" },
    ...projectItems,
    { type: "separator" },
    { label: "Quit", click: () => {
      app.isQuitting = true;
      app.quit();
    } }
  ]));
}

function notifyProjectsChanged() {
  rebuildTrayMenu();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("projects-changed");
  }
}

function changing(handler) {
  return async (...args) => {
    const result = await handler(...args);
    notifyProjectsChanged();
    return result;
  };
}

function exposeIpc() {
  // Project CRUD
  ipcMain.handle("projects:list", () => core.statusAll());
  ipcMain.handle("projects:add", changing((_event, input) => {
    const project = core.addProject(input.path, input);
    return core.statusProject(project.id);
  }));
  ipcMain.handle("projects:update", changing((_event, id, patch) => {
    const project = core.updateProject(id, patch);
    return core.statusProject(project.id);
  }));
  ipcMain.handle("projects:remove", changing((_event, id) => {
    core.removeProject(id);
    return true;
  }));

  // Project lifecycle
  ipcMain.handle("projects:start", changing((_event, id, options) => core.startProject(id, options || {})));
  ipcMain.handle("projects:stop", changing((_event, id) => core.stopProject(id)));
  ipcMain.handle("projects:restart", changing((_event, id, options) => core.restartProject(id, options || {})));

  // Services
  ipcMain.handle("services:add", changing((_event, projectId, input) => {
    core.addService(projectId, input || {});
    return core.statusProject(projectId);
  }));
  ipcMain.handle("services:update", changing((_event, projectId, serviceId, patch) => {
    core.updateService(projectId, serviceId, patch || {});
    return core.statusProject(projectId);
  }));
  ipcMain.handle("services:remove", changing((_event, projectId, serviceId) => {
    core.removeService(projectId, serviceId);
    return core.statusProject(projectId);
  }));
  ipcMain.handle("services:start", changing((_event, projectId, serviceId, options) =>
    core.startService(projectId, serviceId, options || {})
  ));
  ipcMain.handle("services:reclaim", changing((_event, projectId, serviceId) =>
    core.reclaimService(projectId, serviceId)
  ));
  ipcMain.handle("services:stop", changing((_event, projectId, serviceId) =>
    core.stopService(projectId, serviceId)
  ));
  ipcMain.handle("services:restart", changing((_event, projectId, serviceId, options) =>
    core.restartService(projectId, serviceId, options || {})
  ));
  ipcMain.handle("services:setPrimary", changing((_event, projectId, serviceId) => {
    core.setPrimaryService(projectId, serviceId);
    return core.statusProject(projectId);
  }));

  // Logs
  ipcMain.handle("services:logs", (_event, projectId, serviceId, lines) =>
    core.readServiceLogs(projectId, serviceId, lines || 300)
  );
  ipcMain.handle("services:clearLogs", changing((_event, projectId, serviceId) => {
    core.clearServiceLogs(projectId, serviceId);
    return true;
  }));
  ipcMain.handle("services:copyLogs", (_event, projectId, serviceId, lines) => {
    const logs = core.readServiceLogs(projectId, serviceId, lines || 1000);
    clipboard.writeText(logs);
    return true;
  });
  ipcMain.handle("projects:copyAllLogs", (_event, projectId, lines) => {
    const logs = core.readAllLogs(projectId, lines || 800);
    clipboard.writeText(logs);
    return true;
  });

  // Open
  ipcMain.handle("projects:open", (_event, id) => {
    const project = core.statusProject(id);
    if (project.url) shell.openExternal(project.url);
    return project.url;
  });
  ipcMain.handle("services:open", (_event, projectId, serviceId) => {
    const project = core.statusProject(projectId);
    const service = project.services.find((svc) => svc.id === serviceId);
    if (service?.url) shell.openExternal(service.url);
    return service?.url || null;
  });

  // Terminals
  ipcMain.handle("terminals:spawn", changing((_event, projectId, options) =>
    core.spawnTerminal(projectId, options || {})
  ));
  ipcMain.handle("terminals:close", changing((_event, projectId, name) => {
    core.closeTerminal(projectId, name);
    return core.statusProject(projectId);
  }));
  ipcMain.handle("terminals:read", (_event, projectId, name, lines) =>
    core.readTerminalCapture(projectId, name, lines || 400)
  );
  ipcMain.handle("terminals:rename", changing((_event, projectId, oldName, newName) =>
    core.renameTerminal(projectId, oldName, newName)
  ));
  ipcMain.handle("terminals:input", (_event, projectId, name, parts) =>
    core.sendTerminalInput(projectId, name, parts || [])
  );

  // Misc helpers
  ipcMain.handle("projects:copyAttach", (_event, projectId, windowName) => {
    const cmd = windowName
      ? `tmux attach -t pier-${projectId} \\; select-window -t ${windowName}`
      : `tmux attach -t pier-${projectId}`;
    clipboard.writeText(cmd);
    return cmd;
  });
  ipcMain.handle("projects:chooseFolder", async () => {
    const result = await dialog.showOpenDialog(createWindow(), {
      title: "Add Development Project",
      defaultPath: core.DEFAULT_DEV_ROOT,
      properties: ["openDirectory"]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => createWindow());
}

app.whenReady().then(() => {
  exposeIpc();
  tray = new Tray(trayIcon());
  tray.setToolTip("Pier");
  tray.on("click", () => createWindow());
  rebuildTrayMenu();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => createWindow());
