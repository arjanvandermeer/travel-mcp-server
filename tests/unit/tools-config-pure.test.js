/**
 * Tests for pure functions in tools-config.js (Tier 1 coverage)
 * getPromptMessages, getToolsConfig, getResourcesConfig, buildSearchResponse
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getPromptMessages,
  getToolsConfig,
  getResourcesConfig,
  buildSearchResponse,
} from '../../src/tools-config.js';

// =============================================================================
// getPromptMessages
// =============================================================================

describe('getPromptMessages', () => {
  describe('find_hotels_in_city', () => {
    it('should return prompt with provided city and country', () => {
      const result = getPromptMessages('find_hotels_in_city', {
        city: 'Bangkok',
        country_code: 'TH',
      });

      assert.strictEqual(result.description, 'Find hotels in Bangkok');
      assert.strictEqual(result.messages.length, 1);
      assert.strictEqual(result.messages[0].role, 'user');
      assert.strictEqual(result.messages[0].content.type, 'text');
      assert.ok(result.messages[0].content.text.includes('Bangkok'));
      assert.ok(result.messages[0].content.text.includes('TH'));
    });

    it('should use defaults when no args provided', () => {
      const result = getPromptMessages('find_hotels_in_city');

      assert.ok(result.description.includes('the specified city'));
      assert.ok(result.messages[0].content.text.includes('New York'));
      assert.ok(result.messages[0].content.text.includes('US'));
    });
  });

  describe('find_restaurants_nearby', () => {
    it('should return prompt with provided coordinates', () => {
      const result = getPromptMessages('find_restaurants_nearby', {
        latitude: '13.7563',
        longitude: '100.5018',
        radius_km: '2',
      });

      assert.ok(result.description.includes('13.7563'));
      assert.ok(result.description.includes('100.5018'));
      assert.ok(result.messages[0].content.text.includes('13.7563'));
      assert.ok(result.messages[0].content.text.includes('100.5018'));
      assert.ok(result.messages[0].content.text.includes('2'));
    });

    it('should use default coordinates when no args', () => {
      const result = getPromptMessages('find_restaurants_nearby');

      assert.ok(result.messages[0].content.text.includes('40.7580'));
      assert.ok(result.messages[0].content.text.includes('-73.9855'));
      assert.ok(result.messages[0].content.text.includes('1'));
    });
  });

  describe('find_attractions', () => {
    it('should return prompt with provided city', () => {
      const result = getPromptMessages('find_attractions', {
        city: 'Paris',
        country_code: 'FR',
      });

      assert.ok(result.description.includes('Paris'));
      assert.ok(result.messages[0].content.text.includes('Paris'));
      assert.ok(result.messages[0].content.text.includes('FR'));
    });

    it('should use defaults when no args', () => {
      const result = getPromptMessages('find_attractions');

      assert.ok(result.messages[0].content.text.includes('New York'));
    });
  });

  describe('explore_area', () => {
    it('should return prompt with provided city', () => {
      const result = getPromptMessages('explore_area', {
        city: 'Tokyo',
        country_code: 'JP',
      });

      assert.ok(result.description.includes('Tokyo'));
      assert.ok(result.messages[0].content.text.includes('Tokyo'));
      assert.ok(result.messages[0].content.text.includes('JP'));
    });

    it('should use defaults when no args', () => {
      const result = getPromptMessages('explore_area');

      assert.ok(result.messages[0].content.text.includes('New York'));
    });
  });

  describe('find_near_landmark', () => {
    it('should return prompt with landmark and search type', () => {
      const result = getPromptMessages('find_near_landmark', {
        landmark: 'Eiffel Tower',
        search_type: 'restaurants',
      });

      assert.ok(result.description.includes('restaurants'));
      assert.ok(result.description.includes('Eiffel Tower'));
      assert.ok(result.messages[0].content.text.includes('Eiffel Tower'));
      assert.ok(result.messages[0].content.text.includes('search_restaurants'));
    });

    it('should handle hotels search type', () => {
      const result = getPromptMessages('find_near_landmark', {
        landmark: 'Big Ben',
        search_type: 'hotels',
      });

      assert.ok(result.messages[0].content.text.includes('search_hotels'));
    });

    it('should include brand when provided', () => {
      const result = getPromptMessages('find_near_landmark', {
        landmark: 'Central Park',
        search_type: 'restaurants',
        brand: 'Starbucks',
      });

      assert.ok(result.description.includes('Starbucks'));
      assert.ok(result.messages[0].content.text.includes('Starbucks'));
    });

    it('should use defaults when no args', () => {
      const result = getPromptMessages('find_near_landmark');

      assert.ok(result.messages[0].content.text.includes('Empire State Building'));
    });
  });

  describe('unknown prompt', () => {
    it('should return unknown prompt message', () => {
      const result = getPromptMessages('nonexistent_prompt');

      assert.strictEqual(result.description, 'Unknown prompt');
      assert.ok(result.messages[0].content.text.includes('Unknown prompt: nonexistent_prompt'));
      assert.ok(result.messages[0].content.text.includes('find_hotels_in_city'));
    });
  });
});

// =============================================================================
// getToolsConfig
// =============================================================================

describe('getToolsConfig', () => {
  it('should return an array of tools', () => {
    const tools = getToolsConfig('https://example.com');
    assert.ok(Array.isArray(tools));
    assert.ok(tools.length > 0);
  });

  it('should add widgetDomain to tools with outputTemplate', () => {
    const domain = 'https://mcp.example.com';
    const tools = getToolsConfig(domain);

    const uiTools = tools.filter(t => t._meta?.['openai/widgetDomain']);
    assert.ok(uiTools.length > 0, 'Should have UI tools with widgetDomain');

    for (const tool of uiTools) {
      assert.strictEqual(tool._meta['openai/widgetDomain'], domain);
    }
  });

  it('should add CSP with frame_domains for poi-details tools', () => {
    const tools = getToolsConfig('https://example.com');

    const poiDetailsTool = tools.find(
      t => t._meta?.['openai/outputTemplate']?.includes('poi-details'),
    );
    assert.ok(poiDetailsTool, 'Should have a poi-details tool');
    assert.deepStrictEqual(
      poiDetailsTool._meta['openai/widgetCSP'].frame_domains,
      ['https://maps.google.com'],
    );
  });

  it('should add CSP with empty frame_domains for non-poi-details UI tools', () => {
    const tools = getToolsConfig('https://example.com');

    const searchResultsTool = tools.find(
      t => t._meta?.['openai/outputTemplate']?.includes('search-results'),
    );
    assert.ok(searchResultsTool, 'Should have a search-results tool');
    assert.deepStrictEqual(
      searchResultsTool._meta['openai/widgetCSP'].frame_domains,
      [],
    );
  });

  it('should not add widgetDomain to tools without outputTemplate', () => {
    const tools = getToolsConfig('https://example.com');

    // search_cities has no outputTemplate
    const searchCities = tools.find(t => t.name === 'search_cities');
    assert.ok(searchCities, 'Should have search_cities tool');
    assert.strictEqual(searchCities._meta?.['openai/widgetDomain'], undefined);
  });

  it('should preserve original tool properties', () => {
    const tools = getToolsConfig('https://example.com');

    for (const tool of tools) {
      assert.ok(tool.name, 'Each tool should have a name');
      assert.ok(tool.description, 'Each tool should have a description');
      assert.ok(tool.inputSchema, 'Each tool should have an inputSchema');
    }
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

  describe('static resources', () => {
    it('should include version resource', () => {
      const config = getResourcesConfig(domain);
      const version = config.resources.find(r => r.uri === 'info://version');

      assert.ok(version);
      assert.strictEqual(version.mimeType, 'application/json');
    });

    it('should include random-poi resource', () => {
      const config = getResourcesConfig(domain);
      const randomPoi = config.resources.find(r => r.uri === 'info://random-poi');

      assert.ok(randomPoi);
      assert.strictEqual(randomPoi.mimeType, 'application/json');
    });

    it('should include sample queries resource', () => {
      const config = getResourcesConfig(domain);
      const samples = config.resources.find(r => r.uri === 'samples://queries');

      assert.ok(samples);
      assert.strictEqual(samples.mimeType, 'application/json');
    });
  });

  describe('resource templates', () => {
    it('should include poi-details widget template', () => {
      const config = getResourcesConfig(domain);
      const poiDetails = config.resourceTemplates.find(
        r => r.uriTemplate === 'ui://widget/poi-details.html',
      );

      assert.ok(poiDetails);
      assert.strictEqual(poiDetails.mimeType, 'text/html+skybridge');
      assert.strictEqual(poiDetails._meta['openai/widgetDomain'], domain);
      assert.deepStrictEqual(
        poiDetails._meta['openai/widgetCSP'].frame_domains,
        ['https://maps.google.com'],
      );
    });

    it('should include search-results widget template', () => {
      const config = getResourcesConfig(domain);
      const searchResults = config.resourceTemplates.find(
        r => r.uriTemplate === 'ui://widget/search-results.html',
      );

      assert.ok(searchResults);
      assert.strictEqual(searchResults.mimeType, 'text/html+skybridge');
      assert.strictEqual(searchResults._meta['openai/widgetDomain'], domain);
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
      assert.strictEqual(nearby.mimeType, 'text/html+skybridge');
      assert.strictEqual(nearby._meta['openai/widgetDomain'], domain);
    });

    it('should include poi by ID template', () => {
      const config = getResourcesConfig(domain);
      const poiById = config.resourceTemplates.find(
        r => r.uriTemplate === 'ui://poi/{osm_id}',
      );

      assert.ok(poiById);
      assert.strictEqual(poiById.mimeType, 'text/html+skybridge');
      assert.strictEqual(poiById._meta['openai/widgetDomain'], domain);
      assert.deepStrictEqual(
        poiById._meta['openai/widgetCSP'].frame_domains,
        ['https://maps.google.com'],
      );
    });

    it('should use the provided widget domain for all templates', () => {
      const customDomain = 'https://custom.example.org';
      const config = getResourcesConfig(customDomain);

      for (const template of config.resourceTemplates) {
        assert.strictEqual(
          template._meta['openai/widgetDomain'],
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
