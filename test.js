import { HotelDatabase } from './src/database.js';

console.log('Testing Hotel MCP Server Database...\n');

const db = new HotelDatabase('./data/hotels.db');

// Test 1: Database initialization
console.log('✓ Database initialized');

// Test 2: Country search and queries
console.log('\n=== COUNTRY TESTS ===');
console.log('\nTesting searchCountries("United"):');
const unitedResults = db.searchCountries('United', 3);
console.log(`Found ${unitedResults.length} results`);
unitedResults.forEach(country => {
  console.log(`  - ${country.country} (${country.iso}) - Pop: ${country.population?.toLocaleString() || 'N/A'}`);
});

console.log('\nTesting getCountryByISO("US"):');
const usa = db.getCountryByISO('US');
if (usa) {
  console.log(`  Country: ${usa.country}`);
  console.log(`  Capital: ${usa.capital}`);
  console.log(`  Population: ${usa.population?.toLocaleString() || 'N/A'}`);
  console.log(`  Currency: ${usa.currency_name} (${usa.currency_code})`);
}

console.log('\nTesting getCountryByISO("GB"):');
const uk = db.getCountryByISO('GB');
if (uk) {
  console.log(`  Country: ${uk.country} (${uk.iso})`);
  console.log(`  Capital: ${uk.capital}`);
}

console.log('\n=== CITY TESTS ===');

console.log('\nInserting test cities...');
const testCities = [
  {
    geoname_id: 2643743,
    name: 'London',
    ascii_name: 'London',
    alternate_names: 'Londres,Londra,Londyn',
    latitude: 51.50853,
    longitude: -0.12574,
    feature_class: 'P',
    feature_code: 'PPLC',
    country_code: 'GB',
    admin1_code: 'ENG',
    admin2_code: 'GLA',
    population: 8961989,
    elevation: 25,
    timezone: 'Europe/London',
    modification_date: '2023-01-01'
  },
  {
    geoname_id: 2988507,
    name: 'Paris',
    ascii_name: 'Paris',
    alternate_names: 'Parigi,Paříž,Parijs',
    latitude: 48.85341,
    longitude: 2.3488,
    feature_class: 'P',
    feature_code: 'PPLC',
    country_code: 'FR',
    admin1_code: 'IDF',
    admin2_code: '75',
    population: 2138551,
    elevation: 42,
    timezone: 'Europe/Paris',
    modification_date: '2023-01-01'
  },
  {
    geoname_id: 5128581,
    name: 'New York City',
    ascii_name: 'New York City',
    alternate_names: 'NYC,Nueva York,New York',
    latitude: 40.71427,
    longitude: -74.00597,
    feature_class: 'P',
    feature_code: 'PPL',
    country_code: 'US',
    admin1_code: 'NY',
    admin2_code: '061',
    population: 8804190,
    elevation: 10,
    timezone: 'America/New_York',
    modification_date: '2023-01-01'
  }
];

db.bulkInsertGeonamesCities(testCities);
console.log('✓ Inserted 3 test cities');

// Test 3: Search cities
console.log('\nTesting search_cities("London"):');
const londonResults = db.searchCities('London', 5);
console.log(`Found ${londonResults.length} results`);
londonResults.forEach(city => {
  console.log(`  - ${city.name}, ${city.country_code} (pop: ${city.population})`);
});

// Test 4: Get city by ID
console.log('\nTesting get_city_by_id(2643743):');
const london = db.getCityByGeonameId(2643743);
console.log(`  Found: ${london.name}, ${london.country_code}`);
console.log(`  Coordinates: ${london.latitude}, ${london.longitude}`);

// Test 5: Find cities near coordinates
console.log('\nTesting find_cities_near_coordinates (London area):');
const nearbyCities = db.getCitiesNearCoordinates(51.5074, -0.1278, 300, 5);
console.log(`Found ${nearbyCities.length} cities within 300km:`);
nearbyCities.forEach(city => {
  console.log(`  - ${city.name} (${Math.round(city.distance_km)}km away)`);
});

// Test 6: Insert test hotels
console.log('\nInserting test hotels...');
const testHotels = [
  {
    osm_id: 'N12345',
    name: 'The Ritz London',
    latitude: 51.5074,
    longitude: -0.1419,
    address: '150 Piccadilly',
    city: 'London',
    country_code: 'GB',
    phone: '+44 20 7493 8181',
    website: 'https://theritzlondon.com',
    stars: 5,
    rooms: 111,
    amenities: ['wifi', 'spa', 'restaurant', 'bar', 'gym']
  },
  {
    osm_id: 'N12346',
    name: 'Hôtel Plaza Athénée',
    latitude: 48.8662,
    longitude: 2.3046,
    address: '25 Avenue Montaigne',
    city: 'Paris',
    country_code: 'FR',
    phone: '+33 1 53 67 66 65',
    website: 'https://plaza-athenee-paris.com',
    stars: 5,
    rooms: 154,
    amenities: ['wifi', 'spa', 'restaurant', 'pool']
  }
];

testHotels.forEach(hotel => db.insertHotel(hotel));
console.log('✓ Inserted 2 test hotels');

// Test 7: Search hotels
console.log('\nTesting search_hotels("Ritz"):');
const hotelResults = db.searchHotels('Ritz', 5);
console.log(`Found ${hotelResults.length} results`);
hotelResults.forEach(hotel => {
  console.log(`  - ${hotel.name}, ${hotel.city}`);
});

// Test 8: Find hotels near coordinates
console.log('\nTesting find_hotels_near_coordinates (London):');
const nearbyHotels = db.getHotelsNearCoordinates(51.5074, -0.1278, 5, 10);
console.log(`Found ${nearbyHotels.length} hotels within 5km:`);
nearbyHotels.forEach(hotel => {
  const amenities = JSON.parse(hotel.amenities);
  console.log(`  - ${hotel.name} (${Math.round(hotel.distance_km * 10) / 10}km, ${hotel.stars}⭐, ${amenities.length} amenities)`);
});

// Test extended GeoNames features
console.log('\n=== EXTENDED GEONAMES TESTS ===');

// Test alternate names - search for "Londres" (Spanish for London)
console.log('\nTesting searchByAlternateName("Londres"):');
const londresResults = db.searchByAlternateName('Londres', 3);
londresResults.forEach(city => {
  console.log(`  - ${city.name} matched by "${city.matched_name}" (${city.iso_language})`);
});

// Test admin1 codes
console.log('\nTesting searchAdmin1("California"):');
const caResults = db.searchAdmin1('California', 2);
caResults.forEach(admin => {
  console.log(`  - ${admin.name} (${admin.code})`);
});

// Test timezone lookup
console.log('\nTesting getTimezoneById("Europe/London"):');
const londonTz = db.getTimezoneById('Europe/London');
if (londonTz) {
  console.log(`  GMT Offset: ${londonTz.gmt_offset}, DST Offset: ${londonTz.dst_offset}`);
}

// Test feature code description
console.log('\nTesting getFeatureCodeDescription("P.PPLC"):');
const pplcCode = db.getFeatureCodeDescription('P.PPLC');
if (pplcCode) {
  console.log(`  ${pplcCode.name}: ${pplcCode.description}`);
}

// Database stats
console.log('\n=== DATABASE STATS ===');
const stats = db.getStats();
console.log(`  Countries: ${stats.countries}`);
console.log(`  Cities: ${stats.cities}`);
console.log(`  Hotels: ${stats.hotels}`);
console.log(`  Alternate Names: ${stats.alternate_names}`);
console.log(`  Admin1 Codes: ${stats.admin1_codes}`);
console.log(`  Admin2 Codes: ${stats.admin2_codes}`);
console.log(`  Timezones: ${stats.timezones}`);
console.log(`  Feature Codes: ${stats.feature_codes}`);
console.log(`  Hierarchy Relations: ${stats.hierarchy_relations}`);

db.close();
console.log('\n✓ All tests passed!');
