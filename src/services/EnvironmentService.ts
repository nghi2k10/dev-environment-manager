import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import {
  DiagnosticToolId,
  DiagnosticToolResult,
  DiagnosticsState,
  Profile
} from "../types/project-config";
import { ConfigService, normalizeConfigPathValue } from "./ConfigService";
import { LogService, stripAnsi } from "./LogService";

export function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find(k => k.toLowerCase() === "path") ?? "Path";
}

import {
  findNvmNodeHome,
  getNodeVersionFromProfile,
  isUsingNvm,
  runNvmUse
} from "./NvmService";

export { findNvmNodeHome, getNodeVersionFromProfile, isUsingNvm, runNvmUse };

export function makeEnvironment(profile: Profile): Record<string, string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = getPathKey(env);
  const javaHome = normalizeConfigPathValue(profile.javaHome);
  const gradleHome = normalizeConfigPathValue(profile.gradleHome);
  let nodeHome = profile.nodeHome ? normalizeConfigPathValue(profile.nodeHome) : "";

  if (isUsingNvm(profile) || !nodeHome || !fs.existsSync(nodeHome)) {
    const ver = getNodeVersionFromProfile(profile);
    if (ver) {
      const found = findNvmNodeHome(ver);
      if (found) {
        nodeHome = found;
      }
    }
  }

  const additions = [
    path.join(javaHome, "bin"),
    path.join(gradleHome, "bin")
  ];
  if (nodeHome && fs.existsSync(nodeHome)) {
    additions.push(nodeHome);
  }
  const existingPath = env[pathKey] ?? env.PATH ?? "";
  env.JAVA_HOME = javaHome;
  env.GRADLE_HOME = gradleHome;
  if (nodeHome && fs.existsSync(nodeHome)) {
    env.NODE_HOME = nodeHome;
  }
  env.PATH = [...additions, existingPath].filter(Boolean).join(path.delimiter);
  env[pathKey] = env.PATH;

  if (profile.env && typeof profile.env === "object") {
    for (const [k, v] of Object.entries(profile.env)) {
      if (typeof v === "string") {
        env[k] = v;
        if (k.toUpperCase() === "PATH") {
          env[pathKey] = v;
        }
      }
    }
  }

  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function resolveCommand(
  command: string,
  profile: Profile
): { executable: string; usedFallback: boolean; expectedPath?: string } {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();
  const javaHome = normalizeConfigPathValue(profile.javaHome);
  const gradleHome = normalizeConfigPathValue(profile.gradleHome);
  const nodeHome = profile.nodeHome ? normalizeConfigPathValue(profile.nodeHome) : "";

  if (lower === "java") {
    const candidates =
      process.platform === "win32"
        ? [path.join(javaHome, "bin", "java.exe"), path.join(javaHome, "bin", "java")]
        : [path.join(javaHome, "bin", "java")];
    const found = candidates.find(p => fs.existsSync(p));
    return {
      executable: found ?? candidates[0],
      usedFallback: false,
      expectedPath: candidates[0]
    };
  }

  if (lower === "gradle") {
    const candidates =
      process.platform === "win32"
        ? [path.join(gradleHome, "bin", "gradle.bat"), path.join(gradleHome, "bin", "gradle")]
        : [path.join(gradleHome, "bin", "gradle")];
    const found = candidates.find(p => fs.existsSync(p));
    return {
      executable: found ?? trimmed,
      usedFallback: !found,
      expectedPath: candidates[0]
    };
  }

  if (lower === "npm") {
    let effectiveNodeHome = nodeHome;
    if (isUsingNvm(profile) || !effectiveNodeHome || !fs.existsSync(effectiveNodeHome)) {
      const ver = getNodeVersionFromProfile(profile);
      if (ver) {
        const found = findNvmNodeHome(ver);
        if (found) {
          effectiveNodeHome = found;
        }
      }
    }

    if (effectiveNodeHome && fs.existsSync(effectiveNodeHome)) {
      const candidates =
        process.platform === "win32"
          ? [path.join(effectiveNodeHome, "npm.cmd"), path.join(effectiveNodeHome, "npm")]
          : [path.join(effectiveNodeHome, "bin", "npm"), path.join(effectiveNodeHome, "npm")];
      const found = candidates.find(p => fs.existsSync(p));
      if (found) {
        return {
          executable: found,
          usedFallback: false,
          expectedPath: found
        };
      }
    }

    return {
      executable: "npm",
      usedFallback: false,
      expectedPath: "npm"
    };
  }

  if (lower === "node") {
    let effectiveNodeHome = nodeHome;
    if (isUsingNvm(profile) || !effectiveNodeHome || !fs.existsSync(effectiveNodeHome)) {
      const ver = getNodeVersionFromProfile(profile);
      if (ver) {
        const found = findNvmNodeHome(ver);
        if (found) {
          effectiveNodeHome = found;
        }
      }
    }

    if (effectiveNodeHome && fs.existsSync(effectiveNodeHome)) {
      const candidates =
        process.platform === "win32"
          ? [path.join(effectiveNodeHome, "node.exe"), path.join(effectiveNodeHome, "node")]
          : [path.join(effectiveNodeHome, "bin", "node"), path.join(effectiveNodeHome, "node")];
      const found = candidates.find(p => fs.existsSync(p));
      if (found) {
        return {
          executable: found,
          usedFallback: false,
          expectedPath: found
        };
      }
    }

    return {
      executable: "node",
      usedFallback: false,
      expectedPath: "node"
    };
  }

  return { executable: trimmed, usedFallback: false };
}

export function quoteWindowsCmdToken(token: string): string {
  const escaped = token.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function executeCommandCapture(
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs = 20000
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const isDirectWinExe = isWin && executable.toLowerCase().endsWith(".exe") && path.isAbsolute(executable);

    let spawnCmd = executable;
    let spawnArgs = args;
    let windowsVerbatimArguments = false;

    if (isWin && !isDirectWinExe) {
      spawnCmd = process.env.ComSpec || "cmd.exe";
      const innerCommand = [
        quoteWindowsCmdToken(executable),
        ...args.map(arg => quoteWindowsCmdToken(arg))
      ].join(" ");
      spawnArgs = ["/d", "/s", "/c", `"${innerCommand}"`];
      windowsVerbatimArguments = true;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: fs.existsSync(cwd) ? cwd : process.cwd(),
      env,
      windowsHide: true,
      windowsVerbatimArguments,
      shell: false
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s: ${executable}`));
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 256 * 1024) {
        stdout += chunk.toString("utf8");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 256 * 1024) {
        stderr += chunk.toString("utf8");
      }
    });

    child.on("error", err => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", code => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code });
      }
    });
  });
}

function summarizeDetectedVersion(toolId: DiagnosticToolId, outputText: string): string {
  const lines = outputText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "Unknown version";
  }

  if (toolId === "java") {
    const versionLine = lines.find(l => /version/i.test(l)) ?? lines[0];
    return versionLine;
  }
  if (toolId === "gradle") {
    const gradleLine = lines.find(l => /^Gradle\s+/i.test(l)) ?? lines[0];
    return gradleLine;
  }
  return lines[0];
}

export function createInitialDiagnosticsResults(profile?: Profile): DiagnosticToolResult[] {
  const javaRes = profile ? resolveCommand("java", profile) : { executable: "java", usedFallback: false };
  const gradleRes = profile ? resolveCommand("gradle", profile) : { executable: "gradle", usedFallback: false };
  const nodeRes = profile ? resolveCommand("node", profile) : { executable: "node", usedFallback: false };
  const npmRes = profile ? resolveCommand("npm", profile) : { executable: "npm", usedFallback: false };

  return [
    {
      id: "java",
      toolName: "Java",
      commandDisplay: "java -version",
      status: "idle",
      detectedVersion: "Not checked yet",
      rawOutput: "",
      executablePath: javaRes.expectedPath ?? javaRes.executable
    },
    {
      id: "gradle",
      toolName: "Gradle",
      commandDisplay: "gradle -version",
      status: "idle",
      detectedVersion: "Not checked yet",
      rawOutput: "",
      executablePath: gradleRes.expectedPath ?? gradleRes.executable
    },
    {
      id: "node",
      toolName: "Node.js",
      commandDisplay: "node -v",
      status: "idle",
      detectedVersion: "Not checked yet",
      rawOutput: "",
      executablePath: nodeRes.expectedPath ?? nodeRes.executable
    },
    {
      id: "npm",
      toolName: "npm",
      commandDisplay: "npm -v",
      status: "idle",
      detectedVersion: "Not checked yet",
      rawOutput: "",
      executablePath: npmRes.expectedPath ?? npmRes.executable
    }
  ];
}

export class EnvironmentService {
  private state: DiagnosticsState = {
    isChecking: false,
    results: createInitialDiagnosticsResults()
  };

  private readonly onDidChangeEmitter = new vscode.EventEmitter<DiagnosticsState>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(
    private readonly configService: ConfigService,
    private readonly logService: LogService
  ) {}

  public getDiagnosticsState(currentProfile?: { id: string; profile: Profile }): DiagnosticsState {
    if (!this.state.profileId && currentProfile) {
      return {
        isChecking: this.state.isChecking,
        profileId: currentProfile.id,
        profileLabel: currentProfile.profile.label ?? currentProfile.id,
        lastCheckedAt: this.state.lastCheckedAt,
        results: createInitialDiagnosticsResults(currentProfile.profile)
      };
    }
    return this.state;
  }

  public async runDiagnostics(showOutput = false): Promise<DiagnosticsState> {
    if (this.state.isChecking) {
      return this.state;
    }

    const config = this.configService.readConfig();
    const { id, profile } = this.configService.getActiveProfile(config);
    const env = makeEnvironment(profile);
    const root = this.configService.getWorkspaceRoot();

    this.logService.appendOutputChannelOnly("");
    this.logService.appendOutputChannelOnly(
      `=== Environment Check: ${config.name ?? path.basename(root)} (${id}) ===`
    );
    this.logService.appendOutputChannelOnly(`JAVA_HOME: ${profile.javaHome}`);
    this.logService.appendOutputChannelOnly(`GRADLE_HOME: ${profile.gradleHome}`);
    const nodeVer = getNodeVersionFromProfile(profile, id);
    const useNvm = isUsingNvm(profile);
    if (useNvm) {
      this.logService.appendOutputChannelOnly(
        `NODE: Managed via NVM (target: ${nodeVer ? `nvm use ${nodeVer}` : "system default"})`
      );
      if (nodeVer) {
        this.logService.appendOutputChannelOnly(`[NVM] Running 'nvm use ${nodeVer}'...`);
        const nvmRes = await runNvmUse(nodeVer);
        this.logService.appendOutputChannelOnly(
          `[NVM] ${nvmRes.output || (nvmRes.success ? "Success" : "Failed")}`
        );
      }
    } else {
      this.logService.appendOutputChannelOnly(`NODE_HOME: ${profile.nodeHome}`);
    }

    const specs: Array<{
      id: DiagnosticToolId;
      toolName: string;
      commandDisplay: string;
      commandKey: string;
      args: string[];
    }> = [
      { id: "java", toolName: "Java", commandDisplay: "java -version", commandKey: "java", args: ["-version"] },
      { id: "gradle", toolName: "Gradle", commandDisplay: "gradle -version", commandKey: "gradle", args: ["-version"] },
      { id: "node", toolName: "Node.js", commandDisplay: "node -v", commandKey: "node", args: ["-v"] },
      { id: "npm", toolName: "npm", commandDisplay: "npm -v", commandKey: "npm", args: ["-v"] }
    ];

    this.state = {
      isChecking: true,
      profileId: id,
      profileLabel: profile.label ?? id,
      lastCheckedAt: this.state.lastCheckedAt,
      results: specs.map(spec => {
        const resolved = resolveCommand(spec.commandKey, profile);
        return {
          id: spec.id,
          toolName: spec.toolName,
          commandDisplay: spec.commandDisplay,
          status: "checking",
          detectedVersion: "Checking...",
          rawOutput: "",
          executablePath: resolved.expectedPath ?? resolved.executable
        };
      })
    };
    this.onDidChangeEmitter.fire(this.state);

    const updatedResults: DiagnosticToolResult[] = [];

    for (const spec of specs) {
      const resolved = resolveCommand(spec.commandKey, profile);
      const checkedAt = new Date().toLocaleTimeString();

      if (spec.id === "java" && resolved.expectedPath && !fs.existsSync(resolved.expectedPath)) {
        const errMsg = `Executable not found at configured path: ${resolved.expectedPath}`;
        this.logService.appendOutputChannelOnly(`[ERROR] ${spec.toolName}: ${errMsg}`);
        updatedResults.push({
          id: spec.id,
          toolName: spec.toolName,
          commandDisplay: spec.commandDisplay,
          status: "failed",
          detectedVersion: "Executable missing",
          rawOutput: "",
          executablePath: resolved.expectedPath,
          errorDetails: errMsg,
          checkedAt
        });
        continue;
      }

      try {
        const res = await executeCommandCapture(resolved.executable, spec.args, root, env, 20000);
        const combined = stripAnsi([res.stdout, res.stderr].filter(Boolean).join("\n").trim());

        if (res.exitCode === 0 && combined.length > 0) {
          const summary = summarizeDetectedVersion(spec.id, combined);
          const isWarning = resolved.usedFallback;
          const warningMessage = isWarning
            ? `Profile binary not found at "${resolved.expectedPath}". Resolved from system PATH instead.`
            : undefined;

          this.logService.appendOutputChannelOnly(
            `[${isWarning ? "WARN" : "OK"}] ${spec.toolName}: ${combined.replace(/\r?\n/g, " | ")}`
          );

          updatedResults.push({
            id: spec.id,
            toolName: spec.toolName,
            commandDisplay: spec.commandDisplay,
            status: isWarning ? "warning" : "passed",
            detectedVersion: summary,
            rawOutput: combined,
            executablePath: isWarning
              ? `${resolved.executable} (PATH fallback; missing ${resolved.expectedPath})`
              : resolved.executable,
            errorDetails: warningMessage,
            checkedAt
          });
        } else {
          const errDetails =
            combined || `Command exited with code ${res.exitCode ?? "unknown"} (${resolved.executable})`;
          this.logService.appendOutputChannelOnly(
            `[ERROR] ${spec.toolName}: ${errDetails.replace(/\r?\n/g, " | ")}`
          );
          updatedResults.push({
            id: spec.id,
            toolName: spec.toolName,
            commandDisplay: spec.commandDisplay,
            status: "failed",
            detectedVersion: "Validation failed",
            rawOutput: combined,
            executablePath: resolved.expectedPath ?? resolved.executable,
            errorDetails: errDetails,
            checkedAt
          });
        }
      } catch (err) {
        const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        const details = stripAnsi(
          [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim()
        );
        this.logService.appendOutputChannelOnly(
          `[ERROR] ${spec.toolName}: ${details.replace(/\r?\n/g, " | ")}`
        );
        updatedResults.push({
          id: spec.id,
          toolName: spec.toolName,
          commandDisplay: spec.commandDisplay,
          status: "failed",
          detectedVersion: "Check failed",
          rawOutput: details,
          executablePath: resolved.expectedPath ?? resolved.executable,
          errorDetails: details,
          checkedAt
        });
      }
    }

    this.state = {
      isChecking: false,
      profileId: id,
      profileLabel: profile.label ?? id,
      lastCheckedAt: new Date().toLocaleTimeString(),
      results: updatedResults
    };
    this.onDidChangeEmitter.fire(this.state);

    if (showOutput) {
      this.logService.showOutputChannel(true);
    }

    return this.state;
  }
}

