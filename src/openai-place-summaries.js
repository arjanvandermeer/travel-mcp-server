import { sanitizeHttpUrl } from './url-utils.js';
import OpenAI from 'openai';
import * as telemetry from './telemetry.js';

const DEFAULT_MODEL = 'gpt-5-mini';
const DEFAULT_MAX_OUTPUT_TOKENS = 1000;

function compactText(value, maxLength = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function extractResponseText(response) {
  if (typeof response?.output_text === 'string') return response.output_text.trim();
  for (const item of response?.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (typeof content.text === 'string') return content.text.trim();
    }
  }
  return '';
}

function toolNames(tools = []) {
  return tools.map(tool => tool?.type).filter(Boolean).join(',') || 'none';
}

function recordOpenAIRequest({ operation, model, tools, status, durationMs, usage = null, error = null }) {
  const tags = {
    provider: 'openai',
    source: 'ai_place_summary',
    operation,
    model,
    tools: toolNames(tools),
    status,
  };
  telemetry.incrementCounter('openai.api_requests', 1, tags);
  telemetry.captureMetricEvent('openai.api_requests', 1, tags, {
    durationMs,
    usage,
    error: error?.message,
  });

  if (status === 'error') {
    telemetry.incrementCounter('openai.api_errors', 1, { ...tags, error_name: error?.name || 'Error' });
    telemetry.captureMetricEvent('openai.api_errors', 1, {
      ...tags,
      error_name: error?.name || 'Error',
    }, {
      durationMs,
      error: error?.message,
    });
  }
}

export function createOpenAIPlaceSummarizer({
  apiKey,
  client,
  model = DEFAULT_MODEL,
} = {}) {
  if (!client && !apiKey) {
    throw new Error('OpenAI API key is required for place summaries');
  }

  const openai = client || new OpenAI({ apiKey });

  async function createResponse({ operation, input, tools = [] }) {
    const startedAt = Date.now();
    try {
      const response = await openai.responses.create({
        model,
        input,
        tools,
        store: false,
        reasoning: { effort: 'minimal' },
        text: { verbosity: 'low' },
        max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
      });
      recordOpenAIRequest({
        operation,
        model,
        tools,
        status: 'success',
        durationMs: Date.now() - startedAt,
        usage: response?.usage || null,
      });
      return extractResponseText(response);
    } catch (error) {
      recordOpenAIRequest({
        operation,
        model,
        tools,
        status: 'error',
        durationMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }

  return {
    model,

    async summarizeReviews(place) {
      const reviews = Array.isArray(place.reviews) ? place.reviews : [];
      const reviewText = reviews
        .map(review => ({
          rating: review.rating ?? null,
          text: compactText(review.text?.text || review.text || review.originalText?.text, 800),
        }))
        .filter(review => review.text);

      if (reviewText.length === 0) return null;

      return createResponse({
        operation: 'review_summary',
        input: [
          {
            role: 'system',
            content: 'You summarize traveler reviews for a travel app. Be balanced, concrete, and useful. Do not invent facts. Return exactly 2-3 concise sentences and no bullets.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              place: {
                name: place.name,
                type: place.primary_type || place.poi_type,
                city: place.city,
                rating: place.rating,
                review_count: place.user_rating_count,
              },
              reviews: reviewText,
            }),
          },
        ],
      });
    },

    async summarizeHomepage(place) {
      const homepageUrl = sanitizeHttpUrl(place.website_uri) || sanitizeHttpUrl(place.osm_website);
      if (!homepageUrl) return null;

      const summary = await createResponse({
        operation: 'homepage_summary',
        tools: [{ type: 'web_search' }],
        input: [
          {
            role: 'system',
            content: 'You inspect official property websites for a travel app. Use web search/opening only for the provided URL. Return exactly 2-3 concise sentences. Prefer factual details about the property experience, facilities, location, and booking-relevant traits. Do not mention inability unless the page cannot be accessed.',
          },
          {
            role: 'user',
            content: `Open and summarize this official property homepage: ${homepageUrl}\nProperty name: ${place.name || 'unknown'}\nAddress: ${place.formatted_address || 'unknown'}`,
          },
        ],
      });

      return { summary, url: homepageUrl };
    },
  };
}
