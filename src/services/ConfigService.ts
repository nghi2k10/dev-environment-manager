import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  BackendTarget,
  BuildTarget,
  FrontendTarget,
  Profile,
  ProfileDetailsView,
  ProjectConfig,
  RunTarget
} from "../types/project-config";
import { ConfigurationUpdatePayload } from "../dashboard/DashboardMessages";
import {
  getNodeVersionFromProfile,
  isUsingNvm,
  runNvmUse
} from "./NvmService";
import { detectProjectJavaVersion } from "./ProjectScanService";

export const CONFIG_DEFAULT = ".vscode/project-build-manager.json";

const TEMPLATE_STATE_KEY = "dem.machineConfigTemplate.v1";

const DEFAULT_BUILD_TARGET: BuildTarget = {
  workingDirectory: ".",
  command: "gradle",
  args: ["clean", "root:bootwar"],
  terminalName: "DEM: Build"
};

const FORBIDDEN_SECRET_PATTERNS = /password|passwd|secret|token|apikey|api_key|private_key|credential/i;

export function normalizeConfigPathValue(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^[a-zA-Z]:\\\\/.test(trimmed)) {
    return path.normalize(trimmed.replace(/\\\\+/g, "\\"));
  }
  return path.normalize(trimmed);
}

export function extractProfileVersions(
  id: string,
  profile: Profile
): { javaVersion: string; gradleVersion: string; nodeVersion: string } {
  const label = profile.label ?? "";
  const javaFromLabel = label.match(/Java\s+([0-9._+-]+)/i)?.[1];
  const gradleFromLabel = label.match(/Gradle\s+([0-9._+-]+)/i)?.[1];
  const nodeFromLabel = label.match(/Node(?:\.js)?\s+([0-9._+-]+)/i)?.[1];

  const javaFromPath =
    profile.javaHome.match(/jdk[-_]?([0-9._]+)/i)?.[1] ??
    id.match(/java([0-9]+)/i)?.[1] ??
    "Configured";
  const gradleFromPath =
    profile.gradleHome.match(/gradle[-_]?([0-9._]+)/i)?.[1] ?? "Configured";
  const nodeFromVersion = profile.nodeVersion ? profile.nodeVersion.replace(/^v/i, "") : undefined;
  const nodeFromPath = profile.nodeHome
    ? profile.nodeHome.match(/node[-_]?v?([0-9._]+)/i)?.[1] ?? id.match(/node([0-9]+)/i)?.[1] ?? "Configured"
    : "Configured";

  return {
    javaVersion: javaFromLabel ? `Java ${javaFromLabel}` : `Java ${javaFromPath}`,
    gradleVersion: gradleFromLabel ? `Gradle ${gradleFromLabel}` : `Gradle ${gradleFromPath}`,
    nodeVersion: nodeFromVersion
      ? `Node.js ${nodeFromVersion}`
      : nodeFromLabel
        ? `Node.js ${nodeFromLabel}`
        : `Node.js ${nodeFromPath}`
  };
}

export class ConfigService {
  private sessionProfileId: string | undefined;
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.onDidChangeEmitter.event;
  private globalState: vscode.Memento | undefined;
  private lastRememberedTemplate = "";

  public setGlobalState(state: vscode.Memento): void {
    this.globalState = state;
  }

  private loadTemplate(): Record<string, unknown> | undefined {
    const tpl = this.globalState?.get<Record<string, unknown>>(TEMPLATE_STATE_KEY);
    if (
      !tpl ||
      typeof tpl !== "object" ||
      !tpl.profiles ||
      typeof tpl.profiles !== "object" ||
      Object.keys(tpl.profiles).length === 0 ||
      !tpl.backend ||
      !tpl.frontend
    ) {
      return undefined;
    }
    return JSON.parse(JSON.stringify(tpl)) as Record<string, unknown>;
  }

  public rememberTemplate(raw: Record<string, unknown>): void {
    if (!this.globalState || !raw.profiles || !raw.backend || !raw.frontend) {
      return;
    }
    const snapshot: Record<string, unknown> = {
      activeProfile: raw.activeProfile,
      profiles: raw.profiles,
      backend: raw.backend,
      frontend: raw.frontend,
      build: raw.build
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.lastRememberedTemplate) {
      return;
    }
    this.lastRememberedTemplate = serialized;
    void this.globalState.update(TEMPLATE_STATE_KEY, JSON.parse(serialized));
  }

  private getProfileJavaMajor(id: string, profile: Profile): number | undefined {
    const fromLabel = (profile.label ?? "").match(/Java\s+(?:1\.)?(\d+)/i)?.[1];
    const fromId = id.match(/java(?:1\.)?(\d+)/i)?.[1];
    const fromPath = (profile.javaHome ?? "").match(/(?:jdk|java)[-_ ]?(?:1\.)?(\d+)/i)?.[1];
    const raw = fromLabel ?? fromId ?? fromPath;
    return raw ? parseInt(raw, 10) : undefined;
  }

  public findProfileIdForJavaMajor(
    profiles: Record<string, Profile>,
    major: number
  ): string | undefined {
    return Object.entries(profiles).find(([id, p]) => this.getProfileJavaMajor(id, p) === major)?.[0];
  }

  public applyDetectedProfile(): { major: number; profileId: string; source: string } | undefined {
    if (!this.hasWorkspace()) {
      return undefined;
    }
    const config = this.readConfig();
    const detected = detectProjectJavaVersion(this.resolveProjectRoot(config));
    if (!detected) {
      return undefined;
    }
    const profileId = this.findProfileIdForJavaMajor(config.profiles, detected.major);
    if (!profileId) {
      return undefined;
    }
    if (this.getActiveProfile(config).id !== profileId) {
      this.setSessionProfile(profileId);
    }
    return { major: detected.major, profileId, source: detected.source };
  }

  public hasWorkspace(): boolean {
    return Boolean(vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0);
  }

  public getWorkspaceRoot(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error("No workspace folder is open in VS Code. Open a project folder first.");
    }
    return folder.uri.fsPath;
  }

  public getWorkspaceName(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? folder.name : "No Workspace";
  }

  public getConfigFilePath(): string {
    const configured = vscode.workspace
      .getConfiguration("devEnvironmentManager")
      .get<string>("configFile", CONFIG_DEFAULT);
    return path.resolve(this.getWorkspaceRoot(), configured);
  }

  public resolveProjectRoot(config: ProjectConfig): string {
    const wsRoot = this.getWorkspaceRoot();
    if (!config.projectRoot || config.projectRoot.trim() === "" || config.projectRoot.trim() === ".") {
      return wsRoot;
    }
    const normalizedRoot = normalizeConfigPathValue(config.projectRoot);
    if (path.isAbsolute(normalizedRoot)) {
      if (fs.existsSync(normalizedRoot)) {
        return normalizedRoot;
      }
      return wsRoot;
    }
    return path.resolve(wsRoot, normalizedRoot);
  }

  public resolveTargetDirectory(config: ProjectConfig, workingDirectory: string): string {
    const baseRoot = this.resolveProjectRoot(config);
    const cleaned = normalizeConfigPathValue(workingDirectory || ".");
    return path.isAbsolute(cleaned) ? cleaned : path.resolve(baseRoot, cleaned);
  }

  public ensureConfigFileExists(): { created: boolean; path: string } {
    if (!this.hasWorkspace()) {
      return { created: false, path: "" };
    }
    const file = this.getConfigFilePath();
    if (fs.existsSync(file)) {
      return { created: false, path: file };
    }

    const wsRoot = this.getWorkspaceRoot();
    const wsName = this.getWorkspaceName();

    const defaultConfig: ProjectConfig = {
      name: wsName,
      projectRoot: wsRoot,
      activeProfile: "java17-node20",
      profiles: {
        "java8-node10": {
          label: "Java 8 / Gradle 3.5.1 / Node.js 10.24.1",
          javaHome: "E:\\soft\\jdk8",
          gradleHome: "E:\\soft\\gradle-3.5.1",
          nodeVersion: "10.24.1",
          backendArgs: ["run"]
        },
        "java11-node14": {
          label: "Java 11 / Gradle 6.9.1 / Node.js 14.20.0",
          javaHome: "E:\\soft\\jdk11",
          gradleHome: "E:\\soft\\gradle-6.9.1",
          nodeVersion: "14.20.0",
          backendArgs: ["root:bootRun"]
        },
        "java17-node20": {
          label: "Java 17 / Gradle 8.8 / Node.js 20.14.0",
          javaHome: "E:\\soft\\jdk17",
          gradleHome: "E:\\soft\\gradle-8.8",
          nodeVersion: "20.14.0",
          backendArgs: ["root:bootRun"]
        },
        "java21-node20": {
          label: "Java 21 / Gradle 8.8 / Node.js 20.14.0",
          javaHome: "E:\\soft\\jdk21",
          gradleHome: "E:\\soft\\gradle-8.8",
          nodeVersion: "20.14.0",
          backendArgs: ["root:bootRun"]
        }
      },
      backend: {
        workingDirectory: ".",
        command: "gradle",
        args: ["root:bootRun"],
        terminalName: "DEM: Backend",
        debugPort: 5005,
        serverPort: 8080,
        springProfile: "dev",
        jdwpMode: "javaToolOptions",
        jvmSuspend: false,
        autoAttachDebugger: true
      },
      frontend: {
        workingDirectory: "frontend",
        command: "npm",
        args: ["start"],
        terminalName: "DEM: Frontend",
        devServerUrl: "http://localhost:4200",
        browserType: "chrome",
        webRoot: "${workspaceFolder}/frontend"
      },
      build: {
        workingDirectory: ".",
        command: "gradle",
        args: ["clean", "root:bootwar"]
      }
    };

    // Prefer template from machine storage if exists, while preserving current workspace name & root
    const template = this.loadTemplate();
    const finalConfig: Record<string, unknown> = template
      ? { ...template, name: wsName, projectRoot: wsRoot }
      : (defaultConfig as unknown as Record<string, unknown>);

    // Detect Java version from application-dev.yml / application-dev.properties
    const profiles = finalConfig.profiles as Record<string, Profile>;
    const detected = detectProjectJavaVersion(wsRoot);
    const byVersion = detected ? this.findProfileIdForJavaMajor(profiles, detected.major) : undefined;
    const templateActive =
      typeof finalConfig.activeProfile === "string" && profiles[finalConfig.activeProfile]
        ? finalConfig.activeProfile
        : Object.keys(profiles)[0];
    finalConfig.activeProfile = byVersion ?? templateActive;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(finalConfig, null, 2) + "\n", "utf8");
    this.onDidChangeEmitter.fire();
    return { created: true, path: file };
  }

  public autoSyncProjectRoot(force = false): { updated: boolean; oldRoot?: string; newRoot: string } {
    if (!this.hasWorkspace()) {
      return { updated: false, newRoot: "" };
    }
    const file = this.getConfigFilePath();
    if (!fs.existsSync(file)) {
      this.ensureConfigFileExists();
      return { updated: true, newRoot: this.getWorkspaceRoot() };
    }

    const wsRoot = this.getWorkspaceRoot();
    const wsName = this.getWorkspaceName();

    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return { updated: false, newRoot: wsRoot };
    }

    const currentProjectRoot = typeof raw.projectRoot === "string" ? raw.projectRoot.trim() : "";
    const normalizedCurrent = currentProjectRoot ? normalizeConfigPathValue(currentProjectRoot) : "";
    const isInvalidOrMissing =
      !currentProjectRoot ||
      currentProjectRoot === "." ||
      !fs.existsSync(normalizedCurrent) ||
      normalizedCurrent.toLowerCase().includes("ccc\\code\\ccc");

    if (force || isInvalidOrMissing) {
      if (normalizedCurrent.toLowerCase() !== wsRoot.toLowerCase()) {
        raw.projectRoot = wsRoot;
        if (!raw.name || raw.name === "CCC") {
          raw.name = wsName;
        }
        fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n", "utf8");
        this.onDidChangeEmitter.fire();
        return { updated: true, oldRoot: currentProjectRoot, newRoot: wsRoot };
      }
    }

    return { updated: false, newRoot: currentProjectRoot || wsRoot };
  }

  public readConfig(): ProjectConfig {
    const file = this.getConfigFilePath();
    if (!fs.existsSync(file)) {
      this.ensureConfigFileExists();
    }
    if (!fs.existsSync(file)) {
      throw new Error(
        `Configuration file not found: ${file}. Create ${CONFIG_DEFAULT} in your workspace.`
      );
    }

    let rawText: string;
    try {
      rawText = fs.readFileSync(file, "utf8");
    } catch (err) {
      throw new Error(`Unable to read configuration file ${file}: ${(err as Error).message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (err) {
      throw new Error(
        `Malformed JSON in ${path.basename(file)}: ${(err as Error).message}. Please fix syntax errors in ${CONFIG_DEFAULT}.`
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid configuration root in ${CONFIG_DEFAULT}: expected a JSON object.`);
    }

    const cfg = parsed as Partial<ProjectConfig>;
    if (!cfg.profiles || typeof cfg.profiles !== "object" || Object.keys(cfg.profiles).length === 0) {
      throw new Error("Configuration 'profiles' is empty or missing.");
    }
    if (!cfg.backend || typeof cfg.backend !== "object") {
      throw new Error("Configuration is missing the 'backend' target section.");
    }
    if (!cfg.frontend || typeof cfg.frontend !== "object") {
      throw new Error("Configuration is missing the 'frontend' target section.");
    }

    const normalizedProfiles: Record<string, Profile> = {};
    for (const [id, rawProfile] of Object.entries(cfg.profiles)) {
      if (!rawProfile || typeof rawProfile !== "object") {
        continue;
      }
      normalizedProfiles[id] = {
        label:
          typeof rawProfile.label === "string"
            ? rawProfile.label.replace(/\bNode\s+(\d)/i, "Node.js $1")
            : id,
        javaHome: normalizeConfigPathValue(String(rawProfile.javaHome ?? "")),
        gradleHome: normalizeConfigPathValue(String(rawProfile.gradleHome ?? "")),
        nodeHome: rawProfile.nodeHome ? normalizeConfigPathValue(String(rawProfile.nodeHome)) : undefined,
        nodeVersion:
          typeof rawProfile.nodeVersion === "string" && rawProfile.nodeVersion.trim()
            ? rawProfile.nodeVersion.trim()
            : undefined,
        backendCommand:
          typeof rawProfile.backendCommand === "string" && rawProfile.backendCommand.trim()
            ? rawProfile.backendCommand.trim()
            : undefined,
        backendArgs: Array.isArray(rawProfile.backendArgs)
          ? rawProfile.backendArgs.map(String)
          : undefined,
        frontendCommand:
          typeof rawProfile.frontendCommand === "string" && rawProfile.frontendCommand.trim()
            ? rawProfile.frontendCommand.trim()
            : undefined,
        frontendArgs: Array.isArray(rawProfile.frontendArgs)
          ? rawProfile.frontendArgs.map(String)
          : undefined,
        env:
          rawProfile.env && typeof rawProfile.env === "object" && !Array.isArray(rawProfile.env)
            ? Object.fromEntries(
                Object.entries(rawProfile.env as Record<string, unknown>)
                  .filter(([k]) => k && k.trim().length > 0)
                  .map(([k, v]) => [k.trim(), String(v ?? "")])
              )
            : undefined
      };
    }

    const firstProfileId = Object.keys(normalizedProfiles)[0];
    const activeProfile =
      typeof cfg.activeProfile === "string" && normalizedProfiles[cfg.activeProfile]
        ? cfg.activeProfile
        : firstProfileId;

    const backendRaw = (cfg.backend || {}) as Record<string, unknown>;
    const backend: BackendTarget = {
      workingDirectory: String(backendRaw.workingDirectory ?? "."),
      command: String(backendRaw.command ?? "gradle"),
      args: Array.isArray(backendRaw.args) ? backendRaw.args.map(String) : ["root:bootRun"],
      terminalName: typeof backendRaw.terminalName === "string" ? backendRaw.terminalName : "DEM: Backend",
      debugPort:
        typeof backendRaw.debugPort === "number" && backendRaw.debugPort > 0
          ? backendRaw.debugPort
          : 5005,
      serverPort:
        typeof backendRaw.serverPort === "number" && backendRaw.serverPort > 0
          ? backendRaw.serverPort
          : 8080,
      springProfile:
        typeof backendRaw.springProfile === "string" && backendRaw.springProfile.trim()
          ? backendRaw.springProfile.trim()
          : undefined,
      jdwpMode:
        backendRaw.jdwpMode === "gradleDebugJvm" || backendRaw.jdwpMode === "customArgs"
          ? backendRaw.jdwpMode
          : "javaToolOptions",
      jvmSuspend: Boolean(backendRaw.jvmSuspend),
      customDebugArgs: Array.isArray(backendRaw.customDebugArgs)
        ? backendRaw.customDebugArgs.map(String)
        : undefined,
      autoAttachDebugger: backendRaw.autoAttachDebugger !== false
    };

    const frontendRaw = (cfg.frontend || {}) as Record<string, unknown>;
    const frontend: FrontendTarget = {
      workingDirectory: String(frontendRaw.workingDirectory ?? "frontend"),
      command: String(frontendRaw.command ?? "npm"),
      args: Array.isArray(frontendRaw.args) ? frontendRaw.args.map(String) : ["start"],
      terminalName: typeof frontendRaw.terminalName === "string" ? frontendRaw.terminalName : "DEM: Frontend",
      devServerUrl:
        typeof frontendRaw.devServerUrl === "string" && frontendRaw.devServerUrl.trim()
          ? frontendRaw.devServerUrl.trim()
          : "http://localhost:4200",
      browserType: frontendRaw.browserType === "msedge" ? "msedge" : "chrome",
      webRoot:
        typeof frontendRaw.webRoot === "string" && frontendRaw.webRoot.trim()
          ? frontendRaw.webRoot.trim()
          : "${workspaceFolder}/frontend",
      browserExecutable:
        typeof frontendRaw.browserExecutable === "string" && frontendRaw.browserExecutable.trim()
          ? frontendRaw.browserExecutable.trim()
          : undefined,
      userDataDir:
        typeof frontendRaw.userDataDir === "string" && frontendRaw.userDataDir.trim()
          ? frontendRaw.userDataDir.trim()
          : undefined,
      browserArgs: Array.isArray(frontendRaw.browserArgs)
        ? frontendRaw.browserArgs.map(String)
        : undefined,
      browserDebugPort:
        typeof frontendRaw.browserDebugPort === "number" && frontendRaw.browserDebugPort > 0
          ? frontendRaw.browserDebugPort
          : undefined
    };

    const build: BuildTarget = cfg.build
      ? {
          workingDirectory: String(cfg.build.workingDirectory ?? "."),
          command: String(cfg.build.command ?? "gradle"),
          args: Array.isArray(cfg.build.args) ? cfg.build.args.map(String) : ["clean", "root:bootwar"],
          terminalName: cfg.build.terminalName ?? "DEM: Build"
        }
      : { ...DEFAULT_BUILD_TARGET };

    if (parsed && typeof parsed === "object") {
      this.rememberTemplate(parsed as Record<string, unknown>);
    }

    return {
      name: typeof cfg.name === "string" && cfg.name.trim() ? cfg.name.trim() : this.getWorkspaceName(),
      projectRoot:
        typeof cfg.projectRoot === "string" && cfg.projectRoot.trim()
          ? normalizeConfigPathValue(cfg.projectRoot)
          : this.getWorkspaceRoot(),
      activeProfile,
      profiles: normalizedProfiles,
      backend,
      frontend,
      build
    };
  }

  public getActiveProfile(config?: ProjectConfig): {
    id: string;
    profile: Profile;
    savedId: string;
    isSessionOnly: boolean;
  } {
    const cfg = config ?? this.readConfig();
    const savedId = cfg.activeProfile;
    const effectiveId =
      this.sessionProfileId && cfg.profiles[this.sessionProfileId]
        ? this.sessionProfileId
        : savedId;
    const profile = cfg.profiles[effectiveId];
    if (!profile) {
      throw new Error(`Profile "${effectiveId}" was not found in configuration.`);
    }
    return {
      id: effectiveId,
      profile,
      savedId,
      isSessionOnly: effectiveId !== savedId
    };
  }

  public setSessionProfile(profileId: string): {
    id: string;
    profile: Profile;
    savedId: string;
    isSessionOnly: boolean;
  } {
    const cfg = this.readConfig();
    const profile = cfg.profiles[profileId];
    if (!profile) {
      throw new Error(`Profile "${profileId}" does not exist in configuration.`);
    }
    this.sessionProfileId = profileId;
    const nodeVer = getNodeVersionFromProfile(profile, profileId);
    if (isUsingNvm(profile) && nodeVer) {
      void runNvmUse(nodeVer);
    }
    this.onDidChangeEmitter.fire();
    return this.getActiveProfile(cfg);
  }

  public buildProfileDetailsList(config: ProjectConfig): ProfileDetailsView[] {
    return Object.entries(config.profiles).map(([id, profile]) => {
      const versions = extractProfileVersions(id, profile);
      const javaHome = normalizeConfigPathValue(profile.javaHome);
      const gradleHome = normalizeConfigPathValue(profile.gradleHome);
      const rawNodeHome = profile.nodeHome ? normalizeConfigPathValue(profile.nodeHome) : "";
      const nodeVersion = getNodeVersionFromProfile(profile, id);
      const useNvm = isUsingNvm(profile);

      return {
        id,
        label: profile.label ?? id,
        javaVersionHint: versions.javaVersion,
        gradleVersionHint: versions.gradleVersion,
        nodeVersionHint: versions.nodeVersion,
        javaHome,
        gradleHome,
        nodeHome: useNvm
          ? (nodeVersion ? `nvm use ${nodeVersion}` : "nvm")
          : rawNodeHome,
        nodeVersion,
        useNvm,
        javaHomeExists: Boolean(javaHome && fs.existsSync(javaHome)),
        gradleHomeExists: Boolean(gradleHome && fs.existsSync(gradleHome)),
        nodeHomeExists: useNvm ? true : Boolean(rawNodeHome && fs.existsSync(rawNodeHome)),
        backendCommand: profile.backendCommand,
        backendArgs: profile.backendArgs,
        env: profile.env
      };
    });
  }

  public validateConfigurationPayload(raw: unknown): ConfigurationUpdatePayload {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Invalid configuration payload.");
    }

    const rawText = JSON.stringify(raw);
    if (FORBIDDEN_SECRET_PATTERNS.test(rawText)) {
      throw new Error(
        "Refusing to save configuration containing sensitive keys (passwords, tokens, or secrets are not permitted)."
      );
    }

    const obj = raw as Record<string, unknown>;
    const projectRoot = this.requireNonEmptyString(obj.projectRoot, "Project root");
    const activeProfile = this.requireNonEmptyString(obj.activeProfile, "Active profile");
    const editedProfileId = this.requireNonEmptyString(obj.editedProfileId, "Selected profile ID");

    if (!obj.editedProfile || typeof obj.editedProfile !== "object") {
      throw new Error("Profile paths section is required.");
    }
    const prof = obj.editedProfile as Record<string, unknown>;
    const javaHome = this.requireSafePath(prof.javaHome, "Java Home");
    const gradleHome = this.requireSafePath(prof.gradleHome, "Gradle Home");
    const rawNodeHome = prof.nodeHome ? String(prof.nodeHome).trim() : "";
    const rawNodeVersion = prof.nodeVersion ? String(prof.nodeVersion).trim() : "";

    let nodeHome: string | undefined = undefined;
    let nodeVersion: string | undefined = undefined;

    if (rawNodeVersion) {
      nodeVersion = rawNodeVersion.replace(/^v/i, "");
    }
    if (rawNodeHome && !rawNodeHome.toLowerCase().startsWith("nvm")) {
      nodeHome = normalizeConfigPathValue(rawNodeHome);
    } else if (rawNodeHome.toLowerCase().startsWith("nvm use ")) {
      nodeVersion = rawNodeHome.replace(/^nvm use\s+/i, "").trim().replace(/^v/i, "");
    }

    if (!nodeHome && !nodeVersion) {
      const matchFromId = obj.editedProfileId ? String(obj.editedProfileId).match(/node([0-9]+)/i)?.[1] : undefined;
      if (matchFromId) {
        nodeVersion = matchFromId;
      }
    }

    const label = typeof prof.label === "string" && prof.label.trim() ? prof.label.trim() : undefined;
    const backendCommand =
      typeof prof.backendCommand === "string" && prof.backendCommand.trim()
        ? prof.backendCommand.trim()
        : undefined;
    const backendArgs = Array.isArray(prof.backendArgs)
      ? prof.backendArgs.map(String)
      : undefined;

    let env: Record<string, string> | undefined = undefined;
    if (prof.env !== undefined) {
      if (prof.env && typeof prof.env === "object" && !Array.isArray(prof.env)) {
        env = {};
        for (const [k, v] of Object.entries(prof.env as Record<string, unknown>)) {
          const key = k.trim();
          if (key.length > 0) {
            env[key] = String(v ?? "");
          }
        }
      } else {
        env = undefined;
      }
    }

    const backendBase = this.validateTargetSection(obj.backend, "Backend", "DEM: Backend");
    const bRaw = obj.backend as Record<string, unknown>;
    const backend: ConfigurationUpdatePayload["backend"] = {
      ...backendBase,
      debugPort:
        typeof bRaw.debugPort === "number" && bRaw.debugPort > 0
          ? bRaw.debugPort
          : undefined,
      serverPort:
        typeof bRaw.serverPort === "number" && bRaw.serverPort > 0
          ? bRaw.serverPort
          : undefined,
      springProfile:
        typeof bRaw.springProfile === "string" ? bRaw.springProfile.trim() : undefined,
      jdwpMode:
        bRaw.jdwpMode === "gradleDebugJvm" || bRaw.jdwpMode === "customArgs"
          ? bRaw.jdwpMode
          : "javaToolOptions",
      jvmSuspend: typeof bRaw.jvmSuspend === "boolean" ? bRaw.jvmSuspend : undefined,
      customDebugArgs: Array.isArray(bRaw.customDebugArgs)
        ? bRaw.customDebugArgs.map(String)
        : undefined,
      autoAttachDebugger:
        typeof bRaw.autoAttachDebugger === "boolean" ? bRaw.autoAttachDebugger : undefined
    };

    const frontendBase = this.validateTargetSection(obj.frontend, "Frontend", "DEM: Frontend");
    const fRaw = obj.frontend as Record<string, unknown>;
    const frontend: ConfigurationUpdatePayload["frontend"] = {
      ...frontendBase,
      devServerUrl:
        typeof fRaw.devServerUrl === "string" && fRaw.devServerUrl.trim()
          ? fRaw.devServerUrl.trim()
          : undefined,
      browserType: fRaw.browserType === "msedge" ? "msedge" : "chrome",
      webRoot:
        typeof fRaw.webRoot === "string" && fRaw.webRoot.trim()
          ? fRaw.webRoot.trim()
          : undefined,
      browserExecutable:
        typeof fRaw.browserExecutable === "string" && fRaw.browserExecutable.trim()
          ? fRaw.browserExecutable.trim()
          : undefined,
      userDataDir:
        typeof fRaw.userDataDir === "string" && fRaw.userDataDir.trim()
          ? fRaw.userDataDir.trim()
          : undefined,
      browserArgs: Array.isArray(fRaw.browserArgs)
        ? fRaw.browserArgs.map(String)
        : undefined,
      browserDebugPort:
        typeof fRaw.browserDebugPort === "number" && fRaw.browserDebugPort > 0
          ? fRaw.browserDebugPort
          : undefined
    };

    const build = this.validateTargetSection(obj.build, "Build", "DEM: Build");

    const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : undefined;

    return {
      name,
      projectRoot: normalizeConfigPathValue(projectRoot),
      activeProfile,
      editedProfileId,
      editedProfile: {
        label,
        javaHome,
        gradleHome,
        nodeHome,
        nodeVersion,
        backendCommand,
        backendArgs,
        env
      },
      backend,
      frontend,
      build
    };
  }

  public async saveConfigurationWithConfirmation(rawPayload: unknown): Promise<boolean> {
    const validated = this.validateConfigurationPayload(rawPayload);
    const file = this.getConfigFilePath();

    let existingRaw: Record<string, unknown> = {};
    if (fs.existsSync(file)) {
      const existingContent = fs.readFileSync(file, "utf8");
      try {
        const parsed = JSON.parse(existingContent);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          existingRaw = parsed as Record<string, unknown>;
        }
      } catch (err) {
        throw new Error(
          `Cannot overwrite malformed JSON file automatically: ${(err as Error).message}`
        );
      }
    }

    const currentConfig = this.readConfig();
    if (!currentConfig.profiles[validated.editedProfileId]) {
      throw new Error(`Unknown profile "${validated.editedProfileId}".`);
    }
    if (!currentConfig.profiles[validated.activeProfile]) {
      throw new Error(`Unknown default profile "${validated.activeProfile}".`);
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Save changes to ${path.basename(file)}? This will overwrite your workspace configuration file.`,
      { modal: true },
      "Overwrite Configuration"
    );

    if (confirmation !== "Overwrite Configuration") {
      return false;
    }

    const existingProf = currentConfig.profiles[validated.editedProfileId];
    const newProf: Profile = {
      label:
        validated.editedProfile.label ??
        existingProf.label ??
        validated.editedProfileId,
      javaHome: validated.editedProfile.javaHome,
      gradleHome: validated.editedProfile.gradleHome
    };
    if (validated.editedProfile.nodeVersion || existingProf.nodeVersion) {
      newProf.nodeVersion = validated.editedProfile.nodeVersion ?? existingProf.nodeVersion;
    }
    if (validated.editedProfile.nodeHome) {
      newProf.nodeHome = validated.editedProfile.nodeHome;
    }
    if (validated.editedProfile.backendCommand !== undefined) {
      newProf.backendCommand = validated.editedProfile.backendCommand;
    } else if (existingProf.backendCommand !== undefined) {
      newProf.backendCommand = existingProf.backendCommand;
    }
    if (validated.editedProfile.backendArgs !== undefined) {
      newProf.backendArgs = validated.editedProfile.backendArgs;
    } else if (existingProf.backendArgs !== undefined) {
      newProf.backendArgs = existingProf.backendArgs;
    }
    if (validated.editedProfile.env !== undefined) {
      newProf.env = validated.editedProfile.env;
    } else if (existingProf.env !== undefined) {
      newProf.env = existingProf.env;
    }

    const updatedProfiles: Record<string, Profile> = {
      ...currentConfig.profiles,
      [validated.editedProfileId]: newProf
    };

    const existingBackend = (existingRaw.backend ?? {}) as Record<string, unknown>;
    const existingFrontend = (existingRaw.frontend ?? {}) as Record<string, unknown>;

    const finalBackend: Record<string, unknown> = {
      ...existingBackend,
      workingDirectory: validated.backend.workingDirectory,
      command: validated.backend.command,
      args: validated.backend.args,
      terminalName:
        validated.backend.terminalName ?? currentConfig.backend.terminalName ?? "DEM: Backend"
    };
    if (validated.backend.debugPort !== undefined) {
      finalBackend.debugPort = validated.backend.debugPort;
    } else if (currentConfig.backend.debugPort !== undefined) {
      finalBackend.debugPort = currentConfig.backend.debugPort;
    }
    if (validated.backend.serverPort !== undefined) {
      finalBackend.serverPort = validated.backend.serverPort;
    } else if (currentConfig.backend.serverPort !== undefined) {
      finalBackend.serverPort = currentConfig.backend.serverPort;
    }
    if (validated.backend.springProfile !== undefined) {
      finalBackend.springProfile = validated.backend.springProfile;
    } else if (currentConfig.backend.springProfile !== undefined) {
      finalBackend.springProfile = currentConfig.backend.springProfile;
    }
    if (validated.backend.jdwpMode !== undefined) {
      finalBackend.jdwpMode = validated.backend.jdwpMode;
    } else if (currentConfig.backend.jdwpMode !== undefined) {
      finalBackend.jdwpMode = currentConfig.backend.jdwpMode;
    }
    if (validated.backend.jvmSuspend !== undefined) {
      finalBackend.jvmSuspend = validated.backend.jvmSuspend;
    } else if (currentConfig.backend.jvmSuspend !== undefined) {
      finalBackend.jvmSuspend = currentConfig.backend.jvmSuspend;
    }
    if (validated.backend.customDebugArgs !== undefined) {
      finalBackend.customDebugArgs = validated.backend.customDebugArgs;
    }
    if (validated.backend.autoAttachDebugger !== undefined) {
      finalBackend.autoAttachDebugger = validated.backend.autoAttachDebugger;
    }

    const finalFrontend: Record<string, unknown> = {
      ...existingFrontend,
      workingDirectory: validated.frontend.workingDirectory,
      command: validated.frontend.command,
      args: validated.frontend.args,
      terminalName:
        validated.frontend.terminalName ?? currentConfig.frontend.terminalName ?? "DEM: Frontend"
    };
    if (validated.frontend.devServerUrl !== undefined) {
      finalFrontend.devServerUrl = validated.frontend.devServerUrl;
    } else if (currentConfig.frontend.devServerUrl !== undefined) {
      finalFrontend.devServerUrl = currentConfig.frontend.devServerUrl;
    }
    if (validated.frontend.browserType !== undefined) {
      finalFrontend.browserType = validated.frontend.browserType;
    } else if (currentConfig.frontend.browserType !== undefined) {
      finalFrontend.browserType = currentConfig.frontend.browserType;
    }
    if (validated.frontend.webRoot !== undefined) {
      finalFrontend.webRoot = validated.frontend.webRoot;
    } else if (currentConfig.frontend.webRoot !== undefined) {
      finalFrontend.webRoot = currentConfig.frontend.webRoot;
    }
    if (validated.frontend.browserExecutable !== undefined) {
      finalFrontend.browserExecutable = validated.frontend.browserExecutable;
    } else if (currentConfig.frontend.browserExecutable !== undefined) {
      finalFrontend.browserExecutable = currentConfig.frontend.browserExecutable;
    }
    if (validated.frontend.userDataDir !== undefined) {
      finalFrontend.userDataDir = validated.frontend.userDataDir;
    } else if (currentConfig.frontend.userDataDir !== undefined) {
      finalFrontend.userDataDir = currentConfig.frontend.userDataDir;
    }
    if (validated.frontend.browserArgs !== undefined) {
      finalFrontend.browserArgs = validated.frontend.browserArgs;
    } else if (currentConfig.frontend.browserArgs !== undefined) {
      finalFrontend.browserArgs = currentConfig.frontend.browserArgs;
    }
    if (validated.frontend.browserDebugPort !== undefined) {
      finalFrontend.browserDebugPort = validated.frontend.browserDebugPort;
    } else if (currentConfig.frontend.browserDebugPort !== undefined) {
      finalFrontend.browserDebugPort = currentConfig.frontend.browserDebugPort;
    }

    const finalJson: Record<string, unknown> = {
      ...existingRaw,
      name: validated.name ?? currentConfig.name ?? this.getWorkspaceName(),
      projectRoot: validated.projectRoot,
      activeProfile: validated.activeProfile,
      profiles: updatedProfiles,
      backend: finalBackend,
      frontend: finalFrontend,
      build: {
        workingDirectory: validated.build.workingDirectory,
        command: validated.build.command,
        args: validated.build.args
      }
    };

    // Strip any accidental secret-like keys at top level
    for (const key of Object.keys(finalJson)) {
      if (FORBIDDEN_SECRET_PATTERNS.test(key)) {
        delete finalJson[key];
      }
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(finalJson, null, 2) + "\n", "utf8");
    this.rememberTemplate(finalJson);

    this.sessionProfileId = validated.activeProfile;
    this.onDidChangeEmitter.fire();
    return true;
  }

  private validateTargetSection(
    raw: unknown,
    sectionLabel: string,
    defaultTerminalName: string
  ): { workingDirectory: string; command: string; args: string[]; terminalName?: string } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${sectionLabel} configuration section is missing.`);
    }
    const obj = raw as Record<string, unknown>;
    const workingDirectory = this.requireNonEmptyString(
      obj.workingDirectory,
      `${sectionLabel} working directory`
    );
    const command = this.requireSafeCommand(obj.command, `${sectionLabel} command`);

    let args: string[] = [];
    if (Array.isArray(obj.args)) {
      args = obj.args
        .map(item => String(item).trim())
        .filter(item => item.length > 0);
    } else if (typeof obj.args === "string") {
      args = this.parseArgsString(obj.args);
    }

    for (const arg of args) {
      if (/[\r\n\0]/.test(arg)) {
        throw new Error(`${sectionLabel} arguments contain invalid control characters.`);
      }
    }

    const terminalName =
      typeof obj.terminalName === "string" && obj.terminalName.trim()
        ? obj.terminalName.trim()
        : defaultTerminalName;

    return {
      workingDirectory,
      command,
      args,
      terminalName
    };
  }

  public parseArgsString(input: string): string[] {
    const trimmed = input.trim();
    if (!trimmed) {
      return [];
    }
    const matches = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    return matches.map(token => token.replace(/^"(.*)"$/, "$1"));
  }

  private requireNonEmptyString(value: unknown, fieldName: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${fieldName} is required and cannot be empty.`);
    }
    if (/[\r\n\0]/.test(value)) {
      throw new Error(`${fieldName} contains invalid control characters.`);
    }
    return value.trim();
  }

  private requireSafePath(value: unknown, fieldName: string): string {
    const str = this.requireNonEmptyString(value, fieldName);
    return normalizeConfigPathValue(str);
  }

  private requireSafeCommand(value: unknown, fieldName: string): string {
    const str = this.requireNonEmptyString(value, fieldName);
    if (/[;&|`$<>]/.test(str)) {
      throw new Error(
        `${fieldName} contains disallowed shell metacharacters. Specify the executable name or path only.`
      );
    }
    return str;
  }

  public async exportConfiguration(): Promise<string | undefined> {
    if (!this.hasWorkspace()) {
      vscode.window.showWarningMessage("Open a workspace folder first to export configuration.");
      return undefined;
    }

    const currentConfig = this.readConfig();
    const wsRoot = this.getWorkspaceRoot();
    const defaultFileName = `${currentConfig.name || "dem"}-config.json`;
    const defaultUri = vscode.Uri.file(path.join(wsRoot, defaultFileName));

    const targetUri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: {
        "JSON Files": ["json"],
        "All Files": ["*"]
      },
      title: "Export DEM Configuration",
      saveLabel: "Export"
    });

    if (!targetUri) {
      return undefined;
    }

    const configFile = this.getConfigFilePath();
    let exportedData: Record<string, unknown>;
    if (fs.existsSync(configFile)) {
      try {
        exportedData = JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<string, unknown>;
      } catch {
        exportedData = JSON.parse(JSON.stringify(currentConfig)) as Record<string, unknown>;
      }
    } else {
      exportedData = JSON.parse(JSON.stringify(currentConfig)) as Record<string, unknown>;
    }

    // Task 3: Exclude Project General (name, projectRoot, activeProfile)
    delete exportedData.name;
    delete exportedData.projectRoot;
    delete exportedData.activeProfile;

    const contentToExport = JSON.stringify(exportedData, null, 2) + "\n";
    fs.writeFileSync(targetUri.fsPath, contentToExport, "utf8");
    vscode.window.showInformationMessage(
      `DEM configuration exported successfully to ${path.basename(targetUri.fsPath)} (Project General excluded).`
    );
    return targetUri.fsPath;
  }

  public async importConfiguration(): Promise<boolean> {
    if (!this.hasWorkspace()) {
      vscode.window.showWarningMessage("Open a workspace folder first to import configuration.");
      return false;
    }

    const targetUris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: {
        "JSON Files": ["json"],
        "All Files": ["*"]
      },
      title: "Import DEM Configuration",
      openLabel: "Import"
    });

    if (!targetUris || targetUris.length === 0) {
      return false;
    }

    const sourceFile = targetUris[0].fsPath;
    let rawContent: string;
    try {
      rawContent = fs.readFileSync(sourceFile, "utf8");
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to read file ${sourceFile}: ${(err as Error).message}`);
      return false;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawContent);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Expected a JSON object root.");
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Invalid JSON in ${path.basename(sourceFile)}: ${(err as Error).message}`
      );
      return false;
    }

    if (!parsed.profiles || typeof parsed.profiles !== "object" || Object.keys(parsed.profiles).length === 0) {
      vscode.window.showErrorMessage(
        `Import failed: ${path.basename(sourceFile)} is missing a valid "profiles" section.`
      );
      return false;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Import configuration from "${path.basename(sourceFile)}"? Profiles, backend, frontend, and build configs will be updated. Project General (name, projectRoot, activeProfile) will be preserved.`,
      { modal: true },
      "Import & Overwrite",
      "Cancel"
    );

    if (confirmation !== "Import & Overwrite") {
      return false;
    }

    const destFile = this.getConfigFilePath();
    let existingRaw: Record<string, unknown> = {};
    if (fs.existsSync(destFile)) {
      try {
        existingRaw = JSON.parse(fs.readFileSync(destFile, "utf8")) as Record<string, unknown>;
      } catch {
        existingRaw = {};
      }
    }

    // Task 3: Do NOT import Project General (preserve existing name, projectRoot, activeProfile)
    const wsRoot = this.getWorkspaceRoot();
    const wsName = this.getWorkspaceName();

    const merged: Record<string, unknown> = {
      ...parsed,
      name: existingRaw.name ?? wsName,
      projectRoot: existingRaw.projectRoot ?? wsRoot,
      activeProfile: existingRaw.activeProfile ?? Object.keys(parsed.profiles)[0]
    };

    // Reset session profile so newly imported profile takes effect cleanly
    this.sessionProfileId = undefined;

    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.writeFileSync(destFile, JSON.stringify(merged, null, 2) + "\n", "utf8");
    this.rememberTemplate(merged);

    this.onDidChangeEmitter.fire();
    vscode.window.showInformationMessage(
      `Successfully imported DEM configuration from ${path.basename(sourceFile)} (Project General preserved).`
    );
    return true;
  }
}

