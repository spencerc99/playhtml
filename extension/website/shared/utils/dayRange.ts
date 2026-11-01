// ABOUTME: An inclusive span of local calendar days, keyed "YYYY-MM-DD", shared by every "when" filter.
// ABOUTME: Builds ranges from clicks, months, and recent-day presets, and formats them for chips and pills.

/** First and last local day of a span, inclusive. A single day has start === end. */
export interface DayRange {
  start: string;
  end: string;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function dayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

export function singleDay(day: string): DayRange {
  return { start: day, end: day };
}

/** The span between two days, whichever order they were picked in. */
export function spanBetween(a: string, b: string): DayRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}

export function isSingleDay(range: DayRange): boolean {
  return range.start === range.end;
}

export function dayRangeContains(range: DayRange, day: string): boolean {
  return day >= range.start && day <= range.end;
}

export function sameDayRange(a: DayRange | null, b: DayRange | null): boolean {
  return (
    a === b ||
    (a !== null && b !== null && a.start === b.start && a.end === b.end)
  );
}

/** Every local day in the span, oldest first. */
export function eachDay(range: DayRange): string[] {
  const days: string[] = [];
  const cursor = dayDate(range.start);
  for (let day = dayKey(cursor); day <= range.end; day = dayKey(cursor)) {
    days.push(day);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** How many calendar days the span covers, counting days with no data. */
export function dayRangeLength(range: DayRange): number {
  const ms = dayDate(range.end).getTime() - dayDate(range.start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** The whole calendar month a day falls in. */
export function monthOf(day: string): DayRange {
  const date = dayDate(day);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: dayKey(first), end: dayKey(last) };
}

/** Whether the span is exactly one whole calendar month. */
export function isWholeMonth(range: DayRange): boolean {
  return sameDayRange(range, monthOf(range.start));
}

/** The `count` days ending on `lastDay`, inclusive. */
export function recentDays(lastDay: string, count: number): DayRange {
  const end = dayDate(lastDay);
  const start = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate() - (count - 1),
  );
  return { start: dayKey(start), end: lastDay };
}

/**
 * The span in words: "Oct 3", "Oct 3 – 11", "Sep 28 – Oct 4", or
 * "September 2026" for a whole month. `withYear` appends the year to the
 * shorter forms, and adds it to both ends when the span crosses a year.
 */
export function formatDayRange(range: DayRange, withYear = false): string {
  const start = dayDate(range.start);
  const end = dayDate(range.end);
  if (isWholeMonth(range))
    return `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
  const startText = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  if (start.getFullYear() !== end.getFullYear()) {
    return `${startText}, ${start.getFullYear()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
  }
  const year = withYear ? `, ${end.getFullYear()}` : "";
  if (isSingleDay(range)) return `${startText}${year}`;
  if (start.getMonth() === end.getMonth())
    return `${startText} – ${end.getDate()}${year}`;
  return `${startText} – ${MONTHS[end.getMonth()]} ${end.getDate()}${year}`;
}

/** Reads `2026-10-03` or `2026-10-03..2026-10-11`; anything else is undefined. */
export function parseDayRange(raw: string): DayRange | undefined {
  const [start, end = start, ...rest] = raw.split("..");
  if (rest.length > 0 || !DAY_KEY.test(start) || !DAY_KEY.test(end))
    return undefined;
  return spanBetween(start, end);
}

/** The inverse of `parseDayRange`: a single day stays a bare day. */
export function serializeDayRange(range: DayRange): string {
  return isSingleDay(range) ? range.start : `${range.start}..${range.end}`;
}
