import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIPlaceSummarizer } from '../../src/openai-place-summaries.js';

function createClient(calls) {
  return {
    responses: {
      create: async (payload) => {
        calls.push(payload);
        return {
          output_text: 'Guests praise the warm service and central location. Rooms are described as comfortable, with occasional noise concerns.',
          usage: { input_tokens: 20, output_tokens: 18, total_tokens: 38 },
        };
      },
    },
  };
}

describe('createOpenAIPlaceSummarizer', () => {
  it('summarizes reviews with the OpenAI SDK Responses API', async () => {
    const calls = [];
    const summarizer = createOpenAIPlaceSummarizer({
      client: createClient(calls),
      model: 'gpt-5-mini',
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
    assert.equal(calls[0].model, 'gpt-5-mini');
    assert.equal(calls[0].store, false);
    assert.deepEqual(calls[0].reasoning, { effort: 'minimal' });
    assert.deepEqual(calls[0].text, { verbosity: 'low' });
    assert.equal(calls[0].max_output_tokens, 1000);
    assert.deepEqual(calls[0].tools, []);
    assert.match(calls[0].input[0].content, /2-3 concise sentences/);
    assert.match(calls[0].input[0].content, /Do not repeat the place name, city, street, neighborhood, country, or exact location/);
    assert.match(calls[0].input[0].content, /available public footprint/);
  });

  it('uses web_search for homepage summaries', async () => {
    const calls = [];
    const summarizer = createOpenAIPlaceSummarizer({
      client: createClient(calls),
      model: 'gpt-5-mini',
    });

    const result = await summarizer.summarizeHomepage({
      name: 'Grand Hotel',
      website_uri: 'https://example.com/hotel',
    });

    assert.equal(result.url, 'https://example.com/hotel');
    assert.match(result.summary, /Guests praise/);
    assert.deepEqual(calls[0].tools, [{ type: 'web_search' }]);
    assert.match(calls[0].input[1].content, /https:\/\/example.com\/hotel/);
    assert.match(calls[0].input[0].content, /visitor-facing copy/);
    assert.match(calls[0].input[0].content, /Do not repeat the place name, city, street, neighborhood, country, or exact location/);
    assert.match(calls[0].input[0].content, /available public footprint/);
  });

  it('returns null when no review text or homepage URL is available', async () => {
    const calls = [];
    const summarizer = createOpenAIPlaceSummarizer({
      client: createClient(calls),
      model: 'gpt-5-mini',
    });

    assert.equal(await summarizer.summarizeReviews({ reviews: [] }), null);
    assert.equal(await summarizer.summarizeHomepage({ website_uri: 'javascript:alert(1)' }), null);
    assert.equal(calls.length, 0);
  });

  it('propagates OpenAI request errors after telemetry capture', async () => {
    const summarizer = createOpenAIPlaceSummarizer({
      client: {
        responses: {
          create: async () => {
            throw new Error('OpenAI unavailable');
          },
        },
      },
      model: 'gpt-5-mini',
    });

    await assert.rejects(
      () => summarizer.summarizeReviews({
        reviews: [{ rating: 4, text: 'Helpful staff.' }],
      }),
      /OpenAI unavailable/,
    );
  });
});
