/**
 * Version information module
 * Captures git commit hash and version info at startup
 * Falls back to environment variables when git is not available (Docker)
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

// Get git commit hash (try git first, then env vars)
function getGitCommit() {
  // Try git command first
  try {
    const hash = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const shortHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { hash, shortHash };
  } catch {
    // Fall back to environment variables (set during Docker build)
    const hash = process.env.GIT_COMMIT || null;
    const shortHash = process.env.GIT_COMMIT_SHORT || null;
    return { hash, shortHash };
  }
}

// Get git branch (try git first, then env vars)
function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return process.env.GIT_BRANCH || null;
  }
}

// Get latest git tag (try git first, then env vars)
function getGitTag() {
  try {
    const tag = execSync('git describe --tags --abbrev=0 2>/dev/null', { encoding: 'utf8', cwd: path.join(__dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return tag || null;
  } catch {
    return process.env.GIT_TAG || null;
  }
}

// Get build timestamp
const buildTime = new Date().toISOString();

// Capture all version info at module load time (startup)
const gitInfo = getGitCommit();

// Build version info object, excluding null/empty values
const rawVersionInfo = {
  version: getPackageVersion(),
  gitTag: getGitTag(),
  gitCommit: gitInfo.hash,
  gitCommitShort: gitInfo.shortHash,
  gitBranch: getGitBranch(),
  buildTime,
};

// Filter out null/empty values
export const versionInfo = Object.fromEntries(
  Object.entries(rawVersionInfo).filter(([, v]) => v != null && v !== '')
);

/**
 * Get version string for MCP server identification
 * Prefers: tag > commit > build date
 * Format: "1.0.0-v1.0.0" or "1.0.0-abc1234" or "1.0.0-20240131"
 */
export function getVersionString() {
  const shortDate = versionInfo.buildTime.split('T')[0].replace(/-/g, '');
  const identifier = versionInfo.gitTag || versionInfo.gitCommitShort || shortDate;
  return `${versionInfo.version}-${identifier}`;
}

export default versionInfo;
