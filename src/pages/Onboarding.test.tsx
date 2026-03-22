import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Onboarding } from "./Onboarding";

const { completeOnboardingMock, useProfileSettingsMock } = vi.hoisted(() => ({
  completeOnboardingMock: vi.fn(),
  useProfileSettingsMock: vi.fn(),
}));

vi.mock("../hooks/useProfileSettings", () => ({
  useProfileSettings: () => useProfileSettingsMock(),
}));

vi.mock("../lib/privacy-boundary", () => ({
  privacyBoundary: {
    neverCollected: ["Onboarding never-collected token"],
    sentToServer: ["Onboarding sent token"],
    trackedLocally: ["Onboarding tracked token"],
  },
  privacyBoundaryIntro: "Onboarding privacy intro token",
}));

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useProfileSettingsMock.mockReturnValue({
      completeOnboarding: (...args: unknown[]) => completeOnboardingMock(...args),
      isLoading: false,
      loadError: null,
      profile: {
        detectionSensitivity: "medium",
        preferredTime: "09:00",
      },
      reload: vi.fn(),
      resolveLocalTimeZone: () => "Europe/Rome",
    });
  });

  it("renders privacy copy from the shared module and submits the chosen defaults", async () => {
    completeOnboardingMock.mockResolvedValue({
      error: null,
      warning: null,
    });

    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>,
    );

    expect(screen.getByText("Onboarding privacy intro token")).toBeInTheDocument();
    expect(screen.getByText("Onboarding never-collected token")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Preferred work time"), {
      target: { value: "10:15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "high" }));
    fireEvent.click(screen.getByRole("button", { name: "Enter the session flow" }));

    await waitFor(() => {
      expect(completeOnboardingMock).toHaveBeenCalledWith({
        detectionSensitivity: "high",
        preferredTime: "10:15",
      });
    });
  });
});
