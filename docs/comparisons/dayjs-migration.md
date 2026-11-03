# Moving from dayjs to Temporal

Written by `bash tests/compare-dayjs/run.sh --write`, from the same results as [the comparison](dayjs.md), whose notes say which of these lines are conventions. The last column counts generated cases on transitions since 2000, chosen where dates go wrong, not an average of what an application meets.

`zoned` is a `Temporal.ZonedDateTime`, `date` a `Temporal.PlainDate`, `wall` a `Temporal.PlainDateTime`, `span` an interval. The functions of `@yaltaan/temporal` that can fail return a `Result`: read its `value` after testing its `ok`. `parseZonedDateTime` reads `yyyy-MM-ddTHH:mm:ss` unless a format says otherwise, and refuses a wall clock that does not exist or exists twice, which dayjs accepts, unless `disambiguation` decides.

| Need | dayjs | Temporal or `@yaltaan/temporal` | dayjs differs / cases |
|---|---|---|---:|
| Today, now | `dayjs()` | `Temporal.Now.plainDateISO(zone), Temporal.Now.zonedDateTimeISO(zone)` | not compared |
| Show a date with a pattern | `d.format('YYYY-MM-DD HH:mm')` | `zoned.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ')` | not compared |
| Show a date to a person | `d.format('DD/MM/YYYY')` | `date.toLocaleString('fr-FR')` | not compared |
| Add months to a date | `dayjs.utc(text).add(1, 'month')` | `Temporal.PlainDate.from(text).add({ months: 1 })` | 0 / 5941 |
| Days between two dates | `a.diff(b, 'day')` | `a.since(b, { largestUnit: 'days' }).days` | 0 / 8570 |
| Months between two dates | `a.diff(b, 'month')` | `a.since(b, { largestUnit: 'months' }).months` | 162 / 8570 |
| Read a wall clock in a zone | `dayjs.tz(text, zone)` | `parseZonedDateTime(text, { timeZone: zone })` | 1383 / 1593 |
| Add hours in a zone | `dayjs.tz(text, zone).add(3, 'hour')` | `zoned.add({ hours: 3 })` | 4262 / 6390 |
| Add days in a zone | `dayjs.tz(text, zone).add(1, 'day')` | `zoned.add({ days: 1 })` | 1068 / 2130 |
| Start of a unit, no zone | `dayjs.utc(text).startOf('month')` | `startOf(date, 'month')` | 0 / 2742 |
| Start of a unit in a zone | `dayjs.tz(text, zone).startOf('day')` | `startOf(zoned, 'day')` | 339 / 6808 |
| End of a unit in a zone | `dayjs.tz(text, zone).endOf('month')` | `endOf(zoned, 'month')` | 0 / 6808 |
| A Date in a zone, on a machine set to Paris | `dayjs(date).tz(zone)` | `fromDate(date, { timeZone: zone })` | 172 / 5325 |
| A wall clock in a zone, as a Date | `dayjs.tz(text, zone).toDate()` | `toDate(wall, { timeZone: zone })` | 1 / 1483 |
| Which instant comes first | `a.isBefore(b)` | `Temporal.ZonedDateTime.compare(a, b) < 0` | 307 / 3195 |
| Same day in the zone of the first | `a.isSame(b, 'day')` | `a.toPlainDate().equals(b.withTimeZone(a.timeZoneId).toPlainDate())` | 83 / 2130 |
| Inside two bounds, end left out | `x.isBetween(a, b, null, '[)')` | `contains(span, x)` | 266 / 3195 |
| Read a declared format | `dayjs(text, 'DD/MM/YYYY', true)` | `parsePlainDate(text, { format: 'dd/MM/yyyy' })` | 0 / 9247 |
| Check that a date exists | `dayjs(text).isValid()` | `parsePlainDate(text).ok` | 483 / 2310 |
| A two-digit year: pivots differ, there is no truth | `dayjs(text, 'DD/MM/YY')` | `parsePlainDate(text, { format: 'dd/MM/yy', pivotYear: 1969 })` | 0 / 300 |

## Le même tableau, en français

Écrit par `bash tests/compare-dayjs/run.sh --write`, à partir des mêmes résultats que la comparaison, dont les notes disent quelles lignes sont des conventions. La dernière colonne compte des cas générés sur les changements d'heure depuis 2000, choisis là où les dates se trompent : ce n'est pas une moyenne de ce que rencontre une application.

`zoned` est un `Temporal.ZonedDateTime`, `date` un `Temporal.PlainDate`, `wall` un `Temporal.PlainDateTime`, `span` un intervalle. Les fonctions de `@yaltaan/temporal` qui peuvent échouer rendent un `Result` : lisez sa `value` après avoir testé son `ok`. `parseZonedDateTime` lit `yyyy-MM-ddTHH:mm:ss` sauf si un format dit autre chose, et refuse une heure qui n'existe pas ou existe deux fois, ce que dayjs accepte, sauf si `disambiguation` décide.

| Besoin | dayjs | Temporal ou `@yaltaan/temporal` | dayjs diffère / cas |
|---|---|---|---:|
| Aujourd'hui, maintenant | `dayjs()` | `Temporal.Now.plainDateISO(zone), Temporal.Now.zonedDateTimeISO(zone)` | not compared |
| Afficher une date selon un motif | `d.format('YYYY-MM-DD HH:mm')` | `zoned.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ')` | not compared |
| Afficher une date à une personne | `d.format('DD/MM/YYYY')` | `date.toLocaleString('fr-FR')` | not compared |
| Ajouter des mois à une date | `dayjs.utc(text).add(1, 'month')` | `Temporal.PlainDate.from(text).add({ months: 1 })` | 0 / 5941 |
| Jours entre deux dates | `a.diff(b, 'day')` | `a.since(b, { largestUnit: 'days' }).days` | 0 / 8570 |
| Mois entre deux dates | `a.diff(b, 'month')` | `a.since(b, { largestUnit: 'months' }).months` | 162 / 8570 |
| Lire une heure dans un fuseau | `dayjs.tz(text, zone)` | `parseZonedDateTime(text, { timeZone: zone })` | 1383 / 1593 |
| Ajouter des heures dans un fuseau | `dayjs.tz(text, zone).add(3, 'hour')` | `zoned.add({ hours: 3 })` | 4262 / 6390 |
| Ajouter des jours dans un fuseau | `dayjs.tz(text, zone).add(1, 'day')` | `zoned.add({ days: 1 })` | 1068 / 2130 |
| Début d'une unité, sans fuseau | `dayjs.utc(text).startOf('month')` | `startOf(date, 'month')` | 0 / 2742 |
| Début d'une unité dans un fuseau | `dayjs.tz(text, zone).startOf('day')` | `startOf(zoned, 'day')` | 339 / 6808 |
| Fin d'une unité dans un fuseau | `dayjs.tz(text, zone).endOf('month')` | `endOf(zoned, 'month')` | 0 / 6808 |
| Une Date dans un fuseau, sur une machine réglée sur Paris | `dayjs(date).tz(zone)` | `fromDate(date, { timeZone: zone })` | 172 / 5325 |
| Une heure dans un fuseau, en Date | `dayjs.tz(text, zone).toDate()` | `toDate(wall, { timeZone: zone })` | 1 / 1483 |
| Quel instant vient en premier | `a.isBefore(b)` | `Temporal.ZonedDateTime.compare(a, b) < 0` | 307 / 3195 |
| Même jour dans le fuseau du premier | `a.isSame(b, 'day')` | `a.toPlainDate().equals(b.withTimeZone(a.timeZoneId).toPlainDate())` | 83 / 2130 |
| Entre deux bornes, fin exclue | `x.isBetween(a, b, null, '[)')` | `contains(span, x)` | 266 / 3195 |
| Lire un format déclaré | `dayjs(text, 'DD/MM/YYYY', true)` | `parsePlainDate(text, { format: 'dd/MM/yyyy' })` | 0 / 9247 |
| Vérifier qu'une date existe | `dayjs(text).isValid()` | `parsePlainDate(text).ok` | 483 / 2310 |
| Une année sur deux chiffres : les pivots diffèrent, il n'y a pas de vérité | `dayjs(text, 'DD/MM/YY')` | `parsePlainDate(text, { format: 'dd/MM/yy', pivotYear: 1969 })` | 0 / 300 |
