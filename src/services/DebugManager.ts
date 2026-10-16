import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as os from "node:os";
import {
  BreakpointInfo,
  DebugManagerState,
  Profile,
  ProjectConfig,
  SpringBootMilestones
} from "../types/project-config";
import { ConfigService } from "./ConfigService";
import { LogService } from "./LogService";

const execFileAsync = promisify(execFile);

export function isJava8Profile(profile: Profile, profileId = ""): boolean {
  const combined = `${profileId} ${profile.label ?? ""} ${profile.javaHome}`.toLowerCase();
  return (
    combined.includes("java 8") ||
    combined.includes("jdk8") ||
    combined.includes("jdk-8") ||
    combined.includes("jdk1.8") ||
    combined.includes("java8") ||
    combined.includes("1.8.")
  );
}

export function buildJdwpArgument(
  profile: Profile,
  profileId: string,
  port: number,
  suspend: boolean
): string {
  const suspendVal = suspend ? "y" : "n";
  const isJ8 = isJava8Profile(profile, profileId);
  const addressVal = isJ8 ? `${port}` : `127.0.0.1:${port}`;
  return `-agentlib:jdwp=transport=dt_socket,server=y,suspend=${suspendVal},address=${addressVal}`;
}

export function createGradleDebugInitScript(
  profile: Profile,
  profileId: string,
  port: number,
  suspend: boolean,
  springProfile?: string
): string {
  const jdwpArg = buildJdwpArgument(profile, profileId, port, suspend);
  const springProp =
    springProfile && springProfile.trim()
      ? `\n            task.systemProperty 'spring.profiles.active', '${springProfile.trim()}'`
      : "";

  return `// Dev Environment Manager - Auto-generated Spring Boot debug init script
gradle.taskGraph.whenReady { graph ->
    graph.allTasks.each { task ->
        if (task instanceof JavaExec) {
            task.jvmArgs '${jdwpArg}'${springProp}
        }
    }
}
`;
}

export function writeGradleDebugInitScript(
  profile: Profile,
  profileId: string,
  port: number,
  suspend: boolean,
  springProfile?: string
): string {
  const initContent = createGradleDebugInitScript(profile, profileId, port, suspend, springProfile);
  const tmpPath = path.join(os.tmpdir(), "dem-gradle-debug-init.gradle");
  fs.writeFileSync(tmpPath, initContent, "utf8");
  return tmpPath;
}

export function getBreakpointUniqueId(bp: vscode.Breakpoint): string {
  if (bp instanceof vscode.SourceBreakpoint) {
    return `${bp.location.uri.toString()}:${bp.location.range.start.line}:${bp.location.range.start.character}`;
  }
  if (bp instanceof vscode.FunctionBreakpoint) {
    return `fn:${bp.functionName}`;
  }
  return `bp:${bp.id}`;
}

export class DebugManager implements vscode.Disposable {
  private backendDebugActive = false;
  private frontendDebugActive = false;
  private backendSessionId?: string;
  private frontendSessionId?: string;

  private springBootMilestones: SpringBootMilestones = {
    jdwpListening: false,
    serverStarted: false,
    appReady: false
  };

  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly logService: LogService
  ) {
    this.disposables.push(
      vscode.debug.onDidStartDebugSession(session => {
        this.handleDebugSessionStarted(session);
      }),
      vscode.debug.onDidTerminateDebugSession(session => {
        this.handleDebugSessionTerminated(session);
      }),
      vscode.debug.onDidChangeBreakpoints(() => {
        this.onDidChangeEmitter.fire();
      })
    );
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  public getDebugState(config?: ProjectConfig): DebugManagerState {
    let cfg = config;
    if (!cfg) {
      try {
        cfg = this.configService.readConfig();
      } catch {
        // Fallback
      }
    }

    const backendPort = cfg?.backend.debugPort ?? 5005;
    const serverPort = cfg?.backend.serverPort ?? 8080;
    const devServerUrl = cfg?.frontend.devServerUrl ?? "http://localhost:4200";
    const browserType = cfg?.frontend.browserType ?? "chrome";

    return {
      backendDebugActive: this.backendDebugActive,
      frontendDebugActive: this.frontendDebugActive,
      backendAttached: Boolean(this.backendSessionId),
      frontendAttached: Boolean(this.frontendSessionId),
      backendDebugPort: backendPort,
      backendServerPort: serverPort,
      frontendDevServerUrl: devServerUrl,
      browserType,
      springBootMilestones: { ...this.springBootMilestones },
      breakpointsCount: this.getBreakpoints().length
    };
  }

  public setBackendDebugActive(active: boolean): void {
    this.backendDebugActive = active;
    if (!active) {
      this.resetMilestones();
    }
    this.onDidChangeEmitter.fire();
  }

  public setFrontendDebugActive(active: boolean): void {
    this.frontendDebugActive = active;
    this.onDidChangeEmitter.fire();
  }

  public resetMilestones(): void {
    this.springBootMilestones = {
      jdwpListening: false,
      serverStarted: false,
      appReady: false,
      jdwpPort: undefined,
      serverPort: undefined,
      readyTimeSeconds: undefined,
      lastMilestoneText: undefined
    };
    this.onDidChangeEmitter.fire();
  }

  public handleLogChunk(stream: "stdout" | "stderr", chunkText: string): void {
    let changed = false;

    // 1. JDWP listening regex
    if (!this.springBootMilestones.jdwpListening) {
      const jdwpMatch = chunkText.match(
        /Listening for transport dt_socket at address:\s*(?:127\.0\.0\.1:)?(\d+)/i
      );
      if (jdwpMatch) {
        this.springBootMilestones.jdwpListening = true;
        this.springBootMilestones.jdwpPort = parseInt(jdwpMatch[1], 10);
        this.springBootMilestones.lastMilestoneText = `JDWP Listening on port ${this.springBootMilestones.jdwpPort}`;
        changed = true;
        this.logService.appendLine(
          "backend",
          "system",
          `[DEM Debug] Detected Spring Boot JDWP transport listening on port ${this.springBootMilestones.jdwpPort}.`
        );

        // Trigger auto-attach if enabled
        void this.checkAndAutoAttach();
      }
    }

    // 2. Web server port started (Tomcat, Netty, Jetty, Undertow)
    if (!this.springBootMilestones.serverStarted) {
      const serverMatch =
        chunkText.match(/(?:Tomcat|Netty|Jetty|Undertow)\s+started on port\(s\):\s*(\d+)/i) ??
        chunkText.match(/(?:Netty|Tomcat)\s+started on port\s*(\d+)/i) ??
        chunkText.match(/Started server on port\s*(\d+)/i);
      if (serverMatch) {
        this.springBootMilestones.serverStarted = true;
        this.springBootMilestones.serverPort = parseInt(serverMatch[1], 10);
        this.springBootMilestones.lastMilestoneText = `Embedded server started on port ${this.springBootMilestones.serverPort}`;
        changed = true;
        this.logService.appendLine(
          "backend",
          "system",
          `[DEM Debug] Detected HTTP server started on port ${this.springBootMilestones.serverPort}.`
        );
      }
    }

    // 3. Spring Boot ready (Started ... in ... seconds)
    if (!this.springBootMilestones.appReady) {
      const readyMatch = chunkText.match(
        /Started\s+[A-Za-z0-9_.$]+\s+in\s+([\d.]+)\s+seconds/i
      );
      if (readyMatch) {
        this.springBootMilestones.appReady = true;
        this.springBootMilestones.readyTimeSeconds = parseFloat(readyMatch[1]);
        this.springBootMilestones.lastMilestoneText = `Spring Boot application ready in ${this.springBootMilestones.readyTimeSeconds}s`;
        changed = true;
        this.logService.appendLine(
          "backend",
          "system",
          `[DEM Debug] Spring Boot application successfully started in ${this.springBootMilestones.readyTimeSeconds}s!`
        );
      }
    }

    if (changed) {
      this.onDidChangeEmitter.fire();
    }
  }

  private async checkAndAutoAttach(): Promise<void> {
    try {
      const config = this.configService.readConfig();
      if (config.backend.autoAttachDebugger === false) {
        return;
      }
      if (this.backendSessionId) {
        return; // Already attached
      }

      // Small delay to ensure JVM socket is ready to accept handshake
      await new Promise(r => setTimeout(r, 600));
      await this.attachSpringBootDebugger();
    } catch {
      // Ignore background auto-attach failures
    }
  }

  public async attachSpringBootDebugger(): Promise<boolean> {
    if (!this.configService.hasWorkspace()) {
      vscode.window.showWarningMessage("Open a workspace folder to attach the debugger.");
      return false;
    }

    const config = this.configService.readConfig();
    const port = this.springBootMilestones.jdwpPort || config.backend.debugPort || 5005;

    // Check if Java debugger extension is installed
    const javaExt = vscode.extensions.getExtension("vscjava.vscode-java-debug");
    if (!javaExt) {
      const choice = await vscode.window.showWarningMessage(
        "VS Code Debugger for Java ('vscjava.vscode-java-debug') is required for JDWP Java debugging.",
        "Install Debugger for Java",
        "Continue without extension"
      );
      if (choice === "Install Debugger for Java") {
        await vscode.commands.executeCommand(
          "workbench.extensions.installExtension",
          "vscjava.vscode-java-debug"
        );
      }
      if (choice !== "Continue without extension") {
        return false;
      }
    }

    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    const sessionName = `DEM: Attach Spring Boot (:${port})`;

    this.logService.appendLine(
      "backend",
      "system",
      `[DEM Debug] Attaching VS Code Java Debugger to 127.0.0.1:${port}...`
    );

    const started = await vscode.debug.startDebugging(wsFolder, {
      type: "java",
      name: sessionName,
      request: "attach",
      hostName: "127.0.0.1",
      port
    });

    if (started) {
      this.logService.appendLine(
        "backend",
        "system",
        `[DEM Debug] Successfully attached Java debugger to port ${port}.`
      );
    } else {
      this.logService.appendLine(
        "backend",
        "system",
        `[DEM Debug] Failed to attach Java debugger. Ensure Spring Boot is running and listening on port ${port}.`
      );
    }

    return started;
  }

  public async launchAngularDebugger(): Promise<boolean> {
    if (!this.configService.hasWorkspace()) {
      vscode.window.showWarningMessage("Open a workspace folder to launch the browser debugger.");
      return false;
    }

    const config = this.configService.readConfig();
    const devServerUrl = config.frontend.devServerUrl || "http://localhost:4200";
    const browserType = config.frontend.browserType === "msedge" ? "pwa-msedge" : "pwa-chrome";
    const wsFolder = vscode.workspace.workspaceFolders?.[0];

    let resolvedWebRoot = config.frontend.webRoot;
    if (!resolvedWebRoot || resolvedWebRoot.trim().length === 0) {
      resolvedWebRoot = "${workspaceFolder}/frontend";
    }
    if (wsFolder) {
      resolvedWebRoot = resolvedWebRoot.replace(/\$\{workspaceFolder\}/g, wsFolder.uri.fsPath);
    }

    const debugPort = config.frontend.browserDebugPort ?? 9222;
    // Check if a browser instance is already listening on the remote debugging port
    const isPortOccupied = !(await this.checkPortAvailable(debugPort));

    let debugConfiguration: vscode.DebugConfiguration;

    if (isPortOccupied) {
      this.logService.appendLine(
        "frontend",
        "system",
        `[DEM Debug] Detected browser listening on debug port ${debugPort}. Attaching debugger...`
      );
      debugConfiguration = {
        type: browserType,
        name: `DEM: Attach Browser (Port ${debugPort})`,
        request: "attach",
        port: debugPort,
        urlFilter: `${devServerUrl.replace(/\/+$/, "")}/*`,
        webRoot: resolvedWebRoot,
        sourceMaps: true
      };
    } else {
      this.logService.appendLine(
        "frontend",
        "system",
        `[DEM Debug] Launching ${config.frontend.browserType ?? "chrome"} debugger targeting ${devServerUrl}...`
      );

      debugConfiguration = {
        type: browserType,
        name: `DEM: Debug Angular (${config.frontend.browserType ?? "chrome"})`,
        request: "launch",
        url: devServerUrl,
        webRoot: resolvedWebRoot,
        sourceMaps: true
      };

      if (config.frontend.browserExecutable) {
        debugConfiguration.runtimeExecutable = config.frontend.browserExecutable;
      }
      if (config.frontend.userDataDir) {
        debugConfiguration.userDataDir = config.frontend.userDataDir;
      }
      if (config.frontend.browserArgs && config.frontend.browserArgs.length > 0) {
        debugConfiguration.runtimeArgs = config.frontend.browserArgs;
      }
    }

    const started = await vscode.debug.startDebugging(wsFolder, debugConfiguration);

    if (started) {
      this.frontendDebugActive = true;
      this.logService.appendLine(
        "frontend",
        "system",
        `[DEM Debug] Browser debug session started.`
      );
      this.onDidChangeEmitter.fire();
    } else {
      this.logService.appendLine(
        "frontend",
        "system",
        `[DEM Debug] Failed to launch/attach browser debugger for ${devServerUrl}. If using a custom Chrome with existing profile, ensure Chrome is launched with --remote-debugging-port=${debugPort} or close Chrome first.`
      );
    }

    return started;
  }

  public async checkPortAvailable(port: number, host = "127.0.0.1"): Promise<boolean> {
    return new Promise(resolve => {
      const server = net.createServer();
      server.unref();

      server.once("error", () => {
        resolve(false);
      });

      server.listen(port, host, () => {
        server.close(() => {
          resolve(true);
        });
      });
    });
  }

  public async findProcessPidUsingPort(port: number): Promise<number | undefined> {
    if (process.platform !== "win32") {
      return undefined;
    }

    try {
      const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
        windowsHide: true,
        timeout: 5000
      });
      const lines = stdout.split(/\r?\n/);
      for (const line of lines) {
        if (!line.includes("LISTENING")) {
          continue;
        }
        // Example: TCP    127.0.0.1:5005         0.0.0.0:0              LISTENING       12345
        const match = line.trim().match(/:\b(\d+)\b\s+.*LISTENING\s+(\d+)$/i);
        if (match && parseInt(match[1], 10) === port) {
          return parseInt(match[2], 10);
        }
      }
    } catch {
      // Ignore
    }
    return undefined;
  }

  public async terminateProcessByPid(pid: number): Promise<boolean> {
    try {
      await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 8000
      });
      return true;
    } catch {
      return false;
    }
  }

  public async handleDebugPortPreflight(port: number): Promise<"ok" | "cancelled"> {
    const isAvail = await this.checkPortAvailable(port);
    if (isAvail) {
      return "ok";
    }

    const pid = await this.findProcessPidUsingPort(port);
    const pidInfo = pid ? ` (occupied by PID ${pid})` : "";
    const choice = await vscode.window.showWarningMessage(
      `Debug port ${port} is currently in use${pidInfo}. Spring Boot JDWP will fail to bind unless the port is freed.`,
      { modal: true },
      pid ? "Terminate Conflicting Process" : "Retry Port",
      "Cancel"
    );

    if (choice === "Terminate Conflicting Process" && pid) {
      const killed = await this.terminateProcessByPid(pid);
      if (killed) {
        vscode.window.showInformationMessage(`Terminated process PID ${pid} on port ${port}.`);
        // Wait briefly for OS socket cleanup
        await new Promise(r => setTimeout(r, 600));
        return "ok";
      } else {
        vscode.window.showErrorMessage(`Failed to terminate PID ${pid}. Try freeing port ${port} manually.`);
        return "cancelled";
      }
    } else if (choice === "Retry Port") {
      const retryAvail = await this.checkPortAvailable(port);
      return retryAvail ? "ok" : "cancelled";
    }

    return "cancelled";
  }

  public async syncLaunchJson(config?: ProjectConfig): Promise<boolean> {
    if (!this.configService.hasWorkspace()) {
      vscode.window.showWarningMessage("Open a workspace folder first to generate launch.json.");
      return false;
    }

    const wsRoot = this.configService.getWorkspaceRoot();
    const vscodeDir = path.join(wsRoot, ".vscode");
    const launchPath = path.join(vscodeDir, "launch.json");

    const cfg = config ?? this.configService.readConfig();
    const debugPort = cfg.backend.debugPort ?? 5005;
    const devServerUrl = cfg.frontend.devServerUrl ?? "http://localhost:4200";
    const browserType = cfg.frontend.browserType === "msedge" ? "pwa-msedge" : "pwa-chrome";
    const webRoot = cfg.frontend.webRoot ?? "${workspaceFolder}/frontend";

    let launchObj: { version?: string; configurations?: Record<string, unknown>[]; compounds?: Record<string, unknown>[] } = {
      version: "0.2.0",
      configurations: [],
      compounds: []
    };

    if (fs.existsSync(launchPath)) {
      try {
        const content = fs.readFileSync(launchPath, "utf8");
        launchObj = JSON.parse(content);
      } catch (err) {
        throw new Error(`Failed to parse existing ${launchPath}: ${(err as Error).message}`);
      }
    }

    if (!Array.isArray(launchObj.configurations)) {
      launchObj.configurations = [];
    }
    if (!Array.isArray(launchObj.compounds)) {
      launchObj.compounds = [];
    }

    // Filter out previous DEM configurations to replace with up-to-date entries
    launchObj.configurations = launchObj.configurations.filter(c => {
      const name = String(c.name ?? "");
      return !name.startsWith("DEM:");
    });

    launchObj.compounds = launchObj.compounds.filter(c => {
      const name = String(c.name ?? "");
      return !name.startsWith("DEM:");
    });

    const springBootConfig: Record<string, unknown> = {
      name: "DEM: Attach Spring Boot",
      type: "java",
      request: "attach",
      hostName: "127.0.0.1",
      port: debugPort
    };

    const angularLaunchConfig: Record<string, unknown> = {
      name: "DEM: Debug Angular (Launch)",
      type: browserType,
      request: "launch",
      url: devServerUrl,
      webRoot: webRoot,
      sourceMaps: true
    };
    if (cfg.frontend.browserExecutable) {
      angularLaunchConfig.runtimeExecutable = cfg.frontend.browserExecutable;
    }
    if (cfg.frontend.userDataDir) {
      angularLaunchConfig.userDataDir = cfg.frontend.userDataDir;
    }
    if (cfg.frontend.browserArgs && cfg.frontend.browserArgs.length > 0) {
      angularLaunchConfig.runtimeArgs = cfg.frontend.browserArgs;
    }

    const browserDebugPort = cfg.frontend.browserDebugPort ?? 9222;
    const angularAttachConfig: Record<string, unknown> = {
      name: `DEM: Attach Browser (:${browserDebugPort})`,
      type: browserType,
      request: "attach",
      port: browserDebugPort,
      urlFilter: `${devServerUrl.replace(/\/+$/, "")}/*`,
      webRoot: webRoot,
      sourceMaps: true
    };

    const fullstackCompound: Record<string, unknown> = {
      name: "DEM: Fullstack Debug (Spring Boot + Angular)",
      configurations: ["DEM: Attach Spring Boot", "DEM: Debug Angular (Launch)"],
      stopAll: true
    };

    launchObj.configurations.push(springBootConfig, angularLaunchConfig, angularAttachConfig);
    launchObj.compounds.push(fullstackCompound);

    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(launchPath, JSON.stringify(launchObj, null, 2) + "\n", "utf8");

    vscode.window.showInformationMessage(
      `Synchronized DEM debug configurations to ${path.relative(wsRoot, launchPath)}.`
    );
    return true;
  }

  public getBreakpoints(): BreakpointInfo[] {
    const wsRoot = this.configService.hasWorkspace() ? this.configService.getWorkspaceRoot() : "";
    const list: BreakpointInfo[] = [];

    for (const bp of vscode.debug.breakpoints) {
      if (bp instanceof vscode.SourceBreakpoint) {
        const fsPath = bp.location.uri.fsPath;
        const rel = wsRoot ? path.relative(wsRoot, fsPath) : path.basename(fsPath);
        list.push({
          id: getBreakpointUniqueId(bp),
          enabled: bp.enabled,
          verified: true,
          filePath: fsPath,
          relativeFilePath: rel,
          line: bp.location.range.start.line + 1,
          column: bp.location.range.start.character + 1,
          condition: bp.condition,
          hitCondition: bp.hitCondition,
          logMessage: bp.logMessage
        });
      }
    }

    return list;
  }

  public toggleBreakpoint(id: string): void {
    const bp = vscode.debug.breakpoints.find(b => getBreakpointUniqueId(b) === id);
    if (!bp || !(bp instanceof vscode.SourceBreakpoint)) {
      return;
    }
    const currentEnabled = bp.enabled;
    const location = bp.location;
    const condition = bp.condition;
    const hitCondition = bp.hitCondition;
    const logMessage = bp.logMessage;

    vscode.debug.removeBreakpoints([bp]);
    const updated = new vscode.SourceBreakpoint(
      location,
      !currentEnabled,
      condition,
      hitCondition,
      logMessage
    );
    vscode.debug.addBreakpoints([updated]);
    this.onDidChangeEmitter.fire();
  }

  public removeBreakpoint(id: string): void {
    const bp = vscode.debug.breakpoints.find(b => getBreakpointUniqueId(b) === id);
    if (bp) {
      vscode.debug.removeBreakpoints([bp]);
      this.onDidChangeEmitter.fire();
    }
  }

  public clearAllBreakpoints(): void {
    vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    this.onDidChangeEmitter.fire();
  }

  public async jumpToBreakpoint(filePath: string, line: number): Promise<void> {
    if (!fs.existsSync(filePath)) {
      vscode.window.showWarningMessage(`File not found: ${filePath}`);
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    const editor = await vscode.window.showTextDocument(doc);
    const targetLine = Math.max(0, line - 1);
    const pos = new vscode.Position(targetLine, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(
      new vscode.Range(pos, pos),
      vscode.TextEditorRevealType.InCenter
    );
  }

  private handleDebugSessionStarted(session: vscode.DebugSession): void {
    const name = session.name;
    const type = session.type;

    if (name.includes("DEM: Attach Spring Boot") || (type === "java" && name.includes("DEM"))) {
      this.backendSessionId = session.id;
      this.logService.appendLine(
        "backend",
        "system",
        `[DEM Debug] Session active: ${name} (ID: ${session.id})`
      );
      this.onDidChangeEmitter.fire();
    } else if (
      name.includes("DEM: Debug Angular") ||
      type === "pwa-chrome" ||
      type === "pwa-msedge"
    ) {
      this.frontendSessionId = session.id;
      this.logService.appendLine(
        "frontend",
        "system",
        `[DEM Debug] Browser debug session active: ${name} (ID: ${session.id})`
      );
      this.onDidChangeEmitter.fire();
    }
  }

  private handleDebugSessionTerminated(session: vscode.DebugSession): void {
    if (this.backendSessionId === session.id) {
      this.backendSessionId = undefined;
      this.logService.appendLine(
        "backend",
        "system",
        `[DEM Debug] Spring Boot debug session terminated.`
      );
      this.onDidChangeEmitter.fire();
    }
    if (this.frontendSessionId === session.id) {
      this.frontendSessionId = undefined;
      this.frontendDebugActive = false;
      this.logService.appendLine(
        "frontend",
        "system",
        `[DEM Debug] Browser debug session terminated.`
      );
      this.onDidChangeEmitter.fire();
    }
  }
}
