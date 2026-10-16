import * as vscode from "vscode";
import * as crypto from "node:crypto";

export function createNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

export function buildDashboardHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const nonce = createNonce();
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "dashboard.css")
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media", "dashboard.js")
  );

  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${webview.cspSource} data:`
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dev Environment Manager</title>
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div class="dashboard-container">
    <!-- A. HEADER -->
    <header class="dashboard-header" role="banner">
      <div class="header-brand">
        <div class="brand-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
            <polyline points="7 8 10 10 7 12"></polyline>
            <line x1="12" y1="12" x2="16" y2="12"></line>
          </svg>
        </div>
        <div class="brand-info">
          <p class="header-eyebrow">DEV ENVIRONMENT MANAGER</p>
          <h1 id="header-project-name" class="header-project-name">Loading project...</h1>
          <p id="header-project-path" class="header-project-path">—</p>
        </div>
      </div>
      <div class="header-actions">
        <button id="btn-refresh" class="btn btn-secondary btn-icon" title="Refresh configuration and process status" aria-label="Refresh Dashboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
        <button id="btn-settings" class="btn btn-secondary btn-icon" title="Open Configuration Settings" aria-label="Configuration Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>
    </header>

    <!-- Notification & Error Banners -->
    <div id="notification-banner" class="banner banner-info hidden" role="status">
      <span id="notification-text"></span>
      <button id="btn-dismiss-notification" class="btn btn-secondary btn-sm" aria-label="Dismiss notification">Dismiss</button>
    </div>

    <div id="config-error-banner" class="banner banner-error hidden" role="alert">
      <span id="config-error-text"></span>
      <button id="btn-open-config-raw" class="btn btn-secondary btn-sm">Open Config JSON</button>
    </div>

    <!-- Empty Workspace State -->
    <div id="no-workspace-card" class="card empty-workspace-card hidden">
      <h2 class="card-title" style="justify-content: center;">No Workspace Folder Open</h2>
      <p style="color: var(--dem-muted); margin: 4px 0 0 0;">
        Open a project folder in VS Code containing <code>.vscode/project-build-manager.json</code> to manage Java, Gradle, and Node.js environments.
      </p>
    </div>

    <main id="dashboard-main-content" class="dashboard-container" style="margin: 0; max-width: none;">
      <!-- B. ENVIRONMENT PROFILE CARD -->
      <section class="card" aria-labelledby="section-profile-title">
        <div class="card-header">
          <div class="card-title-group">
            <h2 id="section-profile-title" class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
              Environment Profile
            </h2>
          </div>
          <span id="profile-persistence-badge" class="badge badge-saved" title="Indicates whether the active profile is saved in .vscode/project-build-manager.json or only active for the current VS Code session">
            <span class="badge-dot"></span>
            <span id="profile-persistence-text">Saved in Config</span>
          </span>
        </div>

        <div class="profile-selector-row">
          <label for="profile-select" class="meta-label">Toolchain Profile:</label>
          <select id="profile-select" class="select-input" aria-label="Select Toolchain Profile"></select>
        </div>

        <div class="profile-details-grid">
          <div class="profile-tool-box">
            <div class="profile-tool-header">
              <span class="profile-tool-name">Java Runtime (JDK)</span>
              <span id="prof-java-exists" class="path-status path-exists">Found</span>
            </div>
            <div id="prof-java-version" class="profile-tool-version">—</div>
            <div id="prof-java-path" class="profile-tool-path">—</div>
          </div>

          <div class="profile-tool-box">
            <div class="profile-tool-header">
              <span class="profile-tool-name">Gradle Build Tool</span>
              <span id="prof-gradle-exists" class="path-status path-exists">Found</span>
            </div>
            <div id="prof-gradle-version" class="profile-tool-version">—</div>
            <div id="prof-gradle-path" class="profile-tool-path">—</div>
          </div>

          <div class="profile-tool-box">
            <div class="profile-tool-header">
              <span class="profile-tool-name">Node.js &amp; npm</span>
              <span id="prof-node-exists" class="path-status path-exists">Found</span>
            </div>
            <div id="prof-node-version" class="profile-tool-version">—</div>
            <div id="prof-node-path" class="profile-tool-path">—</div>
          </div>
        </div>

        <div class="profile-actions-row">
          <div class="profile-actions-left">
            <button id="btn-select-profile" class="btn btn-primary" title="Activate the selected profile for this VS Code session">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Select Profile
            </button>
            <button id="btn-check-env" class="btn btn-secondary" title="Validate java, gradle, node, and npm versions using this profile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              Check Environment
            </button>
            <button id="btn-set-env" class="btn btn-secondary" title="Set custom environment variables for this profile">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>
              Set Environment Variables
            </button>
          </div>
          <button id="btn-edit-config" class="btn btn-secondary" title="Edit profile paths and project commands in the Configuration Panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            Edit Configuration
          </button>
        </div>
      </section>

      <!-- C. QUICK ACTIONS -->
      <section class="card" aria-labelledby="section-quick-actions-title">
        <div class="card-header">
          <h2 id="section-quick-actions-title" class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            Quick Actions
          </h2>
        </div>

        <div class="quick-actions-grid">
          <button id="btn-run-all" class="btn btn-primary quick-action-btn" title="Start Backend and Frontend processes">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Run All
          </button>
          <button id="btn-debug-all" class="btn btn-secondary quick-action-btn" title="Start Backend (JDWP) and Frontend processes in debug mode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
            Debug All
          </button>
          <button id="btn-qa-run-backend" class="btn btn-secondary quick-action-btn" title="Start the Backend process only">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Run Backend
          </button>
          <button id="btn-qa-run-frontend" class="btn btn-secondary quick-action-btn" title="Start the Frontend process only">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Run Frontend
          </button>
          <button id="btn-build-project" class="btn btn-secondary quick-action-btn" title="Run the configured Gradle build task">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
            Build Project
          </button>
          <button id="btn-stop-all" class="btn btn-danger quick-action-btn" title="Stop managed Backend and Frontend processes">
            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>
            Stop All
          </button>
          <button id="btn-restart-all" class="btn btn-secondary quick-action-btn" title="Restart both Backend and Frontend processes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            Restart All
          </button>
        </div>

        <div id="build-status-strip" class="build-status-strip">
          <div class="build-status-info">
            <span id="build-status-badge" class="badge badge-idle">
              <span class="badge-dot"></span>
              <span id="build-status-text">Build Idle</span>
            </span>
            <code id="build-command-label" style="font-size: 11px;">gradle build</code>
            <span id="build-summary-text" class="build-summary-text">Ready to run configured build task.</span>
          </div>
          <button id="btn-open-build-terminal" class="btn btn-secondary btn-sm" title="Open DEM: Build terminal">
            Build Terminal
          </button>
        </div>
      </section>

      <!-- D. PROCESS STATUS CARDS -->
      <div class="process-cards-grid">
        <!-- Backend Card -->
        <section class="card process-card" aria-labelledby="backend-card-title">
          <div class="card-header">
            <h2 id="backend-card-title" class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
              </svg>
              Backend Process
            </h2>
            <span id="backend-status-badge" class="badge badge-stopped">
              <span class="badge-dot"></span>
              <span id="backend-status-text">Stopped</span>
            </span>
          </div>

          <div class="process-meta-list">
            <span class="meta-label">Working Dir:</span>
            <span id="backend-cwd" class="meta-value">—</span>
            <span class="meta-label">Command:</span>
            <span id="backend-cmd" class="meta-value">—</span>
            <span class="meta-label">Profile:</span>
            <span id="backend-profile" class="meta-value">—</span>
            <span class="meta-label">Session Info:</span>
            <span id="backend-start-time" class="meta-value">Not started yet</span>
          </div>

          <div id="backend-summary" class="process-summary-box" title="Latest output or error summary">
            No process started in this session.
          </div>

          <div class="process-card-actions">
            <button id="btn-backend-run" class="btn btn-primary btn-sm" title="Start Backend process">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Run
            </button>
            <button id="btn-backend-debug" class="btn btn-secondary btn-sm" title="Start Backend process with JDWP Debugger enabled">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
              Debug
            </button>
            <button id="btn-backend-stop" class="btn btn-danger btn-sm" title="Stop Backend process" disabled>
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>
              Stop
            </button>
            <button id="btn-backend-restart" class="btn btn-secondary btn-sm" title="Restart Backend process">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
              Restart
            </button>
            <button id="btn-backend-terminal" class="btn btn-secondary btn-sm" title="Open DEM: Backend terminal in VS Code">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
              Open Terminal
            </button>
          </div>
        </section>

        <!-- Frontend Card -->
        <section class="card process-card" aria-labelledby="frontend-card-title">
          <div class="card-header">
            <h2 id="frontend-card-title" class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="21" x2="9" y2="9"></line>
              </svg>
              Frontend Process
            </h2>
            <span id="frontend-status-badge" class="badge badge-stopped">
              <span class="badge-dot"></span>
              <span id="frontend-status-text">Stopped</span>
            </span>
          </div>

          <div class="process-meta-list">
            <span class="meta-label">Working Dir:</span>
            <span id="frontend-cwd" class="meta-value">—</span>
            <span class="meta-label">Command:</span>
            <span id="frontend-cmd" class="meta-value">—</span>
            <span class="meta-label">Profile:</span>
            <span id="frontend-profile" class="meta-value">—</span>
            <span class="meta-label">Session Info:</span>
            <span id="frontend-start-time" class="meta-value">Not started yet</span>
          </div>

          <div id="frontend-summary" class="process-summary-box" title="Latest output or error summary">
            No process started in this session.
          </div>

          <div class="process-card-actions">
            <button id="btn-frontend-run" class="btn btn-primary btn-sm" title="Start Frontend process">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Run
            </button>
            <button id="btn-frontend-debug" class="btn btn-secondary btn-sm" title="Start Frontend and launch Browser Debugger">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
              Debug
            </button>
            <button id="btn-frontend-stop" class="btn btn-danger btn-sm" title="Stop Frontend process" disabled>
              <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>
              Stop
            </button>
            <button id="btn-frontend-restart" class="btn btn-secondary btn-sm" title="Restart Frontend process">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
              Restart
            </button>
            <button id="btn-frontend-terminal" class="btn btn-secondary btn-sm" title="Open DEM: Frontend terminal in VS Code">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
              Open Terminal
            </button>
          </div>
        </section>
      </div>

      <!-- E. LIVE LOGS -->
      <section class="card" aria-labelledby="section-logs-title">
        <div class="logs-toolbar">
          <div class="card-title-group">
            <h2 id="section-logs-title" class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
              Live Logs
            </h2>
            <div class="log-filter-group" role="tablist" aria-label="Filter process logs">
              <button class="filter-tab active" data-filter="all" role="tab">All</button>
              <button class="filter-tab" data-filter="backend" role="tab">Backend</button>
              <button class="filter-tab" data-filter="frontend" role="tab">Frontend</button>
              <button class="filter-tab" data-filter="build" role="tab">Build</button>
            </div>
          </div>

          <div class="log-actions-group">
            <label class="autoscroll-label" title="Automatically scroll to newest log output">
              <input id="chk-autoscroll" type="checkbox" checked />
              Auto-scroll
            </label>
            <button id="btn-copy-logs" class="btn btn-secondary btn-sm" title="Copy filtered logs to clipboard">
              Copy Logs
            </button>
            <button id="btn-clear-logs" class="btn btn-secondary btn-sm" title="Clear log buffer">
              Clear Logs
            </button>
          </div>
        </div>

        <div id="logs-viewport" class="logs-viewport" role="log" aria-live="polite">
          <div class="log-empty-state">
            No process output captured yet. Start Backend, Frontend, or Build Project to view live stdout/stderr streams here.
          </div>
        </div>
      </section>

      <!-- F. ENVIRONMENT DIAGNOSTICS -->
      <section class="card" aria-labelledby="section-diagnostics-title">
        <div class="card-header">
          <div>
            <h2 id="section-diagnostics-title" class="card-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
              </svg>
              Environment Diagnostics
            </h2>
            <p id="diag-subtitle" class="form-hint" style="margin: 2px 0 0 0;">
              Validate java, gradle, node, and npm using active profile
            </p>
          </div>
          <button id="btn-check-again" class="btn btn-secondary btn-sm" title="Execute java -version, gradle -version, node -v, and npm -v">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            <span id="btn-check-again-text">Check Again</span>
          </button>
        </div>

        <div id="diagnostics-grid" class="diagnostics-grid"></div>
      </section>

      <!-- G. CONFIGURATION PANEL -->
      <section id="config-card" class="card" aria-labelledby="section-config-title">
        <div class="card-header">
          <h2 id="section-config-title" class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            Project Configuration (.vscode/project-build-manager.json)
          </h2>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button id="btn-cfg-export" class="btn btn-secondary btn-sm" title="Export configuration to a JSON file">Export</button>
            <button id="btn-cfg-import" class="btn btn-secondary btn-sm" title="Import configuration from a JSON file">Import</button>
            <button id="btn-toggle-config-panel" class="btn btn-secondary btn-sm">Expand</button>
          </div>
        </div>

        <div id="config-panel-body" class="hidden" style="display: flex; flex-direction: column; gap: 10px;">
          <div id="config-feedback-banner" class="banner banner-info hidden"></div>

          <div class="config-form-grid">
            <!-- Project & Default Profile -->
            <div class="config-group">
              <h3 class="config-group-title">Project General</h3>
              <div class="form-field">
                <label for="cfg-project-name">Project Name</label>
                <input id="cfg-project-name" type="text" class="text-input" placeholder="CCC" />
              </div>
              <div class="form-field">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <label for="cfg-project-root">Project Root</label>
                  <button id="btn-cfg-auto-detect" type="button" class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 10px;" title="Auto-detect and set projectRoot to current workspace">Use Current Workspace</button>
                </div>
                <input id="cfg-project-root" type="text" class="text-input" placeholder="D:\path\to\project" />
              </div>
              <div class="form-field">
                <label for="cfg-active-profile">Saved Default Profile (activeProfile)</label>
                <select id="cfg-active-profile" class="select-input"></select>
              </div>
            </div>

            <!-- Selected Profile Toolchain Paths -->
            <div class="config-group">
              <h3 class="config-group-title">Toolchain Paths</h3>
              <div class="form-field">
                <label for="cfg-edit-profile-id">Profile to Edit</label>
                <select id="cfg-edit-profile-id" class="select-input"></select>
              </div>
              <div class="form-field">
                <label for="cfg-java-home">Java Home (JAVA_HOME)</label>
                <input id="cfg-java-home" type="text" class="text-input" placeholder="E:\soft\jdk17" />
              </div>
              <div class="form-field">
                <label for="cfg-gradle-home">Gradle Home (GRADLE_HOME)</label>
                <input id="cfg-gradle-home" type="text" class="text-input" placeholder="E:\soft\gradle-8.8" />
              </div>
              <div class="form-field">
                <label for="cfg-node-home">Node.js Version / Path (NVM or Folder)</label>
                <input id="cfg-node-home" type="text" class="text-input" placeholder="nvm use 20.14.0 or path" />
              </div>
              <div class="form-field">
                <label for="cfg-profile-env">Custom Environment Variables (KEY=VALUE, one per line)</label>
                <textarea id="cfg-profile-env" class="text-input" rows="3" style="font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; resize: vertical;" placeholder="MY_VAR=value&#10;SPRING_PROFILES_ACTIVE=dev"></textarea>
                <span class="form-hint" style="margin-top: 3px; display: block;">Applied to Backend, Frontend, and Build processes for this profile.</span>
              </div>
            </div>

            <!-- Backend Config -->
            <div class="config-group">
              <h3 class="config-group-title">Backend Target (Spring Boot)</h3>
              <div class="form-field">
                <label for="cfg-backend-cwd">Backend Working Directory</label>
                <input id="cfg-backend-cwd" type="text" class="text-input" placeholder="." />
              </div>
              <div class="form-field">
                <label for="cfg-backend-cmd">Backend Command</label>
                <input id="cfg-backend-cmd" type="text" class="text-input" placeholder="gradle" />
              </div>
              <div class="form-field">
                <div style="display: flex; justify-content: space-between; align-items: baseline;">
                  <label for="cfg-backend-args">Backend Arguments (space-separated)</label>
                  <span id="cfg-backend-profile-tag" style="font-size: 11px; font-weight: 600; color: var(--dem-accent, #4fc1ff);"></span>
                </div>
                <input id="cfg-backend-args" type="text" class="text-input" placeholder="run or root:bootRun" />
                <span id="cfg-backend-args-hint" style="font-size: 11px; color: var(--dem-accent, #4fc1ff); margin-top: 3px; display: block;"></span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-field">
                  <label for="cfg-backend-debug-port">JDWP Debug Port</label>
                  <input id="cfg-backend-debug-port" type="number" class="text-input" placeholder="5005" />
                </div>
                <div class="form-field">
                  <label for="cfg-backend-server-port">Server HTTP Port</label>
                  <input id="cfg-backend-server-port" type="number" class="text-input" placeholder="8080" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div class="form-field">
                  <label for="cfg-backend-spring-profile">Spring Profile</label>
                  <input id="cfg-backend-spring-profile" type="text" class="text-input" placeholder="dev" />
                </div>
                <div class="form-field">
                  <label for="cfg-backend-jdwp-mode">JDWP Strategy</label>
                  <select id="cfg-backend-jdwp-mode" class="select-input">
                    <option value="javaToolOptions">JAVA_TOOL_OPTIONS (Default)</option>
                    <option value="gradleDebugJvm">Gradle --debug-jvm</option>
                    <option value="customArgs">Custom Args</option>
                  </select>
                </div>
              </div>
              <div style="display: flex; gap: 16px; margin-top: 4px;">
                <label class="autoscroll-label" title="Suspend JVM on startup until debugger attaches">
                  <input id="cfg-backend-jvm-suspend" type="checkbox" />
                  JVM Suspend
                </label>
                <label class="autoscroll-label" title="Automatically attach VS Code Java debugger once JDWP port is ready">
                  <input id="cfg-backend-auto-attach" type="checkbox" checked />
                  Auto-Attach Debugger
                </label>
              </div>
            </div>

            <!-- Frontend & Build Config -->
            <div class="config-group">
              <h3 class="config-group-title">Frontend &amp; Build Targets</h3>
              <div class="form-field">
                <label for="cfg-frontend-cwd">Frontend Working Directory</label>
                <input id="cfg-frontend-cwd" type="text" class="text-input" placeholder="frontend" />
              </div>
              <div class="form-field">
                <label for="cfg-frontend-cmd">Frontend Command &amp; Args</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                  <input id="cfg-frontend-cmd" type="text" class="text-input" placeholder="npm" title="Frontend Command" />
                  <input id="cfg-frontend-args" type="text" class="text-input" placeholder="start" title="Frontend Arguments" />
                </div>
              </div>
              <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
                <div class="form-field">
                  <label for="cfg-frontend-dev-url">Dev Server URL</label>
                  <input id="cfg-frontend-dev-url" type="text" class="text-input" placeholder="http://localhost:4200" />
                </div>
                <div class="form-field">
                  <label for="cfg-frontend-browser-type">Browser</label>
                  <select id="cfg-frontend-browser-type" class="select-input">
                    <option value="chrome">Chrome</option>
                    <option value="msedge">Edge</option>
                  </select>
                </div>
              </div>
              <div class="form-field">
                <label for="cfg-frontend-web-root">Frontend Web Root</label>
                <input id="cfg-frontend-web-root" type="text" class="text-input" placeholder="\${workspaceFolder}/frontend" />
              </div>
              <div class="form-field">
                <label for="cfg-frontend-browser-executable">Browser Executable Path (Optional)</label>
                <input id="cfg-frontend-browser-executable" type="text" class="text-input" placeholder="C:\Users\...\chrome.exe (Blank for default)" />
              </div>
              <div class="form-field">
                <label for="cfg-frontend-user-data-dir">User Data Directory (Optional)</label>
                <input id="cfg-frontend-user-data-dir" type="text" class="text-input" placeholder="D:\ChromeData\dev (Blank for temp profile)" />
              </div>
              <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px;">
                <div class="form-field">
                  <label for="cfg-frontend-browser-args">Custom Browser Flags</label>
                  <input id="cfg-frontend-browser-args" type="text" class="text-input" placeholder="--disable-web-security --disable-site-isolation-trials" />
                </div>
                <div class="form-field">
                  <label for="cfg-frontend-browser-debug-port">CDP Debug Port</label>
                  <input id="cfg-frontend-browser-debug-port" type="number" class="text-input" placeholder="9222" />
                </div>
              </div>
              <div class="form-field">
                <label for="cfg-build-cwd">Build Working Directory</label>
                <input id="cfg-build-cwd" type="text" class="text-input" placeholder="." />
              </div>
              <div class="form-field">
                <label for="cfg-build-cmd">Build Command &amp; Args</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                  <input id="cfg-build-cmd" type="text" class="text-input" placeholder="gradle" title="Build Command" />
                  <input id="cfg-build-args" type="text" class="text-input" placeholder="clean root:bootwar" title="Build Arguments" />
                </div>
              </div>
            </div>
          </div>

          <div class="config-footer">
            <span class="form-hint">
              Saving requires confirmation before updating <code>.vscode/project-build-manager.json</code>. Never store secrets or tokens here.
            </span>
            <div class="config-footer-actions">
              <button id="btn-cfg-export-foot" class="btn btn-secondary" title="Export configuration to a JSON file">Export Config</button>
              <button id="btn-cfg-import-foot" class="btn btn-secondary" title="Import configuration from a JSON file">Import Config</button>
              <button id="btn-cfg-cancel" class="btn btn-secondary">Cancel</button>
              <button id="btn-cfg-save" class="btn btn-primary">Save Configuration</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

