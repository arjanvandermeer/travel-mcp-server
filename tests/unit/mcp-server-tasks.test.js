import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CancelTaskResultSchema,
  CreateTaskResultSchema,
  GetTaskPayloadResultSchema,
  GetTaskResultSchema,
  ListTasksResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTravelMCPServer } from '../../src/mcp-server-factory.js';
import { createMockTravelDb } from '../../scripts/mock-travel-db.js';

const task = {
  taskId: 'geonames_refresh-test',
  status: 'completed',
  statusMessage: 'GeoNames refresh completed successfully',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUpdatedAt: '2026-01-01T00:00:01.000Z',
  ttl: 86400000,
  pollInterval: 2000,
};

function createTaskManager(overrides = {}) {
  const payload = {
    content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
  };
  return {
    cancelTask: () => ({ ...task, status: 'cancelled' }),
    getTask: () => task,
    getTaskPayload: () => payload,
    listTasks: () => [task],
    startGeonamesRefresh: () => ({ task, alreadyRunning: false }),
    ...overrides,
  };
}

async function withClient({ user, taskManager }, callback) {
  const db = createMockTravelDb();
  const userRef = { current: user || null };
  const server = createTravelMCPServer({ db, taskManager, userRef });
  const client = new Client(
    { name: 'mcp-server-tasks-test', version: '1.0.0' },
    { capabilities: { tasks: { requests: { tools: { call: {} } } } } },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
    await callback(client);
  } finally {
    await client.close();
  }
}

describe('MCP maintenance task handlers', () => {
  it('does not expose maintenance tasks to anonymous sessions', async () => {
    await withClient({ taskManager: createTaskManager() }, async (client) => {
      const tasks = await client.request({ method: 'tasks/list', params: {} }, ListTasksResultSchema);
      assert.deepEqual(tasks.tasks, []);
    });
  });

  it('allows admins to start and inspect GeoNames tasks', async () => {
    const admin = { id: 1, email: 'admin@example.com', config: { role: 'admin' } };
    await withClient({ user: admin, taskManager: createTaskManager() }, async (client) => {
      const started = await client.callTool({ name: 'refresh_geonames', arguments: {} });
      const parsed = JSON.parse(started.content[0].text);
      assert.equal(parsed.task.taskId, task.taskId);

      const tasks = await client.request({ method: 'tasks/list', params: {} }, ListTasksResultSchema);
      assert.equal(tasks.tasks.length, 1);

      const fetched = await client.request(
        { method: 'tasks/get', params: { taskId: task.taskId } },
        GetTaskResultSchema,
      );
      assert.equal(fetched.taskId, task.taskId);

      const payload = await client.request(
        { method: 'tasks/result', params: { taskId: task.taskId } },
        GetTaskPayloadResultSchema,
      );
      assert.equal(JSON.parse(payload.content[0].text).success, true);

      const cancelled = await client.request(
        { method: 'tasks/cancel', params: { taskId: task.taskId } },
        CancelTaskResultSchema,
      );
      assert.equal(cancelled.status, 'cancelled');
    });
  });

  it('supports MCP task-augmented refresh_geonames calls for admins', async () => {
    const admin = { id: 1, email: 'admin@example.com', config: { role: 'admin' } };
    await withClient({ user: admin, taskManager: createTaskManager() }, async (client) => {
      const result = await client.request({
        method: 'tools/call',
        params: {
          name: 'refresh_geonames',
          arguments: {},
          task: { ttl: 60000 },
        },
      }, CreateTaskResultSchema);

      assert.equal(result.task.taskId, task.taskId);
    });
  });

  it('supports MCP task-augmented load_geonames_country calls for admins', async () => {
    const admin = { id: 1, email: 'admin@example.com', config: { role: 'admin' } };
    await withClient({ user: admin, taskManager: createTaskManager() }, async (client) => {
      const result = await client.request({
        method: 'tools/call',
        params: {
          name: 'load_geonames_country',
          arguments: { country_code: 'US' },
          task: { ttl: 60000 },
        },
      }, CreateTaskResultSchema);

      assert.equal(result.task.taskId, task.taskId);
    });
  });
});
