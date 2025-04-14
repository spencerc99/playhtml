import React, { useEffect, useState } from "react";
import { withSharedState } from "@playhtml/react";

interface Reaction {
  emoji: string;
  count: number;
}

interface Props {
  reaction: Reaction;
}

export const ReactionView = withSharedState(
  ({ reaction: { count } }: Props) => ({
    defaultData: { count },
  }),
  ({ data, setData, ref }, props: Props) => {
    const {
      reaction: { emoji },
    } = props;
    const [hasReacted, setHasReacted] = useState(false);

    useEffect(() => {
      if (ref.current) {
        // This should be managed by playhtml.. it should be stored in some sort of
        // locally-persisted storage.
        setHasReacted(Boolean(localStorage.getItem(ref.current.id)));
      }
    }, [ref.current?.id]);

    return (
      <button
        onClick={(_e) => {
          const { count } = data;
          if (hasReacted) {
            setData({ count: count - 1 });
            if (ref.current) {
              localStorage.removeItem(ref.current.id);
            }
            setHasReacted(false);
          } else {
            setData({ count: count + 1 });
            if (ref.current) {
              localStorage.setItem(ref.current.id, "true");
            }
            setHasReacted(true);
          }
        }}
        className={`reaction ${hasReacted ? "reacted" : ""}`}
        selector-id=".reactions reaction"
      >
        {emoji} <span className="count">{data.count}</span>
      </button>
    );
  }
);
