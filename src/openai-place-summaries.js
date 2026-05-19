import { sanitizeHttpUrl } from './url-utils.js';
import OpenAI from 'openai';

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

export function createOpenAIPlaceSummarizer({
  apiKey,
  client,
  model = DEFAULT_MODEL,
} = {}) {
  if (!client && !apiKey) {
    throw new Error('OpenAI API key is required for place summaries');
  }

  const openai = client || new OpenAI({ apiKey });

  async function createResponse({ input, tools = [] }) {
    const response = await openai.responses.create({
      model,
      input,
      tools,
      store: false,
      reasoning: { effort: 'minimal' },
      text: { verbosity: 'low' },
      max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    });
    return extractResponseText(response);
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
