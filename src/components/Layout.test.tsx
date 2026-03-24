import { MemoryRouter, Route, Routes } from "react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { Layout } from "./Layout";

const { isTauriMock, useAuthMock } = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => isTauriMock(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../hooks/useDetection", () => ({
  useDetection: () => ({
    dismissNudge: vi.fn(),
    pause: vi.fn(),
    refreshStatus: vi.fn(),
    resume: vi.fn(),
    state: {
      nudgeActive: false,
      status: "active",
    },
  }),
}));

vi.mock("./DetectionNudgeBanner", () => ({
  DetectionNudgeBanner: () => null,
}));

describe("Layout", () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(false);
    useAuthMock.mockReturnValue({
      isLoading: false,
      signOut: vi.fn().mockResolvedValue({ error: null }),
      user: {
        email: "user@example.com",
      },
    });
  });

  function renderLayout(initialEntry: string) {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div>Session body</div>} />
            <Route path="/settings" element={<div>Settings body</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("pins the app frame to the viewport and keeps the session outlet overflow-hidden", () => {
    renderLayout("/");

    expect(screen.getByTestId("app-frame")).toHaveClass(
      "h-[calc(100vh-2.5rem)]",
      "min-h-0",
      "overflow-hidden",
    );
    expect(screen.getByTestId("route-content")).toHaveClass(
      "flex",
      "min-h-0",
      "flex-1",
      "overflow-hidden",
    );
    expect(screen.queryByText("user@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("Detection active")).not.toBeInTheDocument();
  });

  it("keeps non-session routes scrollable inside the fixed frame", () => {
    renderLayout("/settings");

    expect(screen.getByTestId("route-content")).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
    );
    expect(screen.getByText("Settings body")).toBeInTheDocument();
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByText("Detection active")).toBeInTheDocument();
  });

  it("shows a dev-only debug toggle at the bottom and expands the panel on demand", () => {
    isTauriMock.mockReturnValue(true);

    renderLayout("/");

    const toggle = screen.getByRole("button", { name: "Debug" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Dev only")).toBeInTheDocument();
    expect(screen.queryByText("Detection commands")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Detection commands")).toBeInTheDocument();
  });
});
