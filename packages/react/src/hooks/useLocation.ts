// ABOUTME: Tracks the browser pathname and search string for React consumers.
// ABOUTME: Updates location state when the browser emits a popstate event.
// from https://gist.github.com/lenkan/357b006dd31a8c78f659430467369ea7
import { useState, useEffect } from "react";

function getCurrentLocation() {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

export function useLocation() {
  const [{ pathname, search }, setLocation] = useState(getCurrentLocation());

  useEffect(() => {
    window.addEventListener("popstate", handleChange);
    return () => window.removeEventListener("popstate", handleChange);
  }, []);

  function handleChange() {
    setLocation(getCurrentLocation());
  }

  return {
    pathname,
    search,
  };
}
