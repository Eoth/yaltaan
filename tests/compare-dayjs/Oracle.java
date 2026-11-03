import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.time.temporal.ChronoUnit;
import java.time.zone.ZoneRulesProvider;

/**
 * The independent side of the comparison: java.time, which shares no code with dayjs or Temporal. Reads a family and
 * its arguments, tab-separated, one case per line; answers one line per case, in the text of families.mjs.
 */
public final class Oracle {
  private static final String REFUSED = "refused";
  private static final String NOT_APPLICABLE = "n/a";

  private static String stamp(ZonedDateTime z) {
    return z.getYear() + "-" + z.getMonthValue() + "-" + z.getDayOfMonth() + "T" + z.getHour() + ":" + z.getMinute()
        + ":" + z.getSecond() + "." + z.getNano() / 1_000_000 + " " + z.toInstant().toEpochMilli();
  }

  private static String date(LocalDate d) {
    return d.getYear() + "-" + d.getMonthValue() + "-" + d.getDayOfMonth();
  }

  private static ZonedDateTime zoned(String wall, String zone) {
    return LocalDateTime.parse(wall).atZone(ZoneId.of(zone));
  }

  private static LocalDate unitStart(LocalDate d, String unit) {
    switch (unit) {
      case "day":
        return d;
      case "isoWeek":
        return d.minusDays(d.getDayOfWeek().getValue() - 1);
      case "week":
        return d.minusDays(d.getDayOfWeek().getValue() % 7);
      case "month":
        return d.withDayOfMonth(1);
      case "quarter":
        return d.withDayOfMonth(1).withMonth(3 * ((d.getMonthValue() - 1) / 3) + 1);
      default:
        return d.withDayOfYear(1);
    }
  }

  private static LocalDate unitNext(LocalDate start, String unit) {
    switch (unit) {
      case "day":
        return start.plusDays(1);
      case "isoWeek":
      case "week":
        return start.plusDays(7);
      case "month":
        return start.plusMonths(1);
      case "quarter":
        return start.plusMonths(3);
      default:
        return start.plusYears(1);
    }
  }

  private static String pattern(String format) {
    return format.replace("YYYY", "uuuu").replace("YY", "uu").replace("DD", "dd");
  }

  private static String answer(String family, String[] a) {
    String base = family.contains("@") ? family.substring(0, family.indexOf('@')) : family;
    switch (base) {
      case "add-months":
        return date(LocalDate.parse(a[0]).plusMonths(Long.parseLong(a[1])));
      case "add-days":
        return date(LocalDate.parse(a[0]).plusDays(Long.parseLong(a[1])));
      case "diff-months":
        return String.valueOf(ChronoUnit.MONTHS.between(LocalDate.parse(a[1]), LocalDate.parse(a[0])));
      case "diff-days":
        return String.valueOf(ChronoUnit.DAYS.between(LocalDate.parse(a[1]), LocalDate.parse(a[0])));
      case "diff-years":
        return String.valueOf(ChronoUnit.YEARS.between(LocalDate.parse(a[1]), LocalDate.parse(a[0])));
      case "start-of-plain":
        return date(unitStart(LocalDate.parse(a[0]), a[1]));
      case "end-of-plain":
        return date(unitNext(unitStart(LocalDate.parse(a[0]), a[1]), a[1]).minusDays(1));
      case "gap-in-zone":
      case "overlap-in-zone":
      case "gap-local":
      case "overlap-local":
        return stamp(zoned(a[0], a[1]));
      case "zoned-add-days":
        return stamp(zoned(a[0], a[1]).plusDays(Long.parseLong(a[2])));
      case "zoned-add-months":
        return stamp(zoned(a[0], a[1]).plusMonths(Long.parseLong(a[2])));
      case "zoned-add-hours":
        return stamp(zoned(a[0], a[1]).plusHours(Long.parseLong(a[2])));
      case "zoned-diff-hours":
        return String.valueOf(ChronoUnit.HOURS.between(zoned(a[1], a[2]), zoned(a[0], a[2])));
      case "zoned-diff-days":
        return String.valueOf(ChronoUnit.DAYS.between(zoned(a[1], a[2]), zoned(a[0], a[2])));
      case "start-of-zoned":
        return stamp(unitStart(zoned(a[0], a[1]).toLocalDate(), a[2]).atStartOfDay(ZoneId.of(a[1])));
      case "end-of-zoned": {
        LocalDate start = unitStart(zoned(a[0], a[1]).toLocalDate(), a[2]);
        return stamp(unitNext(start, a[2]).atStartOfDay(ZoneId.of(a[1])).minusNanos(1_000_000));
      }
      case "date-to-zone":
      case "old-date-to-zone":
      case "far-date-to-zone":
        return stamp(Instant.ofEpochMilli(Long.parseLong(a[0])).atZone(ZoneId.of(a[1])));
      case "zone-to-date":
        return String.valueOf(zoned(a[0], a[1]).toInstant().toEpochMilli());
      case "zone-to-utc":
        return stamp(zoned(a[0], a[1]).withZoneSameInstant(ZoneOffset.UTC));
      case "zone-to-zone":
        return stamp(zoned(a[0], a[1]).withZoneSameInstant(ZoneId.of(a[2])));
      case "compare": {
        int order = zoned(a[0], a[1]).toInstant().compareTo(zoned(a[2], a[3]).toInstant());
        return order < 0 ? "before" : order > 0 ? "after" : "same";
      }
      case "same-day": {
        ZonedDateTime left = zoned(a[0], a[1]);
        ZonedDateTime right = zoned(a[2], a[3]).withZoneSameInstant(left.getZone());
        return left.toLocalDate().equals(right.toLocalDate()) ? "same day" : "other day";
      }
      case "between": {
        Instant x = zoned(a[0], a[3]).toInstant();
        Instant low = zoned(a[1], a[3]).toInstant();
        Instant high = zoned(a[2], a[3]).toInstant();
        boolean above = a[4].charAt(0) == '[' ? !x.isBefore(low) : x.isAfter(low);
        boolean below = a[4].charAt(1) == ']' ? !x.isAfter(high) : x.isBefore(high);
        return above && below ? "between" : "outside";
      }
      case "interval-contains": {
        Instant x = zoned(a[0], a[3]).toInstant();
        boolean inside = !x.isBefore(zoned(a[1], a[3]).toInstant()) && x.isBefore(zoned(a[2], a[3]).toInstant());
        return inside ? "in" : "out";
      }
      case "interval-overlaps": {
        Instant first = zoned(a[0], a[4]).toInstant();
        Instant firstEnd = zoned(a[1], a[4]).toInstant();
        Instant second = zoned(a[2], a[4]).toInstant();
        Instant secondEnd = zoned(a[3], a[4]).toInstant();
        return first.isBefore(secondEnd) && second.isBefore(firstEnd) ? "yes" : "no";
      }
      case "validate-permissive":
      case "validate-strict":
      case "parse-permissive":
      case "extreme-read":
        return date(LocalDate.parse(a[0], DateTimeFormatter.ISO_LOCAL_DATE));
      case "parse-strict":
        return date(LocalDate.parse(a[0],
            DateTimeFormatter.ofPattern(pattern(a[1])).withResolverStyle(ResolverStyle.STRICT)));
      case "two-digit-year":
        return date(LocalDate.parse(a[0],
            DateTimeFormatter.ofPattern("dd/MM/uu").withResolverStyle(ResolverStyle.STRICT)));
      case "extreme-add-month":
        return date(LocalDate.parse(a[0]).plusMonths(1));
      case "extreme-add-year":
        return date(LocalDate.parse(a[0]).plusYears(1));
      default:
        throw new IllegalArgumentException("unknown family " + family);
    }
  }

  private static boolean unknownZone(String[] a) {
    for (String value : a) {
      if (value.contains("/") && !value.contains(":") && !value.matches("[0-9/ -]*")) {
        return !ZoneId.getAvailableZoneIds().contains(value);
      }
    }
    return false;
  }

  public static void main(String[] args) throws Exception {
    if (args.length > 0 && args[0].equals("--version")) {
      String version = ZoneRulesProvider.getVersions("Europe/Paris").lastKey();
      System.out.println("java " + System.getProperty("java.version") + ", tzdb " + version);
      return;
    }
    try (BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        BufferedWriter out = new BufferedWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8))) {
      String line;
      while ((line = in.readLine()) != null) {
        String[] fields = line.split("\t", -1);
        String[] a = java.util.Arrays.copyOfRange(fields, 1, fields.length);
        String result;
        try {
          result = unknownZone(a) ? NOT_APPLICABLE : answer(fields[0], a);
        } catch (DateTimeException | ArithmeticException | IllegalArgumentException e) {
          result = REFUSED;
        }
        out.write(result);
        out.write('\n');
      }
    }
  }
}
