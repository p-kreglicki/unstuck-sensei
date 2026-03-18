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
