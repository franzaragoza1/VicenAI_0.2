import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from './utils/logger.js';
import { tools, handleToolCall } from './tools/index.js';

export function createMCPServer(): Server {
  const server = new Server(
    {
      name: 'vicen-racing-engineer',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handler for listing available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Received list_tools request');
    return {
      tools,
    };
  });

  // Handler for calling a tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info(`Tool call: ${name}`);
    logger.debug(`Tool arguments:`, args);

    try {
      const result = await handleToolCall(name, args || {});

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Tool call failed: ${errorMsg}`, error);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: errorMsg,
              tool: name,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
