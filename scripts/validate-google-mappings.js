#!/usr/bin/env node

import { TravelDatabase } from '../src/database.js';
import {
  GOOGLE_PLACES_MIN_CONFIDENCE,
} from '../src/config.js';
import {
  getOSMNameVariants,
  scorePlaceCandidate,
} from '../src/google-places-matching.js';

const DEFAULT_REJECTED_LIMIT = 25;
const DEFAULT_WARNING_LIMIT = 25;

function parseArgs(argv) {
  const options = {
    failOnRejected: true,
    json: false,
    limit: null,
    osmId: null,
    poiType: null,
    rejectedLimit: DEFAULT_REJECTED_LIMIT,
    warningLimit: DEFAULT_WARNING_LIMIT,
    minConfidence: GOOGLE_PLACES_MIN_CONFIDENCE,
    failOnWarnings: false,
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

    if (arg === '--allow-rejections') {
      options.failOnRejected = false;
    } else if (arg === '--fail-on-rejected') {
      options.failOnRejected = true;
    } else if (arg === '--fail-on-warnings') {
      options.failOnWarnings = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--limit') {
      options.limit = parsePositiveInteger(next(), arg);
    } else if (arg === '--osm-id') {
      options.osmId = parsePositiveInteger(next(), arg);
    } else if (arg === '--poi-type') {
      options.poiType = next();
    } else if (arg === '--rejected-limit') {
      options.rejectedLimit = parseNonNegativeInteger(next(), arg);
    } else if (arg === '--warning-limit') {
      options.warningLimit = parseNonNegativeInteger(next(), arg);
    } else if (arg === '--min-confidence') {
      options.minConfidence = parseConfidence(next(), arg);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseConfidence(value, label) {
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be a number from 0 to 1`);
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage: node scripts/validate-google-mappings.js [options]

Validates stored active OSM -> Google mappings against the current matcher.
This does not call Google Places; it scores the already enriched Google rows.

Options:
  --allow-rejections          Exit 0 even if active mappings are rejected
  --fail-on-rejected          Exit 1 if active mappings are rejected (default)
  --fail-on-warnings          Exit 1 if accepted mappings have suspicious evidence
  --json                      Print JSON instead of text
  --limit <n>                 Validate at most n mappings
  --osm-id <id>               Validate one OSM id
  --poi-type <type>           Validate one POI type
  --rejected-limit <n>        Number of rejected examples to print (default ${DEFAULT_REJECTED_LIMIT})
  --warning-limit <n>         Number of warning examples to print (default ${DEFAULT_WARNING_LIMIT})
  --min-confidence <0..1>     Override matcher confidence threshold
`);
}

function buildQuery(options) {
  const filters = [
    "m.mapping_status = 'active'",
    'm.google_place_id IS NOT NULL',
  ];
  const params = [];

  if (options.osmId !== null) {
    params.push(options.osmId);
    filters.push(`p.osm_id = $${params.length}`);
  }

  if (options.poiType) {
    params.push(options.poiType);
    filters.push(`p.poi_type = $${params.length}`);
  }

  let limitClause = '';
  if (options.limit !== null) {
    params.push(options.limit);
    limitClause = `LIMIT $${params.length}`;
  }

  return {
    params,
    sql: `
      SELECT
        p.osm_id,
        p.poi_type,
        p.name AS osm_name,
        p.name_en AS osm_name_en,
        p.latitude AS osm_latitude,
        p.longitude AS osm_longitude,
        p.address AS osm_address,
        p.tags AS osm_tags,
        m.google_place_id,
        m.match_confidence AS stored_match_confidence,
        m.match_method,
        m.match_distance_meters AS stored_match_distance_meters,
        m.mapped_at,
        g.name AS google_name,
        g.formatted_address AS google_formatted_address,
        g.short_formatted_address AS google_short_formatted_address,
        g.latitude AS google_latitude,
        g.longitude AS google_longitude,
        g.types AS google_types,
        g.primary_type AS google_primary_type,
        g.address_components AS google_address_components,
        g.business_status AS google_business_status
      FROM osm_google_mappings m
      JOIN osm_pois p ON p.osm_id = m.osm_id
      JOIN google_places g ON g.google_place_id = m.google_place_id
      WHERE ${filters.join('\n        AND ')}
      ORDER BY p.osm_id
      ${limitClause}
    `,
  };
}

function rowToPoi(row) {
  return {
    osm_id: row.osm_id,
    poi_type: row.poi_type,
    name: row.osm_name,
    name_en: row.osm_name_en,
    latitude: row.osm_latitude,
    longitude: row.osm_longitude,
    address: row.osm_address,
    tags: row.osm_tags || {},
  };
}

function rowToPlace(row) {
  return {
    id: row.google_place_id,
    name: row.google_name,
    displayName: { text: row.google_name },
    formattedAddress: row.google_formatted_address,
    shortFormattedAddress: row.google_short_formatted_address,
    latitude: row.google_latitude,
    longitude: row.google_longitude,
    types: row.google_types || [],
    primaryType: row.google_primary_type,
    addressComponents: row.google_address_components || [],
    businessStatus: row.google_business_status,
  };
}

function classifyRejection(evidence) {
  if (!evidence.typeCompatible) return 'type_mismatch';
  if (evidence.address.houseNumberMismatch) return 'house_number_mismatch';
  if (evidence.address.streetMismatch) return 'street_mismatch';
  if (evidence.distanceMeters !== null && evidence.distanceMeters > 500) return 'distance_over_500m';
  if (!evidence.hasDistinctiveNameEvidence && evidence.nameScore >= 0.45) return 'weak_identity';
  if (evidence.nameScore < 0.45) return 'low_name_score';
  return 'insufficient_evidence';
}

function classifyWarnings(result) {
  const warnings = [];

  if (result.computed_distance_meters !== null && result.computed_distance_meters > 500) {
    warnings.push('distance_over_500m');
  }

  if (result.address.house_number_mismatch && result.address.street_mismatch) {
    warnings.push('address_mismatch');
  } else {
    if (result.address.house_number_mismatch) {
      warnings.push('house_number_mismatch');
    }
    if (result.address.street_mismatch) {
      warnings.push('street_mismatch');
    }
  }

  return warnings;
}

function summarize(rows, options) {
  const results = rows.map(row => {
    const poi = rowToPoi(row);
    const place = rowToPlace(row);
    const names = getOSMNameVariants(poi);
    const evidence = scorePlaceCandidate(poi, names, place, options.minConfidence);
    const mapped = {
      osm_id: row.osm_id,
      poi_type: row.poi_type,
      osm_name: row.osm_name,
      google_place_id: row.google_place_id,
      google_name: row.google_name,
      stored_match_confidence: row.stored_match_confidence === null ? null : Number(row.stored_match_confidence),
      stored_match_distance_meters: row.stored_match_distance_meters,
      computed_confidence: Number(evidence.confidence.toFixed(3)),
      computed_name_score: Number(evidence.nameScore.toFixed(3)),
      computed_distance_meters: evidence.distanceMeters === null ? null : Math.round(evidence.distanceMeters),
      accepted: evidence.accepted,
      direct_name_match: evidence.directNameMatch,
      address_rescue: evidence.addressRescue,
      type_compatible: evidence.typeCompatible,
      has_distinctive_name_evidence: evidence.hasDistinctiveNameEvidence,
      rejection_reason: evidence.accepted ? null : classifyRejection(evidence),
      address: {
        osm_house_number: evidence.address.osmHouseNumber,
        google_house_number: evidence.address.googleHouseNumber,
        osm_street: evidence.address.osmStreet,
        google_street: evidence.address.googleStreet,
        normalized_osm_street: evidence.address.normalizedOsmStreet,
        normalized_google_street: evidence.address.normalizedGoogleStreet,
        house_number_match: evidence.address.houseNumberMatch,
        house_number_mismatch: evidence.address.houseNumberMismatch,
        street_match: evidence.address.streetMatch,
        street_mismatch: evidence.address.streetMismatch,
      },
      match_method: row.match_method,
      mapped_at: row.mapped_at,
    };
    mapped.warning_reasons = evidence.accepted ? classifyWarnings(mapped) : [];
    return mapped;
  });

  const counters = {
    total: results.length,
    accepted: results.filter(row => row.accepted).length,
    rejected: results.filter(row => !row.accepted).length,
    direct_name_match: results.filter(row => row.direct_name_match).length,
    address_rescue: results.filter(row => row.address_rescue).length,
    type_mismatch: results.filter(row => !row.type_compatible).length,
    house_number_mismatch: results.filter(row => row.address.house_number_mismatch).length,
    street_mismatch: results.filter(row => row.address.street_mismatch).length,
    distance_over_500m: results.filter(row => row.computed_distance_meters !== null && row.computed_distance_meters > 500).length,
    accepted_with_warnings: results.filter(row => row.warning_reasons.length > 0).length,
  };

  const rejectedByReason = {};
  for (const result of results) {
    if (result.rejection_reason) {
      rejectedByReason[result.rejection_reason] = (rejectedByReason[result.rejection_reason] || 0) + 1;
    }
  }

  const rejected = results
    .filter(row => !row.accepted)
    .sort((a, b) => {
      const confidenceDelta = b.computed_confidence - a.computed_confidence;
      if (confidenceDelta !== 0) return confidenceDelta;
      return a.osm_id < b.osm_id ? -1 : 1;
    });

  const warnings = results
    .filter(row => row.warning_reasons.length > 0)
    .sort((a, b) => {
      const severityDelta = b.warning_reasons.length - a.warning_reasons.length;
      if (severityDelta !== 0) return severityDelta;
      const distanceDelta = (b.computed_distance_meters ?? 0) - (a.computed_distance_meters ?? 0);
      if (distanceDelta !== 0) return distanceDelta;
      return a.osm_id < b.osm_id ? -1 : 1;
    });

  const warningsByReason = {};
  for (const result of warnings) {
    for (const reason of result.warning_reasons) {
      warningsByReason[reason] = (warningsByReason[reason] || 0) + 1;
    }
  }

  return {
    options: {
      min_confidence: options.minConfidence,
      fail_on_rejected: options.failOnRejected,
      fail_on_warnings: options.failOnWarnings,
      limit: options.limit,
      osm_id: options.osmId,
      poi_type: options.poiType,
    },
    counters,
    rejected_by_reason: rejectedByReason,
    warnings_by_reason: warningsByReason,
    rejected,
    warnings,
  };
}

function printText(summary, rejectedLimit, warningLimit) {
  const c = summary.counters;
  console.log('Google mapping validation');
  console.log(`  Total active mappings: ${c.total}`);
  console.log(`  Accepted by current matcher: ${c.accepted}`);
  console.log(`  Rejected by current matcher: ${c.rejected}`);
  console.log(`  Direct name matches: ${c.direct_name_match}`);
  console.log(`  Address rescues: ${c.address_rescue}`);
  console.log(`  Type mismatches: ${c.type_mismatch}`);
  console.log(`  House number mismatches: ${c.house_number_mismatch}`);
  console.log(`  Street mismatches: ${c.street_mismatch}`);
  console.log(`  Distance > 500m: ${c.distance_over_500m}`);
  console.log(`  Accepted with warnings: ${c.accepted_with_warnings}`);

  if (Object.keys(summary.rejected_by_reason).length > 0) {
    console.log('\nRejected by reason:');
    for (const [reason, count] of Object.entries(summary.rejected_by_reason).sort()) {
      console.log(`  ${reason}: ${count}`);
    }
  }

  if (summary.rejected.length > 0 && rejectedLimit > 0) {
    console.log(`\nRejected examples (top ${Math.min(rejectedLimit, summary.rejected.length)}):`);
    for (const row of summary.rejected.slice(0, rejectedLimit)) {
      console.log(
        `  ${row.osm_id} ${row.poi_type}: "${row.osm_name}" -> "${row.google_name}" ` +
        `reason=${row.rejection_reason} name=${row.computed_name_score} ` +
        `confidence=${row.computed_confidence} distance=${row.computed_distance_meters ?? 'n/a'}m`,
      );
      const street = [
        row.address.osm_street,
        row.address.google_street,
      ].filter(Boolean).join(' vs ');
      if (street) {
        console.log(`    street: ${street}`);
      }
    }
  }

  if (Object.keys(summary.warnings_by_reason).length > 0) {
    console.log('\nWarnings by reason:');
    for (const [reason, count] of Object.entries(summary.warnings_by_reason).sort()) {
      console.log(`  ${reason}: ${count}`);
    }
  }

  if (summary.warnings.length > 0 && warningLimit > 0) {
    console.log(`\nAccepted warning examples (top ${Math.min(warningLimit, summary.warnings.length)}):`);
    for (const row of summary.warnings.slice(0, warningLimit)) {
      console.log(
        `  ${row.osm_id} ${row.poi_type}: "${row.osm_name}" -> "${row.google_name}" ` +
        `warnings=${row.warning_reasons.join(',')} name=${row.computed_name_score} ` +
        `confidence=${row.computed_confidence} distance=${row.computed_distance_meters ?? 'n/a'}m`,
      );
      const address = [
        row.address.osm_house_number && row.address.osm_street
          ? `${row.address.osm_house_number} ${row.address.osm_street}`
          : row.address.osm_street,
        row.address.google_house_number && row.address.google_street
          ? `${row.address.google_house_number} ${row.address.google_street}`
          : row.address.google_street,
      ].filter(Boolean).join(' vs ');
      if (address) {
        console.log(`    address: ${address}`);
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = new TravelDatabase();

  try {
    const query = buildQuery(options);
    const result = await db.pool.query(query.sql, query.params);
    const summary = summarize(result.rows, options);

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printText(summary, options.rejectedLimit, options.warningLimit);
    }

    if (options.failOnRejected && summary.counters.rejected > 0) {
      process.exitCode = 1;
    } else if (options.failOnWarnings && summary.counters.accepted_with_warnings > 0) {
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
