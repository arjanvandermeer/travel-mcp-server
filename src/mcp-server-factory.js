import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListTasksRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as telemetry from './telemetry.js';
import { render } from './templates/index.js';
import {
  executeToolHandler,
  getPromptMessages,
  getResourcesConfig,
  getToolsConfig,
  handleReadResource,
  promptsConfig,
} from './tools-config.js';
import { getVersionString } from './version.js';

export function createTravelMCPServer({
  db,
  userRef = { current: null },
  log = () => {},
} = {}) {
  if (!db) {
    throw new Error('createTravelMCPServer requires a db instance');
  }

  const server = new Server(
    {
      name: 'travel-mcp-server',
      version: getVersionString(),
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        tasks: { list: {} },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log('INFO', 'ListTools request received');
    const widgetDomain = await db.getServerBaseUrl() || 'http://localhost';
    return { tools: getToolsConfig(widgetDomain) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log('INFO', `Tool call received: ${name}`, args);
    telemetry.addBreadcrumb(`Tool call: ${name}`, 'mcp.tool', args);

    return telemetry.withTransaction(`mcp.tool.${name}`, 'mcp.request', async () => {
      try {
        const result = await executeToolHandler(name, args, db, { user: userRef.current });
        log('INFO', `${name} completed successfully`);
        return result;
      } catch (error) {
        log('ERROR', `Tool ${name} failed`, { error: error.message, stack: error.stack });
        telemetry.captureException(error, { tool: name, args, userId: userRef.current?.id });
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    log('INFO', 'ListResources request received');
    const widgetDomain = await db.getServerBaseUrl() || 'http://localhost';
    return getResourcesConfig(widgetDomain);
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    log('INFO', 'ListResourceTemplates request received');
    const widgetDomain = await db.getServerBaseUrl() || 'http://localhost';
    const { resourceTemplates } = getResourcesConfig(widgetDomain);
    return { resourceTemplates };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    log('INFO', `ReadResource request received: ${uri}`);
    try {
      return await handleReadResource(uri, db, render);
    } catch (error) {
      log('ERROR', `ReadResource failed: ${uri}`, { error: error.message });
      telemetry.captureException(error, { resource: uri });
      return {
        contents: [{ uri, mimeType: 'text/plain', text: `Error: ${error.message}` }],
      };
    }
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    log('INFO', 'ListPrompts request received');
    return { prompts: promptsConfig };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log('INFO', `GetPrompt request received: ${name}`, args);
    return getPromptMessages(name, args);
  });

  server.setRequestHandler(ListTasksRequestSchema, async () => {
    log('INFO', 'ListTasks request received');
    return { tasks: [] };
  });

  return server;
}
