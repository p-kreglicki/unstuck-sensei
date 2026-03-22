import { act, renderHook, waitFor } from "@testing-library/react";
import { useProfileSettings } from "./useProfileSettings";

const {
  loadProfileSettingsMock,
  saveProfileSettingsMock,
  signOutMock,
  supabaseUpdateUserMock,
  syncConfigMock,
  useAuthMock,
} = vi.hoisted(() => ({
  loadProfileSettingsMock: vi.fn(),
  saveProfileSettingsMock: vi.fn(),
  signOutMock: vi.fn(),
  supabaseUpdateUserMock: vi.fn(),
  syncConfigMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("./useAuth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("./useDetection", () => ({
  useDetection: () => ({
    syncConfig: syncConfigMock,
  }),
}));

vi.mock("../lib/profile-settings", () => ({
  hasDetectionSettingsPatch: (patch: { detectionEnabled?: boolean; detectionSensitivity?: string }) =>
    patch.detectionEnabled !== undefined || patch.detectionSensitivity !== undefined,
  loadProfileSettings: (...args: unknown[]) => loadProfileSettingsMock(...args),
  resolveLocalTimeZone: () => "Europe/Rome",
  saveProfileSettings: (...args: unknown[]) => saveProfileSettingsMock(...args),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      signOut: (...args: unknown[]) => signOutMock(...args),
      updateUser: (...args: unknown[]) => supabaseUpdateUserMock(...args),
    },
  },
}));

describe("useProfileSettings", () => {
  const profile = {
    detectionEnabled: true,
    detectionSensitivity: "medium" as const,
    displayName: "Founder",
    emailEnabled: true,
    onboardingCompletedAt: null,
    preferredTime: "09:00",
    timezone: "Europe/Rome",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    useAuthMock.mockReturnValue({
      session: {
        access_token: "token-123",
      },
      user: {
        id: "user-1",
      },
    });

    loadProfileSettingsMock.mockResolvedValue(profile);
    signOutMock.mockResolvedValue({
      error: null,
    });
    supabaseUpdateUserMock.mockResolvedValue({
      error: null,
    });
    syncConfigMock.mockResolvedValue(undefined);
  });

  it("rolls back optimistic profile changes when persistence fails", async () => {
    let rejectSave!: (error: Error) => void;

    saveProfileSettingsMock.mockReturnValue(
      new Promise((_, reject: (error: Error) => void) => {
        rejectSave = reject;
      }),
    );

    const { result } = renderHook(() => useProfileSettings());

    await waitFor(() => {
      expect(result.current.profile?.detectionEnabled).toBe(true);
    });

    let mutationPromise!: Promise<unknown>;

    act(() => {
      mutationPromise = result.current.updateProfile(
        {
          detectionEnabled: false,
        },
        {
          fallbackMessage: "Unable to save focus settings right now.",
        },
      );
    });

    expect(result.current.profile?.detectionEnabled).toBe(false);

    await act(async () => {
      rejectSave(new Error("write failed"));
      await mutationPromise;
    });

    await waitFor(() => {
      expect(result.current.profile?.detectionEnabled).toBe(true);
    });
  });

  it("syncs the detection runtime after a successful detection settings save", async () => {
    saveProfileSettingsMock.mockResolvedValue({
      ...profile,
      detectionEnabled: false,
      detectionSensitivity: "high",
    });

    const { result } = renderHook(() => useProfileSettings());

    await waitFor(() => {
      expect(result.current.profile?.detectionEnabled).toBe(true);
    });

    await act(async () => {
      await result.current.updateProfile(
        {
          detectionEnabled: false,
          detectionSensitivity: "high",
        },
        {
          fallbackMessage: "Unable to save focus settings right now.",
        },
      );
    });

    expect(syncConfigMock).toHaveBeenCalledWith({
      enabled: false,
      sensitivity: "high",
      signedIn: true,
    });
  });
});
