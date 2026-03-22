import { supabase } from "./supabase";
import {
  parseSessionSteps,
  type SessionSource,
  type SessionSummary,
} from "../../shared/session/session-protocol.js";
import type { Database } from "./database.types";

export type ConversationMessageRow =
  Database["public"]["Tables"]["conversation_messages"]["Row"];
export type SessionRow = Database["public"]["Tables"]["sessions"]["Row"];
export type SessionTimerBlockRow =
  Database["public"]["Tables"]["session_timer_blocks"]["Row"];
export type SessionHistoryCursor = {
  createdAt: string;
  id: string;
};

export type SessionHistoryItem = Pick<
  SessionRow,
  | "created_at"
  | "energy_level"
  | "feedback"
  | "id"
  | "source"
  | "status"
  | "stuck_on"
  | "timer_ended_at"
  | "timer_started_at"
>;

export type SessionDetailSection<T> = {
  data: T | null;
  error: string | null;
};

export type SessionDetailResult = {
  messages: SessionDetailSection<ConversationMessageRow[]>;
  session: SessionDetailSection<SessionRow | null>;
  timerBlocks: SessionDetailSection<SessionTimerBlockRow[]>;
};

export type TimerMutationResult = {
  blockId?: string;
  checkedInAt?: string;
  durationSeconds?: number;
  endedAt?: string;
  expiredAt?: string;
  extended?: boolean;
  feedback?: SessionRow["feedback"];
  sessionId: string;
  startedAt?: string;
  status: "already_applied" | "already_resolved" | "ok";
  timerRevision: number;
};

function isTimerMutationStatus(
  value: unknown,
): value is TimerMutationResult["status"] {
  return (
    value === "ok" || value === "already_applied" || value === "already_resolved"
  );
}

function isTimerMutationResult(value: unknown): value is TimerMutationResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "status" in value &&
    isTimerMutationStatus(value.status) &&
    "timerRevision" in value &&
    typeof value.timerRevision === "number"
  );
}

async function runTimerRpc(
  fn: keyof Database["public"]["Functions"],
  args: Database["public"]["Functions"][typeof fn]["Args"],
  fallbackMessage: string,
) {
  const { data, error } = await supabase.rpc(fn, args);

  if (error) {
    throw error;
  }

  if (!isTimerMutationResult(data)) {
    throw new Error(fallbackMessage);
  }

  return data;
}

export async function createSessionDraft(input: {
  source: SessionSource;
  stuckOn: string;
  userId: string;
}) {
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      source: input.source,
      status: "active",
      stuck_on: input.stuckOn,
      user_id: input.userId,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as SessionRow;
}

export async function updateSessionDraft(
  sessionId: string,
  patch: Database["public"]["Tables"]["sessions"]["Update"],
) {
  const { data, error } = await supabase
    .from("sessions")
    .update(patch)
    .eq("id", sessionId)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as SessionRow;
}

export async function insertConversationMessage(input: {
  content: string;
  role: ConversationMessageRow["role"];
  sessionId: string;
}) {
  const { data, error } = await supabase
    .from("conversation_messages")
    .insert({
      content: input.content,
      role: input.role,
      session_id: input.sessionId,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as ConversationMessageRow;
}

export async function loadConversationMessages(sessionId: string) {
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as ConversationMessageRow[];
}

export async function loadActiveSessionDraft(userId: string) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("timer_started_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as SessionRow | null) ?? null;
}

export async function loadActiveTimerSession(userId: string) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("timer_started_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as SessionRow | null) ?? null;
}

export async function loadTimerSession(sessionId: string) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as SessionRow | null) ?? null;
}

export async function loadSessionRecord(sessionId: string) {
  return loadTimerSession(sessionId);
}

export async function loadLatestTimerBlock(sessionId: string) {
  const { data, error } = await supabase
    .from("session_timer_blocks")
    .select("*")
    .eq("session_id", sessionId)
    .order("block_index", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as SessionTimerBlockRow | null) ?? null;
}

export async function loadTimerBlocks(sessionId: string) {
  const { data, error } = await supabase
    .from("session_timer_blocks")
    .select("*")
    .eq("session_id", sessionId)
    .order("block_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []) as SessionTimerBlockRow[];
}

export async function loadRecentSessionSummaries(
  userId: string,
  excludeSessionId?: string,
) {
  let query = supabase
    .from("sessions")
    .select("id, created_at, feedback, steps, stuck_on")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(3);

  if (excludeSessionId) {
    query = query.neq("id", excludeSessionId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []).map((session) => ({
    createdAt: session.created_at,
    feedback: session.feedback,
    steps: parseSessionSteps(session.steps),
    stuckOn: session.stuck_on,
  })) as SessionSummary[];
}

export async function loadSessionHistoryPage(input: {
  cursor?: SessionHistoryCursor | null;
  pageSize?: number;
  userId: string;
}) {
  const pageSize = input.pageSize ?? 50;
  let query = supabase
    .from("sessions")
    .select(
      "id, created_at, stuck_on, energy_level, feedback, source, status, timer_started_at, timer_ended_at",
    )
    .eq("user_id", input.userId)
    .in("status", ["completed", "incomplete"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageSize + 1);

  if (input.cursor) {
    query = query.or(
      [
        `created_at.lt.${input.cursor.createdAt}`,
        `and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`,
      ].join(","),
    );
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as SessionHistoryItem[];
  const items = rows.slice(0, pageSize);
  const lastItem = items.length > 0 ? items[items.length - 1] : null;

  return {
    items,
    nextCursor:
      rows.length > pageSize && lastItem
        ? {
            createdAt: lastItem.created_at,
            id: lastItem.id,
          }
        : null,
  };
}

function normalizeSectionResult<T>(
  result: PromiseSettledResult<T>,
  fallbackMessage: string,
  options?: {
    treatNullAsError?: boolean;
  },
): SessionDetailSection<T> {
  if (result.status === "fulfilled") {
    if ((options?.treatNullAsError ?? true) && result.value === null) {
      return {
        data: null,
        error: fallbackMessage,
      };
    }

    return {
      data: result.value,
      error: null,
    };
  }

  const message =
    result.reason instanceof Error && result.reason.message.trim().length > 0
      ? result.reason.message
      : fallbackMessage;

  return {
    data: null,
    error: message,
  };
}

export async function loadSessionDetail(sessionId: string): Promise<SessionDetailResult> {
  const [sessionResult, messagesResult, timerBlocksResult] = await Promise.allSettled([
    loadSessionRecord(sessionId),
    loadConversationMessages(sessionId),
    loadTimerBlocks(sessionId),
  ]);

  return {
    messages: normalizeSectionResult(
      messagesResult,
      "Unable to load the transcript for this session.",
    ),
    session: normalizeSectionResult(
      sessionResult,
      "Unable to load this session summary.",
      {
        treatNullAsError: false,
      },
    ),
    timerBlocks: normalizeSectionResult(
      timerBlocksResult,
      "Unable to load the timer timeline for this session.",
    ),
  };
}

export async function startTimerBlock(input: {
  durationSeconds: number;
  expectedRevision: number;
  sessionId: string;
  startedAt: string;
}) {
  return runTimerRpc(
    "start_timer_block",
    {
      input_duration_seconds: input.durationSeconds,
      input_expected_revision: input.expectedRevision,
      input_session_id: input.sessionId,
      input_started_at: input.startedAt,
    },
    "Timer start returned an invalid payload.",
  );
}

export async function completeTimerBlock(input: {
  blockId: string;
  endedAt: string;
  expectedRevision: number;
}) {
  return runTimerRpc(
    "complete_timer_block",
    {
      input_block_id: input.blockId,
      input_ended_at: input.endedAt,
      input_expected_revision: input.expectedRevision,
    },
    "Timer completion returned an invalid payload.",
  );
}

export async function startExtensionBlock(input: {
  durationSeconds: number;
  expectedRevision: number;
  sessionId: string;
  startedAt: string;
}) {
  return runTimerRpc(
    "start_extension_block",
    {
      input_duration_seconds: input.durationSeconds,
      input_expected_revision: input.expectedRevision,
      input_session_id: input.sessionId,
      input_started_at: input.startedAt,
    },
    "Timer extension returned an invalid payload.",
  );
}

export async function stopTimerBlock(input: {
  blockId: string;
  endedAt: string;
  expectedRevision: number;
}) {
  return runTimerRpc(
    "stop_timer_block",
    {
      input_block_id: input.blockId,
      input_ended_at: input.endedAt,
      input_expected_revision: input.expectedRevision,
    },
    "Timer stop returned an invalid payload.",
  );
}

export async function checkInTimerSession(input: {
  checkedInAt: string;
  expectedRevision: number;
  feedback: NonNullable<SessionRow["feedback"]>;
  sessionId: string;
}) {
  return runTimerRpc(
    "check_in_timer_session",
    {
      input_checked_in_at: input.checkedInAt,
      input_expected_revision: input.expectedRevision,
      input_feedback: input.feedback,
      input_session_id: input.sessionId,
    },
    "Timer check-in returned an invalid payload.",
  );
}

export async function expireTimerCheckin(input: {
  expectedRevision: number;
  expiredAt: string;
  sessionId: string;
}) {
  return runTimerRpc(
    "expire_timer_checkin",
    {
      input_expected_revision: input.expectedRevision,
      input_expired_at: input.expiredAt,
      input_session_id: input.sessionId,
    },
    "Timer expiry returned an invalid payload.",
  );
}

export async function revertTimerStart(input: {
  expectedRevision: number;
  sessionId: string;
}) {
  return runTimerRpc(
    "revert_timer_start",
    {
      input_expected_revision: input.expectedRevision,
      input_session_id: input.sessionId,
    },
    "Timer start revert returned an invalid payload.",
  );
}

export async function revertExtensionStart(input: {
  expectedRevision: number;
  sessionId: string;
}) {
  return runTimerRpc(
    "revert_extension_start",
    {
      input_expected_revision: input.expectedRevision,
      input_session_id: input.sessionId,
    },
    "Timer extension revert returned an invalid payload.",
  );
}
