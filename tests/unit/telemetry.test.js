/**
 * Unit Tests for Telemetry Module
 *
 * Tests all exported functions. Since telemetryEnabled defaults to false,
 * most functions exercise their guard clause (disabled) paths.
 * Also tests initTelemetry disabled paths and timeAsync (works regardless).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as telemetry from '../../src/telemetry.js';

describe('telemetry', () => {
  // Suppress console.error during tests
  let originalError;
  beforeEach(() => {
    originalError = console.error;
    console.error = () => {};
  });
  afterEach(() => {
    console.error = originalError;
  });

  describe('isEnabled', () => {
    it('should return false by default', () => {
      assert.strictEqual(telemetry.isEnabled(), false);
    });
  });

  describe('getConfig', () => {
    it('should return config object with expected keys', () => {
      const config = telemetry.getConfig();
      assert.strictEqual(typeof config.enabled, 'boolean');
      assert.strictEqual(typeof config.sentryInitialized, 'boolean');
      assert.strictEqual(config.serviceName, 'travel-mcp-server');
      assert.strictEqual(config.serviceVersion, '1.0.0');
      assert.ok('sentryDsn' in config);
      assert.ok('environment' in config);
      assert.ok('sampleRate' in config);
    });
  });

  describe('initTelemetry', () => {
    it('should return false when no DSN configured', async () => {
      // Save current env
      const origDsn = process.env.SENTRY_DSN;
      delete process.env.SENTRY_DSN;

      const result = await telemetry.initTelemetry();
      assert.strictEqual(result, false);

      // Restore
      if (origDsn) process.env.SENTRY_DSN = origDsn;
    });

    it('should return false when explicitly disabled', async () => {
      const origEnabled = process.env.TELEMETRY_ENABLED;
      process.env.TELEMETRY_ENABLED = 'false';

      const result = await telemetry.initTelemetry();
      assert.strictEqual(result, false);

      // Restore
      if (origEnabled) {
        process.env.TELEMETRY_ENABLED = origEnabled;
      } else {
        delete process.env.TELEMETRY_ENABLED;
      }
    });

    it('should accept dbConfig override', async () => {
      const result = await telemetry.initTelemetry({ enabled: false });
      assert.strictEqual(result, false);
    });
  });

  describe('captureException (disabled)', () => {
    it('should return early when telemetry disabled', () => {
      // Should not throw
      telemetry.captureException(new Error('test'));
    });

    it('should accept context parameter', () => {
      telemetry.captureException(new Error('test'), { foo: 'bar' });
    });
  });

  describe('captureMessage (disabled)', () => {
    it('should return early when telemetry disabled', () => {
      telemetry.captureMessage('test message');
    });

    it('should accept level and context', () => {
      telemetry.captureMessage('test', 'warning', { key: 'value' });
    });
  });

  describe('captureLog (disabled)', () => {
    it('should return early when telemetry disabled', () => {
      telemetry.captureLog('test log');
    });

    it('should accept level, attributes, and options', () => {
      telemetry.captureLog('test', 'warn', { key: 'value' }, { breadcrumbCategory: 'test' });
    });
  });

  describe('captureMetricEvent (disabled)', () => {
    it('should return early when telemetry disabled', () => {
      telemetry.captureMetricEvent('test.metric');
    });

    it('should accept value, tags, and extra context', () => {
      telemetry.captureMetricEvent('test.metric', 2, { endpoint: 'test' }, { sample: true });
    });
  });

  describe('startTransaction (disabled)', () => {
    it('should return no-op transaction object', () => {
      const txn = telemetry.startTransaction('test-txn', 'test');

      assert.strictEqual(typeof txn.finish, 'function');
      assert.strictEqual(typeof txn.startChild, 'function');
      assert.strictEqual(typeof txn.setData, 'function');
      assert.strictEqual(typeof txn.setTag, 'function');
      assert.strictEqual(typeof txn.setStatus, 'function');
    });

    it('no-op methods should not throw', () => {
      const txn = telemetry.startTransaction('test-txn');

      txn.finish();
      txn.setData('key', 'value');
      txn.setTag('tag', 'value');
      txn.setStatus('ok');

      const child = txn.startChild('child-op', 'description');
      assert.strictEqual(typeof child.finish, 'function');
      child.finish();
    });
  });

  describe('withTransaction (disabled)', () => {
    it('should call fn directly when disabled', async () => {
      let called = false;
      const result = await telemetry.withTransaction('test', 'op', async () => {
        called = true;
        return 42;
      });

      assert.strictEqual(called, true);
      assert.strictEqual(result, 42);
    });

    it('should propagate errors from fn', async () => {
      await assert.rejects(
        () => telemetry.withTransaction('test', 'op', async () => {
          throw new Error('test error');
        }),
        /test error/,
      );
    });
  });

  describe('withSpan (disabled)', () => {
    it('should call fn directly when disabled', async () => {
      let called = false;
      const result = await telemetry.withSpan('test-span', 'test.op', { provider: 'test' }, async (span) => {
        called = true;
        span.setAttribute('status', 'ok');
        return 42;
      });

      assert.strictEqual(called, true);
      assert.strictEqual(result, 42);
    });

    it('should propagate errors from fn', async () => {
      await assert.rejects(
        () => telemetry.withSpan('test-span', 'test.op', {}, async () => {
          throw new Error('span error');
        }),
        /span error/,
      );
    });
  });

  describe('setSpanAttributes', () => {
    it('should set only non-null attributes', () => {
      const attributes = {};
      telemetry.setSpanAttributes({
        setAttribute: (key, value) => {
          attributes[key] = value;
        },
      }, {
        ok: 'yes',
        zero: 0,
        missing: null,
        absent: undefined,
      });

      assert.deepStrictEqual(attributes, { ok: 'yes', zero: 0 });
    });
  });

  describe('addBreadcrumb (disabled)', () => {
    it('should return early when disabled', () => {
      telemetry.addBreadcrumb('test breadcrumb');
    });

    it('should accept category and data', () => {
      telemetry.addBreadcrumb('test', 'custom', { key: 'value' });
    });

    it('should accept a breadcrumb level', () => {
      telemetry.addBreadcrumb('test', 'custom', { key: 'value' }, 'warning');
    });
  });

  describe('setUser (disabled)', () => {
    it('should return early when disabled', () => {
      telemetry.setUser({ id: '123', email: 'test@example.com' });
    });
  });

  describe('setTag (disabled)', () => {
    it('should return early when disabled', () => {
      telemetry.setTag('env', 'test');
    });
  });

  describe('flush (disabled)', () => {
    it('should return early when disabled', async () => {
      await telemetry.flush();
    });

    it('should accept timeout parameter', async () => {
      await telemetry.flush(1000);
    });
  });

  describe('incrementCounter (disabled)', () => {
    it('should return early when disabled', () => {
      telemetry.incrementCounter('test.counter');
    });

    it('should accept value and tags', () => {
      telemetry.incrementCounter('test.counter', 5, { env: 'test' });
    });
  });

  describe('recordDistribution (disabled)', () => {
    it('should return early when disabled', () => {
      telemetry.recordDistribution('test.dist', 100);
    });

    it('should accept options', () => {
      telemetry.recordDistribution('test.dist', 100, { tags: { op: 'search' }, unit: 'millisecond' });
    });
  });

  describe('recordGauge (disabled)', () => {
    it('should return early when disabled', () => {
      telemetry.recordGauge('test.gauge', 42);
    });

    it('should accept tags', () => {
      telemetry.recordGauge('test.gauge', 42, { env: 'test' });
    });
  });

  describe('recordSet (disabled)', () => {
    it('should return early when disabled', () => {
      telemetry.recordSet('test.set', 'user-123');
    });

    it('should accept tags', () => {
      telemetry.recordSet('test.set', 'user-123', { env: 'test' });
    });
  });

  describe('timeAsync', () => {
    it('should execute function and return result', async () => {
      const result = await telemetry.timeAsync('test.timing', async () => {
        return 'hello';
      });
      assert.strictEqual(result, 'hello');
    });

    it('should propagate errors', async () => {
      await assert.rejects(
        () => telemetry.timeAsync('test.timing', async () => {
          throw new Error('async error');
        }),
        /async error/,
      );
    });

    it('should call onSuccess callback', async () => {
      let successCalled = false;
      let successDuration;
      await telemetry.timeAsync('test.timing', async () => 'ok', {
        onSuccess: (_result, duration) => {
          successCalled = true;
          successDuration = duration;
        },
      });
      assert.strictEqual(successCalled, true);
      assert.strictEqual(typeof successDuration, 'number');
    });

    it('should call onError callback on failure', async () => {
      let errorCalled = false;
      let errorDuration;
      await assert.rejects(
        () => telemetry.timeAsync('test.timing', async () => {
          throw new Error('fail');
        }, {
          tags: { op: 'test' },
          onError: (_err, duration) => {
            errorCalled = true;
            errorDuration = duration;
          },
        }),
        /fail/,
      );
      assert.strictEqual(errorCalled, true);
      assert.strictEqual(typeof errorDuration, 'number');
    });
  });

  describe('Sentry export', () => {
    it('should export Sentry object', () => {
      assert.ok(telemetry.Sentry);
      assert.strictEqual(typeof telemetry.Sentry.init, 'function');
    });
  });
});
