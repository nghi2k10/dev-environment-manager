import * as fs from "node:fs";
import { spawn } from "node:child_process";
import { Profile } from "../types/project-config";
import { stripAnsi } from "./LogService";

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

export async function runNvmUse(version: string): Promise<{ success: boolean; output: string }> {
  const cleanVersion = version.trim().replace(/^v/i, "");
  return new Promise(resolve => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? (process.env.ComSpec || "cmd.exe") : "nvm";
    const args = isWin ? ["/d", "/s", "/c", `nvm use ${cleanVersion}`] : ["use", cleanVersion];

    const child = spawn(cmd, args, {
      windowsHide: true,
      windowsVerbatimArguments: true,
      shell: false
    });

    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });

    child.on("close", code => {
      resolve({
        success: code === 0,
        output: stripAnsi(out).trim()
      });
    });

    child.on("error", err => {
      resolve({
        success: false,
        output: err.message
      });
    });
  });
}

