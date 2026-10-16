export type Profile = {
  label?: string;
  javaHome: string;
  gradleHome: string;
  nodeHome?: string;
  nodeVersion?: string;
};

export type RunTarget = {
  workingDirectory: string;
  command: string;
  args: string[];
  terminalName?: string;
};

export type BuildTarget = {
  workingDirectory: string;
  command: string;
  args: string[];
  terminalName?: string;
};

export type ProjectConfig = {
  name?: string;
  projectRoot?: string;
  activeProfile: string;
  profiles: Record<string, Profile>;
  backend: RunTarget;
  frontend: RunTarget;
  build?: BuildTarget;
};

export type ProcessTargetName = "backend" | "frontend";
export type AllTargetName = "backend" | "frontend" | "build";

export type ProcessStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export type ProcessState = {
  target: ProcessTargetName;
  name: string;
  status: ProcessStatus;
  workingDirectory: string;
  resolvedWorkingDirectory: string;
  command: string;
  args: string[];
  formattedCommand: string;
  activeProfileId: string;
  activeProfileLabel: string;
  pid?: number;
  lastStartTime?: string;
  lastExitTime?: string;
  exitCode?: number | null;
  latestSummary: string;
};

export type BuildState = {
  status: "idle" | "running" | "succeeded" | "failed";
  workingDirectory: string;
  resolvedWorkingDirectory: string;
  command: string;
  args: string[];
  formattedCommand: string;
  activeProfileId?: string;
  lastStartTime?: string;
  lastEndTime?: string;
  exitCode?: number | null;
  latestSummary: string;
};

export type DiagnosticToolId = "java" | "gradle" | "node" | "npm";
export type DiagnosticStatus = "idle" | "checking" | "passed" | "warning" | "failed";

export type DiagnosticToolResult = {
  id: DiagnosticToolId;
  toolName: string;
  commandDisplay: string;
  status: DiagnosticStatus;
  detectedVersion: string;
  rawOutput: string;
  executablePath: string;
  errorDetails?: string;
  checkedAt?: string;
};

export type DiagnosticsState = {
  isChecking: boolean;
  profileId?: string;
  profileLabel?: string;
  lastCheckedAt?: string;
  results: DiagnosticToolResult[];
};

export type LogStreamType = "stdout" | "stderr" | "system";

export type LogEntry = {
  id: number;
  timestamp: string;
  target: AllTargetName;
  stream: LogStreamType;
  text: string;
};

export type ProfileDetailsView = {
  id: string;
  label: string;
  javaVersionHint: string;
  gradleVersionHint: string;
  nodeVersionHint: string;
  javaHome: string;
  gradleHome: string;
  nodeHome: string;
  nodeVersion?: string;
  useNvm?: boolean;
  javaHomeExists: boolean;
  gradleHomeExists: boolean;
  nodeHomeExists: boolean;
};

export type DashboardState = {
  hasWorkspace: boolean;
  workspaceName: string;
  workspaceRootPath: string;
  configFilePath: string;
  configError?: string;
  projectName: string;
  projectRoot: string;
  resolvedProjectRoot: string;
  activeProfileId: string;
  savedActiveProfileId: string;
  isProfileSessionOnly: boolean;
  profiles: ProfileDetailsView[];
  selectedProfile?: ProfileDetailsView;
  backend: ProcessState;
  frontend: ProcessState;
  build: BuildState;
  diagnostics: DiagnosticsState;
  logs: LogEntry[];
  rawConfig?: ProjectConfig;
};

