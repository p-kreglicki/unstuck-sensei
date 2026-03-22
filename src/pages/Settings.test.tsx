import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Settings } from "./Settings";

const { updateProfileMock, useProfileSettingsMock, useTimerMock } = vi.hoisted(() => ({
  updateProfileMock: vi.fn(),
  useProfileSettingsMock: vi.fn(),
  useTimerMock: vi.fn(),
}));

vi.mock("../hooks/useProfileSettings", () => ({
  useProfileSettings: () => useProfileSettingsMock(),
}));

vi.mock("../hooks/useTimer", () => ({
  useTimer: () => useTimerMock(),
}));

vi.mock("../lib/privacy-boundary", () => ({
  privacyBoundary: {
    neverCollected: ["Never collected test token", "Never collected second token"],
    sentToServer: ["Sent to server test token"],
    trackedLocally: ["Tracked locally test token", "Idle time"],
  },
  privacyBoundaryIntro: "Privacy intro test token",
}));

describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useTimerMock.mockReturnValue({
      state: {
        status: "idle",
      },
    });

    useProfileSettingsMock.mockReturnValue({
      changePassword: vi.fn(),
      deleteAccount: vi.fn(),
      isLoading: false,
      loadError: null,
      profile: {
        detectionEnabled: true,
        detectionSensitivity: "medium",
        displayName: "Founder",
        emailEnabled: true,
        preferredTime: "09:00",
      },
      reload: vi.fn(),
      resolveLocalTimeZone: () => "Europe/Rome",
      updateProfile: (...args: unknown[]) => updateProfileMock(...args),
    });
  });

  it("rolls focus drafts back to the last confirmed profile when save fails", async () => {
    updateProfileMock.mockResolvedValue({
      error: new Error("Focus save failed"),
      profile: {
        detectionEnabled: true,
        detectionSensitivity: "medium",
        displayName: "Founder",
        emailEnabled: true,
        preferredTime: "09:00",
      },
      warning: null,
    });

    render(<Settings />);

    expect(screen.getByText("Privacy intro test token")).toBeInTheDocument();

    const detectionToggle = screen.getByLabelText("Detection enabled") as HTMLInputElement;

    fireEvent.click(detectionToggle);
    expect(detectionToggle.checked).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Save focus settings" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Focus save failed");
    });

    expect((screen.getByLabelText("Detection enabled") as HTMLInputElement).checked).toBe(
      true,
    );
  });
});
