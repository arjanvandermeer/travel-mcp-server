import fs from 'fs';

const GOOGLE_ANALYTICS_ID_PATTERN = /^G-[A-Z0-9]{10}$/i;

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
  const id = String(measurementId || '').trim().toUpperCase();
  if (!id || !GOOGLE_ANALYTICS_ID_PATTERN.test(id)) return '';

  return `
  <!-- Google tag (gtag.js) -->
  <script>
    (function () {
      var id = '${id}';
      var scriptLoaded = false;

      function isSuppressedPath(pathname) {
        return String(pathname || '').indexOf('/poi/') === 0;
      }

      function setDisabled(disabled) {
        window['ga-disable-' + id] = disabled;
      }

      function ensureGtag() {
        if (scriptLoaded) return;
        scriptLoaded = true;
        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        window.gtag('config', id, { send_page_view: false });
        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
        document.head.appendChild(script);
      }

      window.__travelAnalytics = {
        update: function (pathname) {
          var path = pathname || window.location.pathname;
          var disabled = isSuppressedPath(path);
          setDisabled(disabled);
          if (disabled) return;
          ensureGtag();
          window.gtag('event', 'page_view', {
            send_to: id,
            page_title: document.title,
            page_location: window.location.href,
            page_path: path
          });
        }
      };

      window.__travelAnalytics.update(window.location.pathname);
    }());
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
