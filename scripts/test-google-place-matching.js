#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findBestPlaceMatch,
  getOSMNameVariants,
  scorePlaceCandidate,
} from '../src/google-places-matching.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FIXTURE_PATH = path.join(__dirname, '..', 'tests', 'fixtures', 'google-place-matching', 'matches.json');

function parseArgs(argv) {
  const options = {
    fixturePath: DEFAULT_FIXTURE_PATH,
    json: false,
    caseIds: new Set(),
    list: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[i];
    };

    if (arg === '--file') {
      options.fixturePath = path.resolve(next());
    } else if (arg === '--case') {
      options.caseIds.add(next());
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node scripts/test-google-place-matching.js [options]

Runs deterministic Google Places matching algorithm fixtures.
This script does not connect to the database and does not call Google.

Options:
  --file <path>   Fixture file to run
  --case <id>     Run one case id; repeat for multiple cases
  --list          List fixture cases without running them
  --json          Print JSON results
`);
}

async function loadFixture(filePath) {
  const body = await readFile(filePath, 'utf8');
  const fixture = JSON.parse(body);
  if (!Array.isArray(fixture.cases)) {
    throw new Error(`Fixture ${filePath} must contain a cases array`);
  }
  return fixture;
}

function selectedIdOf(match) {
  return match?.id || null;
}

function getCandidateEvidence(caseDef) {
  const names = caseDef.names || getOSMNameVariants(caseDef.poi);
  const evidenceById = new Map();
  for (const candidate of caseDef.candidates || []) {
    evidenceById.set(candidate.id, scorePlaceCandidate(caseDef.poi, names, candidate));
  }
  return { names, evidenceById };
}

function getEvidenceValue(evidence, key) {
  if (key === 'houseNumberMatch') return evidence.address.houseNumberMatch;
  if (key === 'houseNumberMismatch') return evidence.address.houseNumberMismatch;
  if (key === 'streetMatch') return evidence.address.streetMatch;
  if (key === 'streetMismatch') return evidence.address.streetMismatch;
  if (key === 'minConfidence') return evidence.confidence;
  if (key === 'maxConfidence') return evidence.confidence;
  if (key === 'minNameScore') return evidence.nameScore;
  if (key === 'maxNameScore') return evidence.nameScore;
  if (key === 'minDistanceMeters') return evidence.distanceMeters;
  if (key === 'maxDistanceMeters') return evidence.distanceMeters;
  return evidence[key];
}

function describeValue(value) {
  if (typeof value === 'number') {
    return Number(value.toFixed(3));
  }
  return value;
}

function assertEvidence(caseId, label, evidence, expectations) {
  const failures = [];
  if (!expectations) return failures;

  for (const [key, expected] of Object.entries(expectations)) {
    const actual = getEvidenceValue(evidence, key);

    if (key.startsWith('min')) {
      if (actual === null || actual === undefined || actual < expected) {
        failures.push(`${caseId} ${label}: expected ${key} >= ${expected}, got ${describeValue(actual)}`);
      }
      continue;
    }

    if (key.startsWith('max')) {
      if (actual === null || actual === undefined || actual > expected) {
        failures.push(`${caseId} ${label}: expected ${key} <= ${expected}, got ${describeValue(actual)}`);
      }
      continue;
    }

    if (actual !== expected) {
      failures.push(`${caseId} ${label}: expected ${key}=${expected}, got ${describeValue(actual)}`);
    }
  }

  return failures;
}

function summarizeEvidence(evidence) {
  return {
    accepted: evidence.accepted,
    confidence: Number(evidence.confidence.toFixed(3)),
    nameScore: Number(evidence.nameScore.toFixed(3)),
    directNameMatch: evidence.directNameMatch,
    addressRescue: evidence.addressRescue,
    typeCompatible: evidence.typeCompatible,
    hasDistinctiveNameEvidence: evidence.hasDistinctiveNameEvidence,
    distanceMeters: evidence.distanceMeters === null ? null : Math.round(evidence.distanceMeters),
    address: {
      houseNumberMatch: evidence.address.houseNumberMatch,
      houseNumberMismatch: evidence.address.houseNumberMismatch,
      streetMatch: evidence.address.streetMatch,
      streetMismatch: evidence.address.streetMismatch,
      normalizedOsmStreet: evidence.address.normalizedOsmStreet,
      normalizedGoogleStreet: evidence.address.normalizedGoogleStreet,
    },
  };
}

function runCase(caseDef) {
  const failures = [];
  const { names, evidenceById } = getCandidateEvidence(caseDef);
  const selected = findBestPlaceMatch(caseDef.poi, names, caseDef.candidates || []);
  const selectedId = selectedIdOf(selected);
  const expected = caseDef.expected || {};

  if (selectedId !== (expected.selectedId || null)) {
    failures.push(`${caseDef.id}: expected selectedId=${expected.selectedId || null}, got ${selectedId}`);
  }

  if (expected.selected) {
    if (!selectedId) {
      failures.push(`${caseDef.id}: expected selected evidence, but no candidate was selected`);
    } else {
      failures.push(...assertEvidence(caseDef.id, `candidate ${selectedId}`, evidenceById.get(selectedId), expected.selected));
    }
  }

  for (const [candidateId, candidateExpectations] of Object.entries(expected.candidates || {})) {
    const evidence = evidenceById.get(candidateId);
    if (!evidence) {
      failures.push(`${caseDef.id}: expected candidate ${candidateId} is not present in fixture candidates`);
      continue;
    }
    failures.push(...assertEvidence(caseDef.id, `candidate ${candidateId}`, evidence, candidateExpectations));
  }

  return {
    id: caseDef.id,
    description: caseDef.description || '',
    passed: failures.length === 0,
    failures,
    expectedSelectedId: expected.selectedId || null,
    selectedId,
    candidates: Object.fromEntries(
      [...evidenceById.entries()].map(([id, evidence]) => [id, summarizeEvidence(evidence)]),
    ),
  };
}

function filterCases(cases, caseIds) {
  if (caseIds.size === 0) return cases;
  const selected = cases.filter(caseDef => caseIds.has(caseDef.id));
  const found = new Set(selected.map(caseDef => caseDef.id));
  const missing = [...caseIds].filter(id => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown fixture case(s): ${missing.join(', ')}`);
  }
  return selected;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = await loadFixture(options.fixturePath);
  const cases = filterCases(fixture.cases, options.caseIds);

  if (options.list) {
    for (const caseDef of cases) {
      console.log(`${caseDef.id}: ${caseDef.description || ''}`);
    }
    return;
  }

  const results = cases.map(runCase);
  const failed = results.filter(result => !result.passed);

  if (options.json) {
    console.log(JSON.stringify({
      fixture: path.relative(process.cwd(), options.fixturePath),
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      results,
    }, null, 2));
  } else {
    console.log(`Google place matching fixtures: ${results.length - failed.length}/${results.length} passed`);
    for (const result of results) {
      const marker = result.passed ? 'PASS' : 'FAIL';
      console.log(`${marker} ${result.id} selected=${result.selectedId ?? 'none'}`);
      for (const failure of result.failures) {
        console.log(`  ${failure}`);
      }
    }
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
