// ABOUTME: Builds and reads the day filter shared by walking-record and portrait pages.
// ABOUTME: Accepts only real local calendar dates in YYYY-MM-DD form.

export function portraitDayPath(day: string): string {
  return `portrait.html?${new URLSearchParams({ day }).toString()}`;
}

export function portraitDayFromSearch(search: string): string | null {
  const day = new URLSearchParams(search).get("day");
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  const date = new Date(`${day}T00:00:00`);
  const validDay = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return validDay === day ? day : null;
}
