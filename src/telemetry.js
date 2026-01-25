/**
 * Sentry Telemetry Module
 *
 * Provides error tracking and performance monitoring via Sentry SDK.
 *
 * Configuration (via .env or database config table):
 * - SENTRY_DSN: Sentry DSN for error and performance monitoring
 * - TELEMETRY_ENABLED: Set to 'false' to disable (default: true if DSN present)
 * - TELEMETRY_SAMPLE_RATE: Trace sample rate 0.0-1.0 (default: 1.0)
 * - TELEMETRY_ENVIRONMENT: Environment name (default: 'development')
 * - SENTRY_SEND_DEV: Set to 'true' to send events in development mode
 */

import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';

dotenv.config();

// Telemetry state
let telemetryEnabled = false;
let sentryInitialized = false;

/**
 * Configuration from environment variables (can be overridden by database config)
 */
function getEnvConfig() {
  return {
    sentryDsn: process.env.SENTRY_DSN || null,
    enabled: process.env.TELEMETRY_ENABLED !== 'false',
    sampleRate: parseFloat(process.env.TELEMETRY_SAMPLE_RATE || '1.0'),
    environment: process.env.TELEMETRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
    sendDev: process.env.SENTRY_SEND_DEV === 'true',
    serviceName: 'travel-mcp-server',
    serviceVersion: '1.0.0',
  };
}

/**
 * Initialize Sentry SDK for error tracking and performance monitoring
 */
function initSentry(config) {
  if (!config.sentryDsn || sentryInitialized) {
    return false;
  }

  try {
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.environment,
      tracesSampleRate: config.sampleRate,
      profilesSampleRate: config.sampleRate * 0.1, // Profile 10% of traces
      integrations: [
        // Auto-instrument common modules
        Sentry.postgresIntegration(),
        Sentry.httpIntegration(),
      ],
      beforeSend(event) {
        // Don't send events in development unless explicitly enabled
        if (config.environment === 'development' && !config.sendDev) {
          console.error('[Telemetry] Sentry event (not sent in dev):', event.message || event.exception?.values?.[0]?.value);
          return null;
        }
        return event;
      },
    });

    sentryInitialized = true;
    console.error('[Telemetry] Sentry initialized successfully');
    return true;
  } catch (error) {
    console.error('[Telemetry] Failed to initialize Sentry:', error.message);
    return false;
  }
}

/**
 * Initialize telemetry with optional database config override
 * @param {Object} dbConfig - Optional config from database
 */
export async function initTelemetry(dbConfig = null) {
  // Merge env config with optional database config
  const envConfig = getEnvConfig();
  const config = {
    ...envConfig,
    ...(dbConfig || {}),
  };

  // Check if explicitly disabled
  if (!config.enabled) {
    console.error('[Telemetry] Telemetry is disabled via configuration');
    telemetryEnabled = false;
    return false;
  }

  // Check if DSN is configured
  if (!config.sentryDsn) {
    console.error('[Telemetry] No SENTRY_DSN configured - telemetry disabled');
    telemetryEnabled = false;
    return false;
  }

  // Initialize Sentry (handles errors + performance)
  const sentryOk = initSentry(config);
  telemetryEnabled = sentryOk;

  if (telemetryEnabled) {
    console.error(`[Telemetry] Enabled (env: ${config.environment}, sample: ${config.sampleRate})`);
  }

  return telemetryEnabled;
}

/**
 * Check if telemetry is enabled
 */
export function isEnabled() {
  return telemetryEnabled;
}

/**
 * Capture an exception
 */
export function captureException(error, context = {}) {
  if (!telemetryEnabled) return;

  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message
 */
export function captureMessage(message, level = 'info', context = {}) {
  if (!telemetryEnabled) return;

  Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Start a transaction/span for performance monitoring
 * @param {string} name - Transaction name (e.g., 'mcp.tool.search_hotels')
 * @param {string} op - Operation type (e.g., 'mcp.request', 'db.query')
 * @returns {Object} Transaction object with finish() method
 */
export function startTransaction(name, op = 'function') {
  if (!telemetryEnabled) {
    // Return a no-op transaction
    return {
      finish: () => {},
      startChild: () => ({ finish: () => {} }),
      setData: () => {},
      setTag: () => {},
      setStatus: () => {},
    };
  }

  return Sentry.startSpan({ name, op }, (span) => {
    return {
      span,
      finish: () => span?.end(),
      startChild: (childOp, description) => {
        const childSpan = Sentry.startInactiveSpan({
          name: description || childOp,
          op: childOp,
        });
        return {
          finish: () => childSpan?.end(),
          setData: (key, value) => childSpan?.setAttribute(key, value),
        };
      },
      setData: (key, value) => span?.setAttribute(key, value),
      setTag: (key, value) => span?.setAttribute(key, value),
      setStatus: (status) => span?.setStatus({ code: status === 'ok' ? 1 : 2 }),
    };
  });
}

/**
 * Wrap an async function with automatic tracing
 * @param {string} name - Transaction name
 * @param {string} op - Operation type
 * @param {Function} fn - Async function to wrap
 */
export async function withTransaction(name, op, fn) {
  if (!telemetryEnabled) {
    return fn();
  }

  return Sentry.startSpan({ name, op }, async (span) => {
    try {
      const result = await fn();
      span?.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span?.setStatus({ code: 2, message: error.message }); // ERROR
      Sentry.captureException(error);
      throw error;
    }
  });
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(message, category = 'custom', data = {}) {
  if (!telemetryEnabled) return;

  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: 'info',
  });
}

/**
 * Set user context
 */
export function setUser(user) {
  if (!telemetryEnabled) return;

  Sentry.setUser(user);
}

/**
 * Set custom tags for filtering
 */
export function setTag(key, value) {
  if (!telemetryEnabled) return;

  Sentry.setTag(key, value);
}

/**
 * Flush pending events (call before process exit)
 */
export async function flush(timeout = 2000) {
  if (!telemetryEnabled) return;

  try {
    await Sentry.flush(timeout);
  } catch (error) {
    console.error('[Telemetry] Error during flush:', error.message);
  }
}

/**
 * Get current telemetry config (for debugging)
 */
export function getConfig() {
  return {
    enabled: telemetryEnabled,
    sentryInitialized,
    ...getEnvConfig(),
  };
}

// Export Sentry for advanced usage
export { Sentry };

export default {
  initTelemetry,
  isEnabled,
  captureException,
  captureMessage,
  startTransaction,
  withTransaction,
  addBreadcrumb,
  setUser,
  setTag,
  flush,
  getConfig,
  Sentry,
};
