import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { OnboardingGate } from "./OnboardingGate";
import {
  ProfileSettingsProvider,
  useProfileSettings,
} from "../hooks/useProfileSettings";

const { loadProfileSettingsMock, syncConfigMock, useAuthMock } = vi.hoisted(() => ({
  loadProfileSettingsMock: vi.fn(),
  syncConfigMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("../hooks/useDetection", () => ({
  useDetection: () => ({
    syncConfig: syncConfigMock,
  }),
}));

vi.mock("../lib/profile-settings", () => ({
  hasCompletedOnboarding: (profile: { onboardingCompletedAt: string | null }) =>
    profile.onboardingCompletedAt !== null,
  hasDetectionSettingsPatch: () => false,
  loadProfileSettings: (...args: unknown[]) => loadProfileSettingsMock(...args),
  resolveLocalTimeZone: () => "Europe/Rome",
  saveProfileSettings: vi.fn(),
}));

function ProfileProbe() {
  const { profile } = useProfileSettings();

  return <div>{profile?.preferredTime ?? "missing"}</div>;
}

describe("OnboardingGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAuthMock.mockReturnValue({
      cancelAccountDeletion: vi.fn(),
      finishAccountDeletion: vi.fn(),
      isAccountDeletionInProgress: false,
      session: {
        access_token: "token-123",
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

  it("shares a single loaded profile between the gate and downstream consumers", async () => {
    loadProfileSettingsMock.mockResolvedValue({
      createdAt: "2026-03-22T10:00:00.000Z",
      detectionEnabled: true,
      detectionSensitivity: "medium",
      displayName: "Founder",
      emailEnabled: true,
      id: "user-1",
      lastEmailSentAt: null,
      onboardingCompletedAt: null,
      preferredTime: "09:00",
      timezone: "Europe/Rome",
      updatedAt: "2026-03-22T10:00:00.000Z",
    });

    render(
      <ProfileSettingsProvider>
        <MemoryRouter initialEntries={["/onboarding"]}>
          <Routes>
            <Route element={<OnboardingGate />}>
              <Route path="/onboarding" element={<ProfileProbe />} />
              <Route path="/" element={<Outlet />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ProfileSettingsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("09:00")).toBeInTheDocument();
    });

    expect(loadProfileSettingsMock).toHaveBeenCalledTimes(1);
    expect(loadProfileSettingsMock).toHaveBeenCalledWith("user-1");
  });
});
