/**
 * Version information module
 * Captures git commit hash and version info at startup
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read package.json version
function getPackageVersion() {
  try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Get git commit hash
function getGitCommit() {
  try {
    const hash = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
    const shortHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
    return { hash, shortHash };
  } catch {
    return { hash: 'unknown', shortHash: 'unknown' };
  }
}

// Get git branch
function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
  } catch {
    return 'unknown';
  }
}

// Get latest git tag (if any)
function getGitTag() {
  try {
    // Get the most recent tag reachable from HEAD
    return execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf8', cwd: path.join(__dirname, '..') }).trim();
  } catch {
    return null;
  }
}

// Get build timestamp
const buildTime = new Date().toISOString();

// Capture all version info at module load time (startup)
const gitInfo = getGitCommit();

export const versionInfo = {
  version: getPackageVersion(),
  gitTag: getGitTag(),
  gitCommit: gitInfo.hash,
  gitCommitShort: gitInfo.shortHash,
  gitBranch: getGitBranch(),
  buildTime,
};

/**
 * Get version string (for display)
 * Format: "1.0.0 (abc1234)"
 */
export function getVersionString() {
  return `${versionInfo.version} (${versionInfo.gitCommitShort})`;
}

export default versionInfo;
