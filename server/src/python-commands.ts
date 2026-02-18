import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

/**
 * Pending command awaiting response from Python
 */
interface PendingCommand {
  resolve: (data: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * PythonCommandExecutor handles executing commands via Python telemetry WebSocket
 */
export class PythonCommandExecutor {
  private pythonWs: WebSocket | null;
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private commandTimeout: number = 5000;  // 5s timeout

  constructor(pythonWs: WebSocket | null) {
    this.pythonWs = pythonWs;
  }

  /**
   * Update Python WebSocket reference (for reconnections)
   */
  public setPythonWs(pythonWs: WebSocket | null): void {
    this.pythonWs = pythonWs;
  }

  /**
   * Execute a command and wait for response
   */
  public async executeCommand(command: string, args: any = {}): Promise<any> {
    if (!this.pythonWs || this.pythonWs.readyState !== WebSocket.OPEN) {
      throw new Error('Python telemetry WebSocket not connected');
    }

    const requestId = uuidv4();

    return new Promise((resolve, reject) => {
      // Setup timeout
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Command timeout: ${command}`));
      }, this.commandTimeout);

      // Store pending command
      this.pendingCommands.set(requestId, { resolve, reject, timeout });

      // Send command to Python
      const message = {
        type: 'command',
        requestId,
        command,
        args,
      };

      console.log(`[PythonCommands] Executing: ${command}`, args);
      this.pythonWs!.send(JSON.stringify(message));
    });
  }

  /**
   * Handle response from Python
   */
  public handleResponse(requestId: string, success: boolean, data: any): void {
    const pending = this.pendingCommands.get(requestId);

    if (!pending) {
      console.warn(`[PythonCommands] Received response for unknown request: ${requestId}`);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(requestId);

    if (success) {
      console.log(`[PythonCommands] Command succeeded:`, data);
      pending.resolve(data);
    } else {
      console.error(`[PythonCommands] Command failed:`, data);
      pending.reject(new Error(data?.error || 'Command failed'));
    }
  }

  /**
   * Configure pit stop
   */
  public async configurePitStop(params: {
    fuelToAdd?: number;
    changeTires?: boolean;
    tireCompound?: string;
    repairDamage?: boolean;
  }): Promise<any> {
    return this.executeCommand('configure_pit', params);
  }

  /**
   * Get pit stop status
   */
  public async getPitStatus(): Promise<any> {
    return this.executeCommand('get_pit_status');
  }

  /**
   * Send chat macro
   */
  public async sendChatMacro(macroNumber: number): Promise<any> {
    return this.executeCommand('send_chat', { macro: macroNumber });
  }

  /**
   * Request current setup
   */
  public async requestCurrentSetup(): Promise<any> {
    return this.executeCommand('get_setup');
  }
}
