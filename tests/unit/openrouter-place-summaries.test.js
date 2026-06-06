import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterPlaceSummarizer } from '../../src/openrouter-place-summaries.js';

function createClient(calls) {
  return {
    chat: {
      completions: {
        create: async (payload) => {
          calls.push(payload);
          return {
            choices: [{
              message: {
                content: 'Guests praise the warm service and comfortable rooms, with occasional noise concerns.',
              },
            }],
            usage: { prompt_tokens: 20, completion_tokens: 18, total_tokens: 38 },
          };
        },
      },
    },
  };
}

describe('createOpenRouterPlaceSummarizer', () => {
  it('summarizes reviews with OpenRouter chat completions', async () => {
    const calls = [];
    const summarizer = createOpenRouterPlaceSummarizer({
      client: createClient(calls),
      model: 'openrouter/auto',
    });

    const summary = await summarizer.summarizeReviews({
      name: 'Grand Hotel',
      primary_type: 'lodging',
      rating: 4.5,
      user_rating_count: 120,
      reviews: [{ rating: 5, text: 'Excellent staff and a great breakfast.' }],
    });

    assert.match(summary, /Guests praise/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'openrouter/auto');
    assert.equal(calls[0].temperature, 0.2);
    assert.equal(calls[0].max_tokens, 1000);
    assert.ok(!('tools' in calls[0]));
    assert.match(calls[0].messages[0].content, /2-3 concise sentences/);
    assert.match(calls[0].messages[0].content, /Do not repeat the place name, city, street, neighborhood, country, or exact location/);
    assert.match(calls[0].messages[0].content, /available public footprint/);
  });

  it('fetches homepage text before summarizing homepage content', async () => {
    const calls = [];
    const fetchedUrls = [];
    const summarizer = createOpenRouterPlaceSummarizer({
      client: createClient(calls),
      model: 'openrouter/auto',
      homepageFetcher: async (url) => {
        fetchedUrls.push(url);
        return '<html><body><h1>Fresh breakfast</h1><script>ignore()</script><p>Rooftop pool and quiet rooms.</p></body></html>';
      },
    });

    const result = await summarizer.summarizeHomepage({
      name: 'Grand Hotel',
      website_uri: 'https://example.com/hotel',
    });

    assert.equal(result.url, 'https://example.com/hotel');
    assert.deepEqual(fetchedUrls, ['https://example.com/hotel']);
    assert.match(result.summary, /Guests praise/);
    assert.match(calls[0].messages[1].content, /https:\/\/example.com\/hotel/);
    assert.match(calls[0].messages[1].content, /Rooftop pool/);
    assert.match(calls[0].messages[0].content, /visitor-facing copy/);
    assert.match(calls[0].messages[0].content, /Do not repeat the place name, city, street, neighborhood, country, or exact location/);
    assert.match(calls[0].messages[0].content, /available public footprint/);
  });

  it('returns null when no review text or homepage URL/content is available', async () => {
    const calls = [];
    const summarizer = createOpenRouterPlaceSummarizer({
      client: createClient(calls),
      model: 'openrouter/auto',
      homepageFetcher: async () => '',
    });

    assert.equal(await summarizer.summarizeReviews({ reviews: [] }), null);
    assert.equal(await summarizer.summarizeHomepage({ website_uri: 'javascript:alert(1)' }), null);
    assert.equal(await summarizer.summarizeHomepage({ website_uri: 'https://example.com/empty' }), null);
    assert.equal(calls.length, 0);
  });

  it('propagates OpenRouter request errors after telemetry capture', async () => {
    const summarizer = createOpenRouterPlaceSummarizer({
      client: {
        chat: {
          completions: {
            create: async () => {
              throw new Error('OpenRouter unavailable');
            },
          },
        },
      },
      model: 'openrouter/auto',
    });

    await assert.rejects(
      () => summarizer.summarizeReviews({
        reviews: [{ rating: 4, text: 'Helpful staff.' }],
      }),
      /OpenRouter unavailable/,
    );
  });
});
