import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MaintenanceTaskManager, isAdminUser } from '../../src/maintenance-tasks.js';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killedSignal = null;
  }

  kill(signal) {
    this.killedSignal = signal;
    return true;
  }
}

function createClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, tick));
  };
}

async function waitForTaskStatus(manager, taskId, expectedStatus) {
  for (let i = 0; i < 20; i += 1) {
    const task = manager.getTask(taskId);
    if (task?.status === expectedStatus) return task;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(`Task ${taskId} did not reach status ${expectedStatus}`);
}

describe('MaintenanceTaskManager', () => {
  it('detects admin users from user_config role', () => {
    assert.equal(isAdminUser({ config: { role: 'admin' } }), true);
    assert.equal(isAdminUser({ config: { role: 'ADMIN' } }), true);
    assert.equal(isAdminUser({ config: { role: 'user' } }), false);
    assert.equal(isAdminUser(null), false);
  });

  it('starts a GeoNames refresh task and stores the completed payload', () => {
    const child = new FakeChild();
    const spawnCalls = [];
    const manager = new MaintenanceTaskManager({
      now: createClock(),
      spawn: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return child;
      },
    });

    const { task, alreadyRunning } = manager.startGeonamesRefresh({
      user: { id: 7, email: 'admin@example.com' },
    });

    assert.equal(alreadyRunning, false);
    assert.match(task.taskId, /^geonames_refresh-/);
    assert.equal(task.status, 'working');
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].command, process.execPath);
    assert.ok(spawnCalls[0].args[0].endsWith('scripts/refresh-imports.js'));
    assert.deepEqual(spawnCalls[0].args.slice(1), ['--skip-osm', '--refresh-geonames']);

    child.stdout.emit('data', 'Running GeoNames import...\n');
    assert.equal(manager.getTask(task.taskId).statusMessage, 'Running GeoNames import...');

    child.emit('close', 0, null);
    const completed = manager.getTask(task.taskId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.statusMessage, 'GeoNames refresh completed successfully');

    const payload = manager.getTaskPayload(task.taskId);
    const parsed = JSON.parse(payload.content[0].text);
    assert.equal(parsed.success, true);
    assert.equal(parsed.requestedBy.email, 'admin@example.com');
    assert.match(parsed.outputTail, /Running GeoNames import/);
  });

  it('passes a country code through to the GeoNames refresh command', () => {
    const child = new FakeChild();
    const spawnCalls = [];
    const manager = new MaintenanceTaskManager({
      now: createClock(),
      spawn: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return child;
      },
    });

    const { task } = manager.startGeonamesRefresh({
      countryCode: 'nl',
      user: { id: 7, email: 'admin@example.com' },
    });

    assert.deepEqual(
      spawnCalls[0].args.slice(1),
      ['--skip-osm', '--refresh-geonames', '--geonames-country=NL'],
    );

    child.emit('close', 0, null);
    const parsed = JSON.parse(manager.getTaskPayload(task.taskId).content[0].text);
    assert.equal(parsed.countryCode, 'NL');
    assert.equal(parsed.statusMessage, 'GeoNames refresh for NL completed successfully');
  });

  it('reuses an active GeoNames refresh task instead of starting a duplicate', () => {
    const child = new FakeChild();
    const spawnCalls = [];
    const manager = new MaintenanceTaskManager({
      now: createClock(),
      spawn: (...args) => {
        spawnCalls.push(args);
        return child;
      },
    });

    const first = manager.startGeonamesRefresh({ user: { id: 1 } });
    const second = manager.startGeonamesRefresh({ user: { id: 1 } });

    assert.equal(second.alreadyRunning, true);
    assert.equal(second.task.taskId, first.task.taskId);
    assert.equal(spawnCalls.length, 1);
  });

  it('cancels a running GeoNames refresh task', () => {
    const child = new FakeChild();
    const manager = new MaintenanceTaskManager({
      now: createClock(),
      spawn: () => child,
    });

    const { task } = manager.startGeonamesRefresh({ user: { id: 1 } });
    const cancelled = manager.cancelTask(task.taskId);

    assert.equal(child.killedSignal, 'SIGTERM');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(manager.getTaskPayload(task.taskId).isError, true);
  });

  it('starts a Google Places enrichment task for stale entries', async () => {
    const calls = [];
    const db = {
      getStaleGooglePlacesEntries: async (limit) => {
        assert.equal(limit, 2);
        return [{ osm_id: 300 }, { osm_id: '100' }];
      },
      enrichOSMPOI: async (osmId, options) => {
        calls.push({ osmId, options });
      },
    };
    const manager = new MaintenanceTaskManager({ now: createClock() });

    const { task, alreadyRunning } = manager.startGooglePlacesEnrichment({
      db,
      limit: 2,
      user: { id: 7, email: 'admin@example.com' },
    });

    assert.equal(alreadyRunning, false);
    assert.match(task.taskId, /^google_places_enrichment-/);

    const completed = await waitForTaskStatus(manager, task.taskId, 'completed');
    assert.equal(completed.statusMessage, 'Google Places stale cache enrichment for 2 POIs completed successfully');
    assert.deepEqual(calls, [
      { osmId: '300', options: { taskId: task.taskId } },
      { osmId: '100', options: { taskId: task.taskId } },
    ]);

    const parsed = JSON.parse(manager.getTaskPayload(task.taskId).content[0].text);
    assert.equal(parsed.kind, 'google_places_enrichment');
    assert.deepEqual(parsed.stats, { total: 2, processed: 2, succeeded: 2, failed: 0 });
  });

  it('cancels a Google Places enrichment task before the next POI', async () => {
    let releaseCurrent;
    const calls = [];
    const db = {
      enrichOSMPOI: async (osmId) => {
        calls.push(osmId);
        await new Promise(resolve => { releaseCurrent = resolve; });
      },
    };
    const manager = new MaintenanceTaskManager({ now: createClock() });

    const { task } = manager.startGooglePlacesEnrichment({
      db,
      osmIds: [101, 202],
      user: { id: 7, email: 'admin@example.com' },
    });

    for (let i = 0; i < 20 && calls.length === 0; i += 1) {
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.deepEqual(calls, ['101']);

    const cancelled = manager.cancelTask(task.taskId);
    assert.equal(cancelled.status, 'cancelled');

    releaseCurrent();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['101']);
  });

  it('starts an AI place summary task and records db-visible task rows', async () => {
    const calls = [];
    const taskRows = [];
    const db = {
      getDueAiSummaryEntries: async (limit) => {
        assert.equal(limit, 2);
        return [{ osm_id: 101 }, { osm_id: 202 }];
      },
      summarizeEnrichedPOI: async (osmId, options) => {
        calls.push({ osmId, options });
        return osmId === '202' ? { skipped: true, reason: 'No reviews' } : { skipped: false };
      },
      recordEnrichmentTask: async (row) => {
        taskRows.push(row);
      },
    };
    const manager = new MaintenanceTaskManager({ now: createClock() });

    const { task } = manager.startAiPlaceSummary({
      db,
      limit: 2,
      force: true,
      user: { id: 7, email: 'admin@example.com' },
    });

    const completed = await waitForTaskStatus(manager, task.taskId, 'completed');
    assert.equal(completed.statusMessage, 'AI place summaries for 2 POIs completed successfully');
    assert.deepEqual(calls, [
      { osmId: '101', options: { force: true } },
      { osmId: '202', options: { force: true } },
    ]);

    const parsed = JSON.parse(manager.getTaskPayload(task.taskId).content[0].text);
    assert.equal(parsed.kind, 'ai_place_summary');
    assert.deepEqual(parsed.stats, { total: 2, processed: 2, succeeded: 1, failed: 0, skipped: 1 });
    assert.ok(taskRows.some(row => row.kind === 'ai_place_summary' && row.status === 'completed'));
  });

  it('starts a homepage harvest task and records harvest stats', async () => {
    const calls = [];
    const taskRows = [];
    const db = {
      getDueHomepageHarvestEntries: async (limit) => {
        assert.equal(limit, 2);
        return [{ osm_id: 101 }, { osm_id: 202 }, { osm_id: 303 }];
      },
      harvestPoiHomepage: async (osmId, options) => {
        calls.push({ osmId, options });
        if (osmId === '202') {
          return { skipped: true, reason: 'fresh until tomorrow' };
        }
        if (osmId === '303') {
          return {
            skipped: false,
            harvest: { fetch_status: 'empty' },
            contentChanged: false,
          };
        }
        return {
          skipped: false,
          harvest: { fetch_status: 'completed' },
          contentChanged: true,
        };
      },
      recordEnrichmentTask: async (row) => {
        taskRows.push(row);
      },
    };
    const manager = new MaintenanceTaskManager({ now: createClock() });

    const { task } = manager.startHomepageHarvest({
      db,
      limit: 2,
      force: true,
      user: { id: 7, email: 'admin@example.com' },
    });

    const completed = await waitForTaskStatus(manager, task.taskId, 'completed');
    assert.equal(completed.statusMessage, 'Homepage harvest for 3 POIs completed successfully');
    assert.deepEqual(calls, [
      { osmId: '101', options: { force: true } },
      { osmId: '202', options: { force: true } },
      { osmId: '303', options: { force: true } },
    ]);

    const parsed = JSON.parse(manager.getTaskPayload(task.taskId).content[0].text);
    assert.equal(parsed.kind, 'homepage_harvest');
    assert.deepEqual(parsed.stats, {
      total: 3,
      processed: 3,
      succeeded: 2,
      failed: 0,
      skipped: 1,
      empty: 1,
      changed: 1,
    });
    assert.ok(taskRows.some(row => row.kind === 'homepage_harvest' && row.status === 'completed'));
  });
});
