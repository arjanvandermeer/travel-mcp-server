import fs from 'fs';

const GOOGLE_ANALYTICS_ID_PATTERN = /^(G|GT|GTM)-[A-Z0-9-]+$/i;

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
  const id = String(measurementId || '').trim();
  if (!id || !GOOGLE_ANALYTICS_ID_PATTERN.test(id)) return '';

  return `
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${id}');
  </script>`;
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
    'Cache-Control': 'no-cache',
  };
}
