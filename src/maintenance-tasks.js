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
const DEFAULT_GOOGLE_ENRICHMENT_LIMIT = 100;
const MAX_GOOGLE_ENRICHMENT_LIMIT = 500;
const DEFAULT_AI_SUMMARY_LIMIT = 25;
const MAX_AI_SUMMARY_LIMIT = 100;
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

function normalizePositiveInteger(value, defaultValue, maxValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, maxValue);
}

function normalizeOsmIds(osmIds) {
  if (osmIds === undefined || osmIds === null || osmIds === '') return [];
  const values = Array.isArray(osmIds) ? osmIds : [osmIds];
  const normalized = [];
  const seen = new Set();

  for (const value of values) {
    const osmId = String(value).trim();
    if (!/^[1-9]\d*$/.test(osmId)) {
      throw new Error('osm_ids must contain only positive OSM numeric ids');
    }
    if (!seen.has(osmId)) {
      seen.add(osmId);
      normalized.push(osmId);
    }
  }

  return normalized;
}

function describeGoogleEnrichmentScope(record) {
  const total = record.stats?.total || record.osmIds?.length || 0;
  if (record.requestedOsmIds?.length > 0) {
    return total === 1 ? `Google Places enrichment for OSM ${record.requestedOsmIds[0]}` : `Google Places enrichment for ${total} requested POIs`;
  }
  return `Google Places stale cache enrichment${total ? ` for ${total} POIs` : ''}`;
}

function describeAiSummaryScope(record) {
  const total = record.stats?.total || record.osmIds?.length || 0;
  if (record.requestedOsmIds?.length > 0) {
    return total === 1 ? `AI place summary for OSM ${record.requestedOsmIds[0]}` : `AI place summaries for ${total} requested POIs`;
  }
  return `AI place summaries${total ? ` for ${total} POIs` : ''}`;
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

  startGooglePlacesEnrichment({ db, osmIds, limit, user, ttl } = {}) {
    this.pruneExpiredTasks();
    if (!db || typeof db.enrichOSMPOI !== 'function') {
      throw new Error('Google Places enrichment requires a database with enrichOSMPOI');
    }

    const requestedOsmIds = normalizeOsmIds(osmIds);
    const normalizedLimit = normalizePositiveInteger(
      limit,
      DEFAULT_GOOGLE_ENRICHMENT_LIMIT,
      MAX_GOOGLE_ENRICHMENT_LIMIT,
    );
    if (requestedOsmIds.length === 0 && typeof db.getStaleGooglePlacesEntries !== 'function') {
      throw new Error('Google Places stale enrichment requires getStaleGooglePlacesEntries');
    }

    const existing = this.findActiveTask('google_places_enrichment');
    if (existing) {
      return { task: this.toPublicTask(existing), alreadyRunning: true };
    }

    const task = this.createTask({
      kind: 'google_places_enrichment',
      statusMessage: requestedOsmIds.length > 0
        ? `Google Places enrichment queued for ${requestedOsmIds.length} requested POIs`
        : `Google Places stale cache enrichment queued (limit ${normalizedLimit})`,
      ttl,
    });
    const record = {
      kind: 'google_places_enrichment',
      task,
      db,
      requestedOsmIds,
      osmIds: [...requestedOsmIds],
      limit: normalizedLimit,
      output: '',
      result: null,
      cancelRequested: false,
      currentOsmId: null,
      stats: {
        total: requestedOsmIds.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
      },
      requestedBy: user ? { id: user.id, email: user.email } : null,
      cancel: () => {
        record.cancelRequested = true;
      },
    };

    this.tasks.set(task.taskId, record);
    this.runGooglePlacesEnrichment(record).catch(error => {
      if (!ACTIVE_STATUSES.has(record.task.status)) return;
      this.finishTask(record, 'failed', `Google Places enrichment failed: ${error.message}`, { error });
    });

    return { task: this.toPublicTask(record), alreadyRunning: false };
  }

  startAiPlaceSummary({ db, osmIds, limit, force = false, user, ttl } = {}) {
    this.pruneExpiredTasks();
    if (!db || typeof db.summarizeEnrichedPOI !== 'function') {
      throw new Error('AI place summary requires a database with summarizeEnrichedPOI');
    }

    const requestedOsmIds = normalizeOsmIds(osmIds);
    const normalizedLimit = normalizePositiveInteger(limit, DEFAULT_AI_SUMMARY_LIMIT, MAX_AI_SUMMARY_LIMIT);
    if (requestedOsmIds.length === 0 && typeof db.getDueAiSummaryEntries !== 'function') {
      throw new Error('AI place summary requires getDueAiSummaryEntries when osm_ids are omitted');
    }

    const existing = this.findActiveTask('ai_place_summary');
    if (existing) {
      return { task: this.toPublicTask(existing), alreadyRunning: true };
    }

    const task = this.createTask({
      kind: 'ai_place_summary',
      statusMessage: requestedOsmIds.length > 0
        ? `AI place summaries queued for ${requestedOsmIds.length} requested POIs`
        : `AI place summaries queued (limit ${normalizedLimit})`,
      ttl,
    });
    const record = {
      kind: 'ai_place_summary',
      task,
      db,
      requestedOsmIds,
      osmIds: [...requestedOsmIds],
      limit: normalizedLimit,
      force: force === true,
      output: '',
      result: null,
      cancelRequested: false,
      currentOsmId: null,
      stats: {
        total: requestedOsmIds.length,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      },
      requestedBy: user ? { id: user.id, email: user.email } : null,
      cancel: () => {
        record.cancelRequested = true;
      },
    };

    this.tasks.set(task.taskId, record);
    this.runAiPlaceSummary(record).catch(error => {
      if (!ACTIVE_STATUSES.has(record.task.status)) return;
      this.finishTask(record, 'failed', `AI place summaries failed: ${error.message}`, { error });
    });

    return { task: this.toPublicTask(record), alreadyRunning: false };
  }

  listTasks({ kind } = {}) {
    this.pruneExpiredTasks();
    return Array.from(this.tasks.values())
      .filter(record => !kind || record.kind === kind)
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

  getTaskKind(taskId) {
    this.pruneExpiredTasks();
    return this.tasks.get(taskId)?.kind || null;
  }

  cancelTask(taskId) {
    this.pruneExpiredTasks();
    const record = this.tasks.get(taskId);
    if (!record) return null;

    if (!ACTIVE_STATUSES.has(record.task.status)) {
      return this.toPublicTask(record);
    }

    if (typeof record.cancel === 'function') {
      record.cancel();
    }
    let signal = null;
    if (record.child?.kill) {
      signal = 'SIGTERM';
      record.child.kill(signal);
    }
    let message = `${describeGeoNamesScope(record.countryCode)} cancelled by admin`;
    if (record.kind === 'google_places_enrichment') {
      message = `${describeGoogleEnrichmentScope(record)} cancelled by admin. Current in-flight Google request may still finish.`;
    } else if (record.kind === 'ai_place_summary') {
      message = `${describeAiSummaryScope(record)} cancelled by admin. Current OpenRouter request may still finish.`;
    }
    this.finishTask(record, 'cancelled', message, {
      signal,
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

  async runGooglePlacesEnrichment(record) {
    this.updateTask(record, 'working', 'Google Places enrichment started');

    if (record.osmIds.length === 0) {
      this.updateTask(record, 'working', `Finding stale Google Places entries (limit ${record.limit})`);
      const staleEntries = await record.db.getStaleGooglePlacesEntries(record.limit);
      record.osmIds = normalizeOsmIds(staleEntries.map(entry => entry.osm_id));
      record.stats.total = record.osmIds.length;
    }

    if (record.osmIds.length === 0) {
      this.finishTask(record, 'completed', 'No due Google Places enrichment entries found');
      return;
    }

    for (const [index, osmId] of record.osmIds.entries()) {
      if (record.cancelRequested || !ACTIVE_STATUSES.has(record.task.status)) {
        if (ACTIVE_STATUSES.has(record.task.status)) {
          this.finishTask(record, 'cancelled', `${describeGoogleEnrichmentScope(record)} cancelled by admin`);
        }
        return;
      }

      record.currentOsmId = osmId;
      this.updateTask(record, 'working', `Enriching OSM ${osmId} (${index + 1}/${record.osmIds.length})`);

      try {
        await record.db.enrichOSMPOI(osmId, { taskId: record.task.taskId });
        record.stats.succeeded += 1;
      } catch (error) {
        record.stats.failed += 1;
        this.appendOutput(record, `OSM ${osmId}: ${error.message}\n`);
      } finally {
        record.stats.processed += 1;
      }
    }

    const status = record.stats.failed > 0 ? 'failed' : 'completed';
    const message = record.stats.failed > 0
      ? `${describeGoogleEnrichmentScope(record)} completed with ${record.stats.failed} errors`
      : `${describeGoogleEnrichmentScope(record)} completed successfully`;
    this.finishTask(record, status, message);
  }

  async runAiPlaceSummary(record) {
    this.updateTask(record, 'working', 'AI place summaries started');

    if (typeof record.db.recordEnrichmentTask === 'function') {
      await record.db.recordEnrichmentTask(this.toTaskRow(record)).catch(() => {});
    }

    if (record.osmIds.length === 0) {
      this.updateTask(record, 'working', `Finding due AI summary entries (limit ${record.limit})`);
      const entries = await record.db.getDueAiSummaryEntries(record.limit);
      record.osmIds = normalizeOsmIds(entries.map(entry => entry.osm_id));
      record.stats.total = record.osmIds.length;
    }

    if (record.osmIds.length === 0) {
      this.finishTask(record, 'completed', 'No due AI summary entries found');
      return;
    }

    for (const [index, osmId] of record.osmIds.entries()) {
      if (record.cancelRequested || !ACTIVE_STATUSES.has(record.task.status)) {
        if (ACTIVE_STATUSES.has(record.task.status)) {
          this.finishTask(record, 'cancelled', `${describeAiSummaryScope(record)} cancelled by admin`);
        }
        return;
      }

      record.currentOsmId = osmId;
      this.updateTask(record, 'working', `Summarizing OSM ${osmId} (${index + 1}/${record.osmIds.length})`);
      if (typeof record.db.recordEnrichmentTask === 'function') {
        await record.db.recordEnrichmentTask(this.toTaskRow(record)).catch(() => {});
      }

      try {
        const result = await record.db.summarizeEnrichedPOI(osmId, { force: record.force });
        if (result?.skipped) {
          record.stats.skipped += 1;
          this.appendOutput(record, `OSM ${osmId}: skipped - ${result.reason}\n`);
        } else {
          record.stats.succeeded += 1;
        }
      } catch (error) {
        record.stats.failed += 1;
        this.appendOutput(record, `OSM ${osmId}: ${error.message}\n`);
      } finally {
        record.stats.processed += 1;
      }
    }

    const status = record.stats.failed > 0 ? 'failed' : 'completed';
    const message = record.stats.failed > 0
      ? `${describeAiSummaryScope(record)} completed with ${record.stats.failed} errors`
      : `${describeAiSummaryScope(record)} completed successfully`;
    this.finishTask(record, status, message);
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
    const payload = {
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
    };

    if (record.kind === 'google_places_enrichment') {
      Object.assign(payload, {
        limit: record.limit,
        osmIdCount: record.osmIds.length,
        osmIds: record.osmIds.slice(0, 100),
        currentOsmId: record.currentOsmId,
        cancelRequested: record.cancelRequested,
        stats: { ...record.stats },
      });
    }
    if (record.kind === 'ai_place_summary') {
      Object.assign(payload, {
        limit: record.limit,
        force: record.force,
        osmIdCount: record.osmIds.length,
        osmIds: record.osmIds.slice(0, 100),
        currentOsmId: record.currentOsmId,
        cancelRequested: record.cancelRequested,
        stats: { ...record.stats },
      });
    }

    record.result = {
      content: [{
        type: 'text',
        text: JSON.stringify(payload, null, 2),
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

    if (typeof record.db?.recordEnrichmentTask === 'function') {
      record.db.recordEnrichmentTask(this.toTaskRow(record, payload)).catch(() => {});
    }
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

  toTaskRow(record, result = null) {
    return {
      taskId: record.task.taskId,
      kind: record.kind,
      status: record.task.status,
      statusMessage: record.task.statusMessage,
      currentItem: record.currentOsmId || null,
      processed: record.stats?.processed || 0,
      succeeded: record.stats?.succeeded || 0,
      failed: record.stats?.failed || 0,
      total: record.stats?.total || record.osmIds?.length || 0,
      requestedBy: record.requestedBy,
      payload: {
        osmIds: record.osmIds,
        requestedOsmIds: record.requestedOsmIds,
        limit: record.limit,
        force: record.force,
      },
      result,
    };
  }
}

export const defaultMaintenanceTaskManager = new MaintenanceTaskManager();
