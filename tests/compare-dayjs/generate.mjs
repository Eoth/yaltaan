// The cases of the comparison, generated: time zones read from the platform, instants read from each zone's own
// transitions, calendar edges enumerated, the rest drawn from a fixed seed. Nothing here is a list of chosen examples:
// the same runtime gives the same cases, whatever the implementations then answer.
const LAST = Date.UTC(2027, 0, 1);

/** mulberry32: small, seeded, the same everywhere. */
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (value, width = 2) => String(value).padStart(width, '0');
const dateOf = (plain) => `${pad(plain.year, 4)}-${pad(plain.month)}-${pad(plain.day)}`;
export const wallOf = (plain) => `${dateOf(plain)}T${pad(plain.hour)}:${pad(plain.minute)}:${pad(plain.second)}`;

/** Every transition of a zone from a start: `{ wallBefore, wallAfter, delta }`, delta in seconds of offset gained. */
function transitionsFrom(zone, start, count) {
  const found = [];
  let at = Temporal.Instant.from(start).toZonedDateTimeISO(zone);
  while (found.length < count) {
    const next = at.getTimeZoneTransition('next');
    if (next === null || next.epochMilliseconds >= LAST) {
      break;
    }
    const before = next.subtract({ nanoseconds: 1 }).offsetNanoseconds;
    const delta = Math.round((next.offsetNanoseconds - before) / 1e9);
    const wallAfter = next.toPlainDateTime();
    const wallBefore = wallAfter.subtract({ seconds: delta });
    found.push({ zone, delta, wallBefore, wallAfter, instant: next.toInstant() });
    at = next;
  }
  return found;
}

/** The transitions a date library meets: recent and coming ones, one of the 1970s, the first of the zone's history. */
export function zonePoints(zones) {
  const points = [];
  for (const zone of zones) {
    points.push(...transitionsFrom(zone, '2023-01-01T00:00:00Z', 8));
    points.push(...transitionsFrom(zone, '1975-01-01T00:00:00Z', 1));
    points.push(...transitionsFrom(zone, '1800-01-01T00:00:00Z', 1));
  }
  return points;
}

/** Three walls inside each gap (delta > 0) or overlap (delta < 0): its edges and its middle. */
function wallsInside(point) {
  const low = point.delta > 0 ? point.wallBefore : point.wallAfter;
  const size = Math.abs(point.delta);
  return [low, low.add({ seconds: Math.floor(size / 2) }), low.add({ seconds: size - 1 })].map(wallOf);
}

const calendarDates = () => {
  const dates = [];
  for (const year of [1900, 1999, 2000, 2023, 2024, 2025, 2100]) {
    for (let month = 1; month <= 12; month += 1) {
      const last = new Temporal.PlainDate(year, month, 1).daysInMonth;
      for (const day of new Set([1, 15, 28, 29, 30, 31, last])) {
        if (day <= last) {
          dates.push(dateOf({ year, month, day }));
        }
      }
    }
  }
  return dates;
};

function plainPairs(rand, count) {
  const dates = calendarDates();
  const pairs = [];
  for (let i = 0; i < count; i += 1) {
    const a = Temporal.PlainDate.from(dates[Math.floor(rand() * dates.length)]);
    const shift = Math.floor(rand() * 1600) - 800;
    pairs.push([dateOf(a.add({ days: shift })), dateOf(a)]);
  }
  for (const a of dates) {
    const date = Temporal.PlainDate.from(a);
    for (const months of [1, 2, 3, 12, 13]) {
      pairs.push([dateOf(date.add({ months })), a]);
      pairs.push([dateOf(date.add({ months }).add({ days: 1 })), a]);
    }
  }
  return pairs;
}

const UNITS = ['day', 'isoWeek', 'week', 'month', 'quarter', 'year'];
const FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD HH:mm'];

function textFor(format, year, month, day) {
  const y = pad(year, 4);
  const m = pad(month);
  const d = pad(day);
  return format.replace('YYYY', y).replace('MM', m).replace('DD', d).replace('HH', '10').replace('mm', '30');
}

/** All the cases, family by family; `args` are strings or numbers, the same three sides receive. */
export function generate() {
  const zones = Intl.supportedValuesOf('timeZone');
  const points = zonePoints(zones);
  const moved = points.filter((point) => Math.abs(point.delta) > 0);
  const gaps = moved.filter((point) => point.delta > 0);
  const overlaps = moved.filter((point) => point.delta < 0);
  const rand = random(0x7e3a1);
  const families = {};
  const add = (family, ...args) => (families[family] ??= []).push(args);
  // What an application meets every day apart from what only a historian does: the same family, counted apart.
  const tagged = (point) => (point.wallAfter.year < 2000 ? ':old' : '');

  for (const date of calendarDates()) {
    for (const n of [-13, -12, -3, -1, 1, 2, 3, 6, 11, 12, 13, 24, 48]) {
      add('add-months', date, n);
    }
    for (const n of [-366, -31, -1, 1, 28, 30, 31, 365, 366, 1461]) {
      add('add-days', date, n);
    }
    for (const unit of UNITS) {
      add('start-of-plain', date, unit);
      add('end-of-plain', date, unit);
    }
  }
  for (const [a, b] of plainPairs(rand, 4000)) {
    add('diff-months', a, b);
    add('diff-days', a, b);
    add('diff-years', a, b);
  }

  for (const point of gaps) {
    for (const wall of wallsInside(point)) {
      add(`gap-in-zone${tagged(point)}`, wall, point.zone);
      add(`gap-local${tagged(point)}`, wall, point.zone);
    }
  }
  for (const point of overlaps) {
    for (const wall of wallsInside(point)) {
      add(`overlap-in-zone${tagged(point)}`, wall, point.zone);
      add(`overlap-in-zone@july${tagged(point)}`, wall, point.zone);
      add(`overlap-local${tagged(point)}`, wall, point.zone);
    }
  }
  for (const point of moved) {
    const old = tagged(point);
    const middle = wallsInside(point)[1];
    const walk = Temporal.PlainDateTime.from(middle);
    add(`zoned-add-days${old}`, wallOf(walk.subtract({ days: 1 })), point.zone, 1);
    add(`zoned-add-days${old}`, wallOf(walk.add({ days: 1 })), point.zone, -1);
    add(`zoned-add-months${old}`, wallOf(walk.subtract({ months: 1 })), point.zone, 1);
    const safe = point.instant.toZonedDateTimeISO(point.zone).subtract({ hours: 3 });
    for (const n of [1, 2, 3, 4, 6, 24]) {
      add(`zoned-add-hours${old}`, wallOf(safe.toPlainDateTime()), point.zone, n);
    }
    const after = point.instant.toZonedDateTimeISO(point.zone).add({ hours: 3 });
    add(`zoned-diff-hours${old}`, wallOf(after.toPlainDateTime()), wallOf(safe.toPlainDateTime()), point.zone);
    const later = after.add({ days: 2 }).toPlainDateTime();
    add(`zoned-diff-days${old}`, wallOf(later), wallOf(safe.subtract({ days: 2 }).toPlainDateTime()), point.zone);
    for (const unit of UNITS) {
      add(`start-of-zoned${old}`, wallOf(after.toPlainDateTime()), point.zone, unit);
      add(`end-of-zoned${old}`, wallOf(after.toPlainDateTime()), point.zone, unit);
    }
    const ms = point.instant.epochMilliseconds;
    for (const shift of [-3600000, -1, 0, 1, 3600000]) {
      add(`date-to-zone${old}`, ms + shift, point.zone);
      add(`date-to-zone@paris${old}`, ms + shift, point.zone);
      add(`date-to-zone@new-york${old}`, ms + shift, point.zone);
    }
    const first = wallOf(safe.toPlainDateTime());
    add(`zone-to-date${old}`, first, point.zone);
    add(`zone-to-date@paris${old}`, first, point.zone);
    add(`zone-to-date@new-york${old}`, first, point.zone);
    add(`zone-to-utc${old}`, first, point.zone);
    add(`zone-to-zone${old}`, first, point.zone, zones[Math.floor(rand() * zones.length)]);
    const instantWall = safe.toPlainDateTime();
    add(
      `between${old}`,
      wallOf(instantWall),
      wallOf(instantWall.subtract({ hours: 1 })),
      wallOf(after.toPlainDateTime()),
      point.zone,
      '()',
    );
    add(
      `between${old}`,
      wallOf(after.toPlainDateTime()),
      wallOf(instantWall),
      wallOf(after.toPlainDateTime()),
      point.zone,
      '[]',
    );
    add(
      `between${old}`,
      wallOf(after.toPlainDateTime()),
      wallOf(instantWall),
      wallOf(after.toPlainDateTime()),
      point.zone,
      '()',
    );
    const other = zones[Math.floor(rand() * zones.length)];
    const same = safe.withTimeZone(other);
    add(`compare${old}`, first, point.zone, wallOf(same.toPlainDateTime()), other);
    add(`compare${old}`, first, point.zone, first, other);
    add(`compare${old}`, first, point.zone, wallOf(same.add({ seconds: 1 }).toPlainDateTime()), other);
    add(`same-day${old}`, first, point.zone, wallOf(same.toPlainDateTime()), other);
    add(`same-day${old}`, first, point.zone, wallOf(same.add({ hours: 12 }).toPlainDateTime()), other);
  }

  for (const zone of zones) {
    add('old-date-to-zone', Date.UTC(1850, 0, 1), zone);
    add('old-date-to-zone', Date.UTC(1900, 5, 15), zone);
    add('far-date-to-zone', Date.UTC(2200, 6, 1), zone);
    add('far-date-to-zone', Date.UTC(2200, 0, 1), zone);
    add('zone-to-date', '2024-06-15T12:00:00', zone);
    add('start-of-zoned', '2024-01-31T12:00:00', zone, 'month');
    add('end-of-zoned', '2024-01-31T12:00:00', zone, 'month');
  }

  for (const year of [1999, 2000, 2023, 2024, 2100]) {
    for (let month = 0; month <= 13; month += 1) {
      for (let day = 0; day <= 32; day += 1) {
        const text = textFor('YYYY-MM-DD', year, month, day);
        add('validate-permissive', text);
        add('validate-strict', text);
        for (const format of FORMATS) {
          add('parse-strict', textFor(format, year, month, day), format);
        }
      }
    }
  }
  for (const [text, format] of [
    ['2024-3-4', 'YYYY-MM-DD'],
    ['2024-03-04 ', 'YYYY-MM-DD'],
    [' 2024-03-04', 'YYYY-MM-DD'],
    ['2024-03-04T10:30', 'YYYY-MM-DD'],
    ['2024/03/04', 'YYYY-MM-DD'],
    ['04/03/24', 'DD/MM/YYYY'],
    ['', 'YYYY-MM-DD'],
  ]) {
    add('parse-strict', text, format);
  }
  const permissive = [];
  for (const date of [
    '2024-03-04',
    '2024-02-29',
    '2023-02-29',
    '2024-02-31',
    '2024-13-01',
    '2024-00-10',
    '2024-01-00',
  ]) {
    const [year, month, day] = date.split('-');
    permissive.push(date, date.replaceAll('-', ''), date.replaceAll('-', '/'), `${day}/${month}/${year}`);
    permissive.push(`${month}/${day}/${year}`, `${Number(year)}-${Number(month)}-${Number(day)}`);
    permissive.push(`${date} `, ` ${date}`, `${date}T25:00:00`, `${date}T10:30`, `${date} 10:30`, `${date}Z`);
    permissive.push(`${date}x`, `x${date}`, year, `${year}-${month}`);
  }
  for (const text of ['', ' ', 'hello', '12', 'null', 'March 4 2024', '4 March 2024', 'Mon Mar 04 2024', 'now']) {
    permissive.push(text);
  }
  for (const text of permissive) {
    add('parse-permissive', text);
  }
  for (let year = 0; year <= 99; year += 1) {
    for (const [month, day] of [
      [1, 2],
      [2, 29],
      [12, 31],
    ]) {
      add('two-digit-year', `${pad(day)}/${pad(month)}/${pad(year)}`);
    }
  }
  for (const text of [
    '0000-01-01',
    '0001-01-01',
    '0050-03-01',
    '0099-12-31',
    '0100-01-01',
    '0999-06-15',
    '1000-01-01',
    '1582-10-10',
    '1752-09-10',
    '9999-12-31',
    '+010000-01-01',
    '-000001-01-01',
    '-000044-03-15',
    '+275760-09-13',
    '+275760-09-14',
    '-271821-04-19',
    '-271821-04-20',
  ]) {
    add('extreme-read', text);
    add('extreme-add-month', text);
    add('extreme-add-year', text);
  }
  return { zones, families };
}
