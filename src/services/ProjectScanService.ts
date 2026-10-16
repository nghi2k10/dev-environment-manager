import * as fs from "node:fs";
import * as path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".gradle",
  ".idea",
  ".vscode",
  "build",
  "out",
  "dist",
  "target",
  "bin"
]);

/**
 * Breadth-first search for files by name (case-insensitive) under `root`.
 * Shallow matches are returned first. Bounded by depth and visited-directory count.
 */
export function findFilesBounded(
  root: string,
  fileNames: string[],
  maxDepth = 6,
  maxDirs = 4000
): string[] {
  const wanted = new Set(fileNames.map(n => n.toLowerCase()));
  const found: string[] = [];
  let queue: string[] = [root];
  let visited = 0;

  for (let depth = 0; depth <= maxDepth && queue.length > 0; depth++) {
    const next: string[] = [];
    for (const dir of queue) {
      if (visited++ > maxDirs) {
        return found;
      }
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isFile() && wanted.has(entry.name.toLowerCase())) {
          found.push(path.join(dir, entry.name));
        } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name.toLowerCase())) {
          next.push(path.join(dir, entry.name));
        }
      }
    }
    queue = next;
  }
  return found;
}

function toMajorVersion(raw: string): number | undefined {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(\d+)(?:\.(\d+))?/);
  if (!m) {
    return undefined;
  }
  const first = parseInt(m[1], 10);
  // "1.8" -> 8, "1.7" -> 7; "11" -> 11; "17" -> 17
  if (first === 1 && m[2] !== undefined) {
    return parseInt(m[2], 10);
  }
  return first;
}

export type DetectedJavaVersion = { major: number; source: string };

/**
 * Detects the project's Java version from Spring Boot dev config:
 *  - application-dev.yml / .yaml:        `java-version: 11`
 *  - application-dev.properties:         `build-config.java-version=1.8`
 */
export function detectProjectJavaVersion(projectRoot: string): DetectedJavaVersion | undefined {
  if (!projectRoot || !fs.existsSync(projectRoot)) {
    return undefined;
  }

  const files = findFilesBounded(projectRoot, [
    "application-dev.yml",
    "application-dev.yaml",
    "application-dev.properties"
  ]);

  // Prefer files located in src/main/resources
  files.sort((a, b) => {
    const ra = /src[\\/]main[\\/]resources/i.test(a) ? 0 : 1;
    const rb = /src[\\/]main[\\/]resources/i.test(b) ? 0 : 1;
    return ra - rb;
  });

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const isProps = file.toLowerCase().endsWith(".properties");
    const match = isProps
      ? content.match(/^[ \t]*build-config\.java-version[ \t]*[=:][ \t]*["']?([0-9]+(?:\.[0-9]+)?)/m) ??
        content.match(/^[ \t]*(?:[\w.-]+\.)?java[-.]version[ \t]*[=:][ \t]*["']?([0-9]+(?:\.[0-9]+)?)/m)
      : content.match(/^[ \t]*java-version[ \t]*:[ \t]*["']?([0-9]+(?:\.[0-9]+)?)/m);

    if (match) {
      const major = toMajorVersion(match[1]);
      if (major) {
        return { major, source: file };
      }
    }
  }
  return undefined;
}

const FRONTEND_TASK_LINE =
  /^([ \t]*)(compileJava\.dependsOn[ \t]*\([ \t]*clearFrontend[ \t]*\)|processResources\.dependsOn[ \t]*\([ \t]*copyFrontend[ \t]*\))([ \t;]*)$/gm;

/**
 * Comments out:
 *   compileJava.dependsOn(clearFrontend)
 *   processResources.dependsOn(copyFrontend)
 * in every build.gradle found under `root`. Returns the files that were modified.
 */
export function commentOutFrontendGradleTasks(root: string): string[] {
  const modified: string[] = [];
  for (const file of findFilesBounded(root, ["build.gradle"], 4)) {
    let content: string;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    FRONTEND_TASK_LINE.lastIndex = 0;
    if (!FRONTEND_TASK_LINE.test(content)) {
      continue;
    }
    FRONTEND_TASK_LINE.lastIndex = 0;
    const updated = content.replace(FRONTEND_TASK_LINE, "$1// $2$3");
    if (updated !== content) {
      try {
        fs.writeFileSync(file, updated, "utf8");
        modified.push(file);
      } catch {
        // Ignore unwritable files
      }
    }
  }
  return modified;
}

