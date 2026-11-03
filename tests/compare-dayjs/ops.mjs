// The same operation on the same inputs for each side, for the instruction count: each `op` returns a function of the
// call's index, so that a side does nothing but the operation inside the counted loop.
const ZONES = ['America/New_York', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'];
const DATES = [
  '2024-01-31',
  '2024-02-29',
  '2023-03-31',
  '2025-08-31',
  '2024-12-31',
  '2023-05-15',
  '2025-10-30',
  '2024-06-01',
];
const WALLS = ['2024-03-09T02:30:00', '2024-11-02T01:30:00', '2024-03-30T02:30:00', '2024-10-26T02:30:00'];
const MS = [1710054000000, 1730613600000, 1711846800000, 1729994400000];
const FRENCH = DATES.map((date) => date.split('-').reverse().join('/'));
const at = (list, i) => list[i % list.length];

const unitStart = (date) => date.with({ day: 1 });
const WORKDAYS = { weekend: [6, 7], holidays: [] };

export const OPS = {
  'one business day after a date': {
    yaltaan: (Y, T) => (i) => {
      const read = Y.addBusinessDays(T.PlainDate.from(at(DATES, i)), { ...WORKDAYS, days: 1 });
      return read.ok ? read.value.day : 0;
    },
    temporal: (T) => (i) => {
      let date = T.PlainDate.from(at(DATES, i)).add({ days: 1 });
      while (date.dayOfWeek > 5) {
        date = date.add({ days: 1 });
      }
      return date.day;
    },
  },
  'add one month to a date': {
    dayjs: (d) => (i) =>
      d
        .utc(`${at(DATES, i)}T00:00:00Z`)
        .add(1, 'month')
        .date(),
    temporal: (T) => (i) => T.PlainDate.from(at(DATES, i)).add({ months: 1 }).day,
  },
  'months between two dates': {
    dayjs: (d) => (i) => d.utc(`${at(DATES, i)}T00:00:00Z`).diff(d.utc(`${at(DATES, i + 3)}T00:00:00Z`), 'month'),
    temporal: (T) => (i) => T.PlainDate.from(at(DATES, i)).since(at(DATES, i + 3), { largestUnit: 'months' }).months,
  },
  'read a wall clock in a zone': {
    dayjs: (d) => (i) => d.tz(at(WALLS, i), at(ZONES, i)).valueOf(),
    temporal: (T) => (i) => T.PlainDateTime.from(at(WALLS, i)).toZonedDateTime(at(ZONES, i)).epochMilliseconds,
  },
  'add one day in a zone': {
    dayjs: (d) => (i) => d.tz(at(WALLS, i), at(ZONES, i)).add(1, 'day').valueOf(),
    temporal: (T) => (i) =>
      T.PlainDateTime.from(at(WALLS, i)).toZonedDateTime(at(ZONES, i)).add({ days: 1 }).epochMilliseconds,
  },
  'start of the month in a zone': {
    yaltaan: (Y, T) => (i) =>
      Y.startOf(T.PlainDateTime.from(at(WALLS, i)).toZonedDateTime(at(ZONES, i)), 'month').epochMilliseconds,
    dayjs: (d) => (i) => d.tz(at(WALLS, i), at(ZONES, i)).startOf('month').valueOf(),
    temporal: (T) => (i) => {
      const zone = at(ZONES, i);
      return unitStart(T.PlainDateTime.from(at(WALLS, i)).toZonedDateTime(zone).toPlainDate()).toZonedDateTime(zone)
        .epochMilliseconds;
    },
  },
  'an instant in a zone': {
    yaltaan: (Y) => (i) => {
      const read = Y.fromDate(new Date(at(MS, i)), { timeZone: at(ZONES, i) });
      return read.ok ? read.value.hour : 0;
    },
    dayjs: (d) => (i) => d(at(MS, i)).tz(at(ZONES, i)).hour(),
    temporal: (T) => (i) => T.Instant.fromEpochMilliseconds(at(MS, i)).toZonedDateTimeISO(at(ZONES, i)).hour,
  },
  'read and check a date, dd/MM/yyyy': {
    dayjs: (d) => (i) => d(at(FRENCH, i), 'DD/MM/YYYY', true).isValid(),
    yaltaan: (Y) => (i) => Y.parsePlainDate(at(FRENCH, i), { format: 'dd/MM/yyyy' }).ok,
  },
  'read and check an ISO date': {
    yaltaan: (Y) => (i) => Y.parsePlainDate(at(DATES, i)).ok,
    dayjs: (d) => (i) => d(at(DATES, i), 'YYYY-MM-DD', true).isValid(),
    temporal: (T) => (i) => T.PlainDate.from(at(DATES, i)).day,
  },
  'compare two instants': {
    dayjs: (d) => (i) => d(at(MS, i)).isBefore(d(at(MS, i + 1))),
    temporal: (T) => (i) =>
      T.Instant.compare(T.Instant.fromEpochMilliseconds(at(MS, i)), T.Instant.fromEpochMilliseconds(at(MS, i + 1))) < 0,
  },
};
