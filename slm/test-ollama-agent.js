#!/usr/bin/env node

/**
 * Test suite for the Ollama Agent
 *
 * Runs a set of travel questions through the agent and validates:
 * - Got a non-empty answer (didn't fail silently)
 * - Didn't hit max iterations
 * - Used expected tool(s)
 *
 * Requires: Ollama running with qwen3.5, PostgreSQL with data, HTTP server on :3000
 *
 * Usage:
 *   node slm/test-ollama-agent.js              # run all tests
 *   node slm/test-ollama-agent.js --dry-run     # list questions without running
 *   node slm/test-ollama-agent.js --filter 3    # run only test #3
 *   node slm/test-ollama-agent.js --filter 1-5  # run tests 1 through 5
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SCRIPT = path.join(__dirname, 'ollama-agent.js');
const TIMEOUT_MS = 180_000;

// --- Test definitions ---

const tests = [
  // Simple search (baseline)
  {
    id: 1,
    category: 'Simple search',
    question: 'hotels in hua hin',
    expectTools: ['search_hotels'],
    expectAnswer: /hotel|hua hin/i,
  },
  {
    id: 2,
    category: 'Simple search',
    question: 'find cafes in chiang mai',
    expectTools: ['search_pois', 'search_restaurants'],
    expectAnswer: /cafe|chiang mai/i,
  },

  // Distance between places (3 tool calls)
  {
    id: 3,
    category: 'Distance',
    question: "what's the distance between coco 51 and hua hin marriott",
    expectTools: ['search_pois', 'calculate_distance'],
    expectAnswer: /\d+(\.\d+)?\s*(km|kilometer|meter)/i,
  },
  {
    id: 4,
    category: 'Distance',
    question: 'how far is hyatt regency hua hin from hua hin loft',
    expectTools: ['search_pois', 'calculate_distance'],
    expectAnswer: /\d+(\.\d+)?\s*(km|kilometer|meter)/i,
  },

  // Nearby search (resolve place → coordinates → search)
  {
    id: 5,
    category: 'Nearby',
    question: 'restaurants near coco 51',
    expectTools: ['search_pois', 'search_restaurants'],
    expectAnswer: /restaurant|near|coco/i,
  },
  {
    id: 6,
    category: 'Nearby',
    question: 'hotels near doi inthanon',
    expectTools: ['search_pois', 'search_hotels'],
    expectAnswer: /hotel/i,
  },

  // Detail lookup chain (search → get details)
  {
    id: 7,
    category: 'Detail lookup',
    question: 'tell me everything about coco 51',
    expectTools: ['search_pois', 'get_poi_details'],
    expectAnswer: /coco/i,
  },
  {
    id: 8,
    category: 'Detail lookup',
    question: 'what type of place is hua hin marriott and what are its details',
    expectTools: ['search_pois', 'get_poi_details'],
    expectAnswer: /marriott|hotel/i,
  },

  // Ambiguous / fuzzy names
  {
    id: 9,
    category: 'Fuzzy names',
    question: 'find coco51',
    expectTools: ['search_pois'],
    expectAnswer: /coco/i,
  },
  {
    id: 10,
    category: 'Fuzzy names',
    question: 'where is the hyatt in hua hin',
    expectTools: ['search_pois', 'search_hotels'],
    expectAnswer: /hyatt|hua hin/i,
  },

  // Existence / negative results
  {
    id: 11,
    category: 'Existence check',
    question: 'are there any museums in hua hin?',
    expectTools: ['search_pois'],
    expectAnswer: /museum|no |not |none|found|couldn/i,
  },
  {
    id: 12,
    category: 'Existence check',
    question: 'any castles in phuket?',
    expectTools: ['search_pois'],
    expectAnswer: /castle|no |not |none|found|couldn/i,
  },

  // Comparative (multiple distances)
  {
    id: 13,
    category: 'Comparative',
    question: 'which is closer to coco 51: hua hin marriott or hua hin loft?',
    expectTools: ['search_pois', 'calculate_distance'],
    expectAnswer: /closer|nearer|km|distance/i,
  },

  // City-level exploration (open-ended)
  {
    id: 14,
    category: 'Exploration',
    question: 'what can I do in chiang mai?',
    expectTools: ['search_pois'],
    expectAnswer: /chiang mai/i,
  },
  {
    id: 15,
    category: 'Exploration',
    question: 'tell me about hua hin as a travel destination',
    expectTools: ['search_pois', 'search_hotels', 'search_restaurants'],
    expectAnswer: /hua hin/i,
  },

  // Coordinate-based search
  {
    id: 16,
    category: 'Coordinates',
    question: 'what hotels are near latitude 12.57, longitude 99.96?',
    expectTools: ['search_hotels', 'search_pois'],
    expectAnswer: /hotel/i,
  },
  {
    id: 17,
    category: 'Coordinates',
    question: 'find restaurants near coordinates 13.75, 100.5',
    expectTools: ['search_restaurants', 'search_pois'],
    expectAnswer: /restaurant/i,
  },

  // Multi-criteria
  {
    id: 18,
    category: 'Multi-criteria',
    question: 'find guest houses in chiang mai',
    expectTools: ['search_pois', 'search_hotels'],
    expectAnswer: /guest.?house|chiang mai|accommodation/i,
  },
  {
    id: 19,
    category: 'Multi-criteria',
    question: 'bars in phuket',
    expectTools: ['search_pois', 'search_restaurants'],
    expectAnswer: /bar|phuket/i,
  },

  // Follow-up reasoning
  {
    id: 20,
    category: 'Reasoning',
    question: 'I want to stay in hua hin and eat near my hotel. Find me a hotel and nearby restaurants.',
    expectTools: ['search_hotels', 'search_restaurants'],
    expectAnswer: /hotel|restaurant/i,
  },
];

// --- Runner ---

function runQuestion(question) {
  return new Promise((resolve) => {
    const child = execFile('node', [AGENT_SCRIPT, question], {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        error,
        timedOut: error?.killed === true,
      });
    });
  });
}

function checkResult(test, result) {
  const issues = [];

  // Check for timeout
  if (result.timedOut) {
    issues.push('Timed out');
    return { pass: false, issues };
  }

  // Check for max iterations
  if (result.stdout.includes('Reached maximum iterations')) {
    issues.push('Hit max iterations');
  }

  // Check for non-empty answer
  const answer = result.stdout.trim();
  if (!answer) {
    issues.push('Empty answer');
    return { pass: false, issues };
  }

  // Check if couldn't find info
  if (answer.includes("couldn't find the information")) {
    issues.push('Could not find information');
    return { pass: false, issues };
  }

  // Check expected tools were used
  const toolCalls = result.stderr;
  const usedExpectedTool = test.expectTools.some(tool => toolCalls.includes(`→ ${tool}(`));
  if (!usedExpectedTool) {
    issues.push(`Expected tool(s) [${test.expectTools.join('|')}] not called`);
  }

  // Check answer pattern
  if (test.expectAnswer && !test.expectAnswer.test(answer)) {
    issues.push(`Answer doesn't match expected pattern: ${test.expectAnswer}`);
  }

  return { pass: issues.length === 0, issues };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filterIdx = args.indexOf('--filter');
  let filterRange = null;

  if (filterIdx >= 0 && args[filterIdx + 1]) {
    const val = args[filterIdx + 1];
    if (val.includes('-')) {
      const [start, end] = val.split('-').map(Number);
      filterRange = { start, end };
    } else {
      const n = parseInt(val);
      filterRange = { start: n, end: n };
    }
  }

  const selectedTests = filterRange
    ? tests.filter(t => t.id >= filterRange.start && t.id <= filterRange.end)
    : tests;

  if (dryRun) {
    console.log(`\n  Ollama Agent Test Suite — ${selectedTests.length} questions\n`);
    for (const t of selectedTests) {
      console.log(`  #${String(t.id).padStart(2)}  [${t.category}] "${t.question}"`);
    }
    console.log('');
    return;
  }

  // Verify prerequisites
  try {
    const healthRes = await fetch('http://localhost:3000/health');
    if (!healthRes.ok) throw new Error('unhealthy');
  } catch {
    console.error('ERROR: HTTP server not running on localhost:3000. Start it with: node src/index-http.js');
    process.exit(1);
  }

  try {
    const ollamaRes = await fetch('http://localhost:11434/api/tags');
    if (!ollamaRes.ok) throw new Error('not running');
  } catch {
    console.error('ERROR: Ollama not running on localhost:11434. Start it with: ollama serve');
    process.exit(1);
  }

  console.log(`\n  Ollama Agent Test Suite — running ${selectedTests.length} questions\n`);

  const results = [];

  for (const test of selectedTests) {
    const label = `#${String(test.id).padStart(2)} [${test.category}]`;
    process.stdout.write(`  ${label} "${test.question}" ... `);

    const startTime = Date.now();
    const result = await runQuestion(test.question);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const check = checkResult(test, result);

    if (check.pass) {
      console.log(`\x1b[32mPASS\x1b[0m (${elapsed}s)`);
    } else {
      console.log(`\x1b[31mFAIL\x1b[0m (${elapsed}s) — ${check.issues.join(', ')}`);
    }

    results.push({
      ...test,
      pass: check.pass,
      issues: check.issues,
      elapsed,
      answer: result.stdout.trim().slice(0, 200),
      toolCalls: result.stderr,
    });
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log(`\n  ─────────────────────────────────`);
  console.log(`  Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m, ${results.length} total`);

  if (failed > 0) {
    console.log(`\n  Failed tests:`);
    for (const r of results.filter(r => !r.pass)) {
      console.log(`    #${r.id} [${r.category}] "${r.question}"`);
      console.log(`       Issues: ${r.issues.join(', ')}`);
      if (r.answer) console.log(`       Answer: ${r.answer.slice(0, 120)}...`);
    }
  }
  console.log('');
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
