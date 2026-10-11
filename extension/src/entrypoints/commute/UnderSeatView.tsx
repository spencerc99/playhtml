// ABOUTME: Side view under one carriage seat, where riders read and tuck away notes.
// ABOUTME: Notes are shared and persistent per seat, keyed so writers never clobber.

import { useState } from "react";
import { usePlayContext, withSharedState } from "@playhtml/react";
import { CommuteSideView } from "./CommuteSideView";
import {
  SEAT_NOTE_MAX_LENGTH,
  getNoteAgeLabel,
  getOverflowNoteIds,
  getSeatNotes,
  normalizeSeatNoteText,
  type SeatNote,
  type SeatNotesData,
} from "./seatNotes";

interface UnderSeatViewProps {
  id: string;
  seatId: number;
  onClose: () => void;
}

function createNoteId(): string {
  return `note-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export const UnderSeatView = withSharedState<
  SeatNotesData,
  never,
  UnderSeatViewProps
>(
  () => ({
    defaultData: {} as SeatNotesData,
  }),
  ({ data, setData, ref }, props) => {
    const { cursors } = usePlayContext();
    const [now] = useState(() => Date.now());
    const [draft, setDraft] = useState("");

    const seatKey = String(props.seatId);
    const notes = getSeatNotes(data[seatKey]);

    // Written from an explicit submit — never from a callback that re-runs
    // when the shared notes change.
    const tuckNote = (event: React.FormEvent) => {
      event.preventDefault();
      const text = normalizeSeatNoteText(draft);
      if (!text) return;

      const note: SeatNote = {
        id: createNoteId(),
        color: cursors.color || "#c4724e",
        text,
        leftAt: Date.now(),
      };

      setData((current) => {
        if (!current[seatKey]) current[seatKey] = {};
        current[seatKey][note.id] = note;
        for (const overflowId of getOverflowNoteIds(current[seatKey])) {
          delete current[seatKey][overflowId];
        }
      });
      setDraft("");
    };

    return (
      <section id={props.id} ref={ref}>
        <CommuteSideView
          index="01"
          title="Under the seat"
          caption="crouch to find what someone left"
          onClose={props.onClose}
          notes={[
            {
              label: "the act",
              body: "Crouching is the whole interaction. Nothing is listed anywhere; you find notes by looking where people hide things.",
            },
            {
              label: "at zero riders",
              tone: "rust",
              body: (
                <>
                  Old notes stay tucked and yellow with age. An empty car still
                  has things under the seats — it reads as <em>long-running</em>
                  , not abandoned.
                </>
              ),
            },
          ]}
        >
          <div className="under-seat">
            <ul className="under-seat__notes">
              {notes.length === 0 && (
                <li className="under-seat__empty">
                  nothing under this one yet — leave the first
                </li>
              )}
              {notes.map((note, index) => (
                <li
                  className="under-seat__note"
                  key={note.id}
                  style={
                    {
                      "--note-color": note.color,
                      // Tucked by hand, so no two sit perfectly square.
                      "--note-tilt": `${index % 2 === 0 ? -0.7 : 0.6}deg`,
                    } as React.CSSProperties
                  }
                >
                  <span className="under-seat__note-age">
                    left {getNoteAgeLabel(note.leftAt, now)}
                  </span>
                  <p>{note.text}</p>
                </li>
              ))}
            </ul>
            <form className="under-seat__compose" onSubmit={tuckNote}>
              <label htmlFor={`${props.id}-draft`}>leave a note</label>
              <input
                id={`${props.id}-draft`}
                value={draft}
                maxLength={SEAT_NOTE_MAX_LENGTH}
                placeholder="tuck something under for the next rider"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" disabled={normalizeSeatNoteText(draft) === ""}>
                tuck it under
              </button>
            </form>
          </div>
        </CommuteSideView>
      </section>
    );
  },
);
