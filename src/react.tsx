import React, { PropsWithChildren } from "react";
import { useState, useCallback } from "react";
import { PartykitHost, PartykitRoom, globalData } from "./main";
import * as Y from "yjs";
import { TagType } from "./types";
import { useYMap, useYDoc } from "zustand-yjs";
import YPartyKitProvider from "y-partykit/provider";
import { IndexeddbPersistence } from "y-indexeddb";

// Exported functions for use of this library in by React projects.
interface CanPlayProps {}

export function CanPlayElement({}: PropsWithChildren<CanPlayProps>) {
  return React.cloneElement(React.Children.only(this.props.children), {
    // Note: mouseMove handler is attached to document so it will still function
    // when the user drags quickly and leaves the bounds of the element.
    onMouseDown: this.onMouseDown,
    onMouseUp: this.onMouseUp,
    // onTouchStart is added on `componentDidMount` so they can be added with
    // {passive: false}, which allows it to cancel. See
    // https://developers.google.com/web/updates/2017/01/scrolling-intervention
    onTouchEnd: this.onTouchEnd,
  });
}
//TODO: export an equivalent element for each of the things in elements.ts?

// usePartyState || useCollaborativeState
// useLivePartyState || useLiveCollaborativeState
// useLocalState

export function getCanPlayElementData(): Y.Map<any> {
  if (!globalData.get(TagType.CanPlay)) {
    globalData.set(TagType.CanPlay, new Y.Map<any>());
  }
  return globalData.get(TagType.CanPlay)!;
}

// what to do for schema upgrades / if the type changes / if it's different from what existed?
export function usePartyState<T>(
  id: string,
  defaultValue: T
): [T, (value: T) => void] {
  const doc = useYDoc("playhtml-global", (doc) => {
    const yprovider = new YPartyKitProvider(PartykitHost, PartykitRoom, doc);
    // @ts-ignore
    const _indexedDBProvider = new IndexeddbPersistence(PartykitRoom, doc);

    return () => {
      yprovider.destroy();
      _indexedDBProvider.destroy();
    };
  });
  const canPlayElementData = useYMap(doc.getMap(TagType.CanPlay)!);
  const [value, setValue] = useState(() => {
    console.log("state");
    const stickyValue = canPlayElementData.get(id);
    return stickyValue !== undefined ? stickyValue : defaultValue;
  });

  const updateValue = useCallback(
    (newValue) => {
      console.log("calback", newValue);
      setValue(newValue);
      canPlayElementData.set(id, newValue);
    },
    [id]
  );

  React.useEffect(() => {
    // TODO: anything to do if the value conflicts? i mean this is basically last writer wins here.
    // probably should special case for arrays and use y-array to handle the conflicts.
    // what about objects that conflict?
    const newValue = canPlayElementData.get(id);
    console.log("useeffect", newValue);
    setValue(newValue !== undefined ? newValue : defaultValue);
  }, []);

  return [value, updateValue];
}

// ok i think i need a useYDoc here...
