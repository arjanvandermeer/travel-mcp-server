import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CancelTaskRequestSchema,
  CallToolRequestSchema,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListTasksRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as telemetry from './telemetry.js';
import { defaultMaintenanceTaskManager, isAdminUser } from './maintenance-tasks.js';
import { render } from './templates/index.js';
import {
  executeToolHandler,
  getToolAccessError,
  getResourcesConfig,
  getToolsConfig,
  handleReadResource,
  isToolAvailableToUser,
  maintenanceTaskToolNames,
} from './tools-config.js';
import { getVersionString } from './version.js';

export function createTravelMCPServer({
  db,
  taskManager = defaultMaintenanceTaskManager,
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
        tasks: {
          list: {},
          cancel: {},
          requests: {
            tools: { call: {} },
          },
        },
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    log('INFO', 'ListTools request received');
    const widgetDomain = await db.getServerBaseUrl() || 'http://localhost';
    return { tools: getToolsConfig(widgetDomain, { user: userRef.current }) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const isTaskRequest = !!request.params.task;
    log('INFO', `Tool call received: ${name}`, args);
    telemetry.addBreadcrumb(`Tool call: ${name}`, 'mcp.tool', args);

    return telemetry.withTransaction(`mcp.tool.${name}`, 'mcp.request', async () => {
      try {
        if (!isToolAvailableToUser(name, userRef.current)) {
          throw new Error(getToolAccessError(name, userRef.current));
        }
        if (isTaskRequest && !maintenanceTaskToolNames.has(name)) {
          throw new Error(`Task creation is not supported for tool: ${name}`);
        }

        const result = await executeToolHandler(name, args || {}, db, {
          createTaskResult: isTaskRequest,
          taskManager,
          taskMetadata: request.params.task,
          user: userRef.current,
        });
        log('INFO', `${name} completed successfully`);
        return result;
      } catch (error) {
        log('ERROR', `Tool ${name} failed`, { error: error.message, stack: error.stack });
        telemetry.captureException(error, { tool: name, args, userId: userRef.current?.id });
        if (isTaskRequest) {
          throw error;
        }
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

  server.setRequestHandler(ListTasksRequestSchema, async () => {
    log('INFO', 'ListTasks request received');
    if (!isAdminUser(userRef.current)) {
      return { tasks: [] };
    }
    return { tasks: taskManager.listTasks() };
  });

  server.setRequestHandler(GetTaskRequestSchema, async (request) => {
    const { taskId } = request.params;
    log('INFO', `GetTask request received: ${taskId}`);
    requireAdminTaskAccess(userRef.current);
    const task = taskManager.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  });

  server.setRequestHandler(GetTaskPayloadRequestSchema, async (request) => {
    const { taskId } = request.params;
    log('INFO', `GetTaskPayload request received: ${taskId}`);
    requireAdminTaskAccess(userRef.current);
    const task = taskManager.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    const payload = taskManager.getTaskPayload(taskId);
    if (!payload) {
      throw new Error(`Task result is not available yet: ${taskId} (${task.status})`);
    }
    return payload;
  });

  server.setRequestHandler(CancelTaskRequestSchema, async (request) => {
    const { taskId } = request.params;
    log('INFO', `CancelTask request received: ${taskId}`);
    requireAdminTaskAccess(userRef.current);
    const task = taskManager.cancelTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  });

  return server;
}

function requireAdminTaskAccess(user) {
  if (!user) {
    throw new Error('Authentication required for maintenance tasks');
  }
  if (!isAdminUser(user)) {
    throw new Error('Admin role required for maintenance tasks');
  }
}
