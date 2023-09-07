import React, { PropsWithChildren, useEffect, useRef } from "react";
import { useState, useCallback } from "react";
import { PartykitHost, PartykitRoom, globalData } from "../src/main";
import * as Y from "yjs";
import { TagType } from "./types";
import YPartyKitProvider from "y-partykit/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { useSyncedStore } from "@syncedstore/react";
import { syncedStore, getYjsDoc } from "@syncedstore/core";
import { playhtml } from "playhtml";
import { ElementInitializer } from "playhtml/types";

// Get the Yjs document and sync automatically using y-webrtc

export function Playable(props: PropsWithChildren<ElementInitializer>) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (playhtml.firstSetup) {
      throw Error("playhtml not setup. Please call playhtml.init() first.");
    }
    if (ref.current) {
      playhtml.setupPlayElement(ref.current);
    }

    // TODO: remove play element when unmounted
  });
  return React.cloneElement(React.Children.only(props.children), {
    ...props,
    ref,
  });
}

export function Movable(props: PropsWithChildren<{}>) {
  return <Playable {...CanMoveProps}>{props.children}</Playable>;
}
//TODO: export an equivalent element for each of the things in elements.ts?
