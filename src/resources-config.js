import { fetchNearbyForPOI, renderPOIPreview } from './poi-view-utils.js';

export const MCP_APP_HTML_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Get resources configuration with dynamic widget domain.
 * @param {string} widgetDomain - Full URL from server_base_url config (e.g., "https://travel.arjanvandermeer.com")
 * @returns {object} - MCP resources configuration
 */
export function getResourcesConfig(widgetDomain) {
  const buildWidgetMeta = (frameDomains = []) => buildOpenAIWidgetMeta(widgetDomain, frameDomains);

  return {
    resources: [],
    resourceTemplates: [
      {
        uriTemplate: 'ui://widget/poi-details.html',
        name: 'POI Details Widget',
        description: 'Rich interactive page for a specific POI (hotel, restaurant, etc.)',
        mimeType: MCP_APP_HTML_MIME_TYPE,
        _meta: buildWidgetMeta([]),
      },
      {
        uriTemplate: 'ui://widget/search-results.html',
        name: 'Search Results Widget',
        description: 'Interactive list of search results. Renders tool output as clickable cards.',
        mimeType: MCP_APP_HTML_MIME_TYPE,
        _meta: buildWidgetMeta([]),
      },
      {
        uriTemplate: 'ui://widget/nearby-pois.html',
        name: 'Nearby POIs Widget',
        description: 'Horizontal scrollable cards showing nearby points of interest.',
        mimeType: MCP_APP_HTML_MIME_TYPE,
        _meta: buildWidgetMeta([]),
      },
      {
        uriTemplate: 'ui://poi/{osm_id}',
        name: 'POI Detail Page (by ID)',
        description: 'POI detail page accessed by OSM ID - used when clicking search results.',
        mimeType: MCP_APP_HTML_MIME_TYPE,
        _meta: buildWidgetMeta([]),
      },
    ],
  };
}

function buildOpenAIWidgetMeta(widgetDomain, frameDomains = []) {
  const csp = {
    connectDomains: ['https://chatgpt.com', widgetDomain],
    resourceDomains: [widgetDomain, 'https://*.oaistatic.com'],
    frameDomains,
  };

  return {
    'openai/widgetDomain': widgetDomain,
    'openai/widgetCSP': {
      connect_domains: csp.connectDomains,
      resource_domains: csp.resourceDomains,
      frame_domains: csp.frameDomains,
    },
    ui: {
      domain: widgetDomain,
      csp,
    },
  };
}

/**
 * Handle reading a resource.
 * @param {string} uri - Resource URI
 * @param {object} db - Database instance
 * @param {function} render - Template render function
 * @returns {object} - MCP resource contents
 */
export async function handleReadResource(uri, db, render) {
  const widgetDomain = await db.getServerBaseUrl() || 'http://localhost';
  const buildHtmlContent = (html, frameDomains = []) => ({
    uri,
    mimeType: MCP_APP_HTML_MIME_TYPE,
    text: html,
    _meta: buildOpenAIWidgetMeta(widgetDomain, frameDomains),
  });

  if (uri === 'ui://widget/poi-details.html') {
    return {
      contents: [buildHtmlContent(render('poi-details', {}))],
    };
  }

  if (uri === 'ui://widget/search-results.html') {
    return {
      contents: [buildHtmlContent(render('search-results', {
        title: 'Search Results',
        count: 0,
        results: [],
      }))],
    };
  }

  if (uri === 'ui://widget/nearby-pois.html') {
    return {
      contents: [buildHtmlContent(render('nearby-pois', {
        title: 'Nearby Places',
        results: [],
        count: 0,
      }))],
    };
  }

  const poiMatch = uri.match(/^ui:\/\/[^/]+\/poi\/(\d+)$/);
  if (poiMatch) {
    const osmId = parseInt(poiMatch[1], 10);
    const poi = await db.getPOIDetails(osmId);

    if (!poi) {
      return {
        contents: [buildHtmlContent(render('error', {
          title: 'POI Not Found',
          message: `No POI found with OSM ID: ${osmId}`,
          code: osmId,
        }))],
      };
    }

    const { nearbyPois, nearbyTitle } = await fetchNearbyForPOI(poi, db);
    return {
      contents: [buildHtmlContent(renderPOIPreview(poi, render, nearbyPois, nearbyTitle))],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
}
