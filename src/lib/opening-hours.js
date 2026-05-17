const OSM_DAY_TO_JS = {
  Su: 0,
  Mo: 1,
  Tu: 2,
  We: 3,
  Th: 4,
  Fr: 5,
  Sa: 6,
};

const OSM_DAY_ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return hour * 60 + minute;
}

function expandDayRange(start, end) {
  const startIdx = OSM_DAY_ORDER.indexOf(start);
  const endIdx = OSM_DAY_ORDER.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return [];

  const days = [];
  for (let i = startIdx; ; i = (i + 1) % OSM_DAY_ORDER.length) {
    days.push(OSM_DAY_TO_JS[OSM_DAY_ORDER[i]]);
    if (i === endIdx) break;
  }
  return days;
}

function parseDays(value) {
  if (!value) return [0, 1, 2, 3, 4, 5, 6];

  const days = new Set();
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = /^([A-Z][a-z])-([A-Z][a-z])$/.exec(trimmed);
    if (range) {
      for (const day of expandDayRange(range[1], range[2])) {
        days.add(day);
      }
      continue;
    }
    if (Object.hasOwn(OSM_DAY_TO_JS, trimmed)) {
      days.add(OSM_DAY_TO_JS[trimmed]);
    }
  }

  return [...days];
}

function previousDay(day) {
  return (day + 6) % 7;
}

function matchesWindow(days, openMin, closeMin, day, currentMinutes) {
  if (closeMin > openMin) {
    return days.includes(day) && currentMinutes >= openMin && currentMinutes < closeMin;
  }

  return (
    (days.includes(day) && currentMinutes >= openMin) ||
    (days.includes(previousDay(day)) && currentMinutes < closeMin)
  );
}

export function coerceOpenAt(value = new Date()) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isGoogleOpenAt(openingHours, utcOffsetMinutes, openAt = new Date()) {
  const at = coerceOpenAt(openAt);
  if (!at || !openingHours?.periods || !Array.isArray(openingHours.periods) || utcOffsetMinutes == null) {
    return null;
  }

  const utcMs = at.getTime() + at.getTimezoneOffset() * 60000;
  const localDate = new Date(utcMs + utcOffsetMinutes * 60000);
  const day = localDate.getDay();
  const currentMinutes = localDate.getHours() * 60 + localDate.getMinutes();

  for (const period of openingHours.periods) {
    if (!period.open) continue;
    const openDay = period.open.day;
    const openMin = period.open.hour * 60 + period.open.minute;

    if (!period.close) {
      if (openDay === day) return true;
      continue;
    }

    const closeDay = period.close.day;
    const closeMin = period.close.hour * 60 + period.close.minute;

    if (openDay === closeDay && openDay === day && currentMinutes >= openMin && currentMinutes < closeMin) {
      return true;
    }
    if (openDay !== closeDay) {
      if (day === openDay && currentMinutes >= openMin) return true;
      if (day === closeDay && currentMinutes < closeMin) return true;
    }
  }

  return false;
}

export function isOsmOpeningHoursOpenAt(openingHours, openAt = new Date()) {
  const at = coerceOpenAt(openAt);
  if (!at || typeof openingHours !== 'string' || openingHours.trim() === '') return null;

  const value = openingHours.trim();
  if (value === '24/7') return true;

  const day = at.getDay();
  const currentMinutes = at.getHours() * 60 + at.getMinutes();
  let parsedAnyRule = false;

  for (const rawRule of value.split(';')) {
    const rule = rawRule.trim();
    if (!rule || /\boff\b/i.test(rule)) continue;

    const match = /^(?:(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(rule);
    if (!match) continue;

    const timeMatch = /(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(rule);
    const openMin = parseClock(timeMatch[1]);
    const closeMin = parseClock(timeMatch[2]);
    if (openMin == null || closeMin == null) continue;

    const dayPart = rule.slice(0, timeMatch.index).trim();
    const days = parseDays(dayPart);
    parsedAnyRule = true;

    if (matchesWindow(days, openMin, closeMin, day, currentMinutes)) {
      return true;
    }
  }

  return parsedAnyRule ? false : null;
}

export function isPoiOpenAt(poi, openAt = new Date()) {
  const googleResult = isGoogleOpenAt(
    poi.google_opening_hours,
    poi.google_utc_offset_minutes,
    openAt,
  );
  if (googleResult !== null) return googleResult;

  return isOsmOpeningHoursOpenAt(poi.osm_opening_hours || poi.opening_hours, openAt);
}
