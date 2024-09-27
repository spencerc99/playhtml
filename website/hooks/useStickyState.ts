import React from "react";

export function useStickyState<T = any>(
  key: string,
  defaultValue: T,
  onUpdateCallback?: (value: T) => void
): [T, (value: T) => void] {
  const [value, setValue] = React.useState(() => {
    const stickyValue = window.localStorage.getItem(key);
    return stickyValue !== null ? JSON.parse(stickyValue) : defaultValue;
  });
  React.useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(value));
    onUpdateCallback?.(value);
  }, [key, value]);
  return [value, setValue];
}
