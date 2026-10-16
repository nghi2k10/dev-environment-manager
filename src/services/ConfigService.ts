import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  BuildTarget,
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

export const CONFIG_DEFAULT = ".vscode/project-build-manager.json";

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
          nodeVersion: "10.24.1"
        },
        "java11-node14": {
          label: "Java 11 / Gradle 6.9.1 / Node.js 14.20.0",
          javaHome: "E:\\soft\\jdk11",
          gradleHome: "E:\\soft\\gradle-6.9.1",
          nodeVersion: "14.20.0"
        },
        "java17-node20": {
          label: "Java 17 / Gradle 8.8 / Node.js 20.14.0",
          javaHome: "E:\\soft\\jdk17",
          gradleHome: "E:\\soft\\gradle-8.8",
          nodeVersion: "20.14.0"
        },
        "java21-node20": {
          label: "Java 21 / Gradle 8.8 / Node.js 20.14.0",
          javaHome: "E:\\soft\\jdk21",
          gradleHome: "E:\\soft\\gradle-8.8",
          nodeVersion: "20.14.0"
        }
      },
      backend: {
        workingDirectory: ".",
        command: "gradle",
        args: ["root:bootRun"],
        terminalName: "DEM: Backend"
      },
      frontend: {
        workingDirectory: "frontend",
        command: "npm",
        args: ["start"],
        terminalName: "DEM: Frontend"
      },
      build: {
        workingDirectory: ".",
        command: "gradle",
        args: ["clean", "root:bootwar"]
      }
    };

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(defaultConfig, null, 2) + "\n", "utf8");
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
            : undefined
      };
    }

    const firstProfileId = Object.keys(normalizedProfiles)[0];
    const activeProfile =
      typeof cfg.activeProfile === "string" && normalizedProfiles[cfg.activeProfile]
        ? cfg.activeProfile
        : firstProfileId;

    const backend: RunTarget = {
      workingDirectory: String(cfg.backend.workingDirectory ?? "."),
      command: String(cfg.backend.command ?? "gradle"),
      args: Array.isArray(cfg.backend.args) ? cfg.backend.args.map(String) : ["root:bootRun"],
      terminalName: cfg.backend.terminalName ?? "DEM: Backend"
    };

    const frontend: RunTarget = {
      workingDirectory: String(cfg.frontend.workingDirectory ?? "frontend"),
      command: String(cfg.frontend.command ?? "npm"),
      args: Array.isArray(cfg.frontend.args) ? cfg.frontend.args.map(String) : ["start"],
      terminalName: cfg.frontend.terminalName ?? "DEM: Frontend"
    };

    const build: BuildTarget = cfg.build
      ? {
          workingDirectory: String(cfg.build.workingDirectory ?? "."),
          command: String(cfg.build.command ?? "gradle"),
          args: Array.isArray(cfg.build.args) ? cfg.build.args.map(String) : ["clean", "root:bootwar"],
          terminalName: cfg.build.terminalName ?? "DEM: Build"
        }
      : { ...DEFAULT_BUILD_TARGET };

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
        nodeHomeExists: useNvm ? true : Boolean(rawNodeHome && fs.existsSync(rawNodeHome))
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

    const backend = this.validateTargetSection(obj.backend, "Backend", "DEM: Backend");
    const frontend = this.validateTargetSection(obj.frontend, "Frontend", "DEM: Frontend");
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
        nodeVersion
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

    const updatedProfiles: Record<string, Profile> = {
      ...currentConfig.profiles,
      [validated.editedProfileId]: newProf
    };

    const finalJson: Record<string, unknown> = {
      ...existingRaw,
      name: validated.name ?? currentConfig.name ?? this.getWorkspaceName(),
      projectRoot: validated.projectRoot,
      activeProfile: validated.activeProfile,
      profiles: updatedProfiles,
      backend: {
        workingDirectory: validated.backend.workingDirectory,
        command: validated.backend.command,
        args: validated.backend.args,
        terminalName: validated.backend.terminalName ?? currentConfig.backend.terminalName ?? "DEM: Backend"
      },
      frontend: {
        workingDirectory: validated.frontend.workingDirectory,
        command: validated.frontend.command,
        args: validated.frontend.args,
        terminalName: validated.frontend.terminalName ?? currentConfig.frontend.terminalName ?? "DEM: Frontend"
      },
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
}

