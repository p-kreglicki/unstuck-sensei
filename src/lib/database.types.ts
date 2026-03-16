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
      chat_request_logs: {
        Row: {
          created_at: string;
          id: string;
          session_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          session_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            columns: ["session_id"];
            foreignKeyName: "chat_request_logs_session_id_fkey";
            isOneToOne: false;
            referencedColumns: ["id"];
            referencedRelation: "sessions";
          },
          {
            columns: ["user_id"];
            foreignKeyName: "chat_request_logs_user_id_fkey";
            isOneToOne: false;
            referencedColumns: ["id"];
            referencedRelation: "users";
          },
        ];
      };
      conversation_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          role: "user" | "assistant";
          session_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          role: "user" | "assistant";
          session_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          role?: "user" | "assistant";
          session_id?: string;
        };
        Relationships: [
          {
            columns: ["session_id"];
            foreignKeyName: "conversation_messages_session_id_fkey";
            isOneToOne: false;
            referencedColumns: ["id"];
            referencedRelation: "sessions";
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          detection_enabled: boolean | null;
          detection_sensitivity: "low" | "medium" | "high" | null;
          display_name: string | null;
          email_enabled: boolean | null;
          id: string;
          last_email_sent_at: string | null;
          preferred_time: string | null;
          timezone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          detection_enabled?: boolean | null;
          detection_sensitivity?: "low" | "medium" | "high" | null;
          display_name?: string | null;
          email_enabled?: boolean | null;
          id: string;
          last_email_sent_at?: string | null;
          preferred_time?: string | null;
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          detection_enabled?: boolean | null;
          detection_sensitivity?: "low" | "medium" | "high" | null;
          display_name?: string | null;
          email_enabled?: boolean | null;
          id?: string;
          last_email_sent_at?: string | null;
          preferred_time?: string | null;
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            columns: ["id"];
            foreignKeyName: "profiles_id_fkey";
            isOneToOne: true;
            referencedColumns: ["id"];
            referencedRelation: "users";
          },
        ];
      };
      sessions: {
        Row: {
          clarifying_answer: string | null;
          clarifying_question: string | null;
          created_at: string;
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
          updated_at: string;
          user_id: string;
        };
        Insert: {
          clarifying_answer?: string | null;
          clarifying_question?: string | null;
          created_at?: string;
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
          updated_at?: string;
          user_id: string;
        };
        Update: {
          clarifying_answer?: string | null;
          clarifying_question?: string | null;
          created_at?: string;
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
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            columns: ["user_id"];
            foreignKeyName: "sessions_user_id_fkey";
            isOneToOne: false;
            referencedColumns: ["id"];
            referencedRelation: "users";
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
