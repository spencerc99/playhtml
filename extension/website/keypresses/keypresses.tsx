// ABOUTME: Entry point for the Internet Keypresses visualization
// ABOUTME: Fetches keyboard events with pagination and domain filtering, passes them to KeypressesGrid
import "./keypresses.scss";
import { useState, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { KeypressesGrid } from "../shared/components/KeypressesGrid";
import { RECENT_EVENTS_URL } from "../shared/config";
import { useKeypressEvents } from "./useKeypressEvents";

const API_URL = RECENT_EVENTS_URL;
const PAGE_SIZE = 20000;
const DOMAIN_FILTER_KEY = "keypresses-domain-filter";

const InternetKeypresses = () => {
  const [domainFilter, setDomainFilter] = useState<string>(
    () => localStorage.getItem(DOMAIN_FILTER_KEY) ?? "",
  );
  const { events, loading, error, hasMore, refresh, fetchOlder } =
    useKeypressEvents(API_URL, PAGE_SIZE, domainFilter);

  const handleDomainFilterChange = useCallback((domain: string) => {
    setDomainFilter(domain);
  }, []);

  return (
    <KeypressesGrid
      events={events}
      loading={loading}
      error={error}
      onRefresh={refresh}
      onFetchOlder={fetchOlder}
      hasMore={hasMore}
      onDomainFilterChange={handleDomainFilterChange}
    />
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetKeypresses />);
