#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_EXCLUDED_PATHS = [
  /^node_modules\//,
  /^coverage\//,
  /^data\/.*\.(db|gz|pbf|txt|zip)$/i,
  /^package-lock\.json$/,
  /\.md$/i,
  /\.(png|jpg|jpeg|gif|ico|pdf|zip|gz|pbf|db)$/i,
];

const SECRET_NAME = String.raw`(?:api[_-]?key|apiKey|auth[_-]?token|authToken|client[_-]?secret|clientSecret|connection[_-]?string|connectionString|database[_-]?url|databaseUrl|passwd|password|private[_-]?key|privateKey|secret|token)`;
const ENV_SECRET_KEY = String.raw`[A-Z0-9_]*(?:API_KEY|AUTH_TOKEN|CLIENT_SECRET|CONNECTION_STRING|DATABASE_URL|PASSWD|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)[A-Z0-9_]*`;
const SECRET_KEY = String.raw`(?:${ENV_SECRET_KEY}|${SECRET_NAME})`;
const PRIVATE_KEY_HEADER = ['-----BEGIN', '(?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----'].join(' ');

const DETECTORS = [
  {
    name: 'AWS access key id',
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: 'AWS secret access key',
    pattern: /\b(?:aws_)?secret_access_key\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    valueGroup: 1,
  },
  {
    name: 'Google API key',
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    name: 'GitHub token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,255}/g,
  },
  {
    name: 'Slack token',
    pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    name: 'Bearer token',
    pattern: /\bbearer\s+([A-Za-z0-9._~+/=-]{20,})/gi,
    valueGroup: 1,
  },
  {
    name: 'Private key header',
    pattern: new RegExp(PRIVATE_KEY_HEADER, 'gi'),
  },
  {
    name: 'Credentialed URL',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|ftp|https?):\/\/[^:\s/@]+:([^@\s/]+)@/gi,
    valueGroup: 1,
  },
  {
    name: 'Environment fallback secret',
    pattern: new RegExp(String.raw`(?:^|[{\s,])${SECRET_KEY}\s*[:=]\s*\$\{[A-Z0-9_]+:?-([^}]+)\}`, 'gm'),
    valueGroup: 1,
  },
  {
    name: 'Quoted secret assignment',
    pattern: new RegExp(String.raw`(?:^|[{\s,])${SECRET_KEY}\s*[:=]\s*(['"\x60])([^'"\x60]{8,})\1`, 'gm'),
    valueGroup: 2,
  },
  {
    name: 'Plain secret assignment',
    pattern: new RegExp(String.raw`^\s*${SECRET_KEY}\s*:\s*([^\s#\x24{][^\s#]*)`, 'gm'),
    valueGroup: 1,
  },
];

function isExcluded(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return DEFAULT_EXCLUDED_PATHS.some(pattern => pattern.test(normalized));
}

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
  return output.split('\0').filter(Boolean).filter(file => !isExcluded(file));
}

function isLikelyBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0);
}

export function isAllowedSecretValue(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[),;]+$/g, '');
  if (!normalized) return true;
  if (/^<[^>]+>$/.test(normalized)) return true;
  if (/^\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}$/i.test(normalized)) return true;
  if (/^\$\{[A-Z0-9_]+\}$/i.test(normalized)) return true;
  if (/^(?:test|fake|dummy|example|valid|mock|generated|placeholder|redacted|changeme)[-_a-z0-9]*$/i.test(normalized)) return true;
  if (/^(?:your|my)[-_a-z0-9]*(?:key|secret|token|password)$/i.test(normalized)) return true;
  if (/^(?:env|process\.env)\.[A-Z0-9_]+$/i.test(normalized)) return true;
  if (/^[A-Z][A-Z0-9_]+$/.test(normalized)) return true;
  if (/^[a-z]+[A-Z][A-Za-z0-9_$]*$/.test(normalized)) return true;
  if (/^https?:\/\/[^@\s]+$/i.test(normalized)) return true;

  const envDefault = normalized.match(/^\$\{[A-Z0-9_]+[:-]([^}]+)\}$/i);
  if (envDefault) return isAllowedSecretValue(envDefault[1]);

  return false;
}

function lineNumberFor(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function lineTextFor(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  const nextBreak = text.indexOf('\n', index);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return text.slice(start, end).trim();
}

function redacted(line) {
  return line.replace(/([:=]\s*["']?)[^"'\s#]{8,}/g, '$1[REDACTED]');
}

export function scanText(text, filePath = '<memory>') {
  const findings = [];

  for (const detector of DETECTORS) {
    detector.pattern.lastIndex = 0;
    for (const match of text.matchAll(detector.pattern)) {
      const value = detector.valueGroup ? match[detector.valueGroup] : match[0];
      if (isAllowedSecretValue(value)) continue;
      const preview = lineTextFor(text, match.index);
      if (preview.includes('credential-scan: allow')) continue;

      findings.push({
        filePath,
        line: lineNumberFor(text, match.index),
        detector: detector.name,
        preview: redacted(preview),
      });
    }
  }

  return findings;
}

export function scanFiles(files = listTrackedFiles()) {
  const findings = [];

  for (const filePath of files) {
    const buffer = fs.readFileSync(filePath);
    if (isLikelyBinary(buffer)) continue;
    findings.push(...scanText(buffer.toString('utf8'), filePath));
  }

  return findings;
}

function main() {
  const findings = scanFiles();
  if (findings.length === 0) {
    console.log('Credential scan passed.');
    return;
  }

  console.error('Credential scan FAILED: potential secrets found.');
  for (const finding of findings) {
    console.error(`${finding.filePath}:${finding.line}: ${finding.detector}: ${finding.preview}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
