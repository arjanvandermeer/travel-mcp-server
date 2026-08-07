/**
 * Tests for pure functions in tools-config.js (Tier 1 coverage)
 * getToolsConfig, getResourcesConfig, buildSearchResponse
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getToolsConfig,
  getResourcesConfig,
  buildSearchResponse,
  isToolAvailableToUser,
} from '../../src/tools-config.js';
import { MCP_APP_HTML_MIME_TYPE } from '../../src/resources-config.js';

// =============================================================================
// getToolsConfig
// =============================================================================

describe('getToolsConfig', () => {
  it('should return an array of tools', () => {
    const tools = getToolsConfig('https://example.com');
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);
  });

  it('should add ui.domain to tools with ui.resourceUri', () => {
    const domain = 'https://mcp.example.com';
    const tools = getToolsConfig(domain);

    const uiTools = tools.filter(t => t._meta?.ui?.domain);
    assert.ok(uiTools.length > 0, 'Should have UI tools with domain');

    for (const tool of uiTools) {
      assert.strictEqual(tool._meta.ui.domain, domain);
      assert.strictEqual(tool._meta['openai/outputTemplate'], tool._meta.ui.resourceUri);
      assert.strictEqual(tool._meta['openai/widgetDomain'], domain);
      assert.deepStrictEqual(
        tool._meta['openai/widgetCSP'].connect_domains,
        tool._meta.ui.csp.connectDomains,
      );
    }
  });

  it('should add CSP with empty frameDomains for poi-details tools', () => {
    const tools = getToolsConfig('https://example.com');

    const poiDetailsTool = tools.find(
      t => t._meta?.ui?.resourceUri?.includes('poi-details'),
    );
    assert.ok(poiDetailsTool, 'Should have a poi-details tool');
    assert.deepStrictEqual(
      poiDetailsTool._meta.ui.csp.frameDomains,
      [],
    );
  });

  it('should add CSP with empty frameDomains for non-poi-details UI tools', () => {
    const tools = getToolsConfig('https://example.com');

    const searchResultsTool = tools.find(
      t => t._meta?.ui?.resourceUri?.includes('search-results'),
    );
    assert.ok(searchResultsTool, 'Should have a search-results tool');
    assert.deepStrictEqual(
      searchResultsTool._meta.ui.csp.frameDomains,
      [],
    );
  });

  it('should not add ui.domain to tools without ui.resourceUri', () => {
    const tools = getToolsConfig('https://example.com');

    // search_cities has no resourceUri
    const searchCities = tools.find(t => t.name === 'search_cities');
    assert.ok(searchCities, 'Should have search_cities tool');
    assert.strictEqual(searchCities._meta?.ui?.domain, undefined);
  });

  it('should preserve original tool properties', () => {
    const tools = getToolsConfig('https://example.com');

    for (const tool of tools) {
      assert.ok(tool.name, 'Each tool should have a name');
      assert.ok(tool.description, 'Each tool should have a description');
      assert.ok(tool.inputSchema, 'Each tool should have an inputSchema');
    }
  });

  it('should hide personal and admin tools from anonymous sessions', () => {
    const names = new Set(getToolsConfig('https://example.com').map(tool => tool.name));

    assert.ok(names.has('search_hotels_ui'));
    assert.ok(!names.has('add_favorite'));
    assert.ok(!names.has('get_user_preferences'));
    assert.ok(!names.has('start_enrichment_task'));
    assert.ok(!names.has('get_stats'));
  });

  it('should expose personal tools after authentication and admin tools only to admins', () => {
    const user = { id: 1, email: 'user@example.com', config: {} };
    const admin = { id: 2, email: 'admin@example.com', config: { role: 'admin' } };
    const userNames = new Set(getToolsConfig('https://example.com', { user }).map(tool => tool.name));
    const adminNames = new Set(getToolsConfig('https://example.com', { user: admin }).map(tool => tool.name));

    assert.ok(userNames.has('add_favorite'));
    assert.ok(!userNames.has('start_enrichment_task'));
    assert.ok(adminNames.has('add_favorite'));
    assert.ok(adminNames.has('start_enrichment_task'));
    assert.ok(adminNames.has('start_ai_place_summary_task'));
  });

  it('should use the same access policy for tool invocation', () => {
    const user = { id: 1, config: {} };
    const admin = { id: 2, config: { role: 'admin' } };

    assert.equal(isToolAvailableToUser('search_pois'), true);
    assert.equal(isToolAvailableToUser('add_favorite'), false);
    assert.equal(isToolAvailableToUser('add_favorite', user), true);
    assert.equal(isToolAvailableToUser('start_enrichment_task', user), false);
    assert.equal(isToolAvailableToUser('start_enrichment_task', admin), true);
  });
});

// =============================================================================
// getResourcesConfig
// =============================================================================

describe('getResourcesConfig', () => {
  const domain = 'https://mcp.example.com';

  it('should return resources and resourceTemplates', () => {
    const config = getResourcesConfig(domain);

    assert.ok(Array.isArray(config.resources));
    assert.ok(Array.isArray(config.resourceTemplates));
  });

  describe('resource templates', () => {
    it('should include poi-details widget template', () => {
      const config = getResourcesConfig(domain);
      const poiDetails = config.resourceTemplates.find(
        r => r.uriTemplate === 'ui://widget/poi-details.html',
      );

      assert.ok(poiDetails);
      assert.strictEqual(poiDetails.mimeType, MCP_APP_HTML_MIME_TYPE);
      assert.strictEqual(poiDetails._meta.ui.domain, domain);
      assert.strictEqual(poiDetails._meta['openai/widgetDomain'], domain);
      assert.deepStrictEqual(
        poiDetails._meta.ui.csp.frameDomains,
        [],
      );
      assert.deepStrictEqual(
        poiDetails._meta['openai/widgetCSP'].frame_domains,
        [],
      );
    });

    it('should include search-results widget template', () => {
      const config = getResourcesConfig(domain);
      const searchResults = config.resourceTemplates.find(
        r => r.uriTemplate === 'ui://widget/search-results.html',
      );

      assert.ok(searchResults);
      assert.strictEqual(searchResults.mimeType, MCP_APP_HTML_MIME_TYPE);
      assert.strictEqual(searchResults._meta.ui.domain, domain);
      assert.strictEqual(searchResults._meta['openai/widgetDomain'], domain);
      assert.deepStrictEqual(
        searchResults._meta.ui.csp.frameDomains,
        [],
      );
      assert.deepStrictEqual(
        searchResults._meta['openai/widgetCSP'].frame_domains,
        [],
      );
    });

    it('should include nearby-pois widget template', () => {
      const config = getResourcesConfig(domain);
      const nearby = config.resourceTemplates.find(
        r => r.uriTemplate === 'ui://widget/nearby-pois.html',
      );

      assert.ok(nearby);
      assert.strictEqual(nearby.mimeType, MCP_APP_HTML_MIME_TYPE);
      assert.strictEqual(nearby._meta.ui.domain, domain);
      assert.strictEqual(nearby._meta['openai/widgetDomain'], domain);
    });

    it('should include poi by ID template', () => {
      const config = getResourcesConfig(domain);
      const poiById = config.resourceTemplates.find(
        r => r.uriTemplate === 'ui://poi/{osm_id}',
      );

      assert.ok(poiById);
      assert.strictEqual(poiById.mimeType, MCP_APP_HTML_MIME_TYPE);
      assert.strictEqual(poiById._meta.ui.domain, domain);
      assert.strictEqual(poiById._meta['openai/widgetDomain'], domain);
      assert.deepStrictEqual(
        poiById._meta.ui.csp.frameDomains,
        [],
      );
      assert.deepStrictEqual(
        poiById._meta['openai/widgetCSP'].frame_domains,
        [],
      );
    });

    it('should use the provided widget domain for all templates', () => {
      const customDomain = 'https://custom.example.org';
      const config = getResourcesConfig(customDomain);

      for (const template of config.resourceTemplates) {
        assert.strictEqual(
          template._meta.ui.domain,
          customDomain,
          `${template.uriTemplate} should use custom domain`,
        );
      }
    });
  });
});

// =============================================================================
// buildSearchResponse
// =============================================================================

describe('buildSearchResponse', () => {
  it('should return content and structuredContent', () => {
    const pois = [{ name: 'Test Hotel', osm_id: 123 }];
    const result = buildSearchResponse(pois);

    assert.ok(result.content);
    assert.ok(result.structuredContent);
  });

  it('should format content as JSON text', () => {
    const pois = [{ name: 'Test Hotel', rating: 4.5 }];
    const result = buildSearchResponse(pois);

    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);
    assert.deepStrictEqual(parsed, pois);
  });

  it('should include results and count in structuredContent', () => {
    const pois = [
      { name: 'Hotel A' },
      { name: 'Hotel B' },
      { name: 'Hotel C' },
    ];
    const result = buildSearchResponse(pois);

    assert.deepStrictEqual(result.structuredContent.results, pois);
    assert.strictEqual(result.structuredContent.count, 3);
  });

  it('should handle empty array', () => {
    const result = buildSearchResponse([]);

    assert.strictEqual(result.structuredContent.count, 0);
    assert.deepStrictEqual(result.structuredContent.results, []);
    assert.strictEqual(result.content[0].text, '[]');
  });
});
