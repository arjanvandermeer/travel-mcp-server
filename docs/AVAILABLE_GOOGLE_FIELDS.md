# Google Places API (New) - Available Fields Analysis

Based on the [Google Places API documentation](https://developers.google.com/maps/documentation/places/web-service/data-fields), there are 100+ fields available. Here's what we're currently using vs. what's available.

## Currently Captured ✅

Fields we're already storing:

- ✅ `id` (place_id)
- ✅ `displayName`
- ✅ `formattedAddress`
- ✅ `location` (latitude/longitude)
- ✅ `rating`
- ✅ `userRatingCount`
- ✅ `priceLevel`
- ✅ `types`
- ✅ `nationalPhoneNumber`
- ✅ `websiteUri`
- ✅ `regularOpeningHours` (with periods and weekdayDescriptions)
- ✅ `photos` (name, widthPx, heightPx)

## High-Value Fields We're Missing 🔥

### Business Operations
- **`businessStatus`** - Whether place is operational, closed temporarily, or permanently closed
- **`currentOpeningHours`** - Real-time hours (different from regularOpeningHours)
- **`primaryType`** - The main category of the place
- **`primaryTypeDisplayName`** - Human-readable main category

### Service Capabilities (Especially for Restaurants)
- **`delivery`** - Offers delivery service
- **`dineIn`** - Offers dine-in service
- **`takeout`** - Offers takeout service
- **`curbsidePickup`** - Offers curbside pickup
- **`servesBeer`** - Serves alcoholic beverages
- **`servesWine`**
- **`servesCocktails`**
- **`servesCoffee`**
- **`servesBreakfast`**, `servesBrunch`, `servesLunch`, `servesDinner`
- **`servesVegetarianFood`**
- **`reservable`** - Accepts reservations

### Accessibility & Amenities
- **`accessibilityOptions`** - Full object with wheelchair accessibility details
  - `wheelchairAccessibleParking`
  - `wheelchairAccessibleEntrance`
  - `wheelchairAccessibleRestroom`
  - `wheelchairAccessibleSeating`
- **`parkingOptions`** - Parking availability types
  - `freeParkingLot`, `paidParkingLot`, `freeStreetParking`, etc.
- **`restroom`** - Restroom availability
- **`evChargeOptions`** - EV charging station details (very relevant for hotels!)

### Atmosphere & Experience
- **`goodForChildren`** - Family-friendly
- **`goodForGroups`** - Group-friendly
- **`goodForWatchingSports`** - Has TVs/screens
- **`liveMusic`** - Offers live music
- **`menuForChildren`** - Has kids menu
- **`outdoorSeating`** - Has outdoor seating
- **`allowsDogs`** - Pet-friendly

### Rich Content & AI Features 🤖
- **`editorialSummary`** - Curated place description
- **`generativeSummary`** - AI-generated place summary (NEW!)
- **`reviews`** - Full review objects with:
  - `authorAttribution` (name, profile photo)
  - `text` (review content)
  - `rating`
  - `relativePublishTimeDescription`
  - `originalText` (in original language)
- **`areaPlaceSummary`** - AI-powered neighborhood summary (NEW!)

### Additional Details
- **`internationalPhoneNumber`** - With country code (we have nationalPhoneNumber)
- **`addressComponents`** - Structured address parts
- **`plusCode`** - Plus code location identifier
- **`googleMapsUri`** - Link to Google Maps
- **`shortFormattedAddress`** - Shorter address format
- **`displayNameLanguageCode`** - Language of the name
- **`paymentOptions`** - Accepted payment methods

## Medium-Value Fields

### Secondary Info
- **`iconMaskBaseUri`** - Icon for the place type
- **`iconBackgroundColor`** - Icon background color
- **`utcOffsetMinutes`** - Timezone offset
- **`adrFormatAddress`** - Microformat address
- **`viewport`** - Recommended viewing area on map
- **`subDestinations`** - For places with multiple locations
- **`fuelOptions`** - For gas stations (not relevant for hotels)

## Recommended Next Steps

### Phase 1: High-Priority Business Fields
Add these to the field mask and database schema:

```javascript
const fieldMask = 'id,displayName,formattedAddress,rating,userRatingCount,priceLevel,types,' +
  'nationalPhoneNumber,websiteUri,regularOpeningHours,photos,location,' +
  // NEW High-priority fields:
  'businessStatus,' +
  'editorialSummary,' +
  'primaryType,' +
  'primaryTypeDisplayName';
```

**Database columns to add**:
```sql
ALTER TABLE pois ADD COLUMN google_business_status TEXT;
ALTER TABLE pois ADD COLUMN google_editorial_summary TEXT;
ALTER TABLE pois ADD COLUMN google_primary_type TEXT;
ALTER TABLE pois ADD COLUMN google_primary_type_display TEXT;
```

### Phase 2: Service Capabilities (Restaurants/Cafes)
For food & beverage POIs:
```javascript
'delivery,dineIn,takeout,reservable,' +
'servesBeer,servesWine,servesCoffee,' +
'servesBreakfast,servesLunch,servesDinner,servesVegetarianFood'
```

Store as JSONB:
```sql
ALTER TABLE pois ADD COLUMN google_service_options JSONB;
```

### Phase 3: Accessibility & Amenities (Hotels)
For accommodation POIs:
```javascript
'accessibilityOptions,parkingOptions,evChargeOptions,restroom,allowsDogs'
```

Store as JSONB:
```sql
ALTER TABLE pois ADD COLUMN google_accessibility JSONB;
ALTER TABLE pois ADD COLUMN google_amenities JSONB;
```

### Phase 4: AI-Powered Content 🤖
Premium fields for enhanced user experience:
```javascript
'generativeSummary,reviews'
```

Store generative summary as TEXT, reviews as JSONB array.

## Cost Considerations 💰

**Important**: Each field you request increases the API cost!

- **Basic Data**: Cheapest tier (id, displayName, types, etc.)
- **Contact Data**: Mid-tier (phone, website, address)
- **Atmosphere Data**: Premium (reviews, editorialSummary, generativeSummary)

Current field mask costs ~$0.017 per request (Basic + Contact).
Adding all recommended fields could increase to ~$0.032 per request.

**Recommendation**: Add fields incrementally based on POI type:
- Hotels: Focus on accessibility, parking, evChargeOptions
- Restaurants: Focus on service options, dietary info
- Attractions: Focus on editorialSummary, goodForChildren

## Implementation Strategy

1. **Update field mask based on POI type**:
   ```javascript
   getFieldMaskForPOIType(poiType) {
     const base = 'id,displayName,formattedAddress,rating,...';
     if (poiType === 'hotel') {
       return base + ',accessibilityOptions,parkingOptions,evChargeOptions';
     } else if (['restaurant', 'cafe'].includes(poiType)) {
       return base + ',delivery,dineIn,takeout,reservable,servesVegetarianFood';
     }
     return base;
   }
   ```

2. **Add schema migration** for new columns

3. **Update enrichment transform** to handle new fields

4. **Expose new fields in MCP tools** so Claude can use them

## Example Enhanced Response

With new fields, a hotel result could include:

```json
{
  "name": "Park Hyatt Bangkok",
  "rating": 4.6,
  "businessStatus": "OPERATIONAL",
  "editorialSummary": "Luxury hotel in the heart of Bangkok with world-class amenities",
  "accessibility": {
    "wheelchairAccessibleEntrance": true,
    "wheelchairAccessibleParking": true
  },
  "amenities": {
    "evChargeOptions": ["Tesla Supercharger", "Level 2"],
    "parkingOptions": ["valet", "self-park"],
    "allowsDogs": false
  }
}
```

## Sources

- [Place Data Fields Documentation](https://developers.google.com/maps/documentation/places/web-service/data-fields)
- [Place Details (New) API](https://developers.google.com/maps/documentation/places/web-service/place-details)
