import * as vscode from "vscode";
import { AllTargetName, LogEntry, LogStreamType } from "../types/project-config";

const MAX_LOG_ENTRIES = 1000;

// Regex to strip ANSI escape sequences for clean dashboard rendering
const ANSI_ESCAPE_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_REGEX, "");
}

export function formatTimeShort(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export class LogService implements vscode.Disposable {
  private readonly entries: LogEntry[] = [];
  private nextId = 1;

  private readonly onDidAppendEmitter = new vscode.EventEmitter<LogEntry>();
  public readonly onDidAppend = this.onDidAppendEmitter.event;

  private readonly onDidClearEmitter = new vscode.EventEmitter<void>();
  public readonly onDidClear = this.onDidClearEmitter.event;

  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  public appendLine(target: AllTargetName, stream: LogStreamType, rawLine: string): LogEntry | null {
    const cleaned = stripAnsi(rawLine).replace(/\r$/, "");
    if (!cleaned.trim() && stream !== "stdout") {
      return null;
    }

    const timestamp = formatTimeShort(new Date());
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp,
      target,
      stream,
      text: cleaned
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_LOG_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_LOG_ENTRIES);
    }

    const prefix = stream === "stderr" ? `[${target}:ERR]` : `[${target}]`;
    this.outputChannel.appendLine(`${timestamp} ${prefix} ${cleaned}`);

    this.onDidAppendEmitter.fire(entry);
    return entry;
  }

  public appendChunk(target: AllTargetName, stream: LogStreamType, chunk: string): LogEntry[] {
    const lines = chunk.split(/\r?\n/);
    const created: LogEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i === lines.length - 1 && line === "") {
        continue;
      }
      const entry = this.appendLine(target, stream, line);
      if (entry) {
        created.push(entry);
      }
    }
    return created;
  }

  public appendOutputChannelOnly(message: string): void {
    this.outputChannel.appendLine(message);
  }

  public showOutputChannel(preserveFocus = true): void {
    this.outputChannel.show(preserveFocus);
  }

  public getLogs(filter: "all" | AllTargetName = "all"): LogEntry[] {
    if (filter === "all") {
      return [...this.entries];
    }
    return this.entries.filter(e => e.target === filter);
  }

  public formatLogsForClipboard(filter: "all" | AllTargetName = "all"): string {
    const logs = this.getLogs(filter);
    return logs
      .map(entry => `${entry.timestamp} [${entry.target.toUpperCase()}/${entry.stream.toUpperCase()}] ${entry.text}`)
      .join("\n");
  }

  public clear(): void {
    this.entries.length = 0;
    this.outputChannel.appendLine(`${formatTimeShort()} [system] Live logs cleared by user.`);
    this.onDidClearEmitter.fire();
  }

  public dispose(): void {
    this.onDidAppendEmitter.dispose();
    this.onDidClearEmitter.dispose();
  }
}

