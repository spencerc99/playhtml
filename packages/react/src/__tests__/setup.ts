import { expect, afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

// Extend Vitest's expect method with methods from React Testing Library
expect.extend(matchers);

// Runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
  cleanup();
});

// Create a mock playhtml instance
const mockedPlayhtml = {
  isInitialized: false,
  init: vi.fn().mockImplementation(() => {
    mockedPlayhtml.isInitialized = true;
    return Promise.resolve();
  }),
  setupPlayElements: vi.fn(),
  setupPlayElement: vi.fn(),
  removePlayElement: vi.fn(),
  elementHandlers: {},
  globalData: new Map(),
  dispatchPlayEvent: vi.fn(),
  registerPlayEventListener: vi.fn().mockReturnValue("mock-id"),
  removePlayEventListener: vi.fn(),
};

// Make mock available to tests
vi.stubGlobal("MOCKED_PLAYHTML", mockedPlayhtml);

// Mock playhtml initialization and event functions
vi.mock("playhtml", () => {
  return { playhtml: mockedPlayhtml };
});
