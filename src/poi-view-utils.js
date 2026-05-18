import { isGoogleOpenAt } from './lib/opening-hours.js';
import { displayHostname, sanitizeEmailHref, sanitizeHttpUrl, sanitizeHttpUrlList, sanitizePhoneHref, sanitizePoiExternalUrlsArray } from './url-utils.js';

// Shared POI groups used by tools, web APIs, and template rendering.
export const accommodationTypes = [
  'hotel',
  'hostel',
  'guest_house',
  'motel',
  'resort',
  'apartment',
  'camp_site',
  'chalet',
  'bed_and_breakfast',
];
export const foodTypes = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court'];
export const attractionTypes = ['attraction', 'monument', 'museum', 'park', 'viewpoint', 'ruins', 'castle', 'zoo', 'theme_park'];

const nearbyTypeMap = new Map([
  ...accommodationTypes.map(t => [t, foodTypes]),
  ...foodTypes.map(t => [t, accommodationTypes]),
]);

/**
 * Get the nearby result types for a given POI type.
 * Hotels/accommodation -> restaurants/food; restaurants/food -> hotels/accommodation; other -> both.
 */
export function getNearbyTypes(poiType) {
  return nearbyTypeMap.get(poiType) || [...foodTypes, ...accommodationTypes];
}

/**
 * Determine section title based on which types are being shown nearby.
 */
export function getNearbyTitle(resultTypes) {
  const isFood = resultTypes.some(t => foodTypes.includes(t));
  const isAccom = resultTypes.some(t => accommodationTypes.includes(t));
  if (isFood && !isAccom) return 'Nearby Restaurants & Cafes';
  if (isAccom && !isFood) return 'Nearby Hotels';
  return 'Nearby Places';
}

/**
 * Fetch nearby POIs for a given source POI.
 * Returns { nearbyPois, nearbyTitle } or { nearbyPois: null, nearbyTitle: null } if coords missing.
 */
export async function fetchNearbyForPOI(poi, db, userId = null) {
  if (!poi.osm_latitude || !poi.osm_longitude) {
    return { nearbyPois: null, nearbyTitle: null };
  }

  const types = getNearbyTypes(poi.poi_type);
  const nearbyPois = await db.searchPOIsNearCoordinates(
    poi.osm_latitude, poi.osm_longitude,
    1.5, types, 10, userId, [poi.osm_id],
  );

  return { nearbyPois, nearbyTitle: getNearbyTitle(types) };
}

/**
 * Determine if a POI is currently open based on Google Places opening hours periods
 * and the venue's UTC offset.
 *
 * @param {object|null} openingHours - Google Places opening_hours object with periods array
 * @param {number|null} utcOffsetMinutes - The venue's UTC offset in minutes (e.g. 420 for UTC+7)
 * @returns {{ isOpen: boolean, label: string }|null} - null if no hours data available
 */
export function isOpenNow(openingHours, utcOffsetMinutes) {
  const isOpen = isGoogleOpenAt(openingHours, utcOffsetMinutes, new Date());
  if (isOpen === null) {
    return null;
  }

  const isAllDay = openingHours.periods.some(period => period.open && !period.close);
  return { isOpen, label: isOpen ? (isAllDay ? 'Open 24 hours' : 'Open now') : 'Closed' };
}

export function renderPOIPreview(poi, render, nearby_pois = null, nearby_title = null) {
  const opening_hours_list = poi.google_opening_hours?.weekdayDescriptions || null;
  const sanitizedPhotoUrls = sanitizeHttpUrlList(poi.google_photos?.map(p => p.url || p.url_thumbnail).filter(Boolean));
  const photo_urls = sanitizedPhotoUrls.length > 0 ? sanitizedPhotoUrls : null;
  const photo_url = sanitizedPhotoUrls[0] || null;
  const address = poi.osm_address || poi.google_address || '';
  const address_lines = address.split(',').map(s => s.trim()).filter(Boolean);

  const is_food = foodTypes.includes(poi.poi_type);
  const is_accommodation = accommodationTypes.includes(poi.poi_type);

  const cuisine_list = poi.osm_cuisine
    ? poi.osm_cuisine.split(/[;,]/).map(c => c.trim().replace(/_/g, ' ')).filter(Boolean)
    : null;

  const starDisplay = poi.osm_stars ? '★'.repeat(parseInt(poi.osm_stars, 10) || 0) : null;
  const has_hotel_info = poi.osm_rooms || poi.osm_beds || poi.osm_stars || poi.stay_quality_score !== undefined;
  const google_phone_href = sanitizePhoneHref(poi.google_phone);
  const osm_phone_href = sanitizePhoneHref(poi.osm_phone);
  const email_href = sanitizeEmailHref(poi.osm_email);
  const has_contact = google_phone_href || osm_phone_href || email_href;

  const priceLevelMap = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  };
  const price_display = poi.google_price_level ? priceLevelMap[poi.google_price_level] || null : null;

  let business_status_display = null;
  let business_status_class = null;
  if (poi.google_business_status) {
    if (poi.google_business_status === 'CLOSED_PERMANENTLY') {
      business_status_display = 'Permanently Closed';
      business_status_class = 'status-closed';
    } else if (poi.google_business_status === 'CLOSED_TEMPORARILY') {
      business_status_display = 'Temporarily Closed';
      business_status_class = 'status-temp-closed';
    }
  }

  const website_url = sanitizeHttpUrl(poi.google_website) || sanitizeHttpUrl(poi.osm_website);
  const website_display = displayHostname(website_url);

  let service_options_list = null;
  if (poi.google_service_options) {
    const opts = poi.google_service_options;
    const services = [];
    if (opts.dineIn) services.push('Dine-in');
    if (opts.takeout) services.push('Takeout');
    if (opts.delivery) services.push('Delivery');
    if (opts.curbsidePickup) services.push('Curbside pickup');
    if (opts.servesBreakfast) services.push('Breakfast');
    if (opts.servesLunch) services.push('Lunch');
    if (opts.servesDinner) services.push('Dinner');
    if (opts.servesBrunch) services.push('Brunch');
    if (opts.servesBeer) services.push('Beer');
    if (opts.servesWine) services.push('Wine');
    if (opts.servesCocktails) services.push('Cocktails');
    if (opts.servesCoffee) services.push('Coffee');
    if (opts.servesDessert) services.push('Dessert');
    if (opts.servesVegetarianFood) services.push('Vegetarian options');
    if (opts.outdoorSeating) services.push('Outdoor seating');
    if (opts.liveMusic) services.push('Live music');
    if (opts.reservable) services.push('Reservations');
    if (services.length > 0) service_options_list = services;
  }

  let amenities_list = null;
  if (poi.google_amenities) {
    const amenities = poi.google_amenities;
    const items = [];
    if (amenities.restroom) items.push({ icon: '🚻', name: 'Restroom' });
    if (amenities.goodForChildren) items.push({ icon: '👶', name: 'Good for children' });
    if (amenities.goodForGroups) items.push({ icon: '👥', name: 'Good for groups' });
    if (amenities.goodForWatchingSports) items.push({ icon: '📺', name: 'Sports viewing' });
    if (amenities.menuForChildren) items.push({ icon: '🍽️', name: 'Kids menu' });
    if (amenities.paymentOptions?.acceptsCreditCards) items.push({ icon: '💳', name: 'Credit cards' });
    if (amenities.paymentOptions?.acceptsCashOnly) items.push({ icon: '💵', name: 'Cash only' });
    if (amenities.parkingOptions?.paidParkingLot) items.push({ icon: '🅿️', name: 'Paid parking' });
    if (amenities.parkingOptions?.freeParkingLot) items.push({ icon: '🅿️', name: 'Free parking' });
    if (amenities.parkingOptions?.streetParking) items.push({ icon: '🚗', name: 'Street parking' });
    if (amenities.parkingOptions?.valetParking) items.push({ icon: '🔑', name: 'Valet parking' });
    if (items.length > 0) amenities_list = items;
  }

  let accessibility_list = null;
  const accessItems = [];
  if (poi.osm_wheelchair === 'yes') accessItems.push('Wheelchair accessible');
  if (poi.osm_wheelchair === 'limited') accessItems.push('Limited wheelchair access');
  if (poi.google_accessibility) {
    const acc = poi.google_accessibility;
    if (acc.wheelchairAccessibleEntrance) accessItems.push('Wheelchair entrance');
    if (acc.wheelchairAccessibleRestroom) accessItems.push('Wheelchair restroom');
    if (acc.wheelchairAccessibleSeating) accessItems.push('Wheelchair seating');
    if (acc.wheelchairAccessibleParking) accessItems.push('Wheelchair parking');
  }
  if (accessItems.length > 0) accessibility_list = [...new Set(accessItems)];

  let reviews_list = null;
  if (poi.google_reviews && Array.isArray(poi.google_reviews) && poi.google_reviews.length > 0) {
    reviews_list = poi.google_reviews.slice(0, 3).map(review => ({
      author: review.author || 'Anonymous',
      ratingStars: '★'.repeat(review.rating || 0) + '☆'.repeat(5 - (review.rating || 0)),
      text: review.text || '',
      relativeTime: review.relativeTime || null,
    })).filter(r => r.text);
  }

  const open_status = !is_accommodation
    ? isOpenNow(poi.google_opening_hours, poi.google_utc_offset_minutes)
    : null;
  const opening_hours = !is_accommodation ? opening_hours_list : null;
  const raw_data_json = JSON.stringify(poi, null, 2);

  return render('poi-details', {
    ...poi,
    opening_hours,
    photo_url,
    photo_urls,
    address_lines,
    is_food,
    is_accommodation,
    cuisine_list,
    starDisplay,
    has_hotel_info,
    has_contact,
    price_display,
    business_status_display,
    business_status_class,
    website_display,
    website_url,
    google_phone_href,
    osm_phone_href,
    email_href,
    service_options_list,
    amenities_list,
    accessibility_list,
    reviews_list,
    open_status,
    raw_data_json,
    nearby_pois,
    nearby_title,
  });
}

/**
 * Render the nearby POIs widget (standalone page).
 */
export function renderNearbyWidget(sourcePoi, nearbyPois, render) {
  const resultTypes = getNearbyTypes(sourcePoi.poi_type || sourcePoi.osm_poi_type);
  return render('nearby-pois', {
    title: getNearbyTitle(resultTypes),
    source_name: sourcePoi.google_name || sourcePoi.osm_name || sourcePoi.name || null,
    source_osm_id: sourcePoi.osm_id,
    results: sanitizePoiExternalUrlsArray(nearbyPois),
    count: nearbyPois.length,
  });
}
