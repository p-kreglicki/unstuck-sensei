import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  ProfileSettingsProvider,
  useProfileSettings,
} from "./useProfileSettings";

const {
  cancelAccountDeletionMock,
  finishAccountDeletionMock,
  loadProfileSettingsMock,
  saveProfileSettingsMock,
  signOutMock,
  startAccountDeletionMock,
  supabaseUpdateUserMock,
  syncConfigMock,
  useAuthMock,
} = vi.hoisted(() => ({
  cancelAccountDeletionMock: vi.fn(),
  finishAccountDeletionMock: vi.fn(),
  loadProfileSettingsMock: vi.fn(),
  saveProfileSettingsMock: vi.fn(),
  signOutMock: vi.fn(),
  startAccountDeletionMock: vi.fn(),
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

  function wrapper({ children }: { children: ReactNode }) {
    return <ProfileSettingsProvider>{children}</ProfileSettingsProvider>;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());

    useAuthMock.mockReturnValue({
      cancelAccountDeletion: (...args: unknown[]) => cancelAccountDeletionMock(...args),
      finishAccountDeletion: (...args: unknown[]) => finishAccountDeletionMock(...args),
      isAccountDeletionInProgress: false,
      session: {
        access_token: "token-123",
      },
      startAccountDeletion: (...args: unknown[]) => startAccountDeletionMock(...args),
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rolls back optimistic profile changes when persistence fails", async () => {
    let rejectSave!: (error: Error) => void;

    saveProfileSettingsMock.mockReturnValue(
      new Promise((_, reject: (error: Error) => void) => {
        rejectSave = reject;
      }),
    );

    const { result } = renderHook(() => useProfileSettings(), { wrapper });

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

    const { result } = renderHook(() => useProfileSettings(), { wrapper });

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

  it("clears local auth state even when local sign-out fails after account deletion", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(null, {
        status: 204,
      }),
    );
    signOutMock.mockResolvedValue({
      error: new Error("local sign-out failed"),
    });

    const { result } = renderHook(() => useProfileSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.profile?.displayName).toBe("Founder");
    });

    await act(async () => {
      await result.current.deleteAccount();
    });

    expect(startAccountDeletionMock).toHaveBeenCalledTimes(1);
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
    expect(finishAccountDeletionMock).toHaveBeenCalledTimes(1);
    expect(cancelAccountDeletionMock).not.toHaveBeenCalled();
  });

  it("cancels the deletion guard when the delete request fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "delete failed" }), {
        headers: {
          "Content-Type": "application/json",
        },
        status: 500,
      }),
    );

    const { result } = renderHook(() => useProfileSettings(), { wrapper });

    await waitFor(() => {
      expect(result.current.profile?.displayName).toBe("Founder");
    });

    await act(async () => {
      const response = await result.current.deleteAccount();
      expect(response.error?.message).toBe("delete failed");
    });

    expect(startAccountDeletionMock).toHaveBeenCalledTimes(1);
    expect(cancelAccountDeletionMock).toHaveBeenCalledTimes(1);
    expect(finishAccountDeletionMock).not.toHaveBeenCalled();
  });
});
