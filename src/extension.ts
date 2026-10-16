import * as vscode from "vscode";
import { ConfigService } from "./services/ConfigService";
import { LogService } from "./services/LogService";
import { EnvironmentService } from "./services/EnvironmentService";
import { ProcessManager } from "./services/ProcessManager";
import { DebugManager } from "./services/DebugManager";
import { DashboardProvider } from "./dashboard/DashboardProvider";

let processManager: ProcessManager | undefined;
let debugManager: DebugManager | undefined;

function registerCommand(
  context: vscode.ExtensionContext,
  name: string,
  callback: (...args: unknown[]) => unknown
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(`devEnvironmentManager.${name}`, async (...args: unknown[]) => {
      try {
        await callback(...args);
      } catch (err) {
        const msg = (err as Error).message || String(err);
        vscode.window.showErrorMessage(`Dev Environment Manager: ${msg}`);
      }
    })
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Dev Environment Manager");
  context.subscriptions.push(outputChannel);

  const configService = new ConfigService();
  configService.setGlobalState(context.globalState);
  const logService = new LogService(outputChannel);
  const environmentService = new EnvironmentService(configService, logService);
  debugManager = new DebugManager(configService, logService);
  processManager = new ProcessManager(configService, logService, debugManager);

  const dashboardProvider = new DashboardProvider(
    context.extensionUri,
    configService,
    environmentService,
    processManager,
    logService,
    debugManager
  );

  context.subscriptions.push(
    logService,
    debugManager,
    processManager,
    dashboardProvider,
    vscode.window.registerWebviewViewProvider(
      DashboardProvider.viewType,
      dashboardProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );

  // Watch workspace configuration changes
  const watcher = vscode.workspace.createFileSystemWatcher("**/.vscode/project-build-manager.json");
  watcher.onDidChange(() => dashboardProvider.broadcastFullState());
  watcher.onDidCreate(() => dashboardProvider.broadcastFullState());
  watcher.onDidDelete(() => dashboardProvider.broadcastFullState());
  context.subscriptions.push(watcher);

  // Auto-sync project root to current workspace folder if needed
  try {
    const syncRes = configService.autoSyncProjectRoot(false);
    if (syncRes.updated) {
      outputChannel.appendLine(
        `Auto-configured projectRoot to current workspace: ${syncRes.newRoot}`
      );
    }
  } catch {
    // Ignore if no workspace is open
  }

  // Task 2: Auto-detect Java version from application-dev.yml / application-dev.properties and apply profile
  try {
    const detected = configService.applyDetectedProfile();
    if (detected) {
      outputChannel.appendLine(
        `[DEM] Detected project Java ${detected.major} from ${detected.source} -> applied profile "${detected.profileId}"`
      );
    }
  } catch {
    // Ignore detection errors
  }

  // Register Commands
  registerCommand(context, "openDashboard", () => {
    dashboardProvider.openDashboardPanel();
  });

  registerCommand(context, "autoConfigureProjectRoot", () => {
    const res = configService.autoSyncProjectRoot(true);
    dashboardProvider.broadcastFullState();
    vscode.window.showInformationMessage(
      `Dev Environment Manager: Project root auto-configured to ${res.newRoot}`
    );
  });

  registerCommand(context, "selectProfile", async () => {
    const config = configService.readConfig();
    const active = configService.getActiveProfile(config);
    const choices = Object.entries(config.profiles).map(([id, profile]) => ({
      label: profile.label ?? id,
      description: id === active.id ? `${id} (Active)` : id,
      detail: `Java: ${profile.javaHome} | Gradle: ${profile.gradleHome} | Node.js: ${profile.nodeHome}`,
      id
    }));

    const picked = await vscode.window.showQuickPick(choices, {
      title: "Select Project Environment Profile",
      placeHolder: "Choose active toolchain profile for this VS Code session"
    });
    if (!picked) {
      return;
    }

    const updated = configService.setSessionProfile(picked.id);
    const note = updated.isSessionOnly
      ? "(Session only; save in Configuration Panel to persist in JSON)"
      : "(Matches saved config default)";
    logService.appendOutputChannelOnly(`Active profile changed to: ${picked.id} ${note}`);
    vscode.window.setStatusBarMessage(`DEM: ${picked.id}`, 5000);
    vscode.window.showInformationMessage(`Active profile set to: ${picked.label} ${note}`);
  });

  registerCommand(context, "checkEnvironment", async () => {
    await environmentService.runDiagnostics(true);
  });

  registerCommand(context, "runBackend", async () => {
    await processManager?.startTarget("backend", { promptIfRunning: true, showTerminal: false });
  });

  registerCommand(context, "runFrontend", async () => {
    await processManager?.startTarget("frontend", { promptIfRunning: true, showTerminal: false });
  });

  registerCommand(context, "runAll", async () => {
    await processManager?.runAll();
  });

  registerCommand(context, "debugBackend", async () => {
    await processManager?.debugBackend();
  });

  registerCommand(context, "debugFrontend", async () => {
    await processManager?.debugFrontend();
  });

  registerCommand(context, "debugAll", async () => {
    await processManager?.debugAll();
  });

  registerCommand(context, "attachSpringBoot", async () => {
    await debugManager?.attachSpringBootDebugger();
  });

  registerCommand(context, "attachFrontend", async () => {
    await debugManager?.launchAngularDebugger();
  });

  registerCommand(context, "syncLaunchJson", async () => {
    await debugManager?.syncLaunchJson();
  });

  registerCommand(context, "buildProject", async () => {
    const succeeded = await processManager?.runBuildProject(false);
    if (succeeded) {
      vscode.window.showInformationMessage("Dev Environment Manager: Project build succeeded.");
    } else {
      vscode.window.showWarningMessage(
        "Dev Environment Manager: Project build failed or was cancelled. Check Live Logs."
      );
    }
  });

  registerCommand(context, "stopBackend", async () => {
    const stopped = await processManager?.stopTarget("backend");
    if (!stopped) {
      vscode.window.showInformationMessage("Backend is not currently running.");
    }
  });

  registerCommand(context, "stopFrontend", async () => {
    const stopped = await processManager?.stopTarget("frontend");
    if (!stopped) {
      vscode.window.showInformationMessage("Frontend is not currently running.");
    }
  });

  registerCommand(context, "stopAll", async () => {
    await processManager?.stopAll();
  });

  registerCommand(context, "restartBackend", async () => {
    await processManager?.restartTarget("backend");
  });

  registerCommand(context, "restartFrontend", async () => {
    await processManager?.restartTarget("frontend");
  });

  registerCommand(context, "restartAll", async () => {
    await processManager?.restartAll();
  });

  registerCommand(context, "openBackendTerminal", () => {
    processManager?.openTerminal("backend", false);
  });

  registerCommand(context, "openFrontendTerminal", () => {
    processManager?.openTerminal("frontend", false);
  });

  registerCommand(context, "exportConfig", async () => {
    await configService.exportConfiguration();
  });

  registerCommand(context, "importConfig", async () => {
    const imported = await configService.importConfiguration();
    if (imported) {
      dashboardProvider.broadcastFullState();
    }
  });

  outputChannel.appendLine("Dev Environment Manager activated.");
}

export function deactivate(): void {
  debugManager?.dispose();
  debugManager = undefined;
  processManager?.dispose();
  processManager = undefined;
}
