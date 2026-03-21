import { revertExtensionStart, revertTimerStart } from "./session-records";

const { rpcMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

describe("timer revert RPC wrappers", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("passes the expected revision to revertTimerStart", async () => {
    rpcMock.mockResolvedValue({
      data: {
        sessionId: "session-1",
        status: "ok",
        timerRevision: 5,
      },
      error: null,
    });

    await revertTimerStart({
      expectedRevision: 4,
      sessionId: "session-1",
    });

    expect(rpcMock).toHaveBeenCalledWith("revert_timer_start", {
      input_expected_revision: 4,
      input_session_id: "session-1",
    });
  });

  it("surfaces stale revision errors from revertExtensionStart", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: new Error("Timer revision mismatch."),
    });

    await expect(
      revertExtensionStart({
        expectedRevision: 7,
        sessionId: "session-1",
      }),
    ).rejects.toThrow("Timer revision mismatch.");

    expect(rpcMock).toHaveBeenCalledWith("revert_extension_start", {
      input_expected_revision: 7,
      input_session_id: "session-1",
    });
  });
});
