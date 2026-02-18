import { readGeminiLogsTool, readGeminiLogs } from './read-gemini-logs.js';
import { readTelemetrySnapshotTool, readTelemetrySnapshot } from './read-telemetry.js';
import { readGeminiStateTool, readGeminiState } from './read-gemini-state.js';
import { readLapDataTool, readLapData } from './read-lap-data.js';
import { listAvailableDataTool, listAvailableData } from './list-available-data.js';

// Export all tool definitions
export const tools = [
  readGeminiLogsTool,
  readTelemetrySnapshotTool,
  readGeminiStateTool,
  readLapDataTool,
  listAvailableDataTool,
];

// Tool call router
export async function handleToolCall(name: string, args: any): Promise<any> {
  switch (name) {
    case 'read_gemini_logs':
      return readGeminiLogs(args);

    case 'read_telemetry_snapshot':
      return readTelemetrySnapshot(args);

    case 'read_gemini_state':
      return readGeminiState();

    case 'read_lap_data':
      return readLapData(args);

    case 'list_available_data':
      return listAvailableData();

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
