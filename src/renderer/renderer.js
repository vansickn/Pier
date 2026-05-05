const state = {
  projects: [],
  selectedId: null,
  activeTab: null, // { kind: "service"|"terminal", id }
  logTimer: null,
  lastTabKey: null,
  lastTabContent: "",
  collapsed: false,
  serviceDialogMode: { mode: "add", projectId: null, serviceId: null },
  lastStatusFingerprint: "",
  // Track which sidebar project items we've already animated in, so
  // re-renders triggered by polling / status changes / actions don't replay
  // the staggered fade-in every time. Items present skip the entrance
  // animation; the active indicator likewise only slides in on a real
  // selection change (lastSelectedId !== current).
  renderedProjectIds: new Set(),
  lastSelectedId: null
};

const $ = (id) => document.getElementById(id);

const icons = {
  plus: '<svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  external: '<svg viewBox="0 0 16 16"><path d="M6.5 4.5H4A1.5 1.5 0 0 0 2.5 6v6A1.5 1.5 0 0 0 4 13.5h6a1.5 1.5 0 0 0 1.5-1.5V9.5"/><path d="M9 2.5h4.5V7"/><path d="m8.5 7.5 4.5-4.5"/></svg>',
  restart: '<svg viewBox="0 0 16 16" data-spin><path d="M13 7.5A5 5 0 1 1 11.5 4"/><path d="M11.5 1.8V4h-2.2"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path d="M5.5 3.5 12 8l-6.5 4.5v-9Z"/></svg>',
  stop: '<svg viewBox="0 0 16 16"><path d="M5 5h6v6H5z"/></svg>',
  copy: '<svg viewBox="0 0 16 16"><path d="M5.5 5.5h7v8h-7z"/><path d="M3.5 10.5h-1v-8h7v1"/></svg>',
  trash: '<svg viewBox="0 0 16 16"><path d="M3 4.5h10"/><path d="M6.5 2.5h3"/><path d="M5 4.5l.5 9h5l.5-9"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" data-spin><path d="M13 7.5A5 5 0 1 1 11.5 4"/><path d="M11.5 1.8V4h-2.2"/></svg>',
  gear: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5"/></svg>',
  x: '<svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
  star: '<svg viewBox="0 0 16 16"><path d="M8 2.2 9.7 6h4.1l-3.3 2.5 1.2 4-3.7-2.6L4.3 12.5l1.2-4L2.2 6h4.1L8 2.2Z"/></svg>'
};

function hydrateIcons(root = document) {
  root.querySelectorAll("button[data-icon]").forEach((button) => {
    if (button.dataset.hydrated === button.dataset.icon) return;
    const name = button.dataset.icon;
    const label = button.dataset.label || button.textContent.trim();
    if (label && !button.dataset.label) button.dataset.label = label;
    const labelHtml = label ? `<span>${escapeHtml(label)}</span>` : "";
    button.innerHTML = `<span class="button-icon">${icons[name] || ""}</span>${labelHtml}`;
    button.dataset.hydrated = name;
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.selectedId) || null;
}

function compactPath(p) {
  return p.replace(/^\/Users\/[^/]+/, "~");
}

function tabKey(tab) {
  return tab ? `${tab.kind}:${tab.id}` : "";
}

function toast(message, kind = "info", ttl = 2400) {
  const stack = $("toastStack");
  if (!stack) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="dot"></span><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 240);
  }, ttl);
}

// ──────────────────────────────────────────────────────────────────────────
// Sidebar drag/collapse
// ──────────────────────────────────────────────────────────────────────────

const SIDEBAR_COLLAPSED_W = 88;
const SIDEBAR_SNAP_THRESHOLD = 176;
const SIDEBAR_MAX_W = 360;
const SIDEBAR_CLICK_THRESHOLD_PX = 4;

function applyCollapsed() {
  const sidebar = $("sidebar");
  sidebar.classList.toggle("collapsed", state.collapsed);
  const handle = $("sidebarHandle");
  if (handle) handle.title = state.collapsed ? "Expand sidebar" : "Collapse sidebar";
}

function persistCollapsed() {
  try { localStorage.setItem("pier:collapsed", state.collapsed ? "1" : "0"); } catch {}
}

function setupSidebarDrag() {
  const sidebar = $("sidebar");
  const handle = $("sidebarHandle");
  if (!sidebar || !handle) return;

  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let movedAbs = 0;

  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    movedAbs = Math.max(movedAbs, Math.abs(dx));
    const next = Math.max(SIDEBAR_COLLAPSED_W, Math.min(SIDEBAR_MAX_W, startWidth + dx));
    sidebar.style.width = `${next}px`;
    const wantCollapsed = next < SIDEBAR_SNAP_THRESHOLD;
    if (sidebar.classList.contains("collapsed") !== wantCollapsed) {
      sidebar.classList.toggle("collapsed", wantCollapsed);
      renderProjects();
    }
  };

  const finish = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", finish);
    document.body.classList.remove("sidebar-dragging");
    sidebar.classList.remove("dragging");

    if (movedAbs < SIDEBAR_CLICK_THRESHOLD_PX) {
      state.collapsed = !state.collapsed;
    } else {
      const finalWidth = sidebar.getBoundingClientRect().width;
      state.collapsed = finalWidth < SIDEBAR_SNAP_THRESHOLD;
    }
    sidebar.style.width = "";
    applyCollapsed();
    persistCollapsed();
    renderProjects();
  };

  handle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    movedAbs = 0;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    sidebar.classList.add("dragging");
    document.body.classList.add("sidebar-dragging");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", finish);
    e.preventDefault();
  });

  handle.addEventListener("dblclick", (e) => {
    e.preventDefault();
    state.collapsed = !state.collapsed;
    applyCollapsed();
    persistCollapsed();
    renderProjects();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Data refresh
// ──────────────────────────────────────────────────────────────────────────

async function refreshProjects() {
  state.projects = await window.pier.listProjects();
  state.lastStatusFingerprint = statusFingerprint(state.projects);
  if (!state.selectedId && state.projects.length) state.selectedId = state.projects[0].id;
  if (state.selectedId && !state.projects.some((p) => p.id === state.selectedId)) {
    state.selectedId = state.projects[0]?.id || null;
  }
  ensureValidActiveTab();
  renderProjects();
  renderProjectView();
  await refreshActiveTabContent({ force: true });
}

// Stringify only the bits of project state that affect rendering, so the
// status poll can skip re-rendering when nothing visible has changed
// (which keeps list animations from replaying every few seconds).
function statusFingerprint(projects) {
  return projects.map((project) => {
    const svc = (project.services || []).map((s) =>
      `${s.id}|${s.lifecycle}|${s.port || ""}|${s.command}|${s.name}|${s.autostart ? 1 : 0}|${s.setup || ""}`
    ).join(";");
    const term = (project.terminals || []).map((t) => t.name).join(";");
    return `${project.id}|${project.name}|${project.lifecycle}|${project.url || ""}|${project.primaryServiceId || ""}|svc:${svc}|term:${term}`;
  }).join("\n");
}

// Periodic backend status pull — picks up service starts/stops driven by
// the CLI, agents, or services that died on their own. We diff against the
// last fingerprint so the DOM (and its animations) only re-render on real
// change. Skipped while the window is hidden to avoid wasted IPC, or
// while the user is mid-rename (re-rendering would destroy the input
// element and discard their unsaved typing).
async function pollProjectStatus() {
  if (typeof document !== "undefined" && document.hidden) return;
  if (document.querySelector(".tab.renaming")) return;
  let next;
  try {
    next = await window.pier.listProjects();
  } catch {
    return;
  }
  const fp = statusFingerprint(next);
  if (fp === state.lastStatusFingerprint) return;
  state.lastStatusFingerprint = fp;
  state.projects = next;
  if (state.selectedId && !next.some((p) => p.id === state.selectedId)) {
    state.selectedId = next[0]?.id || null;
  }
  ensureValidActiveTab();
  renderProjects();
  renderProjectView();
}

function ensureValidActiveTab() {
  const project = selectedProject();
  if (!project) {
    state.activeTab = null;
    return;
  }
  const has = (tab) => {
    if (!tab) return false;
    if (tab.kind === "service") return project.services.some((s) => s.id === tab.id);
    if (tab.kind === "terminal") return project.terminals.some((t) => t.name === tab.id);
    return false;
  };
  if (has(state.activeTab)) return;
  // pick primary service or first service or first terminal
  const primary = project.services.find((s) => s.id === project.primaryServiceId) || project.services[0];
  if (primary) state.activeTab = { kind: "service", id: primary.id };
  else if (project.terminals[0]) state.activeTab = { kind: "terminal", id: project.terminals[0].name };
  else state.activeTab = null;
}

// ──────────────────────────────────────────────────────────────────────────
// Sidebar / projects
// ──────────────────────────────────────────────────────────────────────────

function renderProjects() {
  const list = $("projectList");
  list.innerHTML = "";
  if (!state.projects.length) {
    if (!state.collapsed) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.innerHTML = `
        <div class="glyph">db</div>
        <p class="project-path">No projects yet.<br>Click <strong>+ Add Project</strong> above.</p>
      `;
      list.appendChild(empty);
    }
    return;
  }

  const renderedNow = new Set();
  state.projects.forEach((project, idx) => {
    renderedNow.add(project.id);
    const isNew = !state.renderedProjectIds.has(project.id);
    const isActive = project.id === state.selectedId;
    const justActivated = isActive && state.lastSelectedId !== state.selectedId;
    const button = document.createElement("button");
    const cls = ["project-item"];
    if (isActive) cls.push("active");
    if (isNew) cls.push("is-new");
    if (justActivated) cls.push("just-activated");
    button.className = cls.join(" ");
    button.draggable = true;
    button.dataset.projectId = project.id;
    if (isNew) button.style.animationDelay = `${Math.min(idx, 8) * 24}ms`;
    const running = project.services.filter((s) => s.running).length;
    const total = project.services.length;
    const lifecycle = project.running ? "running" : project.lifecycle || "stopped";
    button.title = `${project.name} · ${running}/${total} running`;
    const iconInner = project.iconDataUrl
      ? `<img class="project-icon" src="${project.iconDataUrl}" alt="">`
      : `<span class="project-icon fallback">${escapeHtml(project.name.slice(0, 2).toLowerCase())}</span>`;
    const dotClasses = ["icon-status-dot"];
    if (lifecycle === "running") dotClasses.push("running", "show");
    else if (lifecycle === "external") dotClasses.push("external", "show");
    button.innerHTML = `
      <span class="project-icon-wrap">
        ${iconInner}
        <span class="${dotClasses.join(" ")}"></span>
      </span>
      <span class="project-copy">
        <span class="project-title">
          <strong>${escapeHtml(project.name)}</strong>
          <span class="status ${lifecycle}">${running}/${total}</span>
        </span>
        <span class="project-path">${escapeHtml(compactPath(project.path))}</span>
      </span>
    `;
    button.addEventListener("click", async () => {
      if (state.selectedId === project.id) return;
      state.selectedId = project.id;
      state.activeTab = null;
      state.lastTabKey = null;
      state.lastTabContent = "";
      ensureValidActiveTab();
      renderProjects();
      const content = document.querySelector(".content");
      content?.classList.remove("fade-swap");
      void content?.offsetWidth;
      content?.classList.add("fade-swap");
      renderProjectView();
      await refreshActiveTabContent({ force: true });
    });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openProjectContextMenu(event.clientX, event.clientY, project);
    });
    list.appendChild(button);
  });
  state.renderedProjectIds = renderedNow;
  state.lastSelectedId = state.selectedId;
}

// ──────────────────────────────────────────────────────────────────────────
// Sidebar drag-and-drop reordering
// ──────────────────────────────────────────────────────────────────────────
//
// Native HTML5 DnD with delegated listeners on the list container. Each
// .project-item carries dataset.projectId; while dragging we light up the
// nearest sibling with .drop-above / .drop-below as a visual insertion
// caret, then on drop we reorder optimistically and persist via IPC. The
// click handler doesn't need a guard because HTML5 drop suppresses click.

const dragState = { id: null, target: null, position: null };

function clearDropIndicators(list) {
  list.querySelectorAll(".project-item.drop-above, .project-item.drop-below")
    .forEach((el) => el.classList.remove("drop-above", "drop-below"));
}

function resetDragState(list) {
  list.querySelectorAll(".project-item.dragging")
    .forEach((el) => el.classList.remove("dragging"));
  clearDropIndicators(list);
  dragState.id = null;
  dragState.target = null;
  dragState.position = null;
}

function setupProjectListDragDrop() {
  const list = $("projectList");
  if (!list || list.dataset.dndReady === "1") return;
  list.dataset.dndReady = "1";

  list.addEventListener("dragstart", (event) => {
    const item = event.target.closest(".project-item");
    if (!item) return;
    const id = item.dataset.projectId;
    if (!id) return;
    dragState.id = id;
    item.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      try { event.dataTransfer.setData("text/plain", id); } catch {}
    }
  });

  list.addEventListener("dragover", (event) => {
    if (!dragState.id) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const item = event.target.closest(".project-item");
    if (!item || item.classList.contains("dragging")) {
      clearDropIndicators(list);
      dragState.target = null;
      dragState.position = null;
      return;
    }
    const rect = item.getBoundingClientRect();
    const above = event.clientY < rect.top + rect.height / 2;
    const position = above ? "above" : "below";
    if (dragState.target === item && dragState.position === position) return;
    clearDropIndicators(list);
    item.classList.add(above ? "drop-above" : "drop-below");
    dragState.target = item;
    dragState.position = position;
  });

  list.addEventListener("dragleave", (event) => {
    // dragleave fires when crossing into child nodes too. Only clear when
    // the cursor truly exits the list (relatedTarget outside it).
    if (!list.contains(event.relatedTarget)) {
      clearDropIndicators(list);
      dragState.target = null;
      dragState.position = null;
    }
  });

  list.addEventListener("drop", async (event) => {
    if (!dragState.id) return;
    event.preventDefault();
    const sourceId = dragState.id;
    const target = dragState.target;
    const position = dragState.position;
    resetDragState(list);
    if (!target) return;
    const targetId = target.dataset.projectId;
    if (!targetId || targetId === sourceId) return;
    await commitProjectReorder(sourceId, targetId, position);
  });

  list.addEventListener("dragend", () => resetDragState(list));
}

async function commitProjectReorder(sourceId, targetId, position) {
  const ids = state.projects.map((p) => p.id);
  const fromIndex = ids.indexOf(sourceId);
  if (fromIndex === -1 || ids.indexOf(targetId) === -1) return;
  ids.splice(fromIndex, 1);
  let insertIndex = ids.indexOf(targetId);
  if (position === "below") insertIndex += 1;
  ids.splice(insertIndex, 0, sourceId);

  const before = state.projects.map((p) => p.id).join(",");
  const after = ids.join(",");
  if (before === after) return;

  // Optimistic local reorder so the list snaps into place immediately. We
  // also bump the fingerprint so the file-watch broadcast that follows
  // doesn't trigger a redundant re-render.
  const byId = new Map(state.projects.map((p) => [p.id, p]));
  state.projects = ids.map((id) => byId.get(id));
  state.lastStatusFingerprint = statusFingerprint(state.projects);
  renderProjects();

  try {
    await window.pier.reorderProjects(ids);
  } catch (err) {
    toast(err?.message || "Failed to reorder projects", "error");
    await refreshProjects();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Context menu (lightweight popup; reusable for any right-click affordance)
// ──────────────────────────────────────────────────────────────────────────

let openMenuCleanup = null;

function showContextMenu(x, y, items) {
  // Tear down any prior menu so opening a new one doesn't leave a ghost.
  if (openMenuCleanup) openMenuCleanup();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "context-menu-sep";
      menu.appendChild(sep);
      continue;
    }
    const button = document.createElement("button");
    button.className = `context-menu-item${item.danger ? " danger" : ""}`;
    button.textContent = item.label;
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      close();
      try {
        await item.onClick?.();
      } catch (e) {
        toast(`Failed: ${e.message}`, "error");
      }
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  // Position after insert so we know the menu's actual size and can keep
  // it on-screen. Clamp against the viewport with a small margin.
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - margin);
  const top = Math.min(y, window.innerHeight - rect.height - margin);
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;

  const close = () => {
    if (openMenuCleanup !== cleanup) return;
    cleanup();
  };
  const onDown = (event) => {
    if (!menu.contains(event.target)) close();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
  };
  const cleanup = () => {
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("contextmenu", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", close);
    menu.remove();
    openMenuCleanup = null;
  };
  // Defer registration one tick so the click that opened us doesn't
  // immediately fire the close handler.
  setTimeout(() => {
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("contextmenu", onDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
  }, 0);
  openMenuCleanup = cleanup;
}

function openProjectContextMenu(x, y, project) {
  const total = project.services.length;
  const runningCount = project.services.filter((s) => s.running).length;
  // Mirror the Start All / Stop All semantics from the project topbar:
  // if anything is running, the action is "stop everything"; otherwise
  // it's "start everything". Disabled only when there are no services.
  const lifecycleItem = runningCount > 0
    ? {
        label: `Stop all (${runningCount} running)`,
        onClick: async () => {
          await window.pier.stopProject(project.id);
          toast(`Stopped ${project.name}`, "success");
        }
      }
    : {
        label: total ? `Start all (${total} service${total === 1 ? "" : "s"})` : "Start all (no services)",
        onClick: async () => {
          if (!total) return;
          const result = await window.pier.startProject(project.id);
          reportStartResult(result);
        }
      };
  showContextMenu(x, y, [
    {
      label: "Open in Finder",
      onClick: () => window.pier.revealProjectFolder(project.id)
    },
    {
      label: "Copy path",
      onClick: () => {
        navigator.clipboard.writeText(project.path);
        toast("Path copied", "success");
      }
    },
    { separator: true },
    lifecycleItem,
    { separator: true },
    {
      label: "Remove project…",
      danger: true,
      onClick: () => removeProjectWithConfirm(project)
    }
  ]);
}

async function removeProjectWithConfirm(project) {
  const runningCount = project.services.filter((s) => s.running).length;
  const lines = [
    `Remove "${project.name}" from Pier?`,
    "",
    "Your files at this path are not touched — only Pier's record of it."
  ];
  if (runningCount) {
    lines.splice(1, 0, `${runningCount} service${runningCount === 1 ? " is" : "s are"} still running and will be stopped.`);
  }
  if (!confirm(lines.join("\n"))) return;
  try {
    await window.pier.removeProject(project.id);
    if (state.selectedId === project.id) {
      state.selectedId = null;
      state.activeTab = null;
      state.lastTabKey = null;
      state.lastTabContent = "";
    }
    toast(`Removed ${project.name}`, "success");
    await refreshProjects();
  } catch (e) {
    toast(`Failed: ${e.message}`, "error");
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Project view (topbar, services, tabs, logs)
// ──────────────────────────────────────────────────────────────────────────

function renderProjectView() {
  const project = selectedProject();
  renderTopbar(project);
  renderServiceList(project);
  renderTabs(project);
  updateTerminalInputVisibility();
  hydrateIcons();
}

function renderTopbar(project) {
  $("projectName").textContent = project ? project.name : "No project selected";
  if (project) {
    const running = project.services.filter((s) => s.running).length;
    const total = project.services.length;
    const meta = `${running}/${total} services running${project.url ? ` · ${project.url}` : ""}`;
    $("projectMeta").textContent = meta;
  } else {
    $("projectMeta").textContent = "Add a project to get started.";
  }

  const startStop = $("startStopAllButton");
  const restart = $("restartAllButton");
  const open = $("openButton");
  const anyRunning = Boolean(project?.running);

  open.disabled = !project?.url;
  restart.disabled = !project || !anyRunning;
  startStop.disabled = !project || (project.services.length === 0);

  startStop.dataset.label = anyRunning ? "Stop All" : "Start All";
  startStop.dataset.icon = anyRunning ? "stop" : "play";
  startStop.classList.toggle("primary", !anyRunning);
  startStop.classList.toggle("danger", anyRunning);
  startStop.dataset.hydrated = "";
}

function renderServiceList(project) {
  const list = $("serviceList");
  list.innerHTML = "";
  if (!project) {
    list.innerHTML = `<div class="service-empty">Select a project to view services.</div>`;
    return;
  }
  if (!project.services.length) {
    list.innerHTML = `<div class="service-empty">No services yet. Click <strong>+ Service</strong> to add one.</div>`;
    return;
  }
  project.services.forEach((svc) => {
    const row = document.createElement("div");
    row.className = `service-row ${svc.lifecycle}`;
    row.dataset.id = svc.id;
    const isPrimary = svc.id === project.primaryServiceId;
    const portText = svc.port ? `:${svc.port}` : "";
    const isExternal = svc.lifecycle === "external";
    const toggleClass = svc.running ? "running" : isExternal ? "reclaim" : "";
    const toggleIcon = svc.running ? "stop" : isExternal ? "restart" : "play";
    const toggleLabel = svc.running ? "Stop" : isExternal ? "Reclaim" : "Start";
    const toggleTitle = isExternal
      ? `Port ${svc.port} held by ${svc.process?.command || "external process"}${svc.process?.pid ? ` (pid ${svc.process.pid})` : ""} — click to kill and adopt`
      : "";
    const primaryTitle = isPrimary
      ? `★ Project URL — clicking the project's Open button will open ${svc.url || "this service"}`
      : `Use this service's URL for the project's Open button${svc.url ? ` (${svc.url})` : ""}`;
    const primaryClass = `icon-only${isPrimary ? " is-primary" : ""}`;
    row.innerHTML = `
      <span class="svc-dot"></span>
      <div class="svc-copy">
        <strong>${escapeHtml(svc.name)}</strong>
        <code>${escapeHtml(svc.command)}</code>
      </div>
      <div class="svc-port">${portText}</div>
      <div class="svc-actions">
        <button class="${primaryClass}" data-action="primary" data-icon="star" title="${escapeHtml(primaryTitle)}"></button>
        <button class="icon-only" data-action="open" data-icon="external" title="Open URL" ${svc.url ? "" : "disabled"}></button>
        <button class="toggle-btn ${toggleClass}" data-action="toggle" data-icon="${toggleIcon}" title="${escapeHtml(toggleTitle)}">${toggleLabel}</button>
        <button class="icon-only" data-action="edit" data-icon="gear" title="Edit"></button>
        <button class="icon-only" data-action="remove" data-icon="x" title="Remove"></button>
      </div>
    `;
    row.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", (event) => handleServiceAction(svc.id, btn.dataset.action, event));
    });
    list.appendChild(row);
  });
  hydrateIcons(list);
}

function renderTabs(project) {
  const strip = $("tabStrip");
  const meta = $("tabPath");
  strip.innerHTML = "";
  if (!project) {
    meta.textContent = "No log file yet";
    return;
  }
  const tabs = [
    ...project.services.map((svc) => ({
      kind: "service",
      id: svc.id,
      label: svc.name,
      lifecycle: svc.lifecycle,
      running: svc.running
    })),
    ...project.terminals.map((term) => ({
      kind: "terminal",
      id: term.name,
      label: term.name,
      lifecycle: "running",
      running: true
    }))
  ];
  const activeKey = tabKey(state.activeTab);
  tabs.forEach((tab) => {
    const el = document.createElement("button");
    const cls = ["tab"];
    if (tab.kind === "terminal") cls.push("terminal");
    if (tab.lifecycle === "running") cls.push("running");
    if (tab.lifecycle === "external") cls.push("external");
    if (`${tab.kind}:${tab.id}` === activeKey) cls.push("active");
    el.className = cls.join(" ");
    el.dataset.kind = tab.kind;
    el.dataset.id = tab.id;
    const isActive = `${tab.kind}:${tab.id}` === activeKey;
    const closeBtn = tab.kind === "terminal"
      ? `<span class="tab-close" data-close="1" title="Close terminal">×</span>`
      : "";
    const labelTitle = tab.kind === "terminal" && isActive ? "Click to rename" : "";
    el.innerHTML = `<span class="tab-dot"></span><span class="tab-label" title="${escapeHtml(labelTitle)}">${escapeHtml(tab.label)}</span>${closeBtn}`;
    el.addEventListener("click", async (event) => {
      const closeControl = event.target.closest("[data-close]");
      if (closeControl) {
        event.stopPropagation();
        await closeTerminal(tab.id);
        return;
      }
      // Already-active terminal tab: clicking again starts rename. This makes
      // rename discoverable without dedicating a pencil icon to it. Service
      // tabs don't get this — there's nothing meaningful to rename inline.
      if (isActive && tab.kind === "terminal") {
        startTabRename(el, tab.id);
        return;
      }
      state.activeTab = { kind: tab.kind, id: tab.id };
      state.lastTabContent = "";
      renderTabs(selectedProject());
      updateTabMeta();
      updateTerminalInputVisibility();
      await refreshActiveTabContent({ force: true });
      if (tab.kind === "terminal") setTimeout(() => $("terminalInputField")?.focus(), 60);
    });
    if (tab.kind === "terminal") {
      el.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        startTabRename(el, tab.id);
      });
    }
    strip.appendChild(el);
  });
  updateTabMeta();
  updateTerminalInputVisibility();
}

function updateTabMeta() {
  const project = selectedProject();
  const meta = $("tabPath");
  if (!project || !state.activeTab) {
    meta.textContent = "No log file yet";
    return;
  }
  if (state.activeTab.kind === "service") {
    const svc = project.services.find((s) => s.id === state.activeTab.id);
    meta.textContent = svc?.logPath || "No log file yet";
  } else {
    meta.textContent = `tmux window · ${state.activeTab.id} (read-only capture)`;
  }
}

async function refreshActiveTabContent({ force = false } = {}) {
  const project = selectedProject();
  const logsEl = $("logs");
  if (!project || !state.activeTab) {
    if (force || state.lastTabContent !== "") {
      logsEl.textContent = "Select a project to view logs.";
      state.lastTabContent = "";
      state.lastTabKey = "";
    }
    return;
  }
  const key = tabKey(state.activeTab);
  if (key !== state.lastTabKey) {
    state.lastTabContent = "";
    state.lastTabKey = key;
  }

  let next = "";
  try {
    if (state.activeTab.kind === "service") {
      next = await window.pier.readServiceLogs(project.id, state.activeTab.id, 300);
    } else {
      next = await window.pier.readTerminal(project.id, state.activeTab.id, 400);
    }
  } catch (e) {
    next = `(error reading: ${e.message})`;
  }
  if (!force && next === state.lastTabContent) return;
  const wasNearBottom = logsEl.scrollHeight - logsEl.scrollTop - logsEl.clientHeight < 60;
  logsEl.textContent = next || "(no output yet)";
  state.lastTabContent = next;
  // Service logs always tail to the bottom (newest at the end is what you want).
  // Terminals start at the TOP on switch so you see the initial prompt and the
  // start of the session — but still tail if the user is already scrolled near
  // the bottom (so live output keeps following while they're watching it).
  if (force) {
    logsEl.scrollTop = state.activeTab.kind === "terminal" ? 0 : logsEl.scrollHeight;
  } else if (wasNearBottom) {
    logsEl.scrollTop = logsEl.scrollHeight;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Service actions
// ──────────────────────────────────────────────────────────────────────────

async function handleServiceAction(serviceId, action) {
  const project = selectedProject();
  if (!project) return;
  const svc = project.services.find((s) => s.id === serviceId);
  if (!svc) return;

  if (action === "toggle") {
    try {
      if (svc.running) {
        await window.pier.stopService(project.id, svc.id);
        toast(`Stopped ${svc.name}`, "success");
      } else if (svc.lifecycle === "external") {
        const proc = svc.process;
        const ok = confirm(
          `Port ${svc.port} is held by ${proc?.command || "an external process"}${proc?.pid ? ` (pid ${proc.pid})` : ""}.\n\nKill it and start ${svc.name} via Pier?`
        );
        if (!ok) return;
        await window.pier.reclaimService(project.id, svc.id);
        toast(`Reclaimed ${svc.name}`, "success");
      } else {
        await window.pier.startService(project.id, svc.id);
        toast(`Starting ${svc.name}…`, "success");
      }
      await refreshProjects();
    } catch (e) {
      toast(`${e.message}`, "error", 4200);
    }
    return;
  }

  if (action === "open") {
    if (!svc.url) return;
    await window.pier.openService(project.id, svc.id);
    return;
  }

  if (action === "primary") {
    try {
      await window.pier.setPrimaryService(project.id, svc.id);
      toast(
        svc.url
          ? `Project Open button now points to ${svc.name} (${svc.url})`
          : `Project Open button now points to ${svc.name}`,
        "info"
      );
      await refreshProjects();
    } catch (e) {
      toast(`Failed: ${e.message}`, "error");
    }
    return;
  }

  if (action === "edit") {
    openServiceDialog({ mode: "edit", projectId: project.id, service: svc });
    return;
  }

  if (action === "remove") {
    const ok = confirm(`Remove service "${svc.name}"?`);
    if (!ok) return;
    try {
      await window.pier.removeService(project.id, svc.id);
      toast(`Removed ${svc.name}`, "success");
      await refreshProjects();
    } catch (e) {
      toast(`Failed: ${e.message}`, "error");
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Service dialog
// ──────────────────────────────────────────────────────────────────────────

function openServiceDialog({ mode, projectId, service }) {
  state.serviceDialogMode = { mode, projectId, serviceId: service?.id || null };
  $("serviceDialogTitle").textContent = mode === "edit" ? "Edit Service" : "Add Service";
  $("serviceName").value = service?.name || "";
  $("serviceCommand").value = service?.command || "";
  $("serviceSetup").value = service?.setup || "";
  $("servicePort").value = service?.port || "";
  $("serviceAutostart").checked = service ? Boolean(service.autostart) : true;
  $("serviceDialog").showModal();
  setTimeout(() => $("serviceName").focus(), 50);
}

async function submitServiceDialog() {
  const { mode, projectId, serviceId } = state.serviceDialogMode;
  const input = {
    name: $("serviceName").value.trim(),
    command: $("serviceCommand").value.trim(),
    setup: $("serviceSetup").value.trim(),
    port: $("servicePort").value.trim() ? Number($("servicePort").value.trim()) : null,
    autostart: $("serviceAutostart").checked
  };
  if (!input.name) { toast("Name is required", "error"); return; }
  if (!input.command) { toast("Command is required", "error"); return; }
  try {
    if (mode === "edit") {
      await window.pier.updateService(projectId, serviceId, input);
      toast(`Updated ${input.name}`, "success");
    } else {
      await window.pier.addService(projectId, input);
      toast(`Added ${input.name}`, "success");
    }
    $("serviceDialog").close();
    await refreshProjects();
  } catch (e) {
    toast(`Failed: ${e.message}`, "error", 4200);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Terminals
// ──────────────────────────────────────────────────────────────────────────

async function spawnTerminal() {
  const project = selectedProject();
  if (!project) return;
  try {
    const term = await window.pier.spawnTerminal(project.id, { name: "new-terminal" });
    state.activeTab = { kind: "terminal", id: term.name };
    state.lastTabContent = "";
    toast(`Opened ${term.name}`, "success");
    await refreshProjects();
    setTimeout(() => $("terminalInputField")?.focus(), 60);
  } catch (e) {
    toast(`Failed: ${e.message}`, "error", 4200);
  }
}

async function renameTerminalTo(oldName, newNameRaw) {
  const project = selectedProject();
  if (!project) return;
  const newName = newNameRaw.trim();
  if (!newName || newName === oldName) return;
  try {
    const finalName = await window.pier.renameTerminal(project.id, oldName, newName);
    if (state.activeTab?.kind === "terminal" && state.activeTab.id === oldName) {
      state.activeTab = { kind: "terminal", id: finalName };
      state.lastTabContent = "";
    }
    await refreshProjects();
  } catch (e) {
    toast(`Rename failed: ${e.message}`, "error");
  }
}

function startTabRename(tabEl, oldName) {
  if (tabEl.classList.contains("renaming")) return;
  tabEl.classList.add("renaming");
  const labelSpan = tabEl.querySelector("span:nth-of-type(2)");
  const closeBtn = tabEl.querySelector(".tab-close");
  if (closeBtn) closeBtn.style.display = "none";
  const input = document.createElement("input");
  input.className = "tab-rename-input";
  input.value = oldName;
  if (labelSpan) labelSpan.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    if (commit) await renameTerminalTo(oldName, input.value);
    // Always rebuild the tab strip so the input is replaced by a real
    // label again — covers Escape, no-op renames (empty / unchanged),
    // and the success case (renameTerminalTo no-ops on unchanged names
    // and so wouldn't refresh on its own).
    await refreshProjects();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

async function sendTerminalKeys(parts) {
  const project = selectedProject();
  if (!project || state.activeTab?.kind !== "terminal") return;
  try {
    await window.pier.sendTerminalInput(project.id, state.activeTab.id, parts);
    setTimeout(() => refreshActiveTabContent(), 60);
    setTimeout(() => refreshActiveTabContent(), 240);
  } catch (e) {
    toast(`Send failed: ${e.message}`, "error");
  }
}

function isTerminalTabActive() {
  return state.activeTab?.kind === "terminal";
}

function updateTerminalInputVisibility() {
  const bar = $("terminalInput");
  if (!bar) return;
  bar.hidden = !isTerminalTabActive();
}

async function closeTerminal(name) {
  const project = selectedProject();
  if (!project) return;
  try {
    await window.pier.closeTerminal(project.id, name);
    if (state.activeTab?.kind === "terminal" && state.activeTab.id === name) {
      state.activeTab = null;
    }
    toast(`Closed ${name}`, "success");
    await refreshProjects();
  } catch (e) {
    toast(`Failed: ${e.message}`, "error");
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Project-level actions
// ──────────────────────────────────────────────────────────────────────────

async function projectStartStopAll() {
  const project = selectedProject();
  if (!project) return;
  try {
    if (project.running) {
      await window.pier.stopProject(project.id);
      toast(`Stopped ${project.name}`, "success");
    } else {
      const result = await window.pier.startProject(project.id);
      reportStartResult(result, project);
    }
    await refreshProjects();
  } catch (e) {
    toast(`Failed: ${e.message}`, "error", 4200);
  }
}

// Translate the structured response from core.startProject into user-visible
// toasts. Reports the count of services attempted, then surfaces each
// per-service failure so things like port conflicts don't get swallowed.
function reportStartResult(result) {
  const attempted = Array.isArray(result?.attempted) ? result.attempted : [];
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const succeeded = attempted.length - errors.length;

  if (!attempted.length) {
    toast(`No services to start.`, "info");
    return;
  }
  if (succeeded > 0) {
    toast(`Starting ${succeeded} service${succeeded === 1 ? "" : "s"}…`, "success");
  }
  for (const err of errors) {
    toast(`${err.name || err.id}: ${err.message}`, "error", 5200);
  }
}

async function projectRestartAll() {
  const project = selectedProject();
  if (!project) return;
  try {
    await window.pier.restartProject(project.id);
    toast(`Restarting…`, "success");
    await refreshProjects();
  } catch (e) {
    toast(`Failed: ${e.message}`, "error", 4200);
  }
}

async function copyAttachCommand() {
  const project = selectedProject();
  if (!project) return;
  const windowName = state.activeTab?.id;
  await window.pier.copyAttachCommand(project.id, windowName);
  toast("Attach command copied to clipboard", "info");
}

async function copyCurrentTabLogs() {
  const project = selectedProject();
  if (!project || !state.activeTab) return;
  if (state.activeTab.kind === "service") {
    await window.pier.copyServiceLogs(project.id, state.activeTab.id, 1000);
    toast("Logs copied", "success");
  } else {
    const text = await window.pier.readTerminal(project.id, state.activeTab.id, 800);
    navigator.clipboard.writeText(text);
    toast("Terminal capture copied", "success");
  }
}

async function copyAllTabsLogs() {
  const project = selectedProject();
  if (!project) return;
  await window.pier.copyAllLogs(project.id, 800);
  toast("All service logs copied", "success");
}

async function clearCurrentTabLogs() {
  const project = selectedProject();
  if (!project || !state.activeTab) return;
  if (state.activeTab.kind !== "service") {
    toast("Only service logs can be cleared", "error");
    return;
  }
  try {
    await window.pier.clearServiceLogs(project.id, state.activeTab.id);
    toast("Logs cleared", "success");
    state.lastTabContent = "";
    await refreshActiveTabContent({ force: true });
  } catch (e) {
    toast(`Failed: ${e.message}`, "error");
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Wire up
// ──────────────────────────────────────────────────────────────────────────

function wireEvents() {
  setupSidebarDrag();
  setupProjectListDragDrop();

  $("addProject").addEventListener("click", () => $("addDialog").showModal());
  $("chooseFolder").addEventListener("click", async () => {
    const folder = await window.pier.chooseFolder();
    if (folder) $("newPath").value = folder;
  });
  $("confirmAdd").addEventListener("click", async (event) => {
    event.preventDefault();
    const input = {
      path: $("newPath").value.trim(),
      name: $("newName").value.trim(),
      command: $("newCommand").value.trim(),
      port: $("newPort").value.trim()
    };
    if (!input.path) { toast("Choose a folder first", "error"); return; }
    try {
      const project = await window.pier.addProject(input);
      state.selectedId = project.id;
      $("newPath").value = "";
      $("newName").value = "";
      $("newCommand").value = "";
      $("newPort").value = "";
      $("addDialog").close();
      toast(`Added ${project.name}`, "success");
      await refreshProjects();
    } catch (error) {
      toast(`Add failed: ${error.message}`, "error", 4200);
    }
  });

  $("openButton").addEventListener("click", () => {
    const project = selectedProject();
    if (project?.url) window.pier.openProject(project.id);
  });
  $("startStopAllButton").addEventListener("click", projectStartStopAll);
  $("restartAllButton").addEventListener("click", projectRestartAll);

  $("addServiceButton").addEventListener("click", () => {
    const project = selectedProject();
    if (!project) { toast("Select a project first", "error"); return; }
    openServiceDialog({ mode: "add", projectId: project.id });
  });
  $("confirmService").addEventListener("click", (event) => {
    event.preventDefault();
    submitServiceDialog();
  });

  $("addTerminalButton").addEventListener("click", () => {
    const project = selectedProject();
    if (!project) { toast("Select a project first", "error"); return; }
    spawnTerminal();
  });

  const termInput = $("terminalInputField");
  termInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const text = termInput.value;
      termInput.value = "";
      await sendTerminalKeys(text.length ? [text, "Enter"] : ["Enter"]);
    } else if (event.key === "Tab") {
      event.preventDefault();
      const text = termInput.value;
      if (text.length) {
        termInput.value = "";
        await sendTerminalKeys([text, "Tab"]);
      } else {
        await sendTerminalKeys(["Tab"]);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      await sendTerminalKeys(["Up"]);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      await sendTerminalKeys(["Down"]);
    } else if (event.ctrlKey && (event.key === "c" || event.key === "C")) {
      event.preventDefault();
      termInput.value = "";
      await sendTerminalKeys(["C-c"]);
    } else if (event.ctrlKey && (event.key === "d" || event.key === "D")) {
      event.preventDefault();
      await sendTerminalKeys(["C-d"]);
    } else if (event.ctrlKey && (event.key === "l" || event.key === "L")) {
      event.preventDefault();
      await sendTerminalKeys(["C-l"]);
    }
  });

  $("terminalSendButton").addEventListener("click", async () => {
    const text = termInput.value;
    termInput.value = "";
    await sendTerminalKeys(text.length ? [text, "Enter"] : ["Enter"]);
    termInput.focus();
  });

  document.querySelectorAll("#terminalInput .key-btn[data-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.key;
      const text = termInput.value;
      if (text && (key === "Tab")) {
        termInput.value = "";
        await sendTerminalKeys([text, "Tab"]);
      } else {
        await sendTerminalKeys([key]);
      }
      termInput.focus();
    });
  });

  $("attachButton").addEventListener("click", copyAttachCommand);
  $("copyLogsButton").addEventListener("click", copyCurrentTabLogs);
  $("copyAllLogsButton").addEventListener("click", copyAllTabsLogs);
  $("clearLogsButton").addEventListener("click", clearCurrentTabLogs);
  $("refreshLogsButton").addEventListener("click", () => {
    state.lastTabContent = "";
    refreshActiveTabContent({ force: true });
  });

  window.pier.onProjectsChanged(refreshProjects);
  hydrateIcons();
}

try { state.collapsed = localStorage.getItem("pier:collapsed") === "1"; } catch {}
applyCollapsed();
wireEvents();
refreshProjects();

function pollTick() {
  refreshActiveTabContent();
  const interval = isTerminalTabActive() ? 600 : 2000;
  state.logTimer = setTimeout(pollTick, interval);
}
pollTick();

// Status poll runs independently of the log poll so external changes
// (CLI start/stop, services dying, agents editing config) reflect within
// a few seconds even when the user isn't clicking around.
setInterval(pollProjectStatus, 3000);
