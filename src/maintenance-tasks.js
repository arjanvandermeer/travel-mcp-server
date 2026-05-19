import { spawn as spawnProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCountryCode } from './validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = dirname(__dirname);

const DEFAULT_TASK_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_OUTPUT_CHARS = 20000;
const RESULT_OUTPUT_CHARS = 5000;
const ACTIVE_STATUSES = new Set(['working', 'input_required']);

export function isAdminUser(user) {
  return String(user?.config?.role || '').toLowerCase() === 'admin';
}

function normalizeTtl(ttl) {
  if (ttl === null) return null;
  const parsed = Number(ttl);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TASK_TTL_MS;
  return Math.trunc(parsed);
}

function getLastNonEmptyLine(text) {
  const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.at(-1) || null;
}

function describeGeoNamesScope(countryCode) {
  return countryCode ? `GeoNames refresh for ${countryCode}` : 'GeoNames refresh';
}

export class MaintenanceTaskManager {
  constructor({
    command = process.execPath,
    cwd = PROJECT_ROOT,
    env = process.env,
    log = () => {},
    maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS,
    now = () => new Date(),
    spawn = spawnProcess,
  } = {}) {
    this.command = command;
    this.cwd = cwd;
    this.env = env;
    this.log = log;
    this.maxOutputChars = maxOutputChars;
    this.now = now;
    this.spawn = spawn;
    this.tasks = new Map();
  }

  startGeonamesRefresh({ countryCode, user, ttl } = {}) {
    this.pruneExpiredTasks();
    const normalizedCountryCode = countryCode ? validateCountryCode(countryCode) : null;
    if (countryCode && !normalizedCountryCode) {
      throw new Error('country_code must be a valid 2-letter ISO country code');
    }

    const existing = this.findActiveTask('geonames_refresh');
    if (existing) {
      return { task: this.toPublicTask(existing), alreadyRunning: true };
    }

    const task = this.createTask({
      kind: 'geonames_refresh',
      statusMessage: `${describeGeoNamesScope(normalizedCountryCode)} queued`,
      ttl,
    });
    const record = {
      kind: 'geonames_refresh',
      task,
      child: null,
      countryCode: normalizedCountryCode,
      output: '',
      result: null,
      requestedBy: user ? { id: user.id, email: user.email } : null,
    };

    this.tasks.set(task.taskId, record);
    this.runGeonamesRefresh(record);

    return { task: this.toPublicTask(record), alreadyRunning: false };
  }

  listTasks() {
    this.pruneExpiredTasks();
    return Array.from(this.tasks.values())
      .sort((a, b) => String(b.task.createdAt).localeCompare(String(a.task.createdAt)))
      .map(record => this.toPublicTask(record));
  }

  getTask(taskId) {
    this.pruneExpiredTasks();
    const record = this.tasks.get(taskId);
    return record ? this.toPublicTask(record) : null;
  }

  getTaskPayload(taskId) {
    this.pruneExpiredTasks();
    const record = this.tasks.get(taskId);
    if (!record) return null;
    return record.result;
  }

  cancelTask(taskId) {
    this.pruneExpiredTasks();
    const record = this.tasks.get(taskId);
    if (!record) return null;

    if (!ACTIVE_STATUSES.has(record.task.status)) {
      return this.toPublicTask(record);
    }

    if (record.child?.kill) {
      record.child.kill('SIGTERM');
    }
    this.finishTask(record, 'cancelled', `${describeGeoNamesScope(record.countryCode)} cancelled by admin`, {
      signal: 'SIGTERM',
    });

    return this.toPublicTask(record);
  }

  createTask({ kind, statusMessage, ttl }) {
    const timestamp = this.now().toISOString();
    return {
      taskId: `${kind}-${Date.now()}-${randomUUID().slice(0, 8)}`,
      status: 'working',
      statusMessage,
      createdAt: timestamp,
      lastUpdatedAt: timestamp,
      ttl: normalizeTtl(ttl),
      pollInterval: DEFAULT_POLL_INTERVAL_MS,
    };
  }

  runGeonamesRefresh(record) {
    const scriptPath = join(this.cwd, 'scripts', 'refresh-imports.js');
    const args = [scriptPath, '--skip-osm', '--refresh-geonames'];
    if (record.countryCode) {
      args.push(`--geonames-country=${record.countryCode}`);
    }

    this.updateTask(record, 'working', `${describeGeoNamesScope(record.countryCode)} started`);

    let child;
    try {
      child = this.spawn(this.command, args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.finishTask(record, 'failed', `GeoNames refresh failed to start: ${error.message}`, { error });
      return;
    }

    record.child = child;

    child.stdout?.on?.('data', chunk => this.appendOutput(record, chunk));
    child.stderr?.on?.('data', chunk => this.appendOutput(record, chunk));
    child.on?.('error', error => {
      if (!ACTIVE_STATUSES.has(record.task.status)) return;
      this.finishTask(record, 'failed', `GeoNames refresh failed: ${error.message}`, { error });
    });
    child.on?.('close', (code, signal) => {
      if (!ACTIVE_STATUSES.has(record.task.status)) return;

      if (code === 0) {
        this.finishTask(record, 'completed', `${describeGeoNamesScope(record.countryCode)} completed successfully`, { code, signal });
      } else {
        const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
        this.finishTask(record, 'failed', `${describeGeoNamesScope(record.countryCode)} failed with ${suffix}`, { code, signal });
      }
    });
  }

  appendOutput(record, chunk) {
    const text = String(chunk);
    record.output = `${record.output}${text}`.slice(-this.maxOutputChars);

    const latestLine = getLastNonEmptyLine(text);
    if (latestLine) {
      this.updateTask(record, 'working', latestLine);
    }
  }

  finishTask(record, status, statusMessage, { code = null, signal = null, error = null } = {}) {
    this.updateTask(record, status, statusMessage);
    record.child = null;
    record.result = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          taskId: record.task.taskId,
          kind: record.kind,
          countryCode: record.countryCode,
          status,
          statusMessage,
          success: status === 'completed',
          exitCode: code,
          signal,
          requestedBy: record.requestedBy,
          error: error?.message,
          outputTail: record.output.slice(-RESULT_OUTPUT_CHARS),
        }, null, 2),
      }],
    };

    if (status === 'failed' || status === 'cancelled') {
      record.result.isError = true;
    }

    this.log(status === 'completed' ? 'INFO' : 'WARN', statusMessage, {
      taskId: record.task.taskId,
      code,
      signal,
    });
  }

  updateTask(record, status, statusMessage) {
    record.task.status = status;
    record.task.statusMessage = statusMessage;
    record.task.lastUpdatedAt = this.now().toISOString();
  }

  findActiveTask(kind) {
    return Array.from(this.tasks.values()).find(record => (
      record.kind === kind && ACTIVE_STATUSES.has(record.task.status)
    ));
  }

  pruneExpiredTasks() {
    const now = this.now().getTime();
    for (const [taskId, record] of this.tasks) {
      if (ACTIVE_STATUSES.has(record.task.status) || record.task.ttl === null) continue;

      const createdAt = new Date(record.task.createdAt).getTime();
      if (Number.isFinite(createdAt) && now - createdAt > record.task.ttl) {
        this.tasks.delete(taskId);
      }
    }
  }

  toPublicTask(record) {
    return { ...record.task };
  }
}

export const defaultMaintenanceTaskManager = new MaintenanceTaskManager();
