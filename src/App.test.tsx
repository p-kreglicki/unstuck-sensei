import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { AppNavigationBridge } from "./App";

const { listenMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("./components/Layout", () => ({
  Layout: () => null,
}));

vi.mock("./components/ProtectedRoute", () => ({
  ProtectedRoute: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./pages/Login", () => ({
  Login: () => null,
}));

vi.mock("./pages/PlaceholderPage", () => ({
  PlaceholderPage: () => null,
}));

vi.mock("./pages/Session", () => ({
  Session: () => null,
}));

function LocationProbe() {
  return (
    <Routes>
      <Route path="/" element={<div>Session route</div>} />
      <Route path="/settings" element={<div>Settings route</div>} />
    </Routes>
  );
}

describe("AppNavigationBridge", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("routes tray navigation events into the settings page", async () => {
    let handler:
      | ((event: { payload: { to: "/" | "/settings"; source?: "tray" } }) => void)
      | undefined;

    listenMock.mockImplementation(
      (
        _eventName: string,
        callback: (event: {
          payload: { to: "/" | "/settings"; source?: "tray" };
        }) => void,
      ) => {
      handler = callback;
      return Promise.resolve(() => undefined);
      },
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppNavigationBridge />
        <LocationProbe />
      </MemoryRouter>,
    );

    if (!handler) {
      throw new Error("Expected navigation listener to be registered.");
    }

    handler({
      payload: {
        to: "/settings",
        source: "tray",
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Settings route")).toBeInTheDocument();
    });
  });
});
