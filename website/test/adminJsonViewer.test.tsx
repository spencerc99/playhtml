// ABOUTME: Tests inline state editing in the admin JSON viewer.
// ABOUTME: Verifies primitive leaf edits update the caller-owned JSON tree.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { JSONViewer } from "../admin";

describe("JSONViewer", () => {
  test("edits primitive leaf values through onDataChange", () => {
    const onDataChange = vi.fn();

    render(
      <JSONViewer
        data={{
          title: "hello",
          stats: { count: 1, active: false },
        }}
        onDataChange={onDataChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1" }));
    const input = screen.getByLabelText("Edit state value");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onDataChange).toHaveBeenCalledWith({
      title: "hello",
      stats: { count: 7, active: false },
    });
  });
});
