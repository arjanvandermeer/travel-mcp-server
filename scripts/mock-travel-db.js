export function createMockTravelDb(overrides = {}) {
  const db = {
    getServerBaseUrl: async () => 'http://localhost',
    getConfigCached: async () => null,
    setConfig: async () => {},
    getStats: async () => ({
      countries: 1,
      cities: 1,
      pois: 0,
      poi_types: {},
    }),
    searchCities: async () => [],
    searchPOIs: async () => [],
    searchPOIsNearCoordinates: async () => [],
    getCityByName: async (cityName, countryCode) => {
      if (String(countryCode).toUpperCase() !== 'GB') return null;
      return {
        name: cityName,
        country_code: 'GB',
        latitude: 51.5074,
        longitude: -0.1278,
        population: 8982000,
      };
    },
    getRadiusForPopulation: () => 15,
    getPOIDetails: async () => null,
    addFavoriteStatus: async pois => pois,
    listFavorites: async () => [],
    addFavorite: async () => false,
    updateFavoriteNotes: async () => false,
    removeFavorite: async () => false,
  };

  return { ...db, ...overrides };
}
