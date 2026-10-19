(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  let currentState = null;
  let allLogs = [];
  let activeLogFilter = "all";
  let autoScroll = true;
  let isConfigOpen = false;
  let isConfigDirty = false;
  let editingProfileId = null;
  let lastLogsKey = "";
  let lastBreakpointsKey = "";
  let lastDiagKey = "";

  const els = {
    noWorkspaceCard: document.getElementById("no-workspace-card"),
    configErrorBanner: document.getElementById("config-error-banner"),
    configErrorText: document.getElementById("config-error-text"),
    btnOpenConfigRaw: document.getElementById("btn-open-config-raw"),
    notificationBanner: document.getElementById("notification-banner"),
    notificationText: document.getElementById("notification-text"),
    btnDismissNotification: document.getElementById("btn-dismiss-notification"),
    mainContent: document.getElementById("dashboard-main-content"),

    // Header
    headerProjectName: document.getElementById("header-project-name"),
    headerProjectPath: document.getElementById("header-project-path"),
    btnRefresh: document.getElementById("btn-refresh"),
    btnSettings: document.getElementById("btn-settings"),

    // Profile Card
    profilePersistenceBadge: document.getElementById("profile-persistence-badge"),
    profilePersistenceText: document.getElementById("profile-persistence-text"),
    profileSelect: document.getElementById("profile-select"),
    btnSelectProfile: document.getElementById("btn-select-profile"),
    btnCheckEnv: document.getElementById("btn-check-env"),
    btnSetEnv: document.getElementById("btn-set-env"),
    btnEditConfig: document.getElementById("btn-edit-config"),
    profJavaVersion: document.getElementById("prof-java-version"),
    profJavaPath: document.getElementById("prof-java-path"),
    profJavaExists: document.getElementById("prof-java-exists"),
    profGradleVersion: document.getElementById("prof-gradle-version"),
    profGradlePath: document.getElementById("prof-gradle-path"),
    profGradleExists: document.getElementById("prof-gradle-exists"),
    profNodeVersion: document.getElementById("prof-node-version"),
    profNodePath: document.getElementById("prof-node-path"),
    profNodeExists: document.getElementById("prof-node-exists"),

    // Quick Actions
    btnRunAll: document.getElementById("btn-run-all"),
    btnQaRunBackend: document.getElementById("btn-qa-run-backend"),
    btnQaRunFrontend: document.getElementById("btn-qa-run-frontend"),
    btnBuildProject: document.getElementById("btn-build-project"),
    btnDebugAll: document.getElementById("btn-debug-all"),
    btnStopAll: document.getElementById("btn-stop-all"),
    btnRestartAll: document.getElementById("btn-restart-all"),
    buildStatusBadge: document.getElementById("build-status-badge"),
    buildStatusText: document.getElementById("build-status-text"),
    buildCommandLabel: document.getElementById("build-command-label"),
    buildSummaryText: document.getElementById("build-summary-text"),
    btnOpenBuildTerminal: document.getElementById("btn-open-build-terminal"),

    // Backend Process Card
    backendStatusBadge: document.getElementById("backend-status-badge"),
    backendStatusText: document.getElementById("backend-status-text"),
    backendCwd: document.getElementById("backend-cwd"),
    backendCmd: document.getElementById("backend-cmd"),
    backendProfile: document.getElementById("backend-profile"),
    backendStartTime: document.getElementById("backend-start-time"),
    backendSummary: document.getElementById("backend-summary"),
    btnBackendRun: document.getElementById("btn-backend-run"),
    btnBackendDebug: document.getElementById("btn-backend-debug"),
    btnBackendStop: document.getElementById("btn-backend-stop"),
    btnBackendRestart: document.getElementById("btn-backend-restart"),
    btnBackendTerminal: document.getElementById("btn-backend-terminal"),

    // Frontend Process Card
    frontendStatusBadge: document.getElementById("frontend-status-badge"),
    frontendStatusText: document.getElementById("frontend-status-text"),
    frontendCwd: document.getElementById("frontend-cwd"),
    frontendCmd: document.getElementById("frontend-cmd"),
    frontendProfile: document.getElementById("frontend-profile"),
    frontendStartTime: document.getElementById("frontend-start-time"),
    frontendSummary: document.getElementById("frontend-summary"),
    btnFrontendRun: document.getElementById("btn-frontend-run"),
    btnFrontendDebug: document.getElementById("btn-frontend-debug"),
    btnFrontendStop: document.getElementById("btn-frontend-stop"),
    btnFrontendRestart: document.getElementById("btn-frontend-restart"),
    btnFrontendTerminal: document.getElementById("btn-frontend-terminal"),

    // Debug Manager Elements
    btnSyncLaunchJson: document.getElementById("btn-sync-launch-json"),
    btnDebugAllSec: document.getElementById("btn-debug-all-sec"),
    badgeBackendDebug: document.getElementById("badge-backend-debug"),
    badgeBackendDebugText: document.getElementById("badge-backend-debug-text"),
    badgeBackendAttached: document.getElementById("badge-backend-attached"),
    badgeBackendAttachedText: document.getElementById("badge-backend-attached-text"),
    debugMetaJdwpPort: document.getElementById("debug-meta-jdwp-port"),
    debugMetaServerPort: document.getElementById("debug-meta-server-port"),
    debugMetaSpringProfile: document.getElementById("debug-meta-spring-profile"),
    debugMetaJdwpMode: document.getElementById("debug-meta-jdwp-mode"),
    milestoneJdwp: document.getElementById("milestone-jdwp"),
    milestoneJdwpText: document.getElementById("milestone-jdwp-text"),
    milestoneServer: document.getElementById("milestone-server"),
    milestoneServerText: document.getElementById("milestone-server-text"),
    milestoneReady: document.getElementById("milestone-ready"),
    milestoneReadyText: document.getElementById("milestone-ready-text"),
    btnDbgStartBackend: document.getElementById("btn-dbg-start-backend"),
    btnDbgAttachBackend: document.getElementById("btn-dbg-attach-backend"),
    btnDbgOpenBackendUrl: document.getElementById("btn-dbg-open-backend-url"),

    badgeFrontendDebug: document.getElementById("badge-frontend-debug"),
    badgeFrontendDebugText: document.getElementById("badge-frontend-debug-text"),
    badgeFrontendAttached: document.getElementById("badge-frontend-attached"),
    badgeFrontendAttachedText: document.getElementById("badge-frontend-attached-text"),
    debugMetaFrontendUrl: document.getElementById("debug-meta-frontend-url"),
    debugMetaBrowserType: document.getElementById("debug-meta-browser-type"),
    btnDbgStartFrontend: document.getElementById("btn-dbg-start-frontend"),
    btnDbgAttachFrontend: document.getElementById("btn-dbg-attach-frontend"),
    btnDbgOpenFrontendUrl: document.getElementById("btn-dbg-open-frontend-url"),

    // Breakpoints
    breakpointsCountBadge: document.getElementById("breakpoints-count-badge"),
    btnClearBreakpoints: document.getElementById("btn-clear-breakpoints"),
    breakpointsTableContainer: document.getElementById("breakpoints-table-container"),

    // Diagnostics
    diagSubtitle: document.getElementById("diag-subtitle"),
    btnCheckAgain: document.getElementById("btn-check-again"),
    btnCheckAgainText: document.getElementById("btn-check-again-text"),
    diagnosticsGrid: document.getElementById("diagnostics-grid"),

    // Live Logs
    filterTabs: document.querySelectorAll(".filter-tab"),
    chkAutoscroll: document.getElementById("chk-autoscroll"),
    btnCopyLogs: document.getElementById("btn-copy-logs"),
    btnClearLogs: document.getElementById("btn-clear-logs"),
    logsViewport: document.getElementById("logs-viewport"),

    // Configuration Panel
    btnToggleConfigPanel: document.getElementById("btn-toggle-config-panel"),
    configPanelBody: document.getElementById("config-panel-body"),
    configFeedbackBanner: document.getElementById("config-feedback-banner"),
    cfgProjectName: document.getElementById("cfg-project-name"),
    cfgProjectRoot: document.getElementById("cfg-project-root"),
    btnCfgAutoDetect: document.getElementById("btn-cfg-auto-detect"),
    cfgActiveProfile: document.getElementById("cfg-active-profile"),
    cfgEditProfileId: document.getElementById("cfg-edit-profile-id"),
    cfgJavaHome: document.getElementById("cfg-java-home"),
    cfgGradleHome: document.getElementById("cfg-gradle-home"),
    cfgNodeHome: document.getElementById("cfg-node-home"),
    cfgProfileEnv: document.getElementById("cfg-profile-env"),
    cfgBackendProfileTag: document.getElementById("cfg-backend-profile-tag"),
    cfgBackendCwd: document.getElementById("cfg-backend-cwd"),
    cfgBackendCmd: document.getElementById("cfg-backend-cmd"),
    cfgBackendArgs: document.getElementById("cfg-backend-args"),
    cfgBackendArgsHint: document.getElementById("cfg-backend-args-hint"),
    cfgBackendDebugPort: document.getElementById("cfg-backend-debug-port"),
    cfgBackendServerPort: document.getElementById("cfg-backend-server-port"),
    cfgBackendSpringProfile: document.getElementById("cfg-backend-spring-profile"),
    cfgBackendJdwpMode: document.getElementById("cfg-backend-jdwp-mode"),
    cfgBackendJvmSuspend: document.getElementById("cfg-backend-jvm-suspend"),
    cfgBackendAutoAttach: document.getElementById("cfg-backend-auto-attach"),
    cfgFrontendCwd: document.getElementById("cfg-frontend-cwd"),
    cfgFrontendCmd: document.getElementById("cfg-frontend-cmd"),
    cfgFrontendArgs: document.getElementById("cfg-frontend-args"),
    cfgFrontendDevUrl: document.getElementById("cfg-frontend-dev-url"),
    cfgFrontendBrowserType: document.getElementById("cfg-frontend-browser-type"),
    cfgFrontendWebRoot: document.getElementById("cfg-frontend-web-root"),
    cfgFrontendBrowserExecutable: document.getElementById("cfg-frontend-browser-executable"),
    cfgFrontendUserDataDir: document.getElementById("cfg-frontend-user-data-dir"),
    cfgFrontendBrowserArgs: document.getElementById("cfg-frontend-browser-args"),
    cfgFrontendBrowserDebugPort: document.getElementById("cfg-frontend-browser-debug-port"),
    cfgBuildCwd: document.getElementById("cfg-build-cwd"),
    cfgBuildCmd: document.getElementById("cfg-build-cmd"),
    cfgBuildArgs: document.getElementById("cfg-build-args"),
    btnCfgCancel: document.getElementById("btn-cfg-cancel"),
    btnCfgSave: document.getElementById("btn-cfg-save"),
    btnCfgExport: document.getElementById("btn-cfg-export"),
    btnCfgImport: document.getElementById("btn-cfg-import"),
    btnCfgExportFoot: document.getElementById("btn-cfg-export-foot"),
    btnCfgImportFoot: document.getElementById("btn-cfg-import-foot")
  };

  function postCommand(command) {
    vscode.postMessage(command);
  }

  function showBanner(level, message, scope) {
    if (scope === "config" && els.configFeedbackBanner) {
      els.configFeedbackBanner.className = "banner banner-" + (level === "error" ? "error" : level === "warning" ? "warning" : "success");
      els.configFeedbackBanner.textContent = message;
      els.configFeedbackBanner.classList.remove("hidden");
      return;
    }
    if (!els.notificationBanner || !els.notificationText) return;
    els.notificationBanner.className =
      "banner banner-" +
      (level === "error" ? "error" : level === "warning" ? "warning" : level === "success" ? "success" : "info");
    els.notificationText.textContent = message;
    els.notificationBanner.classList.remove("hidden");
  }

  function hideBanner() {
    els.notificationBanner?.classList.add("hidden");
  }

  function setStatusBadge(badgeEl, textEl, status, labelOverride) {
    if (!badgeEl || !textEl) return;
    badgeEl.className = "badge badge-" + status;
    const labels = {
      running: "Running",
      stopped: "Stopped",
      starting: "Starting",
      stopping: "Stopping",
      error: "Error",
      passed: "Passed",
      failed: "Failed",
      warning: "Warning",
      checking: "Checking...",
      idle: "Idle",
      succeeded: "Succeeded"
    };
    textEl.textContent = labelOverride || labels[status] || status;
  }

  function renderProfileSection(state) {
    if (!state.profiles || state.profiles.length === 0) return;

    const currentSelectVal = els.profileSelect.value;
    els.profileSelect.innerHTML = "";
    for (const prof of state.profiles) {
      const opt = document.createElement("option");
      opt.value = prof.id;
      opt.textContent = prof.label + " (" + prof.id + ")";
      els.profileSelect.appendChild(opt);
    }

    els.profileSelect.value = state.activeProfileId || currentSelectVal;

    if (state.isProfileSessionOnly) {
      els.profilePersistenceBadge.className = "badge badge-session";
      els.profilePersistenceText.textContent =
        "Session Only (unsaved — config default: " + state.savedActiveProfileId + ")";
    } else {
      els.profilePersistenceBadge.className = "badge badge-saved";
      els.profilePersistenceText.textContent = "Saved in Config (" + state.savedActiveProfileId + ")";
    }

    updateDisplayedProfileDetails(state.activeProfileId);
  }

  function updateDisplayedProfileDetails(profileId) {
    if (!currentState || !currentState.profiles) return;
    const prof =
      currentState.profiles.find(p => p.id === profileId) ||
      currentState.selectedProfile ||
      currentState.profiles[0];
    if (!prof) return;

    // If diagnostics were run for this profile and passed/warned, show detected version alongside hint
    const diagForProfile =
      currentState.diagnostics && currentState.diagnostics.profileId === prof.id
        ? currentState.diagnostics.results
        : null;
    const javaDiag = diagForProfile?.find(d => d.id === "java" && d.status !== "idle" && d.status !== "checking");
    const gradleDiag = diagForProfile?.find(d => d.id === "gradle" && d.status !== "idle" && d.status !== "checking");
    const nodeDiag = diagForProfile?.find(d => d.id === "node" && d.status !== "idle" && d.status !== "checking");

    els.profJavaVersion.textContent =
      javaDiag && javaDiag.status === "passed"
        ? prof.javaVersionHint + " (" + javaDiag.detectedVersion + ")"
        : prof.javaVersionHint;
    els.profJavaPath.textContent = prof.javaHome || "Not configured";
    setPathExistsIndicator(els.profJavaExists, prof.javaHomeExists);

    els.profGradleVersion.textContent =
      gradleDiag && gradleDiag.status === "passed"
        ? prof.gradleVersionHint + " (" + gradleDiag.detectedVersion + ")"
        : prof.gradleVersionHint;
    els.profGradlePath.textContent = prof.gradleHome || "Not configured";
    setPathExistsIndicator(els.profGradleExists, prof.gradleHomeExists);

    els.profNodeVersion.textContent =
      nodeDiag && nodeDiag.status === "passed"
        ? prof.nodeVersionHint + " (" + nodeDiag.detectedVersion + ")"
        : prof.nodeVersionHint;
    els.profNodePath.textContent =
      prof.nodeHome || (prof.nodeVersion ? "nvm use " + prof.nodeVersion : "Not configured");
    if (prof.useNvm) {
      els.profNodeExists.className = "path-status path-exists";
      els.profNodeExists.textContent = "NVM Mode";
    } else {
      setPathExistsIndicator(els.profNodeExists, prof.nodeHomeExists);
    }
  }

  function setPathExistsIndicator(el, exists) {
    if (!el) return;
    if (exists) {
      el.className = "path-status path-exists";
      el.textContent = "Found";
    } else {
      el.className = "path-status path-missing";
      el.textContent = "Path not found";
    }
  }

  function renderProcessCard(prefix, procState) {
    const isRunningOrStarting = procState.status === "running" || procState.status === "starting";
    const isStopping = procState.status === "stopping";

    const badgeEl = prefix === "backend" ? els.backendStatusBadge : els.frontendStatusBadge;
    const textEl = prefix === "backend" ? els.backendStatusText : els.frontendStatusText;
    const cwdEl = prefix === "backend" ? els.backendCwd : els.frontendCwd;
    const cmdEl = prefix === "backend" ? els.backendCmd : els.frontendCmd;
    const profEl = prefix === "backend" ? els.backendProfile : els.frontendProfile;
    const timeEl = prefix === "backend" ? els.backendStartTime : els.frontendStartTime;
    const summaryEl = prefix === "backend" ? els.backendSummary : els.frontendSummary;
    const btnRun = prefix === "backend" ? els.btnBackendRun : els.btnFrontendRun;
    const btnStop = prefix === "backend" ? els.btnBackendStop : els.btnFrontendStop;
    const btnRestart = prefix === "backend" ? els.btnBackendRestart : els.btnFrontendRestart;

    setStatusBadge(badgeEl, textEl, procState.status);
    cwdEl.textContent = procState.resolvedWorkingDirectory || procState.workingDirectory;
    cmdEl.textContent = procState.formattedCommand;
    profEl.textContent = procState.activeProfileLabel + " (" + procState.activeProfileId + ")";

    let timeInfo = procState.lastStartTime ? "Started " + procState.lastStartTime : "Not started yet";
    if (procState.pid) {
      timeInfo += " • PID " + procState.pid;
    }
    if (procState.exitCode !== undefined && procState.exitCode !== null && !isRunningOrStarting) {
      timeInfo += " • Exit code: " + procState.exitCode;
    }
    timeEl.textContent = timeInfo;
    summaryEl.textContent = procState.latestSummary || "No output yet.";

    btnRun.disabled = isRunningOrStarting || isStopping;
    btnStop.disabled = !isRunningOrStarting || isStopping;
    btnRestart.disabled = isStopping;
  }

  function renderQuickActionsAndBuild(backend, frontend, build) {
    const backendActive = backend.status === "running" || backend.status === "starting";
    const frontendActive = frontend.status === "running" || frontend.status === "starting";
    const anyStopping = backend.status === "stopping" || frontend.status === "stopping";
    const buildRunning = build.status === "running";

    els.btnRunAll.disabled = (backendActive && frontendActive) || anyStopping;
    els.btnQaRunBackend.disabled = backendActive || backend.status === "stopping";
    els.btnQaRunFrontend.disabled = frontendActive || frontend.status === "stopping";
    els.btnStopAll.disabled = !backendActive && !frontendActive;
    els.btnRestartAll.disabled = anyStopping;
    els.btnBuildProject.disabled = buildRunning;

    const buildBadgeStyle =
      build.status === "running"
        ? "starting"
        : build.status === "succeeded"
          ? "passed"
          : build.status === "failed"
            ? "failed"
            : "idle";
    const buildBadgeLabel =
      build.status === "running"
        ? "Building..."
        : build.status === "succeeded"
          ? "Build Passed"
          : build.status === "failed"
            ? "Build Failed"
            : "Build Idle";

    setStatusBadge(els.buildStatusBadge, els.buildStatusText, buildBadgeStyle, buildBadgeLabel);
    els.buildCommandLabel.textContent = build.formattedCommand || "gradle build";
    els.buildSummaryText.textContent = build.latestSummary || "Ready to build.";
  }

  function renderDiagnostics(diagnostics) {
    if (!diagnostics) return;
    els.btnCheckAgain.disabled = Boolean(diagnostics.isChecking);
    els.btnCheckEnv.disabled = Boolean(diagnostics.isChecking);
    els.btnCheckAgainText.textContent = diagnostics.isChecking ? "Checking..." : "Check Again";

    if (diagnostics.lastCheckedAt && diagnostics.profileId) {
      els.diagSubtitle.textContent =
        "Profile: " + diagnostics.profileId + " • Last checked at " + diagnostics.lastCheckedAt;
    } else if (diagnostics.profileId) {
      els.diagSubtitle.textContent =
        "Profile: " + diagnostics.profileId + " • Click Check Environment to validate tools";
    } else {
      els.diagSubtitle.textContent = "Validate java, gradle, node, and npm using active profile";
    }

    els.diagnosticsGrid.innerHTML = "";
    for (const item of diagnostics.results || []) {
      const card = document.createElement("div");
      card.className = "diag-item";

      const header = document.createElement("div");
      header.className = "diag-item-header";

      const titleWrap = document.createElement("div");
      titleWrap.className = "diag-tool-title";
      titleWrap.textContent = item.toolName;

      const cmdSpan = document.createElement("span");
      cmdSpan.className = "diag-cmd-tag";
      cmdSpan.textContent = "(" + item.commandDisplay + ")";
      titleWrap.appendChild(cmdSpan);

      const badge = document.createElement("span");
      const badgeDot = document.createElement("span");
      badgeDot.className = "badge-dot";
      const badgeText = document.createElement("span");
      badge.appendChild(badgeDot);
      badge.appendChild(badgeText);

      const statusLabels = {
        passed: "Passed",
        failed: "Failed",
        warning: "Warning",
        checking: "Checking",
        idle: "Not Checked"
      };
      setStatusBadge(badge, badgeText, item.status, statusLabels[item.status] || item.status);

      header.appendChild(titleWrap);
      header.appendChild(badge);

      const versionDiv = document.createElement("div");
      versionDiv.className = "diag-version";
      versionDiv.textContent = item.detectedVersion || "—";

      const pathDiv = document.createElement("div");
      pathDiv.className = "diag-path";
      pathDiv.textContent = "Executable: " + (item.executablePath || "Unknown");

      card.appendChild(header);
      card.appendChild(versionDiv);
      card.appendChild(pathDiv);

      if (item.errorDetails) {
        const errDiv = document.createElement("div");
        errDiv.className = item.status === "warning" ? "diag-warning-note" : "diag-error";
        errDiv.textContent = item.errorDetails;
        card.appendChild(errDiv);
      }

      els.diagnosticsGrid.appendChild(card);
    }
  }

  function renderDebug(debug, rawConfig) {
    if (!debug) return;

    // Backend Debug State
    if (debug.backendDebugActive) {
      setStatusBadge(els.badgeBackendDebug, els.badgeBackendDebugText, "running", "Debug Active");
    } else {
      setStatusBadge(els.badgeBackendDebug, els.badgeBackendDebugText, "stopped", "Debug Inactive");
    }

    if (debug.backendAttached) {
      setStatusBadge(els.badgeBackendAttached, els.badgeBackendAttachedText, "passed", "Debugger Attached");
    } else {
      setStatusBadge(els.badgeBackendAttached, els.badgeBackendAttachedText, "idle", "Debugger Detached");
    }

    const beDebugPort = debug.backendDebugPort || rawConfig?.backend?.debugPort || 5005;
    const beServerPort = debug.backendServerPort || rawConfig?.backend?.serverPort || 8080;
    const beSpringProfile = rawConfig?.backend?.springProfile || "none";
    const beJdwpMode = rawConfig?.backend?.jdwpMode || "javaToolOptions";

    if (els.debugMetaJdwpPort) els.debugMetaJdwpPort.textContent = beDebugPort;
    if (els.debugMetaServerPort) els.debugMetaServerPort.textContent = beServerPort;
    if (els.debugMetaSpringProfile) els.debugMetaSpringProfile.textContent = beSpringProfile;
    if (els.debugMetaJdwpMode) els.debugMetaJdwpMode.textContent = beJdwpMode;

    // Backend Milestones
    const ms = debug.springBootMilestones || {};
    if (els.milestoneJdwp) {
      if (ms.jdwpListening) {
        els.milestoneJdwp.className = "milestone-pill milestone-active";
        els.milestoneJdwpText.textContent = "JDWP Listening (:" + (ms.jdwpPort || beDebugPort) + ")";
      } else {
        els.milestoneJdwp.className = "milestone-pill milestone-pending";
        els.milestoneJdwpText.textContent = "JDWP Listening (:" + beDebugPort + ")";
      }
    }

    if (els.milestoneServer) {
      if (ms.serverStarted) {
        els.milestoneServer.className = "milestone-pill milestone-active";
        els.milestoneServerText.textContent = "Tomcat/Netty (:" + (ms.serverPort || beServerPort) + ")";
      } else {
        els.milestoneServer.className = "milestone-pill milestone-pending";
        els.milestoneServerText.textContent = "Tomcat/Netty (:" + beServerPort + ")";
      }
    }

    if (els.milestoneReady) {
      if (ms.appReady) {
        els.milestoneReady.className = "milestone-pill milestone-active";
        els.milestoneReadyText.textContent =
          "Spring Boot Ready" + (ms.readyTimeSeconds ? " (" + ms.readyTimeSeconds + "s)" : "");
      } else {
        els.milestoneReady.className = "milestone-pill milestone-pending";
        els.milestoneReadyText.textContent = "Spring Boot Ready";
      }
    }

    // Frontend Debug State
    if (debug.frontendDebugActive) {
      setStatusBadge(els.badgeFrontendDebug, els.badgeFrontendDebugText, "running", "Debug Active");
    } else {
      setStatusBadge(els.badgeFrontendDebug, els.badgeFrontendDebugText, "stopped", "Debug Inactive");
    }

    if (debug.frontendAttached) {
      setStatusBadge(els.badgeFrontendAttached, els.badgeFrontendAttachedText, "passed", "Browser Attached");
    } else {
      setStatusBadge(els.badgeFrontendAttached, els.badgeFrontendAttachedText, "idle", "Browser Detached");
    }

    const feUrl = debug.frontendDevServerUrl || rawConfig?.frontend?.devServerUrl || "http://localhost:4200";
    const feBrowser =
      debug.browserType === "msedge" ? "Microsoft Edge (pwa-msedge)" : "Google Chrome (pwa-chrome)";
    if (els.debugMetaFrontendUrl) els.debugMetaFrontendUrl.textContent = feUrl;
    if (els.debugMetaBrowserType) els.debugMetaBrowserType.textContent = feBrowser;
  }

  function renderBreakpoints(breakpoints) {
    if (!els.breakpointsTableContainer) return;
    const bps = breakpoints || [];
    if (els.breakpointsCountBadge) {
      els.breakpointsCountBadge.textContent = bps.length;
    }

    if (bps.length === 0) {
      els.breakpointsTableContainer.innerHTML =
        '<div class="breakpoints-empty-msg">No breakpoints set. Click in editor gutters to place breakpoints and manage them here.</div>';
      return;
    }

    const table = document.createElement("table");
    table.className = "breakpoints-table";

    const thead = document.createElement("thead");
    thead.innerHTML =
      '<tr><th style="width: 32px; text-align: center;">On</th><th>Location</th><th>Condition</th><th style="width: 70px; text-align: right;">Action</th></tr>';
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const bp of bps) {
      const tr = document.createElement("tr");

      // Checkbox
      const tdCheck = document.createElement("td");
      tdCheck.style.textAlign = "center";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = Boolean(bp.enabled);
      chk.title = bp.enabled ? "Disable Breakpoint" : "Enable Breakpoint";
      chk.addEventListener("change", () => {
        postCommand({ type: "toggleBreakpoint", id: bp.id });
      });
      tdCheck.appendChild(chk);
      tr.appendChild(tdCheck);

      // File & Line
      const tdLoc = document.createElement("td");
      const link = document.createElement("span");
      link.className = "bp-file-link";
      link.textContent = bp.relativeFilePath + ":" + bp.line;
      link.title = bp.filePath + ":" + bp.line + " — Click to open in editor";
      link.addEventListener("click", () => {
        postCommand({ type: "jumpToBreakpoint", filePath: bp.filePath, line: bp.line });
      });
      tdLoc.appendChild(link);
      tr.appendChild(tdLoc);

      // Condition
      const tdCond = document.createElement("td");
      if (bp.condition || bp.hitCondition || bp.logMessage) {
        const condSpan = document.createElement("span");
        condSpan.className = "bp-condition";
        condSpan.textContent = bp.condition
          ? "expr: " + bp.condition
          : bp.hitCondition
            ? "hit: " + bp.hitCondition
            : "log: " + bp.logMessage;
        tdCond.appendChild(condSpan);
      } else {
        tdCond.textContent = "—";
        tdCond.style.color = "var(--dem-muted)";
      }
      tr.appendChild(tdCond);

      // Action (remove)
      const tdAct = document.createElement("td");
      tdAct.style.textAlign = "right";
      const btnRemove = document.createElement("button");
      btnRemove.className = "btn btn-secondary btn-sm";
      btnRemove.style.padding = "2px 6px";
      btnRemove.style.fontSize = "10px";
      btnRemove.textContent = "Remove";
      btnRemove.title = "Remove Breakpoint";
      btnRemove.addEventListener("click", () => {
        postCommand({ type: "removeBreakpoint", id: bp.id });
      });
      tdAct.appendChild(btnRemove);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    els.breakpointsTableContainer.innerHTML = "";
    els.breakpointsTableContainer.appendChild(table);
  }

  function renderLogs() {
    if (!els.logsViewport) return;
    const filtered =
      activeLogFilter === "all"
        ? allLogs
        : allLogs.filter(entry => entry.target === activeLogFilter);

    els.logsViewport.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "log-empty-state";
      empty.textContent =
        activeLogFilter === "all"
          ? "No process output captured yet. Start Backend, Frontend, or Build Project to view live stdout/stderr streams here."
          : "No logs captured for " + activeLogFilter.toUpperCase() + " yet.";
      els.logsViewport.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of filtered) {
      fragment.appendChild(createLogLineElement(entry));
    }
    els.logsViewport.appendChild(fragment);

    if (autoScroll) {
      els.logsViewport.scrollTop = els.logsViewport.scrollHeight;
    }
  }

  function createLogLineElement(entry) {
    const row = document.createElement("div");
    row.className = "log-line";

    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = entry.timestamp;

    const tag = document.createElement("span");
    tag.className = "log-tag log-tag-" + entry.target;
    tag.textContent = entry.target === "backend" ? "BE" : entry.target === "frontend" ? "FE" : "BUILD";

    const text = document.createElement("span");
    text.className = "log-stream-" + entry.stream;
    text.textContent = (entry.stream === "stderr" ? "[stderr] " : "") + entry.text;

    row.appendChild(time);
    row.appendChild(tag);
    row.appendChild(text);
    return row;
  }

  function appendSingleLogToDom(entry) {
    allLogs.push(entry);
    if (allLogs.length > 1000) {
      allLogs.splice(0, allLogs.length - 1000);
    }

    if (activeLogFilter !== "all" && entry.target !== activeLogFilter) {
      return;
    }

    const emptyEl = els.logsViewport.querySelector(".log-empty-state");
    if (emptyEl) {
      els.logsViewport.innerHTML = "";
    }

    els.logsViewport.appendChild(createLogLineElement(entry));
    while (els.logsViewport.childElementCount > 1000) {
      els.logsViewport.removeChild(els.logsViewport.firstElementChild);
    }

    if (autoScroll) {
      els.logsViewport.scrollTop = els.logsViewport.scrollHeight;
    }
  }

  function populateConfigForm(state, forceReset) {
    if (!state.rawConfig) return;
    if (isConfigDirty && !forceReset) return;

    const cfg = state.rawConfig;
    els.cfgProjectName.value = cfg.name || state.projectName || "";
    els.cfgProjectRoot.value = cfg.projectRoot || state.projectRoot || "";

    els.cfgActiveProfile.innerHTML = "";
    els.cfgEditProfileId.innerHTML = "";
    for (const [id, prof] of Object.entries(cfg.profiles || {})) {
      const optDefault = document.createElement("option");
      optDefault.value = id;
      optDefault.textContent = (prof.label || id) + " (" + id + ")";
      els.cfgActiveProfile.appendChild(optDefault);

      const optEdit = document.createElement("option");
      optEdit.value = id;
      optEdit.textContent = (prof.label || id) + " (" + id + ")";
      els.cfgEditProfileId.appendChild(optEdit);
    }

    els.cfgActiveProfile.value = cfg.activeProfile || state.savedActiveProfileId;
    editingProfileId = state.activeProfileId || cfg.activeProfile;
    els.cfgEditProfileId.value = editingProfileId;

    els.cfgBackendCwd.value = cfg.backend?.workingDirectory ?? ".";
    els.cfgBackendCmd.value = cfg.backend?.command ?? "gradle";
    els.cfgBackendArgs.value = (cfg.backend?.args || []).join(" ");
    if (els.cfgBackendDebugPort) els.cfgBackendDebugPort.value = cfg.backend?.debugPort ?? 5005;
    if (els.cfgBackendServerPort) els.cfgBackendServerPort.value = cfg.backend?.serverPort ?? 8080;
    if (els.cfgBackendSpringProfile) els.cfgBackendSpringProfile.value = cfg.backend?.springProfile ?? "dev";
    if (els.cfgBackendJdwpMode) els.cfgBackendJdwpMode.value = cfg.backend?.jdwpMode ?? "javaToolOptions";
    if (els.cfgBackendJvmSuspend) els.cfgBackendJvmSuspend.checked = Boolean(cfg.backend?.jvmSuspend);
    if (els.cfgBackendAutoAttach) els.cfgBackendAutoAttach.checked = cfg.backend?.autoAttachDebugger !== false;

    // Load profile-specific fields (Java, Gradle, Node, and profile-specific backendArgs)
    loadSelectedProfileIntoConfigInputs(editingProfileId);

    els.cfgFrontendCwd.value = cfg.frontend?.workingDirectory ?? "frontend";
    els.cfgFrontendCmd.value = cfg.frontend?.command ?? "npm";
    els.cfgFrontendArgs.value = (cfg.frontend?.args || []).join(" ");
    if (els.cfgFrontendDevUrl) els.cfgFrontendDevUrl.value = cfg.frontend?.devServerUrl ?? "http://localhost:4200";
    if (els.cfgFrontendBrowserType) els.cfgFrontendBrowserType.value = cfg.frontend?.browserType ?? "chrome";
    if (els.cfgFrontendWebRoot) els.cfgFrontendWebRoot.value = cfg.frontend?.webRoot ?? "${workspaceFolder}/frontend";
    if (els.cfgFrontendBrowserExecutable) els.cfgFrontendBrowserExecutable.value = cfg.frontend?.browserExecutable ?? "";
    if (els.cfgFrontendUserDataDir) els.cfgFrontendUserDataDir.value = cfg.frontend?.userDataDir ?? "";
    if (els.cfgFrontendBrowserArgs) els.cfgFrontendBrowserArgs.value = (cfg.frontend?.browserArgs || []).join(" ");
    if (els.cfgFrontendBrowserDebugPort) els.cfgFrontendBrowserDebugPort.value = cfg.frontend?.browserDebugPort ?? 9222;

    els.cfgBuildCwd.value = cfg.build?.workingDirectory ?? ".";
    els.cfgBuildCmd.value = cfg.build?.command ?? "gradle";
    els.cfgBuildArgs.value = (cfg.build?.args || ["clean", "root:bootwar"]).join(" ");

    isConfigDirty = false;
    els.configFeedbackBanner?.classList.add("hidden");
  }

  function isJava8Profile(profileId, prof) {
    const combined = `${profileId || ""} ${prof?.label || ""} ${prof?.javaHome || ""}`.toLowerCase();
    return (
      combined.includes("java8") ||
      combined.includes("java 8") ||
      combined.includes("java-8") ||
      combined.includes("jdk8") ||
      combined.includes("jdk-8") ||
      combined.includes("1.8") ||
      combined.includes("jdk1.8")
    );
  }

  function getEffectiveBackendArgsForProfile(profileId, prof) {
    const isJ8 = isJava8Profile(profileId, prof);
    if (prof && Array.isArray(prof.backendArgs) && prof.backendArgs.length > 0) {
      const joined = prof.backendArgs.join(" ");
      if (isJ8 && (joined === "root:bootRun" || joined === "bootRun")) {
        return "run";
      }
      if (!isJ8 && joined === "run") {
        return "root:bootRun";
      }
      return joined;
    }
    return isJ8 ? "run" : "root:bootRun";
  }

  function loadSelectedProfileIntoConfigInputs(profileId) {
    if (!currentState || !currentState.rawConfig || !currentState.rawConfig.profiles) return;
    const prof = currentState.rawConfig.profiles[profileId];
    if (!prof) return;
    els.cfgJavaHome.value = prof.javaHome || "";
    els.cfgGradleHome.value = prof.gradleHome || "";
    els.cfgNodeHome.value = prof.nodeVersion ? `nvm use ${prof.nodeVersion}` : (prof.nodeHome || "");
    const profArgs = getEffectiveBackendArgsForProfile(profileId, prof);
    if (els.cfgBackendArgs) {
      els.cfgBackendArgs.value = profArgs;
    }
    if (els.cfgBackendProfileTag) {
      els.cfgBackendProfileTag.textContent = `cho profile [${profileId}]`;
    }
    if (els.cfgBackendArgsHint) {
      els.cfgBackendArgsHint.textContent = `⚡ Tự động áp dụng lệnh cho [${profileId}]: gradle ${profArgs}`;
    }
    if (els.cfgProfileEnv) {
      if (prof.env && typeof prof.env === "object") {
        els.cfgProfileEnv.value = Object.entries(prof.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n");
      } else {
        els.cfgProfileEnv.value = "";
      }
    }
  }

  function toggleConfigPanel(forceOpen) {
    isConfigOpen = typeof forceOpen === "boolean" ? forceOpen : !isConfigOpen;
    if (isConfigOpen) {
      els.configPanelBody.classList.remove("hidden");
      els.btnToggleConfigPanel.textContent = "Collapse";
    } else {
      els.configPanelBody.classList.add("hidden");
      els.btnToggleConfigPanel.textContent = "Expand";
    }
  }

  function splitArgs(str) {
    const trimmed = (str || "").trim();
    if (!trimmed) return [];
    const matches = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    return matches.map(token => token.replace(/^"(.*)"$/, "$1"));
  }

  function handleSaveConfiguration() {
    if (!currentState || !currentState.rawConfig) return;
    const editedId = els.cfgEditProfileId.value;
    const existingProf = currentState.rawConfig.profiles[editedId] || {};

    const rawNode = els.cfgNodeHome.value.trim();
    let nodeHome = rawNode || undefined;
    let nodeVersion = existingProf.nodeVersion;

    if (rawNode.toLowerCase().startsWith("nvm use ")) {
      nodeVersion = rawNode.replace(/^nvm use\s+/i, "").trim().replace(/^v/i, "");
      nodeHome = undefined;
    } else if (rawNode.toLowerCase() === "nvm" || !rawNode) {
      nodeHome = undefined;
    }

    const envLines = (els.cfgProfileEnv?.value || "").split(/\r?\n/);
    const parsedEnv = {};
    for (const line of envLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        if (k) parsedEnv[k] = v;
      }
    }

    const payload = {
      name: els.cfgProjectName.value.trim(),
      projectRoot: els.cfgProjectRoot.value.trim(),
      activeProfile: els.cfgActiveProfile.value,
      editedProfileId: editedId,
      editedProfile: {
        label: existingProf.label,
        javaHome: els.cfgJavaHome.value.trim(),
        gradleHome: els.cfgGradleHome.value.trim(),
        nodeHome: nodeHome,
        nodeVersion: nodeVersion,
        backendArgs: els.cfgBackendArgs?.value.trim() ? splitArgs(els.cfgBackendArgs.value) : undefined,
        env: Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined
      },
      backend: {
        workingDirectory: els.cfgBackendCwd.value.trim(),
        command: els.cfgBackendCmd.value.trim(),
        args: splitArgs(els.cfgBackendArgs.value),
        terminalName: currentState.rawConfig.backend?.terminalName || "DEM: Backend",
        debugPort: parseInt(els.cfgBackendDebugPort?.value, 10) || 5005,
        serverPort: parseInt(els.cfgBackendServerPort?.value, 10) || 8080,
        springProfile: els.cfgBackendSpringProfile?.value.trim() || undefined,
        jdwpMode: els.cfgBackendJdwpMode?.value || "javaToolOptions",
        jvmSuspend: Boolean(els.cfgBackendJvmSuspend?.checked),
        autoAttachDebugger: Boolean(els.cfgBackendAutoAttach?.checked)
      },
      frontend: {
        workingDirectory: els.cfgFrontendCwd.value.trim(),
        command: els.cfgFrontendCmd.value.trim(),
        args: splitArgs(els.cfgFrontendArgs.value),
        terminalName: currentState.rawConfig.frontend?.terminalName || "DEM: Frontend",
        devServerUrl: els.cfgFrontendDevUrl?.value.trim() || "http://localhost:4200",
        browserType: els.cfgFrontendBrowserType?.value || "chrome",
        webRoot: els.cfgFrontendWebRoot?.value.trim() || "${workspaceFolder}/frontend",
        browserExecutable: els.cfgFrontendBrowserExecutable?.value.trim() || undefined,
        userDataDir: els.cfgFrontendUserDataDir?.value.trim() || undefined,
        browserArgs: splitArgs(els.cfgFrontendBrowserArgs?.value),
        browserDebugPort: parseInt(els.cfgFrontendBrowserDebugPort?.value, 10) || 9222
      },
      build: {
        workingDirectory: els.cfgBuildCwd.value.trim(),
        command: els.cfgBuildCmd.value.trim(),
        args: splitArgs(els.cfgBuildArgs.value)
      }
    };

    if (
      !payload.projectRoot ||
      !payload.editedProfile.javaHome ||
      !payload.editedProfile.gradleHome ||
      (!payload.editedProfile.nodeHome && !payload.editedProfile.nodeVersion) ||
      !payload.backend.workingDirectory ||
      !payload.backend.command ||
      !payload.frontend.workingDirectory ||
      !payload.frontend.command ||
      !payload.build.workingDirectory ||
      !payload.build.command
    ) {
      showBanner("error", "All path, working directory, and command fields are required.", "config");
      return;
    }

    postCommand({
      type: "saveConfiguration",
      configuration: payload
    });
  }

  function renderFullState(state) {
    currentState = state;

    els.headerProjectName.textContent = state.projectName || state.workspaceName || "No Project Open";
    els.headerProjectPath.textContent = state.resolvedProjectRoot || state.workspaceRootPath || "Open a workspace folder in VS Code";

    if (!state.hasWorkspace) {
      els.noWorkspaceCard.classList.remove("hidden");
      els.mainContent.classList.add("hidden");
      els.configErrorBanner.classList.add("hidden");
      return;
    }

    els.noWorkspaceCard.classList.add("hidden");
    els.mainContent.classList.remove("hidden");

    if (state.configError) {
      els.configErrorText.textContent = state.configError;
      els.configErrorBanner.classList.remove("hidden");
    } else {
      els.configErrorBanner.classList.add("hidden");
    }

    renderProfileSection(state);
    renderProcessCard("backend", state.backend);
    renderProcessCard("frontend", state.frontend);
    renderQuickActionsAndBuild(state.backend, state.frontend, state.build);
    renderDebug(state.debug, state.rawConfig);

    const bpKey = (state.breakpoints || []).map(b => `${b.id}:${b.enabled}`).join(";");
    if (bpKey !== lastBreakpointsKey) {
      lastBreakpointsKey = bpKey;
      renderBreakpoints(state.breakpoints);
    }

    const diagKey = (state.diagnostics?.results || [])
      .map(r => `${r.toolId}:${r.status}:${r.detectedVersion}`)
      .join(";");
    if (diagKey !== lastDiagKey) {
      lastDiagKey = diagKey;
      renderDiagnostics(state.diagnostics);
    }

    if (Array.isArray(state.logs)) {
      const logsKey = `${state.logs.length}:${state.logs[state.logs.length - 1]?.id ?? ""}`;
      if (logsKey !== lastLogsKey) {
        lastLogsKey = logsKey;
        allLogs = state.logs;
        renderLogs();
      }
    }

    populateConfigForm(state, false);
  }

  // Event Listeners
  els.btnRefresh?.addEventListener("click", () => {
    postCommand({ type: "refreshState" });
  });

  els.btnSettings?.addEventListener("click", () => {
    toggleConfigPanel(true);
    document.getElementById("config-card")?.scrollIntoView({ behavior: "smooth" });
  });

  els.btnOpenConfigRaw?.addEventListener("click", () => {
    postCommand({ type: "openConfigFile" });
  });

  els.btnDismissNotification?.addEventListener("click", hideBanner);

  els.profileSelect?.addEventListener("change", () => {
    const selectedId = els.profileSelect.value;
    updateDisplayedProfileDetails(selectedId);
    postCommand({ type: "selectProfile", profileId: selectedId });
  });

  els.btnSelectProfile?.addEventListener("click", () => {
    const selectedId = els.profileSelect.value;
    if (selectedId) {
      postCommand({ type: "selectProfile", profileId: selectedId });
    }
  });

  els.btnCheckEnv?.addEventListener("click", () => {
    postCommand({ type: "checkEnvironment" });
  });

  els.btnSetEnv?.addEventListener("click", () => {
    toggleConfigPanel(true);
    if (els.cfgEditProfileId && els.profileSelect.value) {
      els.cfgEditProfileId.value = els.profileSelect.value;
      editingProfileId = els.profileSelect.value;
      loadSelectedProfileIntoConfigInputs(els.profileSelect.value);
    }
    els.cfgProfileEnv?.focus();
    els.cfgProfileEnv?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  els.btnEditConfig?.addEventListener("click", () => {
    toggleConfigPanel(true);
    if (els.cfgEditProfileId && els.profileSelect.value) {
      els.cfgEditProfileId.value = els.profileSelect.value;
      loadSelectedProfileIntoConfigInputs(els.profileSelect.value);
    }
    document.getElementById("config-card")?.scrollIntoView({ behavior: "smooth" });
  });

  // Quick Actions
  els.btnRunAll?.addEventListener("click", () => postCommand({ type: "runAll" }));
  els.btnDebugAll?.addEventListener("click", () => postCommand({ type: "debugAll" }));
  els.btnQaRunBackend?.addEventListener("click", () => postCommand({ type: "runBackend" }));
  els.btnQaRunFrontend?.addEventListener("click", () => postCommand({ type: "runFrontend" }));
  els.btnBuildProject?.addEventListener("click", () => postCommand({ type: "buildProject" }));
  els.btnStopAll?.addEventListener("click", () => postCommand({ type: "stopAll" }));
  els.btnRestartAll?.addEventListener("click", () => postCommand({ type: "restartAll" }));
  els.btnOpenBuildTerminal?.addEventListener("click", () =>
    postCommand({ type: "openTerminal", target: "build" })
  );

  // Process Card Actions
  els.btnBackendRun?.addEventListener("click", () => postCommand({ type: "runBackend" }));
  els.btnBackendDebug?.addEventListener("click", () => postCommand({ type: "debugBackend" }));
  els.btnBackendStop?.addEventListener("click", () => postCommand({ type: "stopBackend" }));
  els.btnBackendRestart?.addEventListener("click", () => postCommand({ type: "restartBackend" }));
  els.btnBackendTerminal?.addEventListener("click", () =>
    postCommand({ type: "openTerminal", target: "backend" })
  );

  els.btnFrontendRun?.addEventListener("click", () => postCommand({ type: "runFrontend" }));
  els.btnFrontendDebug?.addEventListener("click", () => postCommand({ type: "debugFrontend" }));
  els.btnFrontendStop?.addEventListener("click", () => postCommand({ type: "stopFrontend" }));
  els.btnFrontendRestart?.addEventListener("click", () => postCommand({ type: "restartFrontend" }));
  els.btnFrontendTerminal?.addEventListener("click", () =>
    postCommand({ type: "openTerminal", target: "frontend" })
  );

  // Debug Manager Actions
  els.btnSyncLaunchJson?.addEventListener("click", () => postCommand({ type: "syncLaunchJson" }));
  els.btnDebugAllSec?.addEventListener("click", () => postCommand({ type: "debugAll" }));
  els.btnDbgStartBackend?.addEventListener("click", () => postCommand({ type: "debugBackend" }));
  els.btnDbgAttachBackend?.addEventListener("click", () => postCommand({ type: "attachSpringBoot" }));
  els.btnDbgOpenBackendUrl?.addEventListener("click", () => {
    const port =
      currentState?.debug?.backendServerPort ||
      currentState?.rawConfig?.backend?.serverPort ||
      8080;
    postCommand({ type: "openUrl", url: "http://localhost:" + port });
  });

  els.btnDbgStartFrontend?.addEventListener("click", () => postCommand({ type: "debugFrontend" }));
  els.btnDbgAttachFrontend?.addEventListener("click", () => postCommand({ type: "attachFrontend" }));
  els.btnDbgOpenFrontendUrl?.addEventListener("click", () => {
    const url =
      currentState?.debug?.frontendDevServerUrl ||
      currentState?.rawConfig?.frontend?.devServerUrl ||
      "http://localhost:4200";
    postCommand({ type: "openUrl", url });
  });

  els.btnClearBreakpoints?.addEventListener("click", () =>
    postCommand({ type: "clearAllBreakpoints" })
  );

  // Diagnostics
  els.btnCheckAgain?.addEventListener("click", () => postCommand({ type: "checkEnvironment" }));

  // Logs
  els.filterTabs.forEach(btn => {
    btn.addEventListener("click", () => {
      els.filterTabs.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeLogFilter = btn.getAttribute("data-filter") || "all";
      renderLogs();
    });
  });

  els.chkAutoscroll?.addEventListener("change", () => {
    autoScroll = Boolean(els.chkAutoscroll.checked);
    if (autoScroll && els.logsViewport) {
      els.logsViewport.scrollTop = els.logsViewport.scrollHeight;
    }
  });

  els.btnCopyLogs?.addEventListener("click", () => {
    postCommand({ type: "copyLogs", target: activeLogFilter });
  });

  els.btnClearLogs?.addEventListener("click", () => {
    postCommand({ type: "clearLogs" });
  });

  // Configuration Panel
  els.btnToggleConfigPanel?.addEventListener("click", () => toggleConfigPanel());

  els.btnCfgAutoDetect?.addEventListener("click", () => {
    if (currentState && currentState.workspaceRootPath) {
      els.cfgProjectRoot.value = currentState.workspaceRootPath;
      if (
        currentState.workspaceName &&
        (!els.cfgProjectName.value || els.cfgProjectName.value === "CCC")
      ) {
        els.cfgProjectName.value = currentState.workspaceName;
      }
      isConfigDirty = false;
      postCommand({ type: "autoSyncProjectRoot" });
    }
  });

  els.cfgActiveProfile?.addEventListener("change", () => {
    const chosen = els.cfgActiveProfile.value;
    if (els.cfgEditProfileId) {
      els.cfgEditProfileId.value = chosen;
    }
    editingProfileId = chosen;
    loadSelectedProfileIntoConfigInputs(chosen);
  });

  els.cfgEditProfileId?.addEventListener("change", () => {
    editingProfileId = els.cfgEditProfileId.value;
    loadSelectedProfileIntoConfigInputs(editingProfileId);
  });

  els.cfgBackendArgs?.addEventListener("input", () => {
    if (els.cfgBackendArgsHint) {
      els.cfgBackendArgsHint.textContent = `⚡ Profile [${editingProfileId}] sẽ lưu lệnh: gradle ${els.cfgBackendArgs.value}`;
    }
  });

  const configInputs = [
    els.cfgProjectName,
    els.cfgProjectRoot,
    els.cfgActiveProfile,
    els.cfgJavaHome,
    els.cfgGradleHome,
    els.cfgNodeHome,
    els.cfgProfileEnv,
    els.cfgBackendCwd,
    els.cfgBackendCmd,
    els.cfgBackendArgs,
    els.cfgBackendDebugPort,
    els.cfgBackendServerPort,
    els.cfgBackendSpringProfile,
    els.cfgBackendJdwpMode,
    els.cfgBackendJvmSuspend,
    els.cfgBackendAutoAttach,
    els.cfgFrontendCwd,
    els.cfgFrontendCmd,
    els.cfgFrontendArgs,
    els.cfgFrontendDevUrl,
    els.cfgFrontendBrowserType,
    els.cfgFrontendWebRoot,
    els.cfgFrontendBrowserExecutable,
    els.cfgFrontendUserDataDir,
    els.cfgFrontendBrowserArgs,
    els.cfgFrontendBrowserDebugPort,
    els.cfgBuildCwd,
    els.cfgBuildCmd,
    els.cfgBuildArgs
  ];
  configInputs.forEach(input => {
    input?.addEventListener("input", () => {
      isConfigDirty = true;
    });
    input?.addEventListener("change", () => {
      isConfigDirty = true;
    });
  });

  els.btnCfgCancel?.addEventListener("click", () => {
    if (currentState) {
      populateConfigForm(currentState, true);
      showBanner("info", "Unsaved configuration changes discarded.", "config");
    }
  });

  els.btnCfgSave?.addEventListener("click", handleSaveConfiguration);

  els.btnCfgExport?.addEventListener("click", () => postCommand({ type: "exportConfiguration" }));
  els.btnCfgImport?.addEventListener("click", () => postCommand({ type: "importConfiguration" }));
  els.btnCfgExportFoot?.addEventListener("click", () => postCommand({ type: "exportConfiguration" }));
  els.btnCfgImportFoot?.addEventListener("click", () => postCommand({ type: "importConfiguration" }));

  // Message Listener from Extension
  window.addEventListener("message", event => {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") return;

    switch (msg.type) {
      case "stateUpdated":
        if (msg.state) {
          isConfigDirty = false;
          renderFullState(msg.state);
        }
        break;
      case "processUpdated":
        if (currentState) {
          currentState.backend = msg.backend;
          currentState.frontend = msg.frontend;
          currentState.build = msg.build;
          renderProcessCard("backend", msg.backend);
          renderProcessCard("frontend", msg.frontend);
          renderQuickActionsAndBuild(msg.backend, msg.frontend, msg.build);
        }
        break;
      case "debugUpdated":
        if (currentState) {
          currentState.debug = msg.debug;
          renderDebug(msg.debug, currentState.rawConfig);
        }
        break;
      case "breakpointsUpdated":
        if (currentState) {
          currentState.breakpoints = msg.breakpoints;
          renderBreakpoints(msg.breakpoints);
        }
        break;
      case "diagnosticsUpdated":
        if (currentState) {
          currentState.diagnostics = msg.diagnostics;
          renderDiagnostics(msg.diagnostics);
          updateDisplayedProfileDetails(els.profileSelect.value);
        }
        break;
      case "logAppended":
        if (msg.entry) {
          appendSingleLogToDom(msg.entry);
        }
        break;
      case "logsSnapshot":
        if (Array.isArray(msg.logs)) {
          allLogs = msg.logs;
          renderLogs();
        }
        break;
      case "logsCleared":
        allLogs = [];
        renderLogs();
        break;
      case "notification":
        showBanner(msg.level, msg.message, msg.scope);
        break;
    }
  });

  // Request initial state on startup
  postCommand({ type: "getInitialState" });
})();

