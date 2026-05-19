import { versionInfo } from './version.js';
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
    resources: [
      {
        uri: 'info://version',
        name: 'Server Version',
        description: 'Returns server version info including git commit hash',
        mimeType: 'application/json',
      },
      {
        uri: 'info://random-poi',
        name: 'Random POI Preview',
        description: 'Returns a link to view a random POI in the browser',
        mimeType: 'application/json',
      },
      {
        uri: 'samples://queries',
        name: 'Sample Queries',
        description: 'Example queries to help you get started with the travel MCP server. Includes sample searches for hotels, restaurants, and attractions in New York City.',
        mimeType: 'application/json',
      },
    ],
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

  if (uri === 'info://version') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(versionInfo, null, 2) }],
    };
  }

  if (uri === 'info://random-poi') {
    const serverBaseUrl = await db.getServerBaseUrl();
    const baseUrl = serverBaseUrl ? serverBaseUrl.replace(/\/$/, '') : '';
    const previewUrl = `${baseUrl}/preview/poi/random`;
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ url: previewUrl }, null, 2) }],
    };
  }

  if (uri === 'samples://queries') {
    return {
      contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(buildSampleQueries(), null, 2) }],
    };
  }

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

function buildSampleQueries() {
  return {
    description: 'Example queries to help you get started with the travel MCP server',
    workflow_tips: [
      {
        pattern: 'Find [chain/brand] near [landmark]',
        description: 'To find a chain restaurant or hotel near a landmark, use a two-step approach',
        steps: [
          'Step 1: Use search_pois to find the landmark and get its coordinates',
          'Step 2: Use search_restaurants or search_hotels with those coordinates + query for the brand name',
        ],
        example: {
          query: 'Find Starbucks near Empire State Building',
          step1: { tool: 'search_pois', args: { query: 'Empire State Building', city_name: 'New York', country_code: 'US' } },
          step1_result: 'Returns POI with osm_latitude: 40.748, osm_longitude: -73.985',
          step2: { tool: 'search_restaurants', args: { latitude: 40.748, longitude: -73.985, radius_km: 1, query: 'Starbucks' } },
          step2_result: 'Returns all Starbucks locations within 1km of Empire State Building',
        },
      },
      {
        pattern: 'Find [type] near [landmark]',
        description: 'Same two-step approach works for any type of place near any landmark',
        examples: [
          'Hotels near Central Park -> search_pois("Central Park") -> search_hotels(lat/long)',
          'Italian restaurants near Times Square -> search_pois("Times Square") -> search_restaurants(lat/long, query="Italian")',
          'Museums near Eiffel Tower -> search_pois("Eiffel Tower") -> search_pois(lat/long, poi_type="museum")',
        ],
      },
    ],
    examples: [
      {
        category: 'Hotels',
        description: 'Search for hotels in a city',
        tool: 'search_hotels',
        example_query: 'Find hotels in New York, US',
        example_args: { city_name: 'New York', country_code: 'US', limit: 10 },
        notable_result: 'The Conrad New York Downtown on Vesey Street is a luxury hotel in Lower Manhattan.',
      },
      {
        category: 'Hotel Chains',
        description: 'Search for a specific hotel brand',
        tool: 'search_hotels',
        example_query: 'Find Marriott hotels in Manhattan',
        example_args: { city_name: 'New York', country_code: 'US', query: 'Marriott', limit: 10 },
        note: 'The query parameter works with brand names like Marriott, Hilton, Holiday Inn, etc.',
      },
      {
        category: 'Restaurants',
        description: 'Search for restaurants near a location',
        tool: 'search_restaurants',
        example_query: 'Find restaurants near Rockefeller Center in Manhattan',
        example_args: { latitude: 40.7587, longitude: -73.9787, radius_km: 0.5, limit: 10 },
        notable_result: 'The Rainbow Room at 30 Rockefeller Plaza is an iconic fine dining restaurant in Midtown Manhattan.',
      },
      {
        category: 'Chain Restaurants',
        description: 'Search for a chain restaurant brand near coordinates',
        tool: 'search_restaurants',
        example_query: 'Find Starbucks near Empire State Building (after getting coordinates)',
        example_args: { latitude: 40.748, longitude: -73.985, radius_km: 1, query: 'Starbucks', limit: 10 },
        note: 'The query parameter works with chain brands like Starbucks, McDonald\'s, Chipotle, Subway, etc.',
      },
      {
        category: 'Attractions',
        description: 'Search for points of interest and tourist attractions',
        tool: 'search_pois',
        example_query: 'Find tourist attractions in New York, US',
        example_args: { city_name: 'New York', country_code: 'US', limit: 10 },
        notable_result: 'The Statue of Liberty on Liberty Island is one of the most famous attractions in New York.',
      },
      {
        category: 'Landmarks (for coordinates)',
        description: 'Get coordinates of a landmark to use in subsequent searches',
        tool: 'search_pois',
        example_query: 'Find Empire State Building to get its coordinates',
        example_args: { query: 'Empire State Building', city_name: 'New York', country_code: 'US' },
        note: 'Results include osm_latitude and osm_longitude - use these for nearby searches.',
      },
      {
        category: 'Cities',
        description: 'Search for cities in a country or region',
        tool: 'search_cities',
        example_query: 'Find cities in New York state, US',
        example_args: { country_code: 'US', state: 'New York', limit: 10 },
        notable_result: 'New York City is the most populous city in the United States.',
      },
      {
        category: 'POI Details',
        description: 'Get detailed information about a specific point of interest',
        tool: 'get_poi_details',
        example_query: 'Get details for a specific hotel or restaurant',
        example_args: { osm_id: 123456789 },
        note: 'Use an osm_id from search results to get full details including address, phone, website, and hours.',
      },
    ],
  };
}
