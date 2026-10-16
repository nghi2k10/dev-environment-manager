import {
  BuildState,
  DashboardState,
  DiagnosticsState,
  LogEntry,
  ProcessState
} from "../types/project-config";

export type ConfigurationUpdatePayload = {
  name?: string;
  projectRoot: string;
  activeProfile: string;
  editedProfileId: string;
  editedProfile: {
    label?: string;
    javaHome: string;
    gradleHome: string;
    nodeHome?: string;
    nodeVersion?: string;
  };
  backend: {
    workingDirectory: string;
    command: string;
    args: string[];
    terminalName?: string;
  };
  frontend: {
    workingDirectory: string;
    command: string;
    args: string[];
    terminalName?: string;
  };
  build: {
    workingDirectory: string;
    command: string;
    args: string[];
    terminalName?: string;
  };
};

export type DashboardCommand =
  | { type: "getInitialState" }
  | { type: "refreshState" }
  | { type: "selectProfile"; profileId: string }
  | { type: "checkEnvironment" }
  | { type: "runBackend" }
  | { type: "runFrontend" }
  | { type: "runAll" }
  | { type: "buildProject" }
  | { type: "stopBackend" }
  | { type: "stopFrontend" }
  | { type: "stopAll" }
  | { type: "restartBackend" }
  | { type: "restartFrontend" }
  | { type: "restartAll" }
  | { type: "openTerminal"; target: "backend" | "frontend" | "build" }
  | { type: "getLogs"; target: "all" | "backend" | "frontend" | "build" }
  | { type: "clearLogs" }
  | { type: "copyLogs"; target?: "all" | "backend" | "frontend" | "build" }
  | { type: "saveConfiguration"; configuration: unknown }
  | { type: "openConfigFile" }
  | { type: "autoSyncProjectRoot" };

export type ExtensionMessage =
  | { type: "stateUpdated"; state: DashboardState }
  | { type: "processUpdated"; backend: ProcessState; frontend: ProcessState; build: BuildState }
  | { type: "diagnosticsUpdated"; diagnostics: DiagnosticsState }
  | { type: "logAppended"; entry: LogEntry }
  | { type: "logsSnapshot"; target: "all" | "backend" | "frontend" | "build"; logs: LogEntry[] }
  | { type: "logsCleared" }
  | {
      type: "notification";
      level: "info" | "warning" | "error" | "success";
      message: string;
      scope?: "general" | "config";
    };

const VALID_COMMAND_TYPES = new Set([
  "getInitialState",
  "refreshState",
  "selectProfile",
  "checkEnvironment",
  "runBackend",
  "runFrontend",
  "runAll",
  "buildProject",
  "stopBackend",
  "stopFrontend",
  "stopAll",
  "restartBackend",
  "restartFrontend",
  "restartAll",
  "openTerminal",
  "getLogs",
  "clearLogs",
  "copyLogs",
  "saveConfiguration",
  "openConfigFile",
  "autoSyncProjectRoot"
]);

export function parseDashboardCommand(raw: unknown): DashboardCommand | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const msg = raw as Record<string, unknown>;
  if (typeof msg.type !== "string" || !VALID_COMMAND_TYPES.has(msg.type)) {
    return null;
  }

  switch (msg.type) {
    case "selectProfile": {
      if (typeof msg.profileId !== "string" || msg.profileId.trim().length === 0) {
        return null;
      }
      return { type: "selectProfile", profileId: msg.profileId.trim() };
    }
    case "openTerminal": {
      if (msg.target !== "backend" && msg.target !== "frontend" && msg.target !== "build") {
        return null;
      }
      return { type: "openTerminal", target: msg.target };
    }
    case "getLogs": {
      if (
        msg.target !== "all" &&
        msg.target !== "backend" &&
        msg.target !== "frontend" &&
        msg.target !== "build"
      ) {
        return null;
      }
      return { type: "getLogs", target: msg.target };
    }
    case "copyLogs": {
      const target =
        msg.target === "backend" || msg.target === "frontend" || msg.target === "build"
          ? msg.target
          : "all";
      return { type: "copyLogs", target };
    }
    case "saveConfiguration": {
      return { type: "saveConfiguration", configuration: msg.configuration };
    }
    default:
      return { type: msg.type as DashboardCommand["type"] } as DashboardCommand;
  }
}

