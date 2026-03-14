export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      conversation_messages: {
        Row: {
          content: string;
          created_at: string | null;
          id: string;
          role: "user" | "assistant";
          session_id: string;
        };
        Insert: {
          content: string;
          created_at?: string | null;
          id?: string;
          role: "user" | "assistant";
          session_id: string;
        };
        Update: {
          content?: string;
          created_at?: string | null;
          id?: string;
          role?: "user" | "assistant";
          session_id?: string;
        };
      };
      profiles: {
        Row: {
          created_at: string | null;
          detection_enabled: boolean | null;
          detection_sensitivity: "low" | "medium" | "high" | null;
          display_name: string | null;
          email_enabled: boolean | null;
          id: string;
          last_email_sent_at: string | null;
          preferred_time: string | null;
          timezone: string | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          detection_enabled?: boolean | null;
          detection_sensitivity?: "low" | "medium" | "high" | null;
          display_name?: string | null;
          email_enabled?: boolean | null;
          id: string;
          last_email_sent_at?: string | null;
          preferred_time?: string | null;
          timezone?: string | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          detection_enabled?: boolean | null;
          detection_sensitivity?: "low" | "medium" | "high" | null;
          display_name?: string | null;
          email_enabled?: boolean | null;
          id?: string;
          last_email_sent_at?: string | null;
          preferred_time?: string | null;
          timezone?: string | null;
          updated_at?: string | null;
        };
      };
      sessions: {
        Row: {
          clarifying_answer: string | null;
          clarifying_question: string | null;
          created_at: string | null;
          energy_level: "low" | "medium" | "high" | null;
          feedback: "yes" | "somewhat" | "no" | null;
          id: string;
          source: "detection" | "manual" | "email" | null;
          status: "active" | "completed" | "incomplete" | null;
          steps: Json | null;
          stuck_on: string | null;
          timer_duration_seconds: number | null;
          timer_ended_at: string | null;
          timer_extended: boolean | null;
          timer_started_at: string | null;
          user_id: string;
        };
        Insert: {
          clarifying_answer?: string | null;
          clarifying_question?: string | null;
          created_at?: string | null;
          energy_level?: "low" | "medium" | "high" | null;
          feedback?: "yes" | "somewhat" | "no" | null;
          id?: string;
          source?: "detection" | "manual" | "email" | null;
          status?: "active" | "completed" | "incomplete" | null;
          steps?: Json | null;
          stuck_on?: string | null;
          timer_duration_seconds?: number | null;
          timer_ended_at?: string | null;
          timer_extended?: boolean | null;
          timer_started_at?: string | null;
          user_id: string;
        };
        Update: {
          clarifying_answer?: string | null;
          clarifying_question?: string | null;
          created_at?: string | null;
          energy_level?: "low" | "medium" | "high" | null;
          feedback?: "yes" | "somewhat" | "no" | null;
          id?: string;
          source?: "detection" | "manual" | "email" | null;
          status?: "active" | "completed" | "incomplete" | null;
          steps?: Json | null;
          stuck_on?: string | null;
          timer_duration_seconds?: number | null;
          timer_ended_at?: string | null;
          timer_extended?: boolean | null;
          timer_started_at?: string | null;
          user_id?: string;
        };
      };
    };
  };
};
