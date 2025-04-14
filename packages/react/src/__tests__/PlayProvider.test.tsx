import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/dom";
import { PlayProvider, PlayContext, CanPlayElement } from "../index";

describe("PlayProvider", () => {
  beforeEach(() => {
    // Clear console.error to prevent noise in test output
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("sets isProviderMissing to false when PlayProvider is used", () => {
    const TestComponent = () => {
      const context = React.useContext(PlayContext);
      return (
        <div data-testid="provider-status">
          {context.isProviderMissing ? "Missing" : "Present"}
        </div>
      );
    };

    const { getByTestId } = render(
      <PlayProvider>
        <TestComponent />
      </PlayProvider>
    );

    expect(getByTestId("provider-status")).toHaveTextContent("Present");
  });

  it("sets isProviderMissing to true when PlayProvider is not used", () => {
    const TestComponent = () => {
      const context = React.useContext(PlayContext);
      return (
        <div data-testid="provider-status">
          {context.isProviderMissing ? "Missing" : "Present"}
        </div>
      );
    };

    const { getByTestId } = render(<TestComponent />);

    expect(getByTestId("provider-status")).toHaveTextContent("Missing");
  });

  it("logs an error when CanPlayElement is used without a provider", () => {
    // Spy on console.error
    const consoleErrorSpy = vi.spyOn(console, "error");

    render(
      <CanPlayElement id="test-element" defaultData={{ test: "data" }}>
        {({ data }) => <div>{JSON.stringify(data)}</div>}
      </CanPlayElement>
    );

    // Error should be logged
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("No PlayProvider found");
  });

  it("does not log an error when CanPlayElement has standalone=true", () => {
    // Spy on console.error
    const consoleErrorSpy = vi.spyOn(console, "error");

    render(
      <CanPlayElement
        id="test-element"
        defaultData={{ test: "data" }}
        standalone={true}
      >
        {({ data }) => <div>{JSON.stringify(data)}</div>}
      </CanPlayElement>
    );

    // No error about missing provider should be logged
    const noProviderErrorCalls = consoleErrorSpy.mock.calls.filter(
      (call) =>
        typeof call[0] === "string" && call[0].includes("No PlayProvider found")
    );
    expect(noProviderErrorCalls.length).toBe(0);
  });
});
