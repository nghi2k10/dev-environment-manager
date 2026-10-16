# Dev Environment Manager (Dashboard Webview — Phase 1 & Phase 2)

A VS Code Extension for Windows that manages multiple **Java**, **Gradle**, and **Node.js** environments and runs backend, frontend, and build processes with an integrated **Dashboard Webview UI**, live log viewer, and per-process VS Code terminals.

---

## Features (Phase 1 + Phase 2)

- **Modern Dashboard Webview UI**
  - Accessible directly from the **Activity Bar** (dedicated icon on the left bar) or opened as a full editor tab via `Dev Environment Manager: Open Dashboard`.
  - Automatically adapts to VS Code dark and light themes using native `--vscode-*` theme tokens.
- **Environment Profile Management**
  - Switch between multiple toolchain profiles (`Java 8 / Gradle 3.5.1 / Node.js 10.24.1`, `Java 11 / Gradle 6.9.1 / Node.js 14.20.0`, `Java 17 / Gradle 8.8 / Node.js 20.14.0`, `Java 21 / Gradle 8.8 / Node.js 20.14.0`).
  - Displays configured Java, Gradle, and Node.js versions, installation paths, and path existence indicators.
  - Clearly distinguishes between **Session Only** profile changes and the **Saved in Config** default (`activeProfile`) without silently modifying `.vscode/project-build-manager.json`.
- **Environment Diagnostics**
  - Executes real `java -version`, `gradle -version`, `node -v`, and `npm -v` checks using the selected profile's `JAVA_HOME`, `GRADLE_HOME`, and `PATH`.
  - Reports per-tool status (`Passed`, `Warning`, `Failed`), detected version output, resolved executable path, and detailed error messages.
- **Process Management & Quick Actions**
  - Independent managed processes for **Backend** (`gradle root:bootRun`) and **Frontend** (`npm start`), plus a dedicated **Build Project** task (`gradle build`).
  - Quick Actions: `Run All`, `Run Backend`, `Run Frontend`, `Build Project`, `Stop All`, and `Restart All`.
  - Tracks real child process states (`Running`, `Stopped`, `Starting`, `Stopping`, `Error`), PID, start time, exit code, and latest output summary.
  - Handles Windows `.bat` and `.cmd` scripts (`gradle.bat`, `gradlew.bat`, `npm.cmd`) and paths containing spaces safely, and terminates full process trees on stop/restart.
  - Preserves native VS Code terminals (`DEM: Backend`, `DEM: Frontend`, `DEM: Build`) via `Open Terminal` with `Ctrl+C` support.
- **Live Logs Viewer**
  - Streams real-time `stdout` and `stderr` output from Backend, Frontend, and Build processes with timestamps.
  - Supports filtering by `All`, `Backend`, `Frontend`, and `Build`, plus `Auto-scroll`, `Copy Logs`, and `Clear Logs`.
- **Interactive Configuration Panel**
  - Edit project root, default active profile, profile toolchain paths (`javaHome`, `gradleHome`, `nodeHome`), and Backend / Frontend / Build commands and arguments.
  - Validates required fields, prevents saving secret/token keys, and prompts for confirmation before updating `.vscode/project-build-manager.json`.

---

## Project Architecture

```text
dev-environment-manager/
├── src/
│   ├── extension.ts
│   ├── dashboard/
│   │   ├── DashboardProvider.ts
│   │   ├── DashboardMessages.ts
│   │   └── DashboardHtml.ts
│   ├── services/
│   │   ├── ConfigService.ts
│   │   ├── EnvironmentService.ts
│   │   ├── ProcessManager.ts
│   │   └── LogService.ts
│   └── types/
│       └── project-config.ts
├── media/
│   ├── dashboard.css
│   └── dashboard.js
├── .vscode/
│   ├── launch.json
│   ├── tasks.json
│   └── project-build-manager.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Development & Setup Instructions

1. Install Node.js (v18+ / v20+ recommended for building the extension).
2. Open this extension folder in VS Code.
3. Install dependencies and compile TypeScript:
   ```powershell
   npm install
   npm run compile
   ```
4. Press `F5` to launch the **Extension Development Host** window.
5. In the Extension Development Host window, open your target project folder (or a workspace containing `.vscode/project-build-manager.json`).
6. Click the **Dev Environment Manager** icon on the **Activity Bar** (left bar), or run **`Dev Environment Manager: Open Dashboard`** from the Command Palette (`Ctrl+Shift+P`).
7. Select a profile, click **Check Environment**, and use **Run All**, **Run Backend**, **Run Frontend**, or **Build Project**.

---

## Available Commands

- `Dev Environment Manager: Open Dashboard`
- `Dev Environment Manager: Auto-Configure Project Root from Current Workspace`
- `Dev Environment Manager: Select Profile`
- `Dev Environment Manager: Check Environment`
- `Dev Environment Manager: Run Backend`
- `Dev Environment Manager: Run Frontend`
- `Dev Environment Manager: Run All`
- `Dev Environment Manager: Build Project`
- `Dev Environment Manager: Stop Backend`
- `Dev Environment Manager: Stop Frontend`
- `Dev Environment Manager: Stop All`
- `Dev Environment Manager: Restart Backend`
- `Dev Environment Manager: Restart Frontend`
- `Dev Environment Manager: Restart All`
- `Dev Environment Manager: Open Backend Terminal`
- `Dev Environment Manager: Open Frontend Terminal`

---

## Configuration (`.vscode/project-build-manager.json`)

```json
{
  "name": "CCC",
  "projectRoot": "D:\\CCC\\code\\ccc",
  "activeProfile": "java17-node20",
  "profiles": {
    "java8-node10": {
      "label": "Java 8 / Gradle 3.5.1 / Node.js 10.24.1",
      "javaHome": "E:\\soft\\jdk8",
      "gradleHome": "E:\\soft\\gradle-3.5.1",
      "nodeVersion": "10.24.1"
    },
    "java11-node14": {
      "label": "Java 11 / Gradle 6.9.1 / Node.js 14.20.0",
      "javaHome": "E:\\soft\\jdk11",
      "gradleHome": "E:\\soft\\gradle-6.9.1",
      "nodeVersion": "14.20.0"
    },
    "java17-node20": {
      "label": "Java 17 / Gradle 8.8 / Node.js 20.14.0",
      "javaHome": "E:\\soft\\jdk17",
      "gradleHome": "E:\\soft\\gradle-8.8",
      "nodeVersion": "20.14.0"
    },
    "java21-node20": {
      "label": "Java 21 / Gradle 8.8 / Node.js 20.14.0",
      "javaHome": "E:\\soft\\jdk21",
      "gradleHome": "E:\\soft\\gradle-8.8",
      "nodeVersion": "20.14.0"
    }
  },
  "backend": {
    "workingDirectory": ".",
    "command": "gradle",
    "args": ["root:bootRun"],
    "terminalName": "DEM: Backend"
  },
  "frontend": {
    "workingDirectory": "frontend",
    "command": "npm",
    "args": ["start"],
    "terminalName": "DEM: Frontend"
  },
  "build": {
    "workingDirectory": ".",
    "command": "gradle",
    "args": ["clean", "root:bootwar"]
  }
}
```

### Windows Notes

- The extension never modifies machine-wide Windows environment variables.
- `JAVA_HOME`, `GRADLE_HOME`, `NODE_HOME`, and `PATH` are applied per spawned child process according to the active profile.
- Changing the profile via the dropdown or Quick Pick updates the active session profile immediately; saving changes to `.vscode/project-build-manager.json` is explicit and requires confirmation in the Configuration Panel.

---

## Packaging as VSIX

```powershell
npm run compile
npx @vscode/vsce package
```
