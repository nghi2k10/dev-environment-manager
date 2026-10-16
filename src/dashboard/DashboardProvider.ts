import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildDashboardHtml } from "./DashboardHtml";
import {
  DashboardCommand,
  ExtensionMessage,
  parseDashboardCommand
} from "./DashboardMessages";
import { ConfigService } from "../services/ConfigService";
import {
  createInitialDiagnosticsResults,
  EnvironmentService
} from "../services/EnvironmentService";
import { ProcessManager } from "../services/ProcessManager";
import { LogService } from "../services/LogService";
import { DebugManager } from "../services/DebugManager";
import { DashboardState, ProjectConfig } from "../types/project-config";

export class DashboardProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "devEnvironmentManagerView";
  public static readonly panelType = "devEnvironmentManagerDashboard";

  private sidebarView?: vscode.WebviewView;
  private editorPanel?: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configService: ConfigService,
    private readonly environmentService: EnvironmentService,
    private readonly processManager: ProcessManager,
    private readonly logService: LogService,
    private readonly debugManager: DebugManager
  ) {
    this.disposables.push(
      this.configService.onDidChange(() => {
        this.broadcastFullState();
      }),
      this.processManager.onDidChange(() => {
        let cfg: ProjectConfig | undefined;
        try {
          cfg = this.configService.readConfig();
        } catch {
          cfg = undefined;
        }
        this.broadcastMessage({
          type: "processUpdated",
          backend: this.processManager.getProcessState("backend", cfg),
          frontend: this.processManager.getProcessState("frontend", cfg),
          build: this.processManager.getBuildState(cfg)
        });
      }),
      this.environmentService.onDidChange(diagnostics => {
        this.broadcastMessage({
          type: "diagnosticsUpdated",
          diagnostics
        });
      }),
      this.logService.onDidAppend(entry => {
        this.broadcastMessage({
          type: "logAppended",
          entry
        });
      }),
      this.logService.onDidClear(() => {
        this.broadcastMessage({
          type: "logsCleared"
        });
      }),
      this.debugManager.onDidChange(() => {
        let cfg: ProjectConfig | undefined;
        try {
          cfg = this.configService.readConfig();
        } catch {
          cfg = undefined;
        }
        this.broadcastMessage({
          type: "debugUpdated",
          debug: this.debugManager.getDebugState(cfg)
        });
        this.broadcastMessage({
          type: "breakpointsUpdated",
          breakpoints: this.debugManager.getBreakpoints()
        });
      })
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.sidebarView = webviewView;
    this.configureWebview(webviewView.webview);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postMessageTo(webviewView.webview, {
          type: "stateUpdated",
          state: this.buildDashboardState()
        });
      }
    });

    webviewView.onDidDispose(() => {
      if (this.sidebarView === webviewView) {
        this.sidebarView = undefined;
      }
    });
  }

  public openDashboardPanel(): void {
    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.One);
      this.postMessageTo(this.editorPanel.webview, {
        type: "stateUpdated",
        state: this.buildDashboardState()
      });
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DashboardProvider.panelType,
      "Dev Environment Manager",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
      }
    );

    this.editorPanel = panel;
    this.configureWebview(panel.webview);

    panel.onDidChangeViewState(e => {
      if (e.webviewPanel.visible) {
        this.postMessageTo(panel.webview, {
          type: "stateUpdated",
          state: this.buildDashboardState()
        });
      }
    });

    panel.onDidDispose(() => {
      if (this.editorPanel === panel) {
        this.editorPanel = undefined;
      }
    });
  }

  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")]
    };
    webview.html = buildDashboardHtml(webview, this.extensionUri);

    webview.onDidReceiveMessage(async (raw: unknown) => {
      const command = parseDashboardCommand(raw);
      if (!command) {
        this.postMessageTo(webview, {
          type: "notification",
          level: "error",
          message: "Received invalid or unrecognized command from Webview."
        });
        return;
      }
      await this.handleCommand(command, webview);
    });
  }

  private async handleCommand(command: DashboardCommand, sourceWebview: vscode.Webview): Promise<void> {
    try {
      switch (command.type) {
        case "getInitialState":
        case "refreshState": {
          this.postMessageTo(sourceWebview, {
            type: "stateUpdated",
            state: this.buildDashboardState()
          });
          if (command.type === "refreshState") {
            this.broadcastFullState();
          }
          break;
        }

        case "selectProfile": {
          const active = this.configService.setSessionProfile(command.profileId);
          const persistenceNote = active.isSessionOnly
            ? `(Session only — saved config default is "${active.savedId}")`
            : `(Matches saved default in configuration)`;
          this.logService.appendOutputChannelOnly(
            `Active profile changed to: ${active.id} ${persistenceNote}`
          );
          vscode.window.setStatusBarMessage(`DEM Profile: ${active.id}`, 5000);
          this.broadcastFullState();
          this.broadcastMessage({
            type: "notification",
            level: "info",
            message: `Active profile set to "${active.profile.label ?? active.id}" ${persistenceNote}`
          });
          break;
        }

        case "checkEnvironment": {
          const diag = await this.environmentService.runDiagnostics(false);
          const failedCount = diag.results.filter(r => r.status === "failed").length;
          const warnCount = diag.results.filter(r => r.status === "warning").length;

          if (failedCount > 0) {
            const msg = `Environment check completed with ${failedCount} failed tool(s). Inspect Environment Diagnostics for details.`;
            this.broadcastMessage({ type: "notification", level: "error", message: msg });
            vscode.window.showWarningMessage(msg, "Show Output").then(choice => {
              if (choice === "Show Output") {
                this.logService.showOutputChannel(false);
              }
            });
          } else if (warnCount > 0) {
            this.broadcastMessage({
              type: "notification",
              level: "warning",
              message: `Environment check passed with ${warnCount} PATH fallback warning(s).`
            });
          } else {
            this.broadcastMessage({
              type: "notification",
              level: "success",
              message: `All 4 tools (Java, Gradle, Node.js, npm) passed verification for profile "${diag.profileId}".`
            });
          }
          break;
        }

        case "runBackend": {
          await this.processManager.startTarget("backend");
          break;
        }

        case "runFrontend": {
          await this.processManager.startTarget("frontend");
          break;
        }

        case "runAll": {
          await this.processManager.runAll();
          break;
        }

        case "debugBackend": {
          await this.processManager.debugBackend();
          break;
        }

        case "debugFrontend": {
          await this.processManager.debugFrontend();
          break;
        }

        case "debugAll": {
          await this.processManager.debugAll();
          break;
        }

        case "attachSpringBoot": {
          const success = await this.debugManager.attachSpringBootDebugger();
          if (success) {
            this.broadcastMessage({
              type: "notification",
              level: "success",
              message: "Attached VS Code Java debugger to Spring Boot."
            });
          }
          break;
        }

        case "attachFrontend": {
          const success = await this.debugManager.launchAngularDebugger();
          if (success) {
            this.broadcastMessage({
              type: "notification",
              level: "success",
              message: "Attached browser debugger to Frontend."
            });
          }
          break;
        }

        case "syncLaunchJson": {
          const success = await this.debugManager.syncLaunchJson();
          if (success) {
            this.broadcastMessage({
              type: "notification",
              level: "success",
              message: "Synchronized DEM debug configurations to .vscode/launch.json."
            });
          }
          break;
        }

        case "openUrl": {
          try {
            await vscode.env.openExternal(vscode.Uri.parse(command.url));
          } catch (err) {
            vscode.window.showErrorMessage(`Unable to open URL: ${(err as Error).message}`);
          }
          break;
        }

        case "toggleBreakpoint": {
          this.debugManager.toggleBreakpoint(command.id);
          break;
        }

        case "removeBreakpoint": {
          this.debugManager.removeBreakpoint(command.id);
          break;
        }

        case "jumpToBreakpoint": {
          await this.debugManager.jumpToBreakpoint(command.filePath, command.line);
          break;
        }

        case "clearAllBreakpoints": {
          this.debugManager.clearAllBreakpoints();
          break;
        }

        case "buildProject": {
          void this.processManager
            .runBuildProject(false)
            .then(succeeded => {
              if (succeeded) {
                this.broadcastMessage({
                  type: "notification",
                  level: "success",
                  message: "Project build completed successfully."
                });
              } else {
                this.broadcastMessage({
                  type: "notification",
                  level: "error",
                  message: "Project build failed or was cancelled. Check Live Logs or Build Terminal."
                });
              }
            })
            .catch(err => {
              const msg = (err as Error).message;
              vscode.window.showErrorMessage(`Build Project failed: ${msg}`);
              this.broadcastMessage({
                type: "notification",
                level: "error",
                message: `Build Project error: ${msg}`
              });
            });
          break;
        }

        case "stopBackend": {
          await this.processManager.stopTarget("backend");
          break;
        }

        case "stopFrontend": {
          await this.processManager.stopTarget("frontend");
          break;
        }

        case "stopAll": {
          await this.processManager.stopAll();
          break;
        }

        case "restartBackend": {
          await this.processManager.restartTarget("backend");
          break;
        }

        case "restartFrontend": {
          await this.processManager.restartTarget("frontend");
          break;
        }

        case "restartAll": {
          await this.processManager.restartAll();
          break;
        }

        case "openTerminal": {
          this.processManager.openTerminal(command.target, false);
          break;
        }

        case "getLogs": {
          this.postMessageTo(sourceWebview, {
            type: "logsSnapshot",
            target: command.target,
            logs: this.logService.getLogs(command.target)
          });
          break;
        }

        case "clearLogs": {
          this.logService.clear();
          break;
        }

        case "copyLogs": {
          const text = this.logService.formatLogsForClipboard(command.target ?? "all");
          if (!text) {
            this.postMessageTo(sourceWebview, {
              type: "notification",
              level: "info",
              message: "No logs to copy for the selected filter."
            });
            return;
          }
          await vscode.env.clipboard.writeText(text);
          this.postMessageTo(sourceWebview, {
            type: "notification",
            level: "success",
            message: "Logs copied to clipboard."
          });
          break;
        }

        case "saveConfiguration": {
          const saved = await this.configService.saveConfigurationWithConfirmation(
            command.configuration
          );
          if (saved) {
            this.broadcastFullState();
            this.broadcastMessage({
              type: "notification",
              level: "success",
              message: "Configuration saved to .vscode/project-build-manager.json.",
              scope: "config"
            });
            vscode.window.showInformationMessage(
              "Dev Environment Manager configuration saved."
            );
          } else {
            this.postMessageTo(sourceWebview, {
              type: "notification",
              level: "info",
              message: "Configuration save cancelled.",
              scope: "config"
            });
          }
          break;
        }

        case "openConfigFile": {
          if (!this.configService.hasWorkspace()) {
            vscode.window.showWarningMessage("Open a workspace folder first.");
            return;
          }
          const cfgPath = this.configService.getConfigFilePath();
          if (fs.existsSync(cfgPath)) {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(cfgPath));
            await vscode.window.showTextDocument(doc);
          } else {
            vscode.window.showErrorMessage(`Config file does not exist: ${cfgPath}`);
          }
          break;
        }

        case "autoSyncProjectRoot": {
          const res = this.configService.autoSyncProjectRoot(true);
          this.broadcastFullState();
          this.broadcastMessage({
            type: "notification",
            level: "success",
            message: `Project root auto-configured to current workspace: ${res.newRoot}`
          });
          vscode.window.showInformationMessage(
            `Dev Environment Manager: Project root auto-configured to ${res.newRoot}`
          );
          break;
        }

        case "exportConfiguration": {
          const exportedPath = await this.configService.exportConfiguration();
          if (exportedPath) {
            this.broadcastMessage({
              type: "notification",
              level: "success",
              message: `Configuration exported to: ${path.basename(exportedPath)}`,
              scope: "config"
            });
          }
          break;
        }

        case "importConfiguration": {
          const imported = await this.configService.importConfiguration();
          if (imported) {
            this.broadcastFullState();
            this.broadcastMessage({
              type: "notification",
              level: "success",
              message: "Configuration imported successfully and applied to workspace.",
              scope: "config"
            });
          }
          break;
        }
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      const scope = command.type === "saveConfiguration" ? "config" : "general";
      this.postMessageTo(sourceWebview, {
        type: "notification",
        level: "error",
        message,
        scope
      });
      vscode.window.showErrorMessage(`Dev Environment Manager: ${message}`);
    }
  }

  public buildDashboardState(): DashboardState {
    if (!this.configService.hasWorkspace()) {
      return {
        hasWorkspace: false,
        workspaceName: "No Workspace",
        workspaceRootPath: "",
        configFilePath: "",
        projectName: "No Workspace Open",
        projectRoot: "",
        resolvedProjectRoot: "",
        activeProfileId: "",
        savedActiveProfileId: "",
        isProfileSessionOnly: false,
        profiles: [],
        backend: this.processManager.getProcessState("backend"),
        frontend: this.processManager.getProcessState("frontend"),
        build: this.processManager.getBuildState(),
        diagnostics: this.environmentService.getDiagnosticsState(),
        logs: this.logService.getLogs("all"),
        debug: this.debugManager.getDebugState(),
        breakpoints: []
      };
    }

    const wsRoot = this.configService.getWorkspaceRoot();
    const wsName = this.configService.getWorkspaceName();
    const cfgPath = this.configService.getConfigFilePath();

    try {
      const config = this.configService.readConfig();
      const active = this.configService.getActiveProfile(config);
      const profiles = this.configService.buildProfileDetailsList(config);
      const selectedProfile = profiles.find(p => p.id === active.id) ?? profiles[0];
      const resolvedRoot = this.configService.resolveProjectRoot(config);

      return {
        hasWorkspace: true,
        workspaceName: wsName,
        workspaceRootPath: wsRoot,
        configFilePath: cfgPath,
        projectName: config.name || path.basename(resolvedRoot) || wsName,
        projectRoot: config.projectRoot || wsRoot,
        resolvedProjectRoot: resolvedRoot,
        activeProfileId: active.id,
        savedActiveProfileId: active.savedId,
        isProfileSessionOnly: active.isSessionOnly,
        profiles,
        selectedProfile,
        backend: this.processManager.getProcessState("backend", config),
        frontend: this.processManager.getProcessState("frontend", config),
        build: this.processManager.getBuildState(config),
        diagnostics: this.environmentService.getDiagnosticsState({
          id: active.id,
          profile: active.profile
        }),
        logs: this.logService.getLogs("all"),
        rawConfig: config,
        debug: this.debugManager.getDebugState(config),
        breakpoints: this.debugManager.getBreakpoints()
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      return {
        hasWorkspace: true,
        workspaceName: wsName,
        workspaceRootPath: wsRoot,
        configFilePath: cfgPath,
        configError: errorMsg,
        projectName: wsName,
        projectRoot: wsRoot,
        resolvedProjectRoot: wsRoot,
        activeProfileId: "",
        savedActiveProfileId: "",
        isProfileSessionOnly: false,
        profiles: [],
        backend: this.processManager.getProcessState("backend"),
        frontend: this.processManager.getProcessState("frontend"),
        build: this.processManager.getBuildState(),
        diagnostics: {
          isChecking: false,
          results: createInitialDiagnosticsResults()
        },
        logs: this.logService.getLogs("all"),
        debug: this.debugManager.getDebugState(),
        breakpoints: this.debugManager.getBreakpoints()
      };
    }
  }

  public broadcastFullState(): void {
    const state = this.buildDashboardState();
    this.broadcastMessage({
      type: "stateUpdated",
      state
    });
  }

  private broadcastMessage(message: ExtensionMessage): void {
    if (this.sidebarView?.visible) {
      void this.sidebarView.webview.postMessage(message);
    }
    if (this.editorPanel?.visible) {
      void this.editorPanel.webview.postMessage(message);
    }
  }

  private postMessageTo(webview: vscode.Webview, message: ExtensionMessage): void {
    void webview.postMessage(message);
  }

  public dispose(): void {
    this.editorPanel?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

