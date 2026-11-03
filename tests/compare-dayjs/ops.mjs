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
const at = (list, i) => list[i % list.length];

const unitStart = (date) => date.with({ day: 1 });

export const OPS = {
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
    dayjs: (d) => (i) => d.tz(at(WALLS, i), at(ZONES, i)).startOf('month').valueOf(),
    temporal: (T) => (i) => {
      const zone = at(ZONES, i);
      return unitStart(T.PlainDateTime.from(at(WALLS, i)).toZonedDateTime(zone).toPlainDate()).toZonedDateTime(zone)
        .epochMilliseconds;
    },
  },
  'an instant in a zone': {
    dayjs: (d) => (i) => d(at(MS, i)).tz(at(ZONES, i)).hour(),
    temporal: (T) => (i) => T.Instant.fromEpochMilliseconds(at(MS, i)).toZonedDateTimeISO(at(ZONES, i)).hour,
  },
  'read and check an ISO date': {
    dayjs: (d) => (i) => d(at(DATES, i), 'YYYY-MM-DD', true).isValid(),
    temporal: (T) => (i) => T.PlainDate.from(at(DATES, i)).day,
  },
  'compare two instants': {
    dayjs: (d) => (i) => d(at(MS, i)).isBefore(d(at(MS, i + 1))),
    temporal: (T) => (i) =>
      T.Instant.compare(T.Instant.fromEpochMilliseconds(at(MS, i)), T.Instant.fromEpochMilliseconds(at(MS, i + 1))) < 0,
  },
};
