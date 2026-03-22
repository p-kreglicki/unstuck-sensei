import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Settings } from "./Settings";

const {
  changePasswordMock,
  updateProfileMock,
  useProfileSettingsMock,
  useTimerMock,
} = vi.hoisted(() => ({
  changePasswordMock: vi.fn(),
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
      changePassword: (...args: unknown[]) => changePasswordMock(...args),
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

  it("blocks password changes when the new password is too short", async () => {
    render(<Settings />);

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "short" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "short" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(changePasswordMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Use at least 8 characters for your password.",
    );
  });
});
