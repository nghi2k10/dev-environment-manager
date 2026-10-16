import * as fs from "node:fs";
import * as path from "node:path";
import { Profile } from "../types/project-config";

export function getNodeVersionFromProfile(profile: Profile, id?: string): string | undefined {
  if (profile.nodeVersion && profile.nodeVersion.trim()) {
    return profile.nodeVersion.trim().replace(/^v/i, "");
  }
  const label = profile.label ?? "";
  const matchLabel = label.match(/Node(?:\.js)?\s+v?([0-9._+-]+)/i)?.[1];
  if (matchLabel) {
    return matchLabel;
  }
  if (profile.nodeHome) {
    const matchPath = profile.nodeHome.match(/node[-_]?v?([0-9._]+)/i)?.[1];
    if (matchPath) {
      return matchPath;
    }
  }
  if (id) {
    const matchId = id.match(/node([0-9]+)/i)?.[1];
    if (matchId) {
      return matchId;
    }
  }
  return undefined;
}

export function isUsingNvm(profile: Profile): boolean {
  if (profile.nodeVersion && profile.nodeVersion.trim()) {
    return true;
  }
  if (!profile.nodeHome || profile.nodeHome.trim() === "" || profile.nodeHome.toLowerCase() === "nvm") {
    return true;
  }
  return !fs.existsSync(profile.nodeHome);
}

function isValidNodeDirectory(dir: string): boolean {
  if (!dir || !fs.existsSync(dir)) {
    return false;
  }
  const isWin = process.platform === "win32";
  const nodeExe = isWin ? path.join(dir, "node.exe") : path.join(dir, "bin", "node");
  return fs.existsSync(nodeExe);
}

export function findNvmNodeHome(version: string): string | undefined {
  const cleanVer = version.trim().replace(/^v/i, "");
  const versionVariants = [`v${cleanVer}`, cleanVer];
  const rootCandidates: string[] = [];

  // 1. NVM_HOME env var & settings.txt
  if (process.env.NVM_HOME && fs.existsSync(process.env.NVM_HOME)) {
    rootCandidates.push(process.env.NVM_HOME);
    const settingsFile = path.join(process.env.NVM_HOME, "settings.txt");
    if (fs.existsSync(settingsFile)) {
      try {
        const content = fs.readFileSync(settingsFile, "utf8");
        const match = content.match(/root:\s*(.+)/i);
        if (match && match[1]) {
          const rootPath = match[1].trim();
          if (fs.existsSync(rootPath)) {
            rootCandidates.push(rootPath);
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // 2. NVM_SYMLINK parent
  if (process.env.NVM_SYMLINK) {
    const parent = path.dirname(process.env.NVM_SYMLINK);
    if (fs.existsSync(parent)) {
      rootCandidates.push(parent);
    }
  }

  // 3. Common user / system AppData locations for nvm-windows, fnm, volta, author software
  const appData = process.env.APPDATA || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  const userProfile = process.env.USERPROFILE || "";
  const progFiles = process.env.ProgramFiles || "C:\\Program Files";

  rootCandidates.push(
    path.join(appData, "nvm"),
    path.join(localAppData, "nvm"),
    path.join(localAppData, "Author Software", "nvm", "installs"),
    path.join(localAppData, "nvm", "versions"),
    path.join(userProfile, ".nvm"),
    path.join(userProfile, "nvm"),
    path.join(progFiles, "nvm"),
    path.join(appData, "fnm", "current"),
    path.join(localAppData, "fnm", "current"),
    path.join(userProfile, "AppData", "Roaming", "fnm", "node-versions"),
    path.join(localAppData, "Volta", "tools", "image", "node"),
    "C:\\nvm",
    "D:\\nvm",
    "E:\\nvm"
  );

  for (const root of rootCandidates) {
    if (!root || !fs.existsSync(root)) {
      continue;
    }

    // Direct check for version variants
    for (const v of versionVariants) {
      const candidateDir = path.join(root, v);
      if (isValidNodeDirectory(candidateDir)) {
        return candidateDir;
      }
    }

    // Fuzzy check (e.g. matching "v20.14.0" if cleanVer is "20.14.0" or "20")
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const name = entry.name;
          const norm = name.replace(/^v/i, "");
          if (norm === cleanVer || norm.startsWith(`${cleanVer}.`)) {
            const candidateDir = path.join(root, name);
            if (isValidNodeDirectory(candidateDir)) {
              return candidateDir;
            }
          }
        }
      }
    } catch {
      // ignore read error
    }
  }

  return undefined;
}

export async function runNvmUse(version: string): Promise<{ success: boolean; output: string }> {
  const cleanVersion = version.trim().replace(/^v/i, "");
  const directDir = findNvmNodeHome(cleanVersion);

  if (directDir) {
    return {
      success: true,
      output: `Node.js v${cleanVersion} resolved directly at ${directDir}`
    };
  }

  // If not found in standard NVM directories, return a safe message.
  // We NEVER spawn background 'nvm.exe' on Windows when redirected because
  // nvm-windows v1.1.12+ pops up a Win32 GUI dialog:
  // "Terminal Only: NVM for Windows should be run from a terminal such as CMD or PowerShell."
  return {
    success: false,
    output: `Node.js v${cleanVersion} directory not found in NVM installations. Falling back to system default.`
  };
}
