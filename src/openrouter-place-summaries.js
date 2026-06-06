import { sanitizeHttpUrl } from './url-utils.js';
import OpenAI from 'openai';
import * as telemetry from './telemetry.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openrouter/auto';
const DEFAULT_MAX_TOKENS = 1000;
const HOMEPAGE_FETCH_TIMEOUT_MS = 10000;
const HOMEPAGE_TEXT_LIMIT = 12000;

function compactText(value, maxLength = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function extractChatCompletionText(response) {
  return String(response?.choices?.[0]?.message?.content || '').trim();
}

function normalizeUsage(usage = null) {
  if (!usage) return null;
  return {
    input_tokens: usage.prompt_tokens ?? usage.input_tokens,
    output_tokens: usage.completion_tokens ?? usage.output_tokens,
    total_tokens: usage.total_tokens,
  };
}

function decodeHtmlEntities(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtmlToText(html) {
  return compactText(
    String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z0-9#]+;/gi, match => decodeHtmlEntities(match)),
    HOMEPAGE_TEXT_LIMIT,
  );
}

function getAttr(tag, attrName) {
  const pattern = new RegExp(`${attrName}\\s*=\\s*["']([^"']+)["']`, 'i');
  return tag.match(pattern)?.[1] || '';
}

function absoluteHttpUrl(value, baseUrl) {
  const cleaned = decodeHtmlEntities(String(value || '').trim());
  if (!cleaned || cleaned.startsWith('data:')) return '';
  try {
    return sanitizeHttpUrl(new URL(cleaned, baseUrl).href);
  } catch {
    return '';
  }
}

function extractMetaContent(html, matcher) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (matcher(tag)) return decodeHtmlEntities(getAttr(tag, 'content'));
  }
  return '';
}

export function extractHomepageHarvest(html, baseUrl) {
  const title = decodeHtmlEntities(String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const metaDescription = extractMetaContent(html, tag =>
    /name\s*=\s*["']description["']/i.test(tag) ||
    /property\s*=\s*["']og:description["']/i.test(tag)
  );
  const imageUrls = [];
  const addImage = (url) => {
    if (!url || imageUrls.includes(url)) return;
    imageUrls.push(url);
  };

  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    if (/property\s*=\s*["'](?:og:image|og:image:secure_url)["']/i.test(tag)) {
      addImage(absoluteHttpUrl(getAttr(tag, 'content'), baseUrl));
    }
  }

  for (const tag of String(html || '').match(/<img\b[^>]*>/gi) || []) {
    addImage(absoluteHttpUrl(getAttr(tag, 'src'), baseUrl));
    const srcset = getAttr(tag, 'srcset');
    if (srcset) {
      const firstCandidate = srcset.split(',')[0]?.trim().split(/\s+/)[0];
      addImage(absoluteHttpUrl(firstCandidate, baseUrl));
    }
  }

  return {
    textContent: stripHtmlToText(html),
    title: compactText(title, 300),
    metaDescription: compactText(metaDescription, 500),
    imageUrls: imageUrls.slice(0, 20),
  };
}

export async function fetchHomepageHarvest(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') return '';
  const Controller = globalThis.AbortController;
  const controller = typeof Controller === 'function' ? new Controller() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), HOMEPAGE_FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(url, {
      signal: controller?.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'user-agent': 'travel-mcp-server/1.1 (+https://travel.arjanvandermeer.com)',
      },
    });
    const contentType = response.headers?.get?.('content-type') || '';
    const body = await response.text();
    const finalUrl = sanitizeHttpUrl(response.url || url) || url;
    if (!response.ok) {
      return {
        originalUrl: url,
        finalUrl,
        fetchStatus: 'error',
        httpStatus: response.status || null,
        contentType,
        textContent: '',
        title: '',
        metaDescription: '',
        imageUrls: [],
        error: `HTTP ${response.status || 'error'}`,
      };
    }
    const harvested = contentType.includes('text/plain')
      ? {
          textContent: compactText(body, HOMEPAGE_TEXT_LIMIT),
          title: '',
          metaDescription: '',
          imageUrls: [],
        }
      : extractHomepageHarvest(body, finalUrl);
    return {
      originalUrl: url,
      finalUrl,
      fetchStatus: harvested.textContent || harvested.imageUrls.length > 0 ? 'completed' : 'empty',
      httpStatus: response.status || null,
      contentType,
      ...harvested,
      error: null,
    };
  } catch (error) {
    return {
      originalUrl: url,
      finalUrl: url,
      fetchStatus: 'error',
      httpStatus: null,
      contentType: '',
      textContent: '',
      title: '',
      metaDescription: '',
      imageUrls: [],
      error: error.message || 'Homepage fetch failed',
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchHomepageText(url, fetchImpl = globalThis.fetch) {
  const harvested = await fetchHomepageHarvest(url, fetchImpl);
  return typeof harvested === 'string' ? harvested : harvested.textContent || '';
}

function recordOpenRouterRequest({ operation, model, status, durationMs, usage = null, error = null }) {
  const tags = {
    provider: 'openrouter',
    source: 'ai_place_summary',
    operation,
    model,
    status,
  };
  telemetry.incrementCounter('openrouter.api_requests', 1, tags);
  telemetry.recordDistribution('openrouter.api_latency', durationMs, { tags, unit: 'millisecond' });

  if (usage) {
    const usageTags = {
      provider: 'openrouter',
      source: 'ai_place_summary',
      operation,
      model,
    };
    if (Number.isFinite(usage.input_tokens)) {
      telemetry.incrementCounter('openrouter.tokens', usage.input_tokens, { ...usageTags, token_type: 'input' });
    }
    if (Number.isFinite(usage.output_tokens)) {
      telemetry.incrementCounter('openrouter.tokens', usage.output_tokens, { ...usageTags, token_type: 'output' });
    }
    if (Number.isFinite(usage.total_tokens)) {
      telemetry.incrementCounter('openrouter.tokens', usage.total_tokens, { ...usageTags, token_type: 'total' });
    }
  }

  if (status === 'error') {
    const errorTags = {
      ...tags,
      error_name: error?.name || 'Error',
    };
    telemetry.incrementCounter('openrouter.api_errors', 1, errorTags);
    telemetry.captureLog('OpenRouter API request failed', 'warn', {
      ...errorTags,
      error: error?.message,
      durationMs,
    }, {
      breadcrumbCategory: 'metric',
    });
  }
}

function openRouterSpanAttributes(operation, model) {
  return {
    provider: 'openrouter',
    source: 'ai_place_summary',
    operation,
    model,
    'ai.provider': 'openrouter',
    'ai.model_id': model,
    'ai.operation': 'chat.completions.create',
  };
}

export function createOpenRouterPlaceSummarizer({
  apiKey,
  client,
  model = DEFAULT_MODEL,
  homepageFetcher = fetchHomepageText,
} = {}) {
  if (!client && !apiKey) {
    throw new Error('OpenRouter API key is required for place summaries');
  }

  const openrouter = client || new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || process.env.SERVER_BASE_URL || 'https://travel.arjanvandermeer.com',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'Travel MCP Server',
    },
  });

  async function createCompletion({ operation, messages }) {
    const startedAt = Date.now();
    try {
      const response = await telemetry.withSpan(
        `OpenRouter ${operation}`,
        'ai.openrouter',
        openRouterSpanAttributes(operation, model),
        async (span) => {
          const result = await openrouter.chat.completions.create({
            model,
            messages,
            temperature: 0.2,
            max_tokens: DEFAULT_MAX_TOKENS,
          });
          telemetry.setSpanAttributes(span, {
            'ai.usage.input_tokens': result?.usage?.prompt_tokens,
            'ai.usage.output_tokens': result?.usage?.completion_tokens,
            'ai.usage.total_tokens': result?.usage?.total_tokens,
          });
          return result;
        },
      );
      recordOpenRouterRequest({
        operation,
        model,
        status: 'success',
        durationMs: Date.now() - startedAt,
        usage: normalizeUsage(response?.usage),
      });
      return extractChatCompletionText(response);
    } catch (error) {
      recordOpenRouterRequest({
        operation,
        model,
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

      return createCompletion({
        operation: 'review_summary',
        messages: [
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
      const homepageUrl = sanitizeHttpUrl(place.homepage_url) || sanitizeHttpUrl(place.website_uri) || sanitizeHttpUrl(place.osm_website);
      if (!homepageUrl) return null;

      const homepageSource = place.homepage_text || await homepageFetcher(homepageUrl);
      const homepageText = compactText(typeof homepageSource === 'string' ? homepageSource : homepageSource?.textContent, 6000);
      if (!homepageText) return null;

      const summary = await createCompletion({
        operation: 'homepage_summary',
        messages: [
          {
            role: 'system',
            content: [
              'You summarize official property homepage content for a travel app.',
              'Write visitor-facing copy about the experience, menu/services, amenities, vibe, and practical reasons to choose it.',
              'Do not repeat the place name, city, street, neighborhood, country, or exact location.',
              'Avoid meta phrases such as "available public footprint", "business record", "official site says", or "the website presents itself".',
              'If the homepage is thin, summarize only concrete visitor-relevant facts and do not talk about missing information.',
              'Return exactly 2-3 concise sentences and no bullets.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              homepage_url: homepageUrl,
              place: {
                name: place.name,
                type: place.primary_type || place.poi_type,
                address: place.formatted_address,
              },
              homepage_text: homepageText,
            }),
          },
        ],
      });

      return { summary, url: homepageUrl };
    },
  };
}
