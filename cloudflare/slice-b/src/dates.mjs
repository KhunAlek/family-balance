const DAY_MS = 86400000;

export function parseIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isoDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : parseIsoDate(value);
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

export function addDays(value, amount) {
  const date = value instanceof Date ? value : parseIsoDate(value);
  if (!date) return null;
  return new Date(date.getTime() + Number(amount) * DAY_MS);
}

export function compareDates(a, b) {
  const aa = parseIsoDate(isoDate(a));
  const bb = parseIsoDate(isoDate(b));
  if (!aa || !bb) throw new Error('Invalid business date.');
  return aa.getTime() - bb.getTime();
}

export function countInclusiveDays(start, end) {
  const a = parseIsoDate(isoDate(start));
  const b = parseIsoDate(isoDate(end));
  if (!a || !b || b < a) return 0;
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS) + 1;
}

export function monthPeriod(value) {
  const date = isoDate(value);
  return date ? date.slice(0, 7) : '';
}

export function daysInMonth(value) {
  const date = parseIsoDate(isoDate(value));
  if (!date) return 0;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

export function lastDayOfMonth(value) {
  const date = parseIsoDate(isoDate(value));
  if (!date) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function isLastDayOfMonth(value) {
  const date = parseIsoDate(isoDate(value));
  return !!date && date.getUTCDate() === daysInMonth(date);
}

export function getWeekBounds(value) {
  const date = parseIsoDate(isoDate(value));
  if (!date) throw new Error('Invalid business date.');
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  return { start: addDays(date, -daysFromMonday), end: addDays(date, 6 - daysFromMonday) };
}

export function minDate(a, b) { return compareDates(a, b) <= 0 ? parseIsoDate(isoDate(a)) : parseIsoDate(isoDate(b)); }
export function maxDate(a, b) { return compareDates(a, b) >= 0 ? parseIsoDate(isoDate(a)) : parseIsoDate(isoDate(b)); }

export function iterateDatesExclusiveInclusive(fromDate, toDate) {
  const result = [];
  let cursor = addDays(fromDate, 1);
  const end = parseIsoDate(isoDate(toDate));
  while (cursor && end && cursor <= end) {
    result.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }
  return result;
}

export function bangkokBusinessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
