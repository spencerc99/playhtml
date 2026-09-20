// ABOUTME: Checks that the React API accepts values and prop-derived configuration.
// ABOUTME: Rejects DOM-dependent callbacks in public default-data and awareness props.
import { CanPlayElement, withSharedState } from "../index";
import type { ReactElementInitializer } from "../utils";

type Data = { label: string };
type Awareness = { status: string };

export function verifyDefaultTypes(): void {
  const config: Omit<ReactElementInitializer<Data, Awareness>, "children"> = {
    defaultData: { label: "Alice" },
    myDefaultAwareness: { status: "here" },
  };
  // @ts-expect-error React default data is a value, not an element callback.
  config.defaultData = (element: HTMLElement) => ({ label: element.id });
  // @ts-expect-error React default awareness is a value, not an element callback.
  config.myDefaultAwareness = (element: HTMLElement) => ({ status: element.id });

  // @ts-expect-error Inferred function data cannot bypass the value-only contract.
  const invalid = <CanPlayElement defaultData={(element: HTMLElement) => ({ label: element.id })}>{() => <div id="invalid" />}</CanPlayElement>;
  void invalid;

  // @ts-expect-error Inferred awareness callbacks are not default values.
  const invalidAwareness = <CanPlayElement defaultData={{ label: "Alice" }} myDefaultAwareness={(element: HTMLElement) => ({ status: element.id })}>{() => <div id="invalid-awareness" />}</CanPlayElement>;
  void invalidAwareness;

  // @ts-expect-error The config factory returns values, not DOM-dependent defaults.
  withSharedState({ defaultData: (element: HTMLElement) => ({ label: element.id }) }, () => <div id="invalid-config" />);

  const Selection = withSharedState<Data, Awareness, { label: string }>(
    ({ label }) => ({ defaultData: { label }, myDefaultAwareness: { status: "here" } }),
    ({ data }) => <div id="selection">{data.label}</div>,
  );
  void <Selection label="Bob" />;
}
