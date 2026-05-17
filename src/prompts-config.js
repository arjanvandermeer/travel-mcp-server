/**
 * MCP prompt templates for common travel search workflows.
 */
export const promptsConfig = [
  {
    name: 'find_hotels_in_city',
    description: 'Search for hotels in a specific city',
    arguments: [
      {
        name: 'city',
        description: 'City name (e.g., "New York")',
        required: true,
      },
      {
        name: 'country_code',
        description: 'Two-letter country code (e.g., "US")',
        required: true,
      },
    ],
  },
  {
    name: 'find_restaurants_nearby',
    description: 'Find restaurants near a specific location using coordinates',
    arguments: [
      {
        name: 'latitude',
        description: 'Latitude coordinate',
        required: true,
      },
      {
        name: 'longitude',
        description: 'Longitude coordinate',
        required: true,
      },
      {
        name: 'radius_km',
        description: 'Search radius in kilometers (default: 1)',
        required: false,
      },
    ],
  },
  {
    name: 'find_attractions',
    description: 'Search for tourist attractions and points of interest',
    arguments: [
      {
        name: 'city',
        description: 'City name (e.g., "New York")',
        required: true,
      },
      {
        name: 'country_code',
        description: 'Two-letter country code (e.g., "US")',
        required: true,
      },
    ],
  },
  {
    name: 'explore_area',
    description: 'Explore all points of interest in an area - hotels, restaurants, and attractions',
    arguments: [
      {
        name: 'city',
        description: 'City name (e.g., "New York")',
        required: true,
      },
      {
        name: 'country_code',
        description: 'Two-letter country code (e.g., "US")',
        required: true,
      },
    ],
  },
  {
    name: 'find_near_landmark',
    description: 'Find restaurants or hotels near a specific landmark using two-step coordinate lookup',
    arguments: [
      {
        name: 'landmark',
        description: 'Landmark name (e.g., "Empire State Building", "Central Park")',
        required: true,
      },
      {
        name: 'search_type',
        description: 'What to search for: "restaurants", "hotels", or "both"',
        required: true,
      },
      {
        name: 'brand',
        description: 'Optional brand/chain name (e.g., "Starbucks", "Marriott")',
        required: false,
      },
    ],
  },
];

/**
 * Generate prompt messages based on prompt name and arguments.
 * Returns the actual prompt content to send to the LLM.
 */
export function getPromptMessages(name, args = {}) {
  switch (name) {
    case 'find_hotels_in_city':
      return {
        description: `Find hotels in ${args.city || 'the specified city'}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please search for hotels in ${args.city || 'New York'}, ${args.country_code || 'US'}. Show me the top results with their ratings and addresses.

Example: The Conrad New York Downtown on Vesey Street is a luxury hotel in Lower Manhattan.`,
            },
          },
        ],
      };

    case 'find_restaurants_nearby':
      return {
        description: `Find restaurants near coordinates (${args.latitude}, ${args.longitude})`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please search for restaurants near latitude ${args.latitude || '40.7580'} and longitude ${args.longitude || '-73.9855'} within ${args.radius_km || '1'} km. Show me the top results with their cuisine type and ratings.

Example: The Rainbow Room at 30 Rockefeller Plaza is an iconic fine dining restaurant in Midtown Manhattan.`,
            },
          },
        ],
      };

    case 'find_attractions':
      return {
        description: `Find tourist attractions in ${args.city || 'the specified city'}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please search for tourist attractions and points of interest in ${args.city || 'New York'}, ${args.country_code || 'US'}. Include museums, monuments, and landmarks.

Example: The Statue of Liberty on Liberty Island is one of the most famous attractions in New York.`,
            },
          },
        ],
      };

    case 'explore_area':
      return {
        description: `Explore ${args.city || 'the specified city'} - hotels, restaurants, and attractions`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please help me explore ${args.city || 'New York'}, ${args.country_code || 'US'}. I'd like to see:
1. Top hotels (e.g., Conrad New York Downtown on Vesey Street)
2. Best restaurants (e.g., The Rainbow Room at Rockefeller Center)
3. Must-see attractions (e.g., Statue of Liberty on Liberty Island)

Please search for each category and give me a summary of the best options.`,
            },
          },
        ],
      };

    case 'find_near_landmark':
      return {
        description: `Find ${args.search_type || 'places'}${args.brand ? ` (${args.brand})` : ''} near ${args.landmark || 'the landmark'}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please find ${args.brand ? args.brand + ' ' : ''}${args.search_type || 'restaurants'} near ${args.landmark || 'Empire State Building'}.

IMPORTANT: Use this two-step workflow:
1. First, use search_pois to find "${args.landmark || 'Empire State Building'}" and get its coordinates (osm_latitude, osm_longitude)
2. Then, use search_${args.search_type === 'hotels' ? 'hotels' : 'restaurants'} with those coordinates${args.brand ? ` and query="${args.brand}"` : ''}

This approach ensures accurate results by first resolving the landmark location, then searching nearby.`,
            },
          },
        ],
      };

    default:
      return {
        description: 'Unknown prompt',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Unknown prompt: ${name}. Available prompts: find_hotels_in_city, find_restaurants_nearby, find_attractions, explore_area, find_near_landmark`,
            },
          },
        ],
      };
  }
}
