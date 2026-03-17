import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DetectionProvider, useDetection, type DetectionState } from "./useDetection";

const { invokeMock, isTauriMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <DetectionProvider>{children}</DetectionProvider>;
}

describe("useDetection", () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    listenMock.mockResolvedValue(() => undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes on focus without a duplicate visibility refresh", async () => {
    invokeMock
      .mockResolvedValueOnce({
        nudgeActive: false,
        resumeInSeconds: null,
        status: "disabled",
      } satisfies DetectionState)
      .mockResolvedValueOnce({
        nudgeActive: true,
        resumeInSeconds: 30,
        status: "paused",
      } satisfies DetectionState);

    const { result } = renderHook(() => useDetection(), { wrapper });

    await waitFor(() => {
      expect(result.current.state.status).toBe("disabled");
    });

    const initialSyncConfig = result.current.syncConfig;
    const initialRefreshStatus = result.current.refreshStatus;

    document.dispatchEvent(new Event("visibilitychange"));
    expect(invokeMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(result.current.state.status).toBe("paused");
    });

    expect(invokeMock.mock.calls.map((call) => call[0])).toEqual([
      "get_detection_status",
      "get_detection_status",
    ]);
    expect(result.current.syncConfig).toBe(initialSyncConfig);
    expect(result.current.refreshStatus).toBe(initialRefreshStatus);
  });

  it("does not poll status again after pause commands", async () => {
    invokeMock
      .mockResolvedValueOnce({
        nudgeActive: false,
        resumeInSeconds: null,
        status: "disabled",
      } satisfies DetectionState)
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDetection(), { wrapper });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_detection_status");
    });

    await act(async () => {
      await result.current.pause();
    });

    expect(invokeMock.mock.calls.map((call) => call[0])).toEqual([
      "get_detection_status",
      "pause_detection",
    ]);
  });
});
