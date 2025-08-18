import React, { useMemo, useState } from "react";
import { withSharedState } from "@playhtml/react";

type PollOption = { id: string; label: string };
type VotesByUser = { [userId: string]: string }; // single-select by default

type PollData = {
  question: string;
  options: PollOption[];
  votesByUser: VotesByUser;
};

interface PollProps {
  question?: string;
  options?: string[]; // initial options from props
  allowAddOptions?: boolean; // if true, allow collaborative option adds
}

function getUserId(): string {
  try {
    const existing = localStorage.getItem("userId");
    if (existing) return existing;
    const id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem("userId", id);
    return id;
  } catch {
    return "anon";
  }
}

export const Poll = withSharedState<PollData, any, PollProps>(
  ({ question = "Which do you prefer?", options = [] }) => ({
    defaultData: {
      question,
      options: options.map((label) => ({
        id: Math.random().toString(36).slice(2, 10),
        label,
      })),
      votesByUser: {},
    },
  }),
  ({ data, setData }, { allowAddOptions = true, options = [] }) => {
    const [newOption, setNewOption] = useState("");
    const userId = getUserId();
    const lockedLabels = useMemo(() => new Set(options), [options]);

    const totals = useMemo(() => {
      const tally: Record<string, number> = {};
      for (const option of data.options) tally[option.id] = 0;
      for (const [, optionId] of Object.entries(data.votesByUser)) {
        if (tally[optionId] !== undefined) tally[optionId] += 1;
      }
      return tally;
    }, [data.options, data.votesByUser]);

    const totalVotes = useMemo(
      () => Object.values(totals).reduce((a, b) => a + b, 0),
      [totals]
    );

    const myVote = data.votesByUser[userId];

    const addOption = () => {
      const label = newOption.trim();
      if (!label) return;
      const id = Math.random().toString(36).slice(2, 10);
      setData({
        question: data.question,
        options: [...data.options, { id, label }],
      setData(draft => {
        draft.options.push({ id, label });
      });
      setNewOption("");
    };

    const vote = (optionId: string) => {
      if (!data.options.find((o) => o.id === optionId)) return;
      setData({
        question: data.question,
        options: data.options,
        votesByUser: { ...data.votesByUser, [userId]: optionId },
      });
    };

    const removeOption = (id: string) => {
      const opt = data.options.find((o) => o.id === id);
      if (!opt) return;
      if (lockedLabels.has(opt.label)) return; // do not remove initial options
      setData({
        question: data.question,
        options: data.options.filter((o) => o.id !== id),
        votesByUser: Object.fromEntries(
          Object.entries(data.votesByUser).filter(([, oid]) => oid !== id)
        ),
      });
    };

    return (
      <div id="poll2" style={{ maxWidth: 420 }}>
        <h3 style={{ margin: "8px 0" }}>{data.question}</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {data.options.map((o) => {
            const count = totals[o.id] || 0;
            const pct = totalVotes ? Math.round((100 * count) / totalVotes) : 0;
            const isMine = myVote === o.id;
            return (
              <li key={o.id} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    onClick={() => vote(o.id)}
                    aria-pressed={isMine}
                    title={isMine ? "Your vote" : "Vote"}
                  >
                    {isMine ? "✔" : "○"}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <span>{o.label}</span>
                      <span>
                        {count} ({pct}%)
                      </span>
                    </div>
                    <div
                      style={{ background: "#eee", height: 6, borderRadius: 3 }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: isMine ? "#6aa84f" : "#999",
                          borderRadius: 3,
                        }}
                      />
                    </div>
                  </div>
                  {!lockedLabels.has(o.label) && (
                    <button
                      onClick={() => removeOption(o.id)}
                      aria-label="remove"
                      title="Remove option"
                    >
                      ×
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {allowAddOptions && (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              placeholder="Add option"
              value={newOption}
              onChange={(e) => setNewOption(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOption()}
            />
            <button onClick={addOption}>Add</button>
          </div>
        )}
      </div>
    );
  }
);
