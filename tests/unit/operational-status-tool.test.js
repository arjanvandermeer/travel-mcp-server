import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeToolHandler, getToolsConfig, isToolAvailableToUser } from '../../src/tools-config.js';

describe('get_operational_status MCP tool', () => {
  const admin = { id: 1, email: 'admin@example.com', config: { role: 'admin' } };

  it('is only advertised to admins', () => {
    assert.equal(isToolAvailableToUser('get_operational_status'), false);
    assert.equal(isToolAvailableToUser('get_operational_status', { config: { role: 'user' } }), false);
    assert.equal(isToolAvailableToUser('get_operational_status', admin), true);
    assert.ok(getToolsConfig(null, { user: admin }).some(tool => tool.name === 'get_operational_status'));
  });

  it('returns the read-only database report', async () => {
    const report = { needs_attention: [{ type: 'failed_imports', count: 1 }] };
    const result = await executeToolHandler('get_operational_status', {}, {
      getOperationalStatus: async () => report,
    }, { user: admin });

    assert.deepEqual(JSON.parse(result.content[0].text), report);
  });

  it('defends the handler when it is invoked outside normal tool discovery', async () => {
    const result = await executeToolHandler('get_operational_status', {}, {
      getOperationalStatus: async () => ({ should_not_be_called: true }),
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Authentication required/);
  });
});
