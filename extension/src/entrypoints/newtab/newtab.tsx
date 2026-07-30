// ABOUTME: Mounts the walking record as both a standalone extension page and the new-tab override.
// ABOUTME: Loads one completed week of local events and derives the page without network requests.

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import { WalkingRecordPage } from "../../components/WalkingRecord";
import {
  deriveWalkingRecord,
  getLastCompletedWeek,
  type WalkingRecord,
  type WalkingRecordDomain,
} from "../../history/walkingRecord";
import type { CollectionEvent } from "../../collectors/types";
import type { ScreenTimeSession } from "../../storage/LocalEventStore";

interface EventsResponse {
  success?: boolean;
  events?: CollectionEvent[];
  cursorDistancePx?: number;
}

interface ScreenTimeResponse {
  success?: boolean;
  sessions?: ScreenTimeSession[];
}

interface DomainsResponse {
  success?: boolean;
  domains?: WalkingRecordDomain[];
}

async function loadWalkingRecord(): Promise<WalkingRecord> {
  const range = getLastCompletedWeek();
  const [eventsResponse, screenTimeResponse, domainsResponse] = (await Promise.all([
    browser.runtime.sendMessage({
      type: "GET_WALKING_RECORD_EVENTS",
      options: {
        startTs: range.startTs,
        endTs: range.endTs,
      },
    }),
    browser.runtime.sendMessage({
      type: "GET_SCREEN_TIME",
      options: {
        startTs: range.startTs,
        endTs: range.endTs,
      },
    }),
    browser.runtime.sendMessage({ type: "GET_ALL_DOMAINS" }),
  ])) as [EventsResponse, ScreenTimeResponse, DomainsResponse];

  if (!eventsResponse.success || !eventsResponse.events) {
    throw new Error("The local activity record is unavailable.");
  }
  if (!screenTimeResponse.success || !screenTimeResponse.sessions) {
    throw new Error("The local screen-time record is unavailable.");
  }
  if (!domainsResponse.success || !domainsResponse.domains) {
    throw new Error("The local place record is unavailable.");
  }

  return deriveWalkingRecord({
    events: eventsResponse.events,
    sessions: screenTimeResponse.sessions,
    domains: domainsResponse.domains,
    range,
    cursorDistancePx: eventsResponse.cursorDistancePx,
  });
}

function NewTabPage() {
  const [record, setRecord] = useState<WalkingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWalkingRecord()
      .then(setRecord)
      .catch((loadError: unknown) => {
        console.error("[WalkingRecord] Could not load local activity:", loadError);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The local activity record is unavailable.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const openCollections = async () => {
    const action = browser.action as typeof browser.action & {
      openPopup?: () => Promise<void>;
    };

    if (action.openPopup) {
      try {
        await action.openPopup();
        return;
      } catch (popupError) {
        console.warn("[WalkingRecord] Could not open popup:", popupError);
      }
    }

    window.location.assign(browser.runtime.getURL("popup.html"));
  };

  return (
    <WalkingRecordPage
      record={record}
      loading={loading}
      error={error}
      portraitHref={browser.runtime.getURL("portrait.html")}
      onOpenCollections={openCollections}
    />
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Walking record root element is missing.");
}

createRoot(container).render(<NewTabPage />);
