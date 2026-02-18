# VICEN Racing Engineer MCP Bridge

Model Context Protocol (MCP) server that exposes VICEN Racing Engineer internal data to Claude Code and Claude Desktop.

## Overview

This MCP bridge provides real-time access to:
- **Gemini Live logs** - Session logs with timestamps, categories, and metadata
- **Telemetry data** - Current racing telemetry (speed, RPM, fuel, position, etc.)
- **Gemini state** - Connection status, speaking state, last transcript
- **Lap data** - Best lap, last lap, and specific lap telemetry
- **Data availability** - Health check for all data sources

## Installation

```bash
cd mcp-bridge
npm install
npm run build
```

## Configuration

### Environment Variables

- `VICEN_SERVER_URL` - Base URL for VICEN server (default: `http://localhost:8081`)
- `LOG_LEVEL` - Logging verbosity: `debug`, `info`, `warn`, `error` (default: `info`)

### Claude Desktop Integration

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vicen-racing-engineer": {
      "command": "node",
      "args": [
        "C:\\Users\\YOUR_USERNAME\\Documents\\VICEN-AI-0.1\\mcp-bridge\\dist\\index.js"
      ],
      "env": {
        "LOG_LEVEL": "info",
        "VICEN_SERVER_URL": "http://localhost:8081"
      }
    }
  }
}
```

**Important**: Replace `YOUR_USERNAME` with your actual Windows username.

After configuration, restart Claude Desktop to load the MCP server.

## Available Tools

### 1. `read_gemini_logs`

Reads recent Gemini Live log entries from disk.

**Parameters:**
- `lines` (optional) - Number of log entries to return (default: 20, max: 100)
- `category` (optional) - Filter by category (e.g., "user_message", "context", "tool_call", "response")

**Example:**
```
Read the last 10 Gemini logs with category "user_message"
```

**Response:**
```json
{
  "success": true,
  "logs": [
    {
      "timestamp": "2026-02-15T10:30:45.123Z",
      "type": "sent",
      "category": "user_message",
      "content": "What's my lap time?",
      "metadata": {}
    }
  ],
  "count": 10,
  "filesRead": 2
}
```

### 2. `read_telemetry_snapshot`

Gets current telemetry data from the VICEN server.

**Parameters:**
- `includeRaw` (optional) - Include full raw telemetry data (default: false)

**Example:**
```
Show me the current telemetry snapshot
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "simulator": "iRacing",
    "track": "Watkins Glen International",
    "car": "Mazda MX-5 Cup",
    "position": 3,
    "speed": 145,
    "rpm": 5800,
    "gear": 4,
    "fuel": 78.5,
    "lapTime": "1:23.456",
    "lastLapTime": "1:24.123",
    "inPits": false
  }
}
```

### 3. `read_gemini_state`

Gets current Gemini Live connection state.

**Parameters:** None

**Example:**
```
What's the current Gemini state?
```

**Response:**
```json
{
  "success": true,
  "state": {
    "connected": true,
    "speaking": false,
    "lastTranscript": "Your last lap was 1:24.5",
    "lastUpdate": 1739526645123
  },
  "source": "endpoint"
}
```

### 4. `read_lap_data`

Gets lap data from VICEN server.

**Parameters:**
- `lapReference` (optional) - Which lap to fetch: "session-best", "last", or lap number (default: "session-best")
- `includeTelemetry` (optional) - Include full telemetry points (default: false)

**Example:**
```
Show me the session best lap
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "lapNumber": 5,
    "lapTime": "1:23.456",
    "delta": "-0.234s",
    "trackName": "Watkins Glen International",
    "carName": "Mazda MX-5 Cup",
    "sessionType": "Race",
    "timestamp": "2026-02-15T10:25:30.000Z"
  }
}
```

### 5. `list_available_data`

Health check for all data sources.

**Parameters:** None

**Example:**
```
List all available data sources
```

**Response:**
```json
{
  "success": true,
  "sources": {
    "geminiLogs": {
      "available": true,
      "details": "3 log file(s) found"
    },
    "server": {
      "available": true,
      "details": "Server running at http://localhost:8081"
    },
    "telemetry": {
      "available": true,
      "details": "Active telemetry from iRacing"
    },
    "laps": {
      "available": true,
      "details": "12 lap(s) stored"
    }
  }
}
```

## Data Sources

| Source | Location | Access Method |
|--------|----------|---------------|
| Gemini Logs | `%APPDATA%\VICEN-AI\gemini-logs\` | Direct file read |
| Telemetry | `http://localhost:8081/api/latest` | HTTP GET |
| Gemini State | `http://localhost:8081/api/gemini/state` | HTTP GET |
| Lap Data | `http://localhost:8081/api/laps/*` | HTTP GET |

## Development

### Build

```bash
npm run build
```

### Watch mode (auto-rebuild on changes)

```bash
npm run dev
```

### Manual testing

```bash
node dist/index.js
```

Then send JSON-RPC requests via stdin:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_available_data","arguments":{}}}
```

## Troubleshooting

### MCP server not appearing in Claude Desktop

1. Check `claude_desktop_config.json` syntax is valid
2. Verify the path to `index.js` is correct
3. Restart Claude Desktop completely
4. Check Claude Desktop logs: `%APPDATA%\Claude\logs\`

### "Server unreachable" errors

1. Ensure VICEN app is running
2. Verify server is on port 8081: `curl http://localhost:8081/api/health`
3. Check firewall settings

### "No log files found"

1. Run VICEN app and connect to Gemini at least once
2. Check logs directory exists: `%APPDATA%\VICEN-AI\gemini-logs\`
3. Verify file logging is enabled in VICEN settings

### "No telemetry data available"

1. Start a racing session in iRacing or SimHub
2. Verify telemetry service is running
3. Check `/api/latest` endpoint returns data

### MCP server crashes on startup

1. Check Node.js version (requires Node 18+)
2. Rebuild: `npm run build`
3. Check logs with `LOG_LEVEL=debug`

## Architecture

### STDIO Transport

The MCP server uses STDIO (stdin/stdout) for communication:
- **stdin**: Receives JSON-RPC requests from Claude Desktop
- **stdout**: Sends JSON-RPC responses back
- **stderr**: Used for logging (does not interfere with protocol)

### Request Flow

```
Claude Desktop
    ↓ (JSON-RPC via stdin)
MCP Server (index.ts)
    ↓
Tool Router (tools/index.ts)
    ↓
Tool Implementation
    ↓ (HTTP or File I/O)
Data Source (VICEN server or logs)
```

## License

Part of VICEN Racing Engineer - MIT License
