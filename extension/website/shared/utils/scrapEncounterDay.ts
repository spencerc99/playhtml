// ABOUTME: Identifies the local calendar day of a recorded photo encounter.
// ABOUTME: Uses the capture timezone so counts stay stable when the viewer travels.

const formatters = new Map<string, Intl.DateTimeFormat>();

export function scrapEncounterDay(timestamp: number, timeZone: string): string {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    if (formatters.size >= 16)
      formatters.delete(formatters.keys().next().value!);
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(timestamp);
  const part = (type: string) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) throw new Error(`Missing encounter date ${type}`);
    return value;
  };
  return `${part("year")}-${part("month")}-${part("day")}`;
}
