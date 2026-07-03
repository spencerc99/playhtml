// ABOUTME: Formats village guestbook standing text from server-attested counters.
// ABOUTME: Keeps earned-role UI copy aligned with the counter used by the room rules.

type GuestbookRung = "visitor" | "returning" | "regular" | "keeper";
type GuestbookCounterName = "days" | "sessions";
type GuestbookCounters = Partial<Record<GuestbookCounterName, number>>;

interface GuestbookStandingInput {
  rung: GuestbookRung;
  counterName: GuestbookCounterName;
  counters: GuestbookCounters | undefined;
  permissionsEnforced: boolean;
  canSign: boolean;
  regularThreshold: number;
}

interface GuestbookStandingCopy {
  standing: string;
  signNote: string;
}

const counterLabels: Record<
  GuestbookCounterName,
  { singular: string; plural: string; preposition: string; waitCopy: string }
> = {
  days: {
    singular: "day",
    plural: "days",
    preposition: "on",
    waitCopy:
      "come back tomorrow and the book will take your signature — standing here is earned by returning, not by asking.",
  },
  sessions: {
    singular: "session",
    plural: "sessions",
    preposition: "in",
    waitCopy:
      "connect again and the book will take your signature — standing here is earned by returning, not by asking.",
  },
};

function formatCounter(counterName: GuestbookCounterName, value: number): string {
  const label = counterLabels[counterName];
  const unit = value === 1 ? label.singular : label.plural;
  return `the room has seen you ${label.preposition} ${value} ${unit}`;
}

export function describeGuestbookStanding(
  input: GuestbookStandingInput,
): GuestbookStandingCopy {
  const counter = input.counters?.[input.counterName];
  const counterText =
    counter === undefined
      ? input.permissionsEnforced
        ? "verifying…"
        : `client-only mode — the room can't count ${counterLabels[input.counterName].plural} without the server`
      : formatCounter(input.counterName, counter);

  const standing = `you are a ${input.rung} · ${counterText}`;
  if (input.canSign) {
    return {
      standing,
      signNote:
        input.rung === "keeper"
          ? "the book is yours to tend."
          : `you may sign. regulars (${input.regularThreshold} ${counterLabels[input.counterName].plural}) may also sweep up.`,
    };
  }

  return {
    standing,
    signNote:
      counter === undefined ? "" : counterLabels[input.counterName].waitCopy,
  };
}

export type { GuestbookCounterName, GuestbookRung };
