import {
  loadSessionDetail,
  revertExtensionStart,
  revertTimerStart,
} from "./session-records";

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("./supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

function createQueryBuilder<Result>(result: Result) {
  const promise = Promise.resolve(result);
  const builder = {
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => promise),
    not: vi.fn(() => builder),
    order: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn(() => promise),
    then: promise.then.bind(promise),
  };

  return builder;
}

describe("timer revert RPC wrappers", () => {
  beforeEach(() => {
    fromMock.mockReset();
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

describe("loadSessionDetail", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("treats a missing session row as a valid empty result", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "sessions") {
        return createQueryBuilder({
          data: null,
          error: null,
        });
      }

      if (table === "conversation_messages") {
        return createQueryBuilder({
          data: [],
          error: null,
        });
      }

      if (table === "session_timer_blocks") {
        return createQueryBuilder({
          data: [],
          error: null,
        });
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(loadSessionDetail("session-404")).resolves.toEqual({
      messages: {
        data: [],
        error: null,
      },
      session: {
        data: null,
        error: null,
      },
      timerBlocks: {
        data: [],
        error: null,
      },
    });
  });

  it("still surfaces transcript load failures as an error result", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "sessions") {
        return createQueryBuilder({
          data: {
            created_at: "2026-03-22T10:00:00.000Z",
            energy_level: null,
            feedback: null,
            id: "session-1",
            source: "manual",
            status: "completed",
            steps: null,
            stuck_on: "Ship it",
            timer_ended_at: null,
            timer_started_at: null,
            updated_at: "2026-03-22T10:00:00.000Z",
            user_id: "user-1",
            checked_in_at: null,
            clarifying_answer: null,
            clarifying_question: null,
            timer_duration_seconds: null,
            timer_extended: null,
          },
          error: null,
        });
      }

      if (table === "conversation_messages") {
        return createQueryBuilder({
          data: null,
          error: new Error("Transcript read failed."),
        });
      }

      if (table === "session_timer_blocks") {
        return createQueryBuilder({
          data: [],
          error: null,
        });
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await loadSessionDetail("session-1");

    expect(result.messages).toEqual({
      data: null,
      error: "Transcript read failed.",
    });
    expect(result.session).toEqual({
      data: {
        created_at: "2026-03-22T10:00:00.000Z",
        energy_level: null,
        feedback: null,
        id: "session-1",
        source: "manual",
        status: "completed",
        steps: null,
        stuck_on: "Ship it",
        timer_ended_at: null,
        timer_started_at: null,
        updated_at: "2026-03-22T10:00:00.000Z",
        user_id: "user-1",
        checked_in_at: null,
        clarifying_answer: null,
        clarifying_question: null,
        timer_duration_seconds: null,
        timer_extended: null,
      },
      error: null,
    });
  });
});
