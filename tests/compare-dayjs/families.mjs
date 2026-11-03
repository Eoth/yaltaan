// What each side does for each family of cases. Every side answers in the same text: a stamp of the wall clock and of
// the instant, a date, a yes or no, or `refused` when it throws or says invalid. `n/a` leaves a side out of a case.
export const JANUARY = Date.UTC(2026, 0, 15, 12);
export const REFUSED = 'refused';
export const NOT_APPLICABLE = 'n/a';

const dateText = (year, month, day) => `${year}-${month}-${day}`;
const stampOf = (year, month, day, hour, minute, second, ms, epoch) =>
  `${dateText(year, month, day)}T${hour}:${minute}:${second}.${ms} ${epoch}`;

// dayjs ------------------------------------------------------------------------------------------------------------

const djStamp = (d) =>
  d.isValid()
    ? stampOf(d.year(), d.month() + 1, d.date(), d.hour(), d.minute(), d.second(), d.millisecond(), d.valueOf())
    : REFUSED;
const djDate = (d) => (d.isValid() ? dateText(d.year(), d.month() + 1, d.date()) : REFUSED);
const djUtc = (dayjs, date) => dayjs.utc(`${date}T00:00:00Z`);
const djNumber = (n) => (Number.isFinite(n) ? String(n) : REFUSED);

// Temporal ---------------------------------------------------------------------------------------------------------

const tzStamp = (z) => stampOf(z.year, z.month, z.day, z.hour, z.minute, z.second, z.millisecond, z.epochMilliseconds);
const tDate = (d) => dateText(d.year, d.month, d.day);
const zoned = (T, wall, zone) => T.PlainDateTime.from(wall).toZonedDateTime(zone);

/** The first day of the unit, and of the next one: Temporal has no `startOf`; this is what an application writes. */
function unitStart(date, unit) {
  switch (unit) {
    case 'day':
      return date;
    case 'isoWeek':
      return date.subtract({ days: date.dayOfWeek - 1 });
    case 'week':
      return date.subtract({ days: date.dayOfWeek % 7 });
    case 'month':
      return date.with({ day: 1 });
    case 'quarter':
      return date.with({ month: 3 * Math.floor((date.month - 1) / 3) + 1, day: 1 });
    default:
      return date.with({ month: 1, day: 1 });
  }
}
const STEP = {
  day: { days: 1 },
  isoWeek: { days: 7 },
  week: { days: 7 },
  month: { months: 1 },
  quarter: { months: 3 },
  year: { years: 1 },
};

const compareText = (order) => (order < 0 ? 'before' : order > 0 ? 'after' : 'same');
const bounds = (order, low, high, kind) => {
  const above = kind[0] === '[' ? low <= 0 : low < 0;
  const below = kind[1] === ']' ? high >= 0 : high > 0;
  return above && below ? 'between' : 'outside';
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// `@yaltaan/temporal` names a year and a day as Unicode patterns do; the week of dayjs starts on Sunday, `isoWeek` on
// Monday, and the library is told so.
const yFormat = (format) => format.replace('YYYY', 'yyyy').replace('YY', 'yy').replace('DD', 'dd');
const unitOf = (unit) => (unit === 'isoWeek' || unit === 'week' ? 'week' : unit);
const weekOf = (unit) => (unit === 'isoWeek' ? { firstDayOfWeek: 1 } : { firstDayOfWeek: 7 });
const ySome = (result, answer) => (result.ok ? answer(result.value) : REFUSED);
const compatible = (zone) => ({ timeZone: zone, disambiguation: 'compatible' });
const yWall = ([wall, zone], Y) => ySome(Y.parseZonedDateTime(wall, compatible(zone)), tzStamp);
const yFrom = ([ms, zone], Y) => ySome(Y.fromDate(new Date(ms), { timeZone: zone }), tzStamp);
const yTo = ([wall, zone], Y, T) =>
  ySome(Y.toDate(T.PlainDateTime.from(wall), compatible(zone)), (d) => String(d.getTime()));
const yDate = ([text], Y) => ySome(Y.parsePlainDate(text), tDate);
const CLOSED = { weekend: [6, 7], holidays: [] };

/** Business days the slow way, day by day: what an application without this library writes on Temporal. */
function slowAdd(T, text, days, holidays) {
  const off = new Set(holidays);
  let at = T.PlainDate.from(text);
  for (let left = Math.abs(days); left > 0;) {
    at = at.add({ days: Math.sign(days) });
    if (at.dayOfWeek < 6 && !off.has(String(at))) {
      left -= 1;
    }
  }
  return at;
}
function slowBetween(T, a, b, holidays) {
  const off = new Set(holidays);
  const [low, high] = T.PlainDate.compare(a, b) <= 0 ? [a, b] : [b, a];
  let count = 0;
  for (let at = T.PlainDate.from(low); T.PlainDate.compare(at, high) < 0; at = at.add({ days: 1 })) {
    count += at.dayOfWeek < 6 && !off.has(String(at)) ? 1 : 0;
  }
  return T.PlainDate.compare(a, b) <= 0 ? count : -count;
}
const holidaysOf = (list) => (list === '' ? [] : list.split(','));

/**
 * Each family: `dayjs(args, dayjs)` and `temporal(args, T)`; `host`, the time zone the process runs in for dayjs's
 * answer, a function of the case for the families that depend on it, UTC otherwise; `clock`, the date the machine says
 * it is for dayjs's answer, `JANUARY` otherwise, because `dayjs.tz` starts from the offset of the zone today. Java's
 * answer is in Oracle.java, under the family's name. `yaltaan(args, Y, T)`, where the library has this function: it
 * runs on the native Temporal and on the polyfill, each as `globalThis.Temporal`.
 */
export const FAMILIES = {
  'add-months': {
    dayjs: ([date, n], d) => djDate(djUtc(d, date).add(n, 'month')),
    temporal: ([date, n], T) => tDate(T.PlainDate.from(date).add({ months: n })),
  },
  'add-days': {
    dayjs: ([date, n], d) => djDate(djUtc(d, date).add(n, 'day')),
    temporal: ([date, n], T) => tDate(T.PlainDate.from(date).add({ days: n })),
  },
  'diff-months': {
    dayjs: ([a, b], d) => djNumber(djUtc(d, a).diff(djUtc(d, b), 'month')),
    temporal: ([a, b], T) => String(T.PlainDate.from(a).since(b, { largestUnit: 'months' }).months + 0),
  },
  'diff-days': {
    dayjs: ([a, b], d) => djNumber(djUtc(d, a).diff(djUtc(d, b), 'day')),
    temporal: ([a, b], T) => String(T.PlainDate.from(a).since(b, { largestUnit: 'days' }).days + 0),
  },
  'diff-years': {
    dayjs: ([a, b], d) => djNumber(djUtc(d, a).diff(djUtc(d, b), 'year')),
    temporal: ([a, b], T) => String(T.PlainDate.from(a).since(b, { largestUnit: 'years' }).years + 0),
  },
  'start-of-plain': {
    dayjs: ([date, unit], d) => djDate(djUtc(d, date).startOf(unit)),
    temporal: ([date, unit], T) => tDate(unitStart(T.PlainDate.from(date), unit)),
    yaltaan: ([date, unit], Y, T) => tDate(Y.startOf(T.PlainDate.from(date), unitOf(unit), weekOf(unit))),
  },
  'end-of-plain': {
    dayjs: ([date, unit], d) => djDate(djUtc(d, date).endOf(unit)),
    temporal: ([date, unit], T) => tDate(unitStart(T.PlainDate.from(date), unit).add(STEP[unit]).subtract({ days: 1 })),
    yaltaan: ([date, unit], Y, T) => tDate(Y.endOf(T.PlainDate.from(date), unitOf(unit), weekOf(unit))),
  },
  'gap-in-zone': {
    dayjs: ([wall, zone], d) => djStamp(d.tz(wall, zone)),
    temporal: ([wall, zone], T) => tzStamp(zoned(T, wall, zone)),
    yaltaan: yWall,
  },
  'overlap-in-zone': {
    dayjs: ([wall, zone], d) => djStamp(d.tz(wall, zone)),
    temporal: ([wall, zone], T) => tzStamp(zoned(T, wall, zone)),
    yaltaan: yWall,
  },
  'overlap-in-zone@july': {
    clock: Date.UTC(2026, 6, 15, 12),
    dayjs: ([wall, zone], d) => djStamp(d.tz(wall, zone)),
    temporal: ([wall, zone], T) => tzStamp(zoned(T, wall, zone)),
    yaltaan: yWall,
  },
  'gap-local': {
    host: ([, zone]) => zone,
    dayjs: ([wall], d) => djStamp(d(wall)),
    temporal: ([wall, zone], T) => tzStamp(zoned(T, wall, zone)),
    yaltaan: yWall,
  },
  'overlap-local': {
    host: ([, zone]) => zone,
    dayjs: ([wall], d) => djStamp(d(wall)),
    temporal: ([wall, zone], T) => tzStamp(zoned(T, wall, zone)),
    yaltaan: yWall,
  },
  'zoned-add-days': {
    dayjs: ([wall, zone, n], d) => djStamp(d.tz(wall, zone).add(n, 'day')),
    temporal: ([wall, zone, n], T) => tzStamp(zoned(T, wall, zone).add({ days: n })),
  },
  'zoned-add-months': {
    dayjs: ([wall, zone, n], d) => djStamp(d.tz(wall, zone).add(n, 'month')),
    temporal: ([wall, zone, n], T) => tzStamp(zoned(T, wall, zone).add({ months: n })),
  },
  'zoned-add-hours': {
    dayjs: ([wall, zone, n], d) => djStamp(d.tz(wall, zone).add(n, 'hour')),
    temporal: ([wall, zone, n], T) => tzStamp(zoned(T, wall, zone).add({ hours: n })),
  },
  'zoned-diff-hours': {
    dayjs: ([a, b, zone], d) => djNumber(d.tz(a, zone).diff(d.tz(b, zone), 'hour')),
    temporal: ([a, b, zone], T) =>
      String(zoned(T, a, zone).since(zoned(T, b, zone), { largestUnit: 'hours' }).hours + 0),
  },
  'zoned-diff-days': {
    dayjs: ([a, b, zone], d) => djNumber(d.tz(a, zone).diff(d.tz(b, zone), 'day')),
    temporal: ([a, b, zone], T) => String(zoned(T, a, zone).since(zoned(T, b, zone), { largestUnit: 'days' }).days + 0),
  },
  'local-add-days': {
    host: ([, zone]) => zone,
    dayjs: ([wall, , n], d) => djStamp(d(wall).add(n, 'day')),
    temporal: ([wall, zone, n], T) => tzStamp(zoned(T, wall, zone).add({ days: n })),
  },
  'local-add-months': {
    host: ([, zone]) => zone,
    dayjs: ([wall, , n], d) => djStamp(d(wall).add(n, 'month')),
    temporal: ([wall, zone, n], T) => tzStamp(zoned(T, wall, zone).add({ months: n })),
  },
  'local-add-hours': {
    host: ([, zone]) => zone,
    dayjs: ([wall, , n], d) => djStamp(d(wall).add(n, 'hour')),
    temporal: ([wall, zone, n], T) => tzStamp(zoned(T, wall, zone).add({ hours: n })),
  },
  'local-start-of': {
    host: ([, zone]) => zone,
    dayjs: ([wall, , unit], d) => djStamp(d(wall).startOf(unit)),
    temporal: ([wall, zone, unit], T) =>
      tzStamp(unitStart(zoned(T, wall, zone).toPlainDate(), unit).toZonedDateTime(zone)),
  },
  'local-end-of': {
    host: ([, zone]) => zone,
    dayjs: ([wall, , unit], d) => djStamp(d(wall).endOf(unit)),
    temporal: ([wall, zone, unit], T) =>
      tzStamp(
        unitStart(zoned(T, wall, zone).toPlainDate(), unit)
          .add(STEP[unit])
          .toZonedDateTime(zone)
          .subtract({ milliseconds: 1 }),
      ),
  },
  'start-of-zoned': {
    dayjs: ([wall, zone, unit], d) => djStamp(d.tz(wall, zone).startOf(unit)),
    temporal: ([wall, zone, unit], T) =>
      tzStamp(unitStart(zoned(T, wall, zone).toPlainDate(), unit).toZonedDateTime(zone)),
    yaltaan: ([wall, zone, unit], Y, T) => tzStamp(Y.startOf(zoned(T, wall, zone), unitOf(unit), weekOf(unit))),
  },
  'end-of-zoned': {
    dayjs: ([wall, zone, unit], d) => djStamp(d.tz(wall, zone).endOf(unit)),
    temporal: ([wall, zone, unit], T) =>
      tzStamp(
        unitStart(zoned(T, wall, zone).toPlainDate(), unit)
          .add(STEP[unit])
          .toZonedDateTime(zone)
          .subtract({ milliseconds: 1 }),
      ),
    yaltaan: ([wall, zone, unit], Y, T) => tzStamp(Y.endOf(zoned(T, wall, zone), unitOf(unit), weekOf(unit))),
  },
  'date-to-zone': {
    dayjs: ([ms, zone], d) => djStamp(d(ms).tz(zone)),
    temporal: ([ms, zone], T) => tzStamp(T.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone)),
    yaltaan: yFrom,
  },
  'date-to-zone@paris': {
    host: () => 'Europe/Paris',
    dayjs: ([ms, zone], d) => djStamp(d(ms).tz(zone)),
    temporal: ([ms, zone], T) => tzStamp(T.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone)),
    yaltaan: yFrom,
  },
  'date-to-zone@new-york': {
    host: () => 'America/New_York',
    dayjs: ([ms, zone], d) => djStamp(d(ms).tz(zone)),
    temporal: ([ms, zone], T) => tzStamp(T.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone)),
    yaltaan: yFrom,
  },
  'old-date-to-zone': {
    dayjs: ([ms, zone], d) => djStamp(d(ms).tz(zone)),
    temporal: ([ms, zone], T) => tzStamp(T.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone)),
    yaltaan: yFrom,
  },
  'far-date-to-zone': {
    dayjs: ([ms, zone], d) => djStamp(d(ms).tz(zone)),
    temporal: ([ms, zone], T) => tzStamp(T.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone)),
    yaltaan: yFrom,
  },
  'zone-to-date': {
    dayjs: ([wall, zone], d) => String(d.tz(wall, zone).toDate().getTime()),
    temporal: ([wall, zone], T) => String(zoned(T, wall, zone).epochMilliseconds),
    yaltaan: yTo,
  },
  'zone-to-date@paris': {
    host: () => 'Europe/Paris',
    dayjs: ([wall, zone], d) => String(d.tz(wall, zone).toDate().getTime()),
    temporal: ([wall, zone], T) => String(zoned(T, wall, zone).epochMilliseconds),
    yaltaan: yTo,
  },
  'zone-to-date@new-york': {
    host: () => 'America/New_York',
    dayjs: ([wall, zone], d) => String(d.tz(wall, zone).toDate().getTime()),
    temporal: ([wall, zone], T) => String(zoned(T, wall, zone).epochMilliseconds),
    yaltaan: yTo,
  },
  'zone-to-utc': {
    dayjs: ([wall, zone], d) => djStamp(d.tz(wall, zone).utc()),
    temporal: ([wall, zone], T) => tzStamp(zoned(T, wall, zone).withTimeZone('UTC')),
  },
  'zone-to-zone': {
    dayjs: ([wall, zone, other], d) => djStamp(d.tz(wall, zone).tz(other)),
    temporal: ([wall, zone, other], T) => tzStamp(zoned(T, wall, zone).withTimeZone(other)),
  },
  compare: {
    dayjs: ([a, za, b, zb], d) => {
      const left = d.tz(a, za);
      const right = d.tz(b, zb);
      return left.isBefore(right) ? 'before' : left.isAfter(right) ? 'after' : 'same';
    },
    temporal: ([a, za, b, zb], T) => compareText(T.ZonedDateTime.compare(zoned(T, a, za), zoned(T, b, zb))),
  },
  'same-day': {
    dayjs: ([a, za, b, zb], d) => (d.tz(a, za).isSame(d.tz(b, zb), 'day') ? 'same day' : 'other day'),
    temporal: ([a, za, b, zb], T) =>
      zoned(T, a, za)
        .toPlainDate()
        .equals(zoned(T, b, zb).withTimeZone(za).toPlainDate())
        ? 'same day'
        : 'other day',
  },
  between: {
    dayjs: ([x, low, high, zone, kind], d) =>
      d.tz(x, zone).isBetween(d.tz(low, zone), d.tz(high, zone), null, kind) ? 'between' : 'outside',
    temporal: ([x, low, high, zone, kind], T) => {
      const at = zoned(T, x, zone);
      return bounds(
        0,
        T.ZonedDateTime.compare(zoned(T, low, zone), at),
        T.ZonedDateTime.compare(zoned(T, high, zone), at),
        kind,
      );
    },
  },
  'all-transitions-wall': {
    dayjs: () => NOT_APPLICABLE,
    temporal: ([wall, zone], T) =>
      tzStamp(T.PlainDateTime.from(wall).toZonedDateTime(zone, { disambiguation: 'reject' })),
    yaltaan: ([wall, zone], Y) => ySome(Y.parseZonedDateTime(wall, { timeZone: zone }), tzStamp),
  },
  'all-transitions-instant': {
    dayjs: () => NOT_APPLICABLE,
    temporal: ([ms, zone], T) => tzStamp(T.Instant.fromEpochMilliseconds(ms).toZonedDateTimeISO(zone)),
    yaltaan: yFrom,
  },
  'wall-clock-strict': {
    dayjs: ([wall, zone], d) => djStamp(d.tz(wall, zone)),
    temporal: ([wall, zone], T) =>
      tzStamp(T.PlainDateTime.from(wall).toZonedDateTime(zone, { disambiguation: 'reject' })),
    yaltaan: ([wall, zone], Y) => ySome(Y.parseZonedDateTime(wall, { timeZone: zone }), tzStamp),
  },
  'business-days-add': {
    dayjs: () => NOT_APPLICABLE,
    temporal: ([date, days, list], T) => tDate(slowAdd(T, date, days, holidaysOf(list))),
    yaltaan: ([date, days, list], Y, T) =>
      ySome(
        Y.addBusinessDays(T.PlainDate.from(date), {
          ...CLOSED,
          days,
          holidays: holidaysOf(list).map((h) => T.PlainDate.from(h)),
        }),
        tDate,
      ),
  },
  'business-days-between': {
    dayjs: () => NOT_APPLICABLE,
    temporal: ([a, b, list], T) =>
      String(slowBetween(T, T.PlainDate.from(a), T.PlainDate.from(b), holidaysOf(list)) + 0),
    yaltaan: ([a, b, list], Y, T) =>
      ySome(
        Y.businessDaysBetween(T.PlainDate.from(a), T.PlainDate.from(b), {
          ...CLOSED,
          holidays: holidaysOf(list).map((h) => T.PlainDate.from(h)),
        }),
        (count) => String(count + 0),
      ),
  },
  'interval-contains': {
    dayjs: ([x, low, high, zone], d) =>
      d.tz(x, zone).isBetween(d.tz(low, zone), d.tz(high, zone), null, '[)') ? 'in' : 'out',
    temporal: ([x, low, high, zone], T) => {
      const at = zoned(T, x, zone);
      const inside =
        T.ZonedDateTime.compare(zoned(T, low, zone), at) <= 0 && T.ZonedDateTime.compare(at, zoned(T, high, zone)) < 0;
      return inside ? 'in' : 'out';
    },
    yaltaan: ([x, low, high, zone], Y, T) => {
      const made = Y.interval(zoned(T, low, zone), zoned(T, high, zone));
      return made.ok && Y.contains(made.value, zoned(T, x, zone)) ? 'in' : 'out';
    },
  },
  'interval-overlaps': {
    dayjs: ([a, b, c, e, zone], d) => {
      const [a1, b1, c1, e1] = [d.tz(a, zone), d.tz(b, zone), d.tz(c, zone), d.tz(e, zone)];
      return a1.isBefore(e1) && c1.isBefore(b1) ? 'yes' : 'no';
    },
    temporal: ([a, b, c, e, zone], T) =>
      T.ZonedDateTime.compare(zoned(T, a, zone), zoned(T, e, zone)) < 0 &&
      T.ZonedDateTime.compare(zoned(T, c, zone), zoned(T, b, zone)) < 0
        ? 'yes'
        : 'no',
    yaltaan: ([a, b, c, e, zone], Y, T) => {
      const one = Y.interval(zoned(T, a, zone), zoned(T, b, zone));
      const other = Y.interval(zoned(T, c, zone), zoned(T, e, zone));
      return one.ok && other.ok && Y.overlaps(one.value, other.value) ? 'yes' : 'no';
    },
  },
  'validate-permissive': {
    dayjs: ([text], d) => djDate(d(text)),
    temporal: ([text], T) => tDate(T.PlainDate.from(text)),
    yaltaan: yDate,
  },
  'validate-strict': {
    dayjs: ([text], d) => djDate(d(text, 'YYYY-MM-DD', true)),
    temporal: ([text], T) => tDate(T.PlainDate.from(text)),
    yaltaan: yDate,
  },
  'parse-strict': {
    dayjs: ([text, format], d) => djDate(d(text, format, true)),
    // Temporal reads ISO 8601 and nothing else, and an ISO text more general than this format: it answers only here.
    temporal: ([text, format], T) => {
      return format === 'YYYY-MM-DD' && ISO_DATE.test(text) ? tDate(T.PlainDate.from(text)) : NOT_APPLICABLE;
    },
    yaltaan: ([text, format], Y) =>
      format.includes('HH')
        ? ySome(Y.parsePlainDateTime(text, { format: yFormat(format) }), tDate)
        : ySome(Y.parsePlainDate(text, { format: yFormat(format) }), tDate),
  },
  'parse-permissive': {
    dayjs: ([text], d) => djDate(d(text)),
    temporal: ([text], T) => tDate(T.PlainDate.from(text)),
    yaltaan: yDate,
  },
  'two-digit-year': {
    dayjs: ([text], d) => djDate(d(text, 'DD/MM/YY', true)),
    temporal: () => NOT_APPLICABLE,
    yaltaan: ([text], Y) => ySome(Y.parsePlainDate(text, { format: 'dd/MM/yy', pivotYear: 1969 }), tDate),
  },
  'extreme-read': {
    dayjs: ([text], d) => djDate(d.utc(text)),
    temporal: ([text], T) => tDate(T.PlainDate.from(text)),
    yaltaan: yDate,
  },
  'extreme-add-month': {
    dayjs: ([text], d) => djDate(d.utc(text).add(1, 'month')),
    temporal: ([text], T) => tDate(T.PlainDate.from(text).add({ months: 1 })),
  },
  'extreme-add-year': {
    dayjs: ([text], d) => djDate(d.utc(text).add(1, 'year')),
    temporal: ([text], T) => tDate(T.PlainDate.from(text).add({ years: 1 })),
  },
};

/** What a project leaving dayjs writes instead, with the family of the comparison that says what dayjs does there. */
export const MIGRATION = [
  {
    family: 'add-months',
    en: 'Add months to a date',
    fr: 'Ajouter des mois à une date',
    dayjs: "dayjs.utc(text).add(1, 'month')",
    instead: 'Temporal.PlainDate.from(text).add({ months: 1 })',
  },
  {
    family: 'diff-days',
    en: 'Days between two dates',
    fr: 'Jours entre deux dates',
    dayjs: "a.diff(b, 'day')",
    instead: "a.since(b, { largestUnit: 'days' }).days",
  },
  {
    family: 'diff-months',
    en: 'Months between two dates',
    fr: 'Mois entre deux dates',
    dayjs: "a.diff(b, 'month')",
    instead: "a.since(b, { largestUnit: 'months' }).months",
  },
  {
    family: 'overlap-in-zone',
    en: 'Read a wall clock in a zone',
    fr: 'Lire une heure dans un fuseau',
    dayjs: 'dayjs.tz(text, zone)',
    instead: 'parseZonedDateTime(text, { timeZone: zone })',
  },
  {
    family: 'zoned-add-hours',
    en: 'Add hours in a zone',
    fr: 'Ajouter des heures dans un fuseau',
    dayjs: "dayjs.tz(text, zone).add(3, 'hour')",
    instead: 'zoned.add({ hours: 3 })',
  },
  {
    family: 'zoned-add-days',
    en: 'Add days in a zone',
    fr: 'Ajouter des jours dans un fuseau',
    dayjs: "dayjs.tz(text, zone).add(1, 'day')",
    instead: 'zoned.add({ days: 1 })',
  },
  {
    family: 'start-of-plain',
    en: 'Start of a unit, no zone',
    fr: "Début d'une unité, sans fuseau",
    dayjs: "dayjs.utc(text).startOf('month')",
    instead: "startOf(date, 'month')",
  },
  {
    family: 'start-of-zoned',
    en: 'Start of a unit in a zone',
    fr: "Début d'une unité dans un fuseau",
    dayjs: "dayjs.tz(text, zone).startOf('day')",
    instead: "startOf(zoned, 'day')",
  },
  {
    family: 'end-of-zoned',
    en: 'End of a unit in a zone',
    fr: "Fin d'une unité dans un fuseau",
    dayjs: "dayjs.tz(text, zone).endOf('month')",
    instead: "endOf(zoned, 'month')",
  },
  {
    family: 'date-to-zone@paris',
    en: 'A Date in a zone, on a machine set to Paris',
    fr: 'Une Date dans un fuseau, sur une machine réglée sur Paris',
    dayjs: 'dayjs(date).tz(zone)',
    instead: 'fromDate(date, { timeZone: zone })',
  },
  {
    family: 'zone-to-date',
    en: 'A wall clock in a zone, as a Date',
    fr: 'Une heure dans un fuseau, en Date',
    dayjs: 'dayjs.tz(text, zone).toDate()',
    instead: 'toDate(wall, { timeZone: zone })',
  },
  {
    family: 'compare',
    en: 'Which instant comes first',
    fr: 'Quel instant vient en premier',
    dayjs: 'a.isBefore(b)',
    instead: 'Temporal.ZonedDateTime.compare(a, b) < 0',
  },
  {
    family: 'same-day',
    en: 'Same day in the zone of the first',
    fr: 'Même jour dans le fuseau du premier',
    dayjs: "a.isSame(b, 'day')",
    instead: 'a.toPlainDate().equals(b.withTimeZone(a.timeZoneId).toPlainDate())',
  },
  {
    family: 'interval-contains',
    en: 'Inside two bounds, end left out',
    fr: 'Entre deux bornes, fin exclue',
    dayjs: "x.isBetween(a, b, null, '[)')",
    instead: 'contains(span, x)',
  },
  {
    family: 'parse-strict',
    en: 'Read a declared format',
    fr: 'Lire un format déclaré',
    dayjs: "dayjs(text, 'DD/MM/YYYY', true)",
    instead: "parsePlainDate(text, { format: 'dd/MM/yyyy' })",
  },
  {
    family: 'validate-permissive',
    en: 'Check that a date exists',
    fr: "Vérifier qu'une date existe",
    dayjs: 'dayjs(text).isValid()',
    instead: 'parsePlainDate(text).ok',
  },
  {
    family: 'two-digit-year',
    en: 'A two-digit year',
    fr: 'Une année sur deux chiffres',
    dayjs: "dayjs(text, 'DD/MM/YY')",
    instead: "parsePlainDate(text, { format: 'dd/MM/yy', pivotYear: 1969 })",
  },
];
