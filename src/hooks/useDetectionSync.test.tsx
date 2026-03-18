import { render, waitFor } from "@testing-library/react";
import { DetectionSyncBridge } from "./useDetectionSync";

const {
  eqMock,
  fromMock,
  maybeSingleMock,
  selectMock,
  syncConfigMock,
  useAuthMock,
} = vi.hoisted(() => ({
  eqMock: vi.fn(),
  fromMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  selectMock: vi.fn(),
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

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe("DetectionSyncBridge", () => {
  beforeEach(() => {
    syncConfigMock.mockReset();
    useAuthMock.mockReset();
    fromMock.mockReset();
    selectMock.mockReset();
    eqMock.mockReset();
    maybeSingleMock.mockReset();

    fromMock.mockReturnValue({
      select: selectMock,
    });
    selectMock.mockReturnValue({
      eq: eqMock,
    });
    eqMock.mockReturnValue({
      maybeSingle: maybeSingleMock,
    });
  });

  it("syncs a signed-out state without querying Supabase", async () => {
    useAuthMock.mockReturnValue({
      session: null,
    });
    syncConfigMock.mockResolvedValue(undefined);

    render(<DetectionSyncBridge />);

    await waitFor(() => {
      expect(syncConfigMock).toHaveBeenCalledWith({
        signedIn: false,
        enabled: false,
        sensitivity: "medium",
      });
    });

    expect(fromMock).not.toHaveBeenCalled();
  });

  it("loads the persisted detection config for signed-in users", async () => {
    useAuthMock.mockReturnValue({
      session: {
        user: {
          id: "user-1",
        },
      },
    });
    maybeSingleMock.mockResolvedValue({
      data: {
        detection_enabled: false,
        detection_sensitivity: "high",
      },
      error: null,
    });
    syncConfigMock.mockResolvedValue(undefined);

    render(<DetectionSyncBridge />);

    await waitFor(() => {
      expect(syncConfigMock).toHaveBeenCalledWith({
        signedIn: true,
        enabled: false,
        sensitivity: "high",
      });
    });

    expect(fromMock).toHaveBeenCalledWith("profiles");
  });

  it("falls back to defaults when the profile row is missing", async () => {
    useAuthMock.mockReturnValue({
      session: {
        user: {
          id: "user-1",
        },
      },
    });
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: null,
    });
    syncConfigMock.mockResolvedValue(undefined);

    render(<DetectionSyncBridge />);

    await waitFor(() => {
      expect(syncConfigMock).toHaveBeenCalledWith({
        signedIn: true,
        enabled: true,
        sensitivity: "medium",
      });
    });
  });

  it("does not sync stale signed-in config when the profile query fails", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    useAuthMock.mockReturnValue({
      session: {
        user: {
          id: "user-1",
        },
      },
    });
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: new Error("profiles lookup failed"),
    });

    render(<DetectionSyncBridge />);

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[detection] sync failed:",
        expect.any(Error),
      );
    });

    expect(syncConfigMock).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});
