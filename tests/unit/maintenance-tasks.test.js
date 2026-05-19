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
});
