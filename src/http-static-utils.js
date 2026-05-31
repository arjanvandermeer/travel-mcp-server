import fs from 'fs';

/**
 * Obfuscate email for logging and telemetry.
 * Example: "arjanvdm@gmail.com" -> "a...m@gm...om"
 */
export function obfuscateEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  const localObf = local.length <= 2 ? `${local[0]}*` : `${local[0]}...${local[local.length - 1]}`;
  const domainObf = domain.length <= 4 ? domain : `${domain.slice(0, 2)}...${domain.slice(-2)}`;
  return `${localObf}@${domainObf}`;
}

export function renderGoogleAnalyticsTag(measurementId) {
  void measurementId;
  return '';
}

export function renderWebIndex(filePath, { versionInfo, measurementId } = {}) {
  let html = fs.readFileSync(filePath, 'utf8');
  const versionParts = [versionInfo?.gitCommitShort || versionInfo?.version, versionInfo?.buildTime].filter(Boolean);
  const assetVersion = encodeURIComponent(versionParts.join('-'));
  const commitLabel = versionInfo?.gitCommitShort || versionInfo?.version || 'local';
  const commitUrl = versionInfo?.gitCommit
    ? `https://github.com/arjanvandermeer/travel-mcp-server/commit/${versionInfo.gitCommit}`
    : 'https://github.com/arjanvandermeer/travel-mcp-server';
  html = html
    .replace('href="/css/style.css"', `href="/css/style.css?v=${assetVersion}"`)
    .replace('href="/css/dossier.css"', `href="/css/dossier.css?v=${assetVersion}"`)
    .replace('src="/js/app.js"', `src="/js/app.js?v=${assetVersion}"`)
    .replaceAll('__APP_COMMIT__', commitLabel)
    .replaceAll('__APP_COMMIT_URL__', commitUrl);

  const tag = renderGoogleAnalyticsTag(measurementId);
  if (!tag) return html;
  return html.replace('</head>', `${tag}\n</head>`);
}

export function getStaticHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, max-age=0',
  };
}
