import { TYPE_COLORS } from './constants.js';

export function createFormatStore() {
  return {
    placeMeta(poi = {}) {
      const bits = [];
      if (poi.google_rating) bits.push(`${Number(poi.google_rating).toFixed(1)} rating`);
      if (poi.google_review_count) bits.push(`${poi.google_review_count} reviews`);
      if (poi.poi_type) bits.push(String(poi.poi_type).replaceAll('_', ' '));
      if (poi.city) bits.push(poi.country_code ? `${poi.city}, ${poi.country_code}` : poi.city);
      return bits.join(' · ') || 'Travel place';
    },
    distance(poi = {}) {
      if (poi.distance_km == null) return this.placeMeta(poi);
      return `${Number(poi.distance_km).toFixed(1)} km · ${this.placeMeta(poi)}`;
    },
    thumbStyle(poi = {}) {
      const url = poi.photo_url || poi.primary_photo_url;
      if (url) return `background-image:url("${url}")`;
      const color = TYPE_COLORS.get(poi.poi_type) || '#475569';
      return `background:linear-gradient(135deg, ${color}, #f59e0b)`;
    },
    heroStyle(poi = {}) {
      const photos = poi.google_photos || poi.photos || [];
      const url = poi.photo_url || poi.primary_photo_url || photos?.[0]?.url || photos?.[0]?.url_thumbnail;
      if (url) return `background-image:linear-gradient(90deg, rgba(23,32,51,.86), rgba(23,32,51,.34) 52%, rgba(23,32,51,.08)), url("${url}")`;
      return 'background-image:linear-gradient(135deg, #172033, #0f766e 58%, #b45309)';
    },
    detailPhotos(poi = {}) {
      const photos = poi.google_photos || poi.photos || [];
      return photos
        .map(photo => photo?.url || photo?.url_thumbnail)
        .filter(Boolean)
        .slice(0, 10);
    },
    bestAddress(poi = {}) {
      return poi.google_short_address || poi.google_address || poi.osm_address || [poi.city, poi.country_code].filter(Boolean).join(', ');
    },
    bestPhone(poi = {}) {
      return poi.google_phone || poi.google_international_phone || poi.osm_phone || poi.phone || '';
    },
    bestWebsite(poi = {}) {
      return poi.google_website || poi.osm_website || poi.website || '';
    },
    bestMapsUrl(poi = {}) {
      if (poi.google_maps_url) return poi.google_maps_url;
      const lat = poi.osm_latitude ?? poi.latitude ?? poi.google_latitude;
      const lng = poi.osm_longitude ?? poi.longitude ?? poi.google_longitude;
      return lat !== undefined && lat !== null && lng !== undefined && lng !== null
        ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(poi.name || poi.osm_name || '')}`;
    },
    openStatus(poi = {}) {
      if (poi.google_business_status === 'CLOSED_PERMANENTLY') return 'Permanently closed';
      if (poi.google_business_status === 'CLOSED_TEMPORARILY') return 'Temporarily closed';
      const googleHours = poi.google_current_opening_hours || poi.google_opening_hours;
      if (googleHours?.openNow === true) return 'Open now';
      if (googleHours?.openNow === false) return 'Closed now';
      if (poi.osm_opening_hours) return 'Hours listed';
      return 'Hours not listed';
    },
    openStatusClass(poi = {}) {
      const label = this.openStatus(poi);
      if (/open/i.test(label)) return 'is-open';
      if (/closed/i.test(label)) return 'is-closed';
      return 'is-muted';
    },
    hoursDetail(poi = {}) {
      const googleHours = poi.google_current_opening_hours || poi.google_opening_hours;
      if (googleHours?.nextCloseTime && googleHours?.openNow) return `Until ${new Date(googleHours.nextCloseTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      if (googleHours?.nextOpenTime && googleHours?.openNow === false) return `Opens ${new Date(googleHours.nextOpenTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;
      if (Array.isArray(googleHours?.weekdayDescriptions)) return googleHours.weekdayDescriptions[0] || '';
      return poi.osm_opening_hours || '';
    },
    priceLabel(poi = {}) {
      if (!poi.google_price_level) return '';
      const labels = {
        PRICE_LEVEL_FREE: 'Free',
        PRICE_LEVEL_INEXPENSIVE: '$',
        PRICE_LEVEL_MODERATE: '$$',
        PRICE_LEVEL_EXPENSIVE: '$$$',
        PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
      };
      return labels[poi.google_price_level] || String(poi.google_price_level).replace('PRICE_LEVEL_', '').replaceAll('_', ' ').toLowerCase();
    },
    propertyFacts(poi = {}) {
      const facts = [];
      if (poi.google_rating) facts.push({ label: 'Rating', value: `${Number(poi.google_rating).toFixed(1)} ★` });
      if (poi.google_price_level) facts.push({ label: 'Price', value: this.priceLabel(poi) });
      if (poi.osm_cuisine) facts.push({ label: 'Cuisine', value: String(poi.osm_cuisine).replaceAll(';', ', ') });
      if (poi.osm_wheelchair) facts.push({ label: 'Access', value: String(poi.osm_wheelchair).replaceAll('_', ' ') });
      if (poi.osm_stars) facts.push({ label: 'Class', value: `${poi.osm_stars} stars` });
      if (poi.osm_rooms) facts.push({ label: 'Rooms', value: poi.osm_rooms });
      if (poi.osm_beds) facts.push({ label: 'Beds', value: poi.osm_beds });
      return facts.slice(0, 6);
    },
    contactLinks(poi = {}) {
      const links = [];
      const address = this.bestAddress(poi);
      if (address) links.push({ label: 'Address', value: address, href: this.bestMapsUrl(poi), kind: 'map' });
      const phone = this.bestPhone(poi);
      if (phone) links.push({ label: 'Phone', value: phone, href: `tel:${phone}`, kind: 'phone' });
      const website = this.bestWebsite(poi);
      if (website) links.push({ label: 'Website', value: this.websiteLabel(website), href: website, kind: 'website' });
      return links;
    },
    websiteLabel(url) {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return url;
      }
    },
  };
}
