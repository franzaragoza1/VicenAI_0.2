import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Logs all LLM request/response pairs to a per-session JSONL file.
 * Output directory: %APPDATA%\vicen-racing-engineer\gemini-logs\
 * File format:      session_<ISO timestamp>.jsonl
 *
 * Each line is a JSON object with one of these shapes:
 *
 * Session start:
 * { "event": "session_start", "ts": "<ISO>", "sessionFile": "<filename>", "model": "..." }
 *
 * LLM request:
 * { "event": "llm_request", "ts": "<ISO>", "triggerType": "user"|"proactive"|"periodic",
 *   "userMessage": "...", "raceContext": "...", "messageHistory": [...],
 *   "tools": [...], "model": "...", "maxTokens": N, "temperature": N }
 *
 * LLM response:
 * { "event": "llm_response", "ts": "<ISO>", "responseText": "...", "toolCall": null|{name,args},
 *   "ttfbMs": N, "totalDurationMs": N, "estimatedTokens": N }
 *
 * Function call + result:
 * { "event": "tool_call",    "ts": "<ISO>", "name": "...", "arguments": {...} }
 * { "event": "tool_result",  "ts": "<ISO>", "name": "...", "result": ... }
 */

export interface LLMRequestLog {
  triggerType: 'user' | 'proactive' | 'periodic';
  userMessage: string;
  raceContext: string;
  messageHistory: any[];
  tools: any[];
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMResponseLog {
  responseText: string;
  toolCall: { name: string; arguments: any } | null;
  ttfbMs: number | null;
  totalDurationMs: number;
  estimatedTokens: number;
}

export class LLMSessionLogger {
  private logPath: string;
  private sessionFile: string;

  constructor(model: string) {
    // Resolve log directory
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const logDir = path.join(appData, 'vicen-racing-engineer', 'gemini-logs');

    // Ensure directory exists
    fs.mkdirSync(logDir, { recursive: true });

    // Session file named by start time
    const now = new Date();
    const stamp = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
    this.sessionFile = `session_${stamp}.jsonl`;
    this.logPath = path.join(logDir, this.sessionFile);

    // Write session start marker
    this.write({
      event: 'session_start',
      ts: now.toISOString(),
      sessionFile: this.sessionFile,
      model,
    });

    console.log(`[LLMSessionLogger] Logging to ${this.logPath}`);
  }

  public logRequest(req: LLMRequestLog): void {
    this.write({
      event: 'llm_request',
      ts: new Date().toISOString(),
      ...req,
    });
  }

  public logResponse(res: LLMResponseLog): void {
    this.write({
      event: 'llm_response',
      ts: new Date().toISOString(),
      ...res,
    });
  }

  public logToolCall(name: string, args: any): void {
    this.write({
      event: 'tool_call',
      ts: new Date().toISOString(),
      name,
      arguments: args,
    });
  }

  public logToolResult(name: string, result: any): void {
    this.write({
      event: 'tool_result',
      ts: new Date().toISOString(),
      name,
      result,
    });
  }

  private write(obj: object): void {
    try {
      fs.appendFileSync(this.logPath, JSON.stringify(obj) + '\n', 'utf8');
    } catch (err) {
      console.error('[LLMSessionLogger] Failed to write log:', err);
    }
  }

  public getLogPath(): string {
    return this.logPath;
  }
}
