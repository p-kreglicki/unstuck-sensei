import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { App, AppNavigationBridge } from "./App";
import { ProfileSettingsProvider } from "./hooks/useProfileSettings";

const { listenMock, loadProfileSettingsMock, syncConfigMock, useAuthMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
  loadProfileSettingsMock: vi.fn(),
  syncConfigMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("./hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("./hooks/useDetection", () => ({
  useDetection: () => ({
    syncConfig: syncConfigMock,
  }),
}));

vi.mock("./lib/profile-settings", () => ({
  hasDetectionSettingsPatch: () => false,
  hasCompletedOnboarding: (profile: { onboardingCompletedAt: string | null }) =>
    profile.onboardingCompletedAt !== null,
  loadProfileSettings: (...args: unknown[]) => loadProfileSettingsMock(...args),
  resolveLocalTimeZone: () => "Europe/Rome",
  saveProfileSettings: vi.fn(),
}));

vi.mock("./lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

vi.mock("./components/Layout", () => ({
  Layout: () => <Outlet />,
}));

vi.mock("./pages/Login", () => ({
  Login: () => <div>Login page</div>,
}));

vi.mock("./pages/Onboarding", () => ({
  Onboarding: () => <div>Onboarding page</div>,
}));

vi.mock("./pages/Session", () => ({
  Session: () => <div>Session page</div>,
}));

vi.mock("./pages/History", () => ({
  History: () => <div>History page</div>,
}));

vi.mock("./pages/SessionDetail", () => ({
  SessionDetail: () => <div>Session detail page</div>,
}));

vi.mock("./pages/Settings", () => ({
  Settings: () => <div>Settings page</div>,
}));

function LocationProbe() {
  return (
    <Routes>
      <Route path="/" element={<div>Session route</div>} />
      <Route path="/settings" element={<div>Settings route</div>} />
    </Routes>
  );
}

describe("App routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAuthMock.mockReturnValue({
      cancelAccountDeletion: vi.fn(),
      finishAccountDeletion: vi.fn(),
      isAccountDeletionInProgress: false,
      isLoading: false,
      session: {
        user: {
          id: "user-1",
        },
      },
      startAccountDeletion: vi.fn(),
      user: {
        id: "user-1",
      },
    });
  });

  function renderApp(initialEntries: string[]) {
    return render(
      <ProfileSettingsProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <App />
        </MemoryRouter>
      </ProfileSettingsProvider>,
    );
  }

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

  it("routes incomplete users to onboarding before the shell routes mount", async () => {
    loadProfileSettingsMock.mockResolvedValue({
      onboardingCompletedAt: null,
    });

    renderApp(["/history"]);

    await waitFor(() => {
      expect(screen.getByText("Onboarding page")).toBeInTheDocument();
    });

    expect(screen.queryByText("History page")).not.toBeInTheDocument();
  });

  it("keeps incomplete users on the onboarding route without a redirect loop", async () => {
    loadProfileSettingsMock.mockResolvedValue({
      onboardingCompletedAt: null,
    });

    renderApp(["/onboarding"]);

    await waitFor(() => {
      expect(screen.getByText("Onboarding page")).toBeInTheDocument();
    });
  });

  it("routes onboarded users into history detail pages", async () => {
    loadProfileSettingsMock.mockResolvedValue({
      onboardingCompletedAt: "2026-03-21T12:00:00.000Z",
    });

    renderApp(["/history/session-123"]);

    await waitFor(() => {
      expect(screen.getByText("Session detail page")).toBeInTheDocument();
    });
  });

  it("redirects onboarded users away from onboarding and into the session route", async () => {
    loadProfileSettingsMock.mockResolvedValue({
      onboardingCompletedAt: "2026-03-21T12:00:00.000Z",
    });

    renderApp(["/onboarding"]);

    await waitFor(() => {
      expect(screen.getByText("Session page")).toBeInTheDocument();
    });
  });
});
