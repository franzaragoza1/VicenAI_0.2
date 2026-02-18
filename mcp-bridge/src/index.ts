#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMCPServer } from './server.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Starting VICEN Racing Engineer MCP Bridge');

  const server = createMCPServer();
  const transport = new StdioServerTransport();

  logger.info('Connecting to STDIO transport');
  await server.connect(transport);

  logger.info('MCP Server running on STDIO');

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down');
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
