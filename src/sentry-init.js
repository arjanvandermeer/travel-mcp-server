/**
 * Early Sentry Initialization
 *
 * IMPORTANT: This file must be imported FIRST, before any other modules,
 * to enable automatic instrumentation of pg (postgres), http, and other modules.
 *
 * This uses environment variables for initial config. The full telemetry module
 * can override with database config later, but the SDK must be initialized early
 * for auto-instrumentation to work.
 */

import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import { versionInfo, getVersionString } from './version.js';

// Load environment variables
dotenv.config();

const dsn = process.env.SENTRY_DSN || null;
const environment = process.env.TELEMETRY_ENVIRONMENT || process.env.NODE_ENV || 'development';
// Release format: travel-mcp-server@1.0.0-abc1234 (includes git commit)
const release = `travel-mcp-server@${getVersionString()}`;
const sampleRate = parseFloat(process.env.TELEMETRY_SAMPLE_RATE || '1.0');
const enabled = process.env.TELEMETRY_ENABLED !== 'false';
const sendDev = process.env.SENTRY_SEND_DEV === 'true';

// Initialize Sentry early if DSN is configured
if (dsn && enabled) {
  Sentry.init({
    dsn,
    release,
    environment,
    tracesSampleRate: sampleRate,
    profilesSampleRate: sampleRate * 0.1,
    // Enable Sentry logs for debugging
    _experiments: {
      enableLogs: true,
    },
    integrations: [
      // Auto-instrument postgres queries
      Sentry.postgresIntegration(),
      // Auto-instrument HTTP requests
      Sentry.httpIntegration(),
    ],
    beforeSend(event) {
      if (environment === 'development' && !sendDev) {
        return null;
      }
      return event;
    },
    beforeSendTransaction(transaction) {
      if (environment === 'development' && !sendDev) {
        return null;
      }
      return transaction;
    },
  });

  console.error(`[Sentry] Early init complete (release: ${release}, env: ${environment}, sample: ${sampleRate}, sendDev: ${sendDev})`);
} else {
  console.error('[Sentry] Skipping early init (no DSN or disabled)');
}

export { Sentry };
