import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { ChildProcess, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  AllTargetName,
  BuildState,
  ProcessState,
  ProcessStatus,
  ProcessTargetName,
  Profile,
  ProjectConfig,
  RunTarget
} from "../types/project-config";
import { ConfigService } from "./ConfigService";
import { makeEnvironment, quoteWindowsCmdToken, resolveCommand } from "./EnvironmentService";
import { getNodeVersionFromProfile, isUsingNvm, runNvmUse } from "./NvmService";
import { LogService, stripAnsi } from "./LogService";

const execFileAsync = promisify(execFile);

class TargetPseudoTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  public readonly onDidWrite = this.writeEmitter.event;
  private readonly buffer: string[] = [];
  private isOpen = false;

  constructor(
    private readonly targetName: AllTargetName,
    private readonly onCtrlC: () => void
  ) {}

  public open(): void {
    this.isOpen = true;
    for (const item of this.buffer) {
      this.writeEmitter.fire(item);
    }
  }

  public close(): void {
    this.isOpen = false;
  }

  public handleInput(data: string): void {
    if (data === "\u0003") {
      this.writeLine("\r\n^C — Stopping process via Dev Environment Manager...");
      this.onCtrlC();
    }
  }

  public writeRaw(text: string): void {
    const normalized = text.replace(/\r?\n/g, "\r\n");
    this.buffer.push(normalized);
    if (this.buffer.length > 500) {
      this.buffer.splice(0, this.buffer.length - 500);
    }
    if (this.isOpen) {
      this.writeEmitter.fire(normalized);
    }
  }

  public writeLine(line: string): void {
    this.writeRaw(line + "\r\n");
  }
}

type ManagedProcessRecord = {
  child?: ChildProcess;
  status: ProcessStatus;
  activeProfileId?: string;
  activeProfileLabel?: string;
  lastStartTime?: string;
  lastExitTime?: string;
  exitCode?: number | null;
  latestSummary: string;
  stopRequested: boolean;
  pty: TargetPseudoTerminal;
  terminal?: vscode.Terminal;
};

export function formatCommandLine(command: string, args: string[]): string {
  const all = [command, ...(args ?? [])];
  return all
    .map((part, idx) => {
      const normalized = part.replace(/"/g, '\\"');
      return idx === 0 && /\s/.test(part)
        ? `"${normalized}"`
        : /\s/.test(part)
          ? `"${normalized}"`
          : normalized;
    })
    .join(" ");
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        timeout: 8000
      });
      return;
    } catch {
      try {
        child.kill();
      } catch {
        // Ignore if already exited
      }
      return;
    }
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // Ignore if already exited
  }
}

export class ProcessManager implements vscode.Disposable {
  private readonly records = new Map<ProcessTargetName, ManagedProcessRecord>();
  private buildChild?: ChildProcess;
  private buildStopRequested = false;
  private buildPty: TargetPseudoTerminal;
  private buildTerminal?: vscode.Terminal;
  private buildStatus: BuildState["status"] = "idle";
  private buildActiveProfileId?: string;
  private buildLastStartTime?: string;
  private buildLastEndTime?: string;
  private buildExitCode?: number | null;
  private buildSummary = "Ready to run configured build task.";

  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly logService: LogService
  ) {
    for (const target of ["backend", "frontend"] as const) {
      this.records.set(target, {
        status: "stopped",
        latestSummary: "No process started in this session.",
        stopRequested: false,
        pty: new TargetPseudoTerminal(target, () => {
          void this.stopTarget(target);
        })
      });
    }

    this.buildPty = new TargetPseudoTerminal("build", () => {
      void this.stopBuild();
    });

    this.disposables.push(
      vscode.window.onDidCloseTerminal(closedTerminal => {
        for (const record of this.records.values()) {
          if (record.terminal === closedTerminal) {
            record.terminal = undefined;
          }
        }
        if (this.buildTerminal === closedTerminal) {
          this.buildTerminal = undefined;
        }
      })
    );
  }

  public getProcessState(target: ProcessTargetName, config?: ProjectConfig): ProcessState {
    const rec = this.records.get(target)!;
    let cfg: ProjectConfig | undefined = config;
    if (!cfg) {
      try {
        cfg = this.configService.readConfig();
      } catch {
        cfg = undefined;
      }
    }

    const targetCfg: RunTarget = cfg
      ? cfg[target]
      : {
          workingDirectory: target === "backend" ? "." : "frontend",
          command: target === "backend" ? "gradle" : "npm",
          args: target === "backend" ? ["root:bootRun"] : ["start"],
          terminalName: `DEM: ${target === "backend" ? "Backend" : "Frontend"}`
        };

    let resolvedDir = targetCfg.workingDirectory;
    let defaultProfileId = "unconfigured";
    let defaultProfileLabel = "Unconfigured";

    if (cfg) {
      try {
        resolvedDir = this.configService.resolveTargetDirectory(cfg, targetCfg.workingDirectory);
        const active = this.configService.getActiveProfile(cfg);
        defaultProfileId = active.id;
        defaultProfileLabel = active.profile.label ?? active.id;
      } catch {
        // Fallback to raw values
      }
    }

    const activeProfileId = rec.activeProfileId ?? defaultProfileId;
    const activeProfileLabel =
      rec.activeProfileLabel ??
      (cfg?.profiles[activeProfileId]?.label ?? defaultProfileLabel);

    return {
      target,
      name: target === "backend" ? "Backend" : "Frontend",
      status: rec.status,
      workingDirectory: targetCfg.workingDirectory,
      resolvedWorkingDirectory: resolvedDir,
      command: targetCfg.command,
      args: targetCfg.args ?? [],
      formattedCommand: formatCommandLine(targetCfg.command, targetCfg.args ?? []),
      activeProfileId,
      activeProfileLabel,
      pid: rec.child?.pid,
      lastStartTime: rec.lastStartTime,
      lastExitTime: rec.lastExitTime,
      exitCode: rec.exitCode,
      latestSummary: rec.latestSummary
    };
  }

  public getBuildState(config?: ProjectConfig): BuildState {
    let cfg: ProjectConfig | undefined = config;
    if (!cfg) {
      try {
        cfg = this.configService.readConfig();
      } catch {
        cfg = undefined;
      }
    }

    const buildCfg = cfg?.build ?? {
      workingDirectory: ".",
      command: "gradle",
      args: ["clean", "root:bootwar"]
    };

    let resolvedDir = buildCfg.workingDirectory;
    if (cfg) {
      try {
        resolvedDir = this.configService.resolveTargetDirectory(cfg, buildCfg.workingDirectory);
      } catch {
        // Ignore
      }
    }

    return {
      status: this.buildStatus,
      workingDirectory: buildCfg.workingDirectory,
      resolvedWorkingDirectory: resolvedDir,
      command: buildCfg.command,
      args: buildCfg.args ?? [],
      formattedCommand: formatCommandLine(buildCfg.command, buildCfg.args ?? []),
      activeProfileId: this.buildActiveProfileId,
      lastStartTime: this.buildLastStartTime,
      lastEndTime: this.buildLastEndTime,
      exitCode: this.buildExitCode,
      latestSummary: this.buildSummary
    };
  }

  public openTerminal(target: AllTargetName, preserveFocus = false): void {
    let cfg: ProjectConfig | undefined;
    try {
      cfg = this.configService.readConfig();
    } catch {
      cfg = undefined;
    }

    if (target === "build") {
      if (!this.buildTerminal) {
        const name = cfg?.build?.terminalName ?? "DEM: Build";
        this.buildTerminal = vscode.window.createTerminal({
          name,
          pty: this.buildPty
        });
      }
      this.buildTerminal.show(preserveFocus);
      return;
    }

    const rec = this.records.get(target)!;
    if (!rec.terminal) {
      const name =
        cfg?.[target]?.terminalName ??
        `DEM: ${target === "backend" ? "Backend" : "Frontend"}`;
      rec.terminal = vscode.window.createTerminal({
        name,
        pty: rec.pty
      });
    }
    rec.terminal.show(preserveFocus);
  }

  public async startTarget(
    targetName: ProcessTargetName,
    options: { promptIfRunning?: boolean; showTerminal?: boolean } = {}
  ): Promise<boolean> {
    const rec = this.records.get(targetName)!;
    if (rec.status === "running" || rec.status === "starting") {
      if (options.promptIfRunning) {
        const choice = await vscode.window.showWarningMessage(
          `${targetName === "backend" ? "Backend" : "Frontend"} is already running. Do you want to restart it?`,
          "Restart",
          "Cancel"
        );
        if (choice === "Restart") {
          await this.restartTarget(targetName);
          return true;
        }
      } else {
        vscode.window.showInformationMessage(
          `${targetName === "backend" ? "Backend" : "Frontend"} is already ${rec.status}.`
        );
      }
      return false;
    }

    if (rec.status === "stopping") {
      vscode.window.showWarningMessage(
        `${targetName === "backend" ? "Backend" : "Frontend"} is currently stopping. Please wait a moment.`
      );
      return false;
    }

    const config = this.configService.readConfig();
    const { id: profileId, profile } = this.configService.getActiveProfile(config);
    const targetCfg = config[targetName];
    const cwd = this.configService.resolveTargetDirectory(config, targetCfg.workingDirectory);

    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      const errMsg = `Working directory not found: ${cwd}`;
      rec.status = "error";
      rec.latestSummary = errMsg;
      rec.activeProfileId = profileId;
      rec.activeProfileLabel = profile.label ?? profileId;
      this.logService.appendLine(targetName, "stderr", errMsg);
      this.onDidChangeEmitter.fire();
      throw new Error(errMsg);
    }

    this.validateSafeExecution(targetCfg.command, targetCfg.args ?? []);

    const resolved = resolveCommand(targetCfg.command, profile);
    const resolvedExecutable = this.resolveTargetExecutableInCwd(
      resolved.executable,
      targetCfg.command,
      cwd,
      profile
    );

    const env = makeEnvironment(profile);
    const formattedCmd = formatCommandLine(resolvedExecutable, targetCfg.args ?? []);
    const startTime = new Date().toLocaleTimeString();

    rec.status = "starting";
    rec.stopRequested = false;
    rec.activeProfileId = profileId;
    rec.activeProfileLabel = profile.label ?? profileId;
    rec.lastStartTime = startTime;
    rec.lastExitTime = undefined;
    rec.exitCode = undefined;
    rec.latestSummary = `Starting: ${formattedCmd}`;
    this.onDidChangeEmitter.fire();

    const nodeVer = getNodeVersionFromProfile(profile, profileId);
    if (
      isUsingNvm(profile) &&
      nodeVer &&
      (targetName === "frontend" ||
        targetCfg.command.toLowerCase().includes("node") ||
        targetCfg.command.toLowerCase().includes("npm"))
    ) {
      this.logService.appendLine(
        targetName,
        "system",
        `[NVM] Switching Node.js version via 'nvm use ${nodeVer}'...`
      );
      const nvmRes = await runNvmUse(nodeVer);
      if (nvmRes.output) {
        rec.pty.writeLine(`\x1b[90m[NVM] ${nvmRes.output}\x1b[0m`);
      }
    }

    const headerLine = `=== [${targetName.toUpperCase()}] Starting (${startTime}) | Profile: ${profileId} | CWD: ${cwd} ===`;
    rec.pty.writeLine(`\r\n\x1b[36m${headerLine}\x1b[0m`);
    rec.pty.writeLine(`\x1b[90m$ ${formattedCmd}\x1b[0m`);
    this.logService.appendLine(
      targetName,
      "system",
      `Starting ${targetName} (Profile: ${profileId}) in ${cwd}: ${formattedCmd}`
    );

    if (options.showTerminal) {
      this.openTerminal(targetName, true);
    }

    try {
      const child = this.spawnManagedChild(resolvedExecutable, targetCfg.args ?? [], cwd, env);
      rec.child = child;

      child.on("spawn", () => {
        if (rec.status === "starting") {
          rec.status = "running";
          rec.latestSummary = `Running (PID ${child.pid ?? "active"}) — ${formatCommandLine(targetCfg.command, targetCfg.args ?? [])}`;
          this.onDidChangeEmitter.fire();
        }
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        rec.pty.writeRaw(text);
        const entries = this.logService.appendChunk(targetName, "stdout", text);
        if (entries.length > 0) {
          const lastNonEmpty = [...entries].reverse().find(e => e.text.trim().length > 0);
          if (lastNonEmpty) {
            rec.latestSummary = lastNonEmpty.text.trim().slice(0, 180);
            this.onDidChangeEmitter.fire();
          }
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        rec.pty.writeRaw(text);
        const entries = this.logService.appendChunk(targetName, "stderr", text);
        if (entries.length > 0) {
          const lastNonEmpty = [...entries].reverse().find(e => e.text.trim().length > 0);
          if (lastNonEmpty) {
            rec.latestSummary = lastNonEmpty.text.trim().slice(0, 180);
            this.onDidChangeEmitter.fire();
          }
        }
      });

      child.on("error", err => {
        const errMsg = stripAnsi(err.message);
        rec.child = undefined;
        rec.status = "error";
        rec.lastExitTime = new Date().toLocaleTimeString();
        rec.latestSummary = `Failed to start: ${errMsg}`;
        rec.pty.writeLine(`\x1b[31m[ERROR] ${errMsg}\x1b[0m`);
        this.logService.appendLine(targetName, "stderr", `Process error: ${errMsg}`);
        this.onDidChangeEmitter.fire();
      });

      child.on("close", (code, signal) => {
        const wasStoppedByUser = rec.stopRequested;
        rec.child = undefined;
        rec.stopRequested = false;
        rec.exitCode = code;
        rec.lastExitTime = new Date().toLocaleTimeString();

        if (wasStoppedByUser) {
          rec.status = "stopped";
          rec.latestSummary = `Stopped by user${code !== null ? ` (exit code ${code})` : ""}.`;
          rec.pty.writeLine(`\x1b[33m=== [${targetName.toUpperCase()}] Stopped by user ===\x1b[0m`);
          this.logService.appendLine(targetName, "system", rec.latestSummary);
        } else if (code === 0) {
          rec.status = "stopped";
          rec.latestSummary = "Process finished cleanly (exit code 0).";
          rec.pty.writeLine(`\x1b[32m=== [${targetName.toUpperCase()}] Exited (0) ===\x1b[0m`);
          this.logService.appendLine(targetName, "system", rec.latestSummary);
        } else {
          rec.status = "error";
          const codeDisplay = code !== null ? `code ${code}` : `signal ${signal ?? "unknown"}`;
          rec.latestSummary = `Process exited with ${codeDisplay}. ${rec.latestSummary}`;
          rec.pty.writeLine(
            `\x1b[31m=== [${targetName.toUpperCase()}] Exited with ${codeDisplay} ===\x1b[0m`
          );
          this.logService.appendLine(
            targetName,
            "stderr",
            `Process exited unexpectedly (${codeDisplay}).`
          );
        }

        this.onDidChangeEmitter.fire();
      });

      return true;
    } catch (err) {
      const msg = (err as Error).message;
      rec.status = "error";
      rec.latestSummary = `Spawn error: ${msg}`;
      this.logService.appendLine(targetName, "stderr", rec.latestSummary);
      this.onDidChangeEmitter.fire();
      throw err;
    }
  }

  public async stopTarget(targetName: ProcessTargetName): Promise<boolean> {
    const rec = this.records.get(targetName)!;
    if (!rec.child || (rec.status !== "running" && rec.status !== "starting")) {
      if (rec.status === "error") {
        rec.status = "stopped";
        rec.latestSummary = "Reset to stopped.";
        this.onDidChangeEmitter.fire();
      }
      return false;
    }

    const child = rec.child;
    rec.stopRequested = true;
    rec.status = "stopping";
    rec.latestSummary = "Stopping process tree...";
    this.logService.appendLine(targetName, "system", `Stopping ${targetName} (PID ${child.pid ?? "?"})...`);
    this.onDidChangeEmitter.fire();

    const closePromise = new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 6000);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await terminateProcessTree(child);
    await closePromise;

    if (rec.status === "stopping") {
      rec.child = undefined;
      rec.status = "stopped";
      rec.latestSummary = "Stopped by user.";
      this.onDidChangeEmitter.fire();
    }
    return true;
  }

  public async restartTarget(targetName: ProcessTargetName): Promise<void> {
    const rec = this.records.get(targetName)!;
    if (rec.child && (rec.status === "running" || rec.status === "starting")) {
      await this.stopTarget(targetName);
    }
    await this.startTarget(targetName);
  }

  public async runAll(): Promise<void> {
    const errors: string[] = [];
    for (const target of ["backend", "frontend"] as const) {
      const rec = this.records.get(target)!;
      if (rec.status === "running" || rec.status === "starting") {
        continue;
      }
      try {
        await this.startTarget(target);
      } catch (err) {
        errors.push(`${target}: ${(err as Error).message}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(errors.join(" | "));
    }
  }

  public async stopAll(): Promise<void> {
    await Promise.all([this.stopTarget("backend"), this.stopTarget("frontend")]);
  }

  public async restartAll(): Promise<void> {
    await this.stopAll();
    await this.runAll();
  }

  public async runBuildProject(showTerminal = false): Promise<boolean> {
    if (this.buildStatus === "running" && this.buildChild) {
      vscode.window.showInformationMessage("A project build is already in progress.");
      return false;
    }

    const config = this.configService.readConfig();
    const { id: profileId, profile } = this.configService.getActiveProfile(config);
    const buildCfg = config.build ?? {
      workingDirectory: ".",
      command: "gradle",
      args: ["clean", "root:bootwar"],
      terminalName: "DEM: Build"
    };

    const cwd = this.configService.resolveTargetDirectory(config, buildCfg.workingDirectory);
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      const errMsg = `Build working directory not found: ${cwd}`;
      this.buildStatus = "failed";
      this.buildSummary = errMsg;
      this.logService.appendLine("build", "stderr", errMsg);
      this.onDidChangeEmitter.fire();
      throw new Error(errMsg);
    }

    this.validateSafeExecution(buildCfg.command, buildCfg.args ?? []);
    const resolved = resolveCommand(buildCfg.command, profile);
    const resolvedExecutable = this.resolveTargetExecutableInCwd(
      resolved.executable,
      buildCfg.command,
      cwd,
      profile
    );
    const env = makeEnvironment(profile);
    const formattedCmd = formatCommandLine(resolvedExecutable, buildCfg.args ?? []);

    this.buildStatus = "running";
    this.buildStopRequested = false;
    this.buildActiveProfileId = profileId;
    this.buildLastStartTime = new Date().toLocaleTimeString();
    this.buildLastEndTime = undefined;
    this.buildExitCode = undefined;
    this.buildSummary = `Building: ${formatCommandLine(buildCfg.command, buildCfg.args ?? [])}`;
    this.onDidChangeEmitter.fire();

    this.buildPty.writeLine(
      `\r\n\x1b[36m=== [BUILD] Starting (${this.buildLastStartTime}) | Profile: ${profileId} | CWD: ${cwd} ===\x1b[0m`
    );
    this.buildPty.writeLine(`\x1b[90m$ ${formattedCmd}\x1b[0m`);
    this.logService.appendLine(
      "build",
      "system",
      `Starting project build (Profile: ${profileId}) in ${cwd}: ${formattedCmd}`
    );

    if (showTerminal) {
      this.openTerminal("build", true);
    }

    return new Promise<boolean>((resolve, reject) => {
      try {
        const child = this.spawnManagedChild(resolvedExecutable, buildCfg.args ?? [], cwd, env);
        this.buildChild = child;

        child.stdout?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          this.buildPty.writeRaw(text);
          const entries = this.logService.appendChunk("build", "stdout", text);
          const last = [...entries].reverse().find(e => e.text.trim().length > 0);
          if (last) {
            this.buildSummary = last.text.trim().slice(0, 180);
            this.onDidChangeEmitter.fire();
          }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          this.buildPty.writeRaw(text);
          const entries = this.logService.appendChunk("build", "stderr", text);
          const last = [...entries].reverse().find(e => e.text.trim().length > 0);
          if (last) {
            this.buildSummary = last.text.trim().slice(0, 180);
            this.onDidChangeEmitter.fire();
          }
        });

        child.on("error", err => {
          const errMsg = stripAnsi(err.message);
          this.buildChild = undefined;
          this.buildStatus = "failed";
          this.buildLastEndTime = new Date().toLocaleTimeString();
          this.buildSummary = `Build error: ${errMsg}`;
          this.buildPty.writeLine(`\x1b[31m[BUILD ERROR] ${errMsg}\x1b[0m`);
          this.logService.appendLine("build", "stderr", this.buildSummary);
          this.onDidChangeEmitter.fire();
          reject(err);
        });

        child.on("close", code => {
          this.buildChild = undefined;
          this.buildExitCode = code;
          this.buildLastEndTime = new Date().toLocaleTimeString();

          if (this.buildStopRequested) {
            this.buildStatus = "failed";
            this.buildSummary = "Build cancelled by user.";
            this.buildPty.writeLine(`\x1b[33m=== [BUILD] Cancelled ===\x1b[0m`);
            this.logService.appendLine("build", "system", this.buildSummary);
            this.onDidChangeEmitter.fire();
            resolve(false);
            return;
          }

          if (code === 0) {
            this.buildStatus = "succeeded";
            this.buildSummary = `Build succeeded at ${this.buildLastEndTime}.`;
            this.buildPty.writeLine(`\x1b[32m=== [BUILD] Succeeded (0) ===\x1b[0m`);
            this.logService.appendLine("build", "system", this.buildSummary);
            this.onDidChangeEmitter.fire();
            resolve(true);
          } else {
            this.buildStatus = "failed";
            this.buildSummary = `Build failed with exit code ${code ?? "unknown"}.`;
            this.buildPty.writeLine(
              `\x1b[31m=== [BUILD] Failed (exit code ${code ?? "unknown"}) ===\x1b[0m`
            );
            this.logService.appendLine("build", "stderr", this.buildSummary);
            this.onDidChangeEmitter.fire();
            resolve(false);
          }
        });
      } catch (err) {
        this.buildChild = undefined;
        this.buildStatus = "failed";
        this.buildSummary = `Build failed to start: ${(err as Error).message}`;
        this.onDidChangeEmitter.fire();
        reject(err);
      }
    });
  }

  public async stopBuild(): Promise<void> {
    if (!this.buildChild) {
      return;
    }
    this.buildStopRequested = true;
    await terminateProcessTree(this.buildChild);
  }

  private resolveTargetExecutableInCwd(
    resolvedFromProfile: string,
    rawCommand: string,
    cwd: string,
    profile: Profile
  ): string {
    const lower = rawCommand.trim().toLowerCase();
    if (lower === "gradlew" || lower === "./gradlew" || lower === ".\\gradlew" || lower === "gradlew.bat") {
      const candidates =
        process.platform === "win32"
          ? [path.join(cwd, "gradlew.bat"), path.join(cwd, "gradlew")]
          : [path.join(cwd, "gradlew")];
      const found = candidates.find(p => fs.existsSync(p));
      if (found) {
        return found;
      }
    }
    const reResolved = resolveCommand(rawCommand, profile);
    return reResolved.executable || resolvedFromProfile;
  }

  private validateSafeExecution(command: string, args: string[]): void {
    if (!command || typeof command !== "string" || !command.trim()) {
      throw new Error("Command cannot be empty.");
    }
    if (/[\r\n\0;&|`$<>]/.test(command)) {
      throw new Error(`Command "${command}" contains disallowed shell metacharacters.`);
    }
    for (const arg of args) {
      if (/[\r\n\0]/.test(arg)) {
        throw new Error("Command arguments contain invalid control characters.");
      }
    }
  }

  private spawnManagedChild(
    executable: string,
    args: string[],
    cwd: string,
    env: Record<string, string>
  ): ChildProcess {
    const isWin = process.platform === "win32";
    const isDirectWinExe =
      isWin && executable.toLowerCase().endsWith(".exe") && path.isAbsolute(executable);

    if (isWin && !isDirectWinExe) {
      const comspec = process.env.ComSpec || "cmd.exe";
      const innerCommand = [
        quoteWindowsCmdToken(executable),
        ...args.map(arg => quoteWindowsCmdToken(arg))
      ].join(" ");
      return spawn(comspec, ["/d", "/s", "/c", `"${innerCommand}"`], {
        cwd,
        env,
        windowsHide: true,
        windowsVerbatimArguments: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });
    }

    return spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }

  public dispose(): void {
    for (const rec of this.records.values()) {
      if (rec.child) {
        void terminateProcessTree(rec.child);
      }
      rec.terminal?.dispose();
    }
    if (this.buildChild) {
      void terminateProcessTree(this.buildChild);
    }
    this.buildTerminal?.dispose();
    this.onDidChangeEmitter.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

