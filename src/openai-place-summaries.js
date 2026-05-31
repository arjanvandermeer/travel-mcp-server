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
  const toolsLabel = toolNames(tools);
  const tags = {
    provider: 'openai',
    source: 'ai_place_summary',
    operation,
    model,
    tools: toolsLabel,
    status,
  };
  telemetry.incrementCounter('openai.api_requests', 1, tags);
  telemetry.recordDistribution('openai.api_latency', durationMs, { tags, unit: 'millisecond' });

  if (usage) {
    const usageTags = {
      provider: 'openai',
      source: 'ai_place_summary',
      operation,
      model,
      tools: toolsLabel,
    };
    if (Number.isFinite(usage.input_tokens)) {
      telemetry.incrementCounter('openai.tokens', usage.input_tokens, { ...usageTags, token_type: 'input' });
    }
    if (Number.isFinite(usage.output_tokens)) {
      telemetry.incrementCounter('openai.tokens', usage.output_tokens, { ...usageTags, token_type: 'output' });
    }
    if (Number.isFinite(usage.total_tokens)) {
      telemetry.incrementCounter('openai.tokens', usage.total_tokens, { ...usageTags, token_type: 'total' });
    }
  }

  if (status === 'error') {
    const errorTags = {
      ...tags,
      error_name: error?.name || 'Error',
    };
    telemetry.incrementCounter('openai.api_errors', 1, errorTags);
    telemetry.captureLog('OpenAI API request failed', 'warn', {
      ...errorTags,
      error: error?.message,
      durationMs,
    }, {
      breadcrumbCategory: 'metric',
    });
  }
}

function openAISpanAttributes(operation, model, tools = []) {
  return {
    provider: 'openai',
    source: 'ai_place_summary',
    operation,
    model,
    tools: toolNames(tools),
    'ai.provider': 'openai',
    'ai.model_id': model,
    'ai.operation': 'responses.create',
  };
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
      const response = await telemetry.withSpan(
        `OpenAI ${operation}`,
        'ai.openai',
        openAISpanAttributes(operation, model, tools),
        async (span) => {
          const result = await openai.responses.create({
            model,
            input,
            tools,
            store: false,
            reasoning: { effort: 'minimal' },
            text: { verbosity: 'low' },
            max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
          });
          telemetry.setSpanAttributes(span, {
            'ai.usage.input_tokens': result?.usage?.input_tokens,
            'ai.usage.output_tokens': result?.usage?.output_tokens,
            'ai.usage.total_tokens': result?.usage?.total_tokens,
          });
          return result;
        },
      );
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
            content: [
              'You summarize traveler reviews for a travel app.',
              'Write visitor-facing copy about what guests experience, not a database description.',
              'Do not repeat the place name, city, street, neighborhood, country, or exact location.',
              'Avoid meta phrases such as "available public footprint", "business record", "reviews indicate", or "the data suggests".',
              'Be balanced, concrete, and useful. Do not invent facts.',
              'Return exactly 2-3 concise sentences and no bullets.',
            ].join(' '),
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
            content: [
              'You inspect official property websites for a travel app.',
              'Use web search/opening only for the provided URL.',
              'Write visitor-facing copy about the experience, menu/services, amenities, vibe, and practical reasons to choose it.',
              'Do not repeat the place name, city, street, neighborhood, country, or exact location.',
              'Avoid meta phrases such as "available public footprint", "business record", "official site says", or "the website presents itself".',
              'If the homepage is thin, summarize only concrete visitor-relevant facts and do not talk about missing information.',
              'Return exactly 2-3 concise sentences and no bullets.',
            ].join(' '),
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
