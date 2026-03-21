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
          completed_at: string | null;
          created_at: string;
          id: string;
          reservation_expires_at: string | null;
          session_id: string;
          user_id: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          reservation_expires_at?: string | null;
          session_id: string;
          user_id: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          reservation_expires_at?: string | null;
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
          checked_in_at: string | null;
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
          timer_revision: number;
          timer_started_at: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          checked_in_at?: string | null;
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
          timer_revision?: number;
          timer_started_at?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          checked_in_at?: string | null;
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
          timer_revision?: number;
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
      session_timer_blocks: {
        Row: {
          block_index: number;
          created_at: string;
          duration_seconds: number;
          ended_at: string | null;
          id: string;
          kind: "extension" | "initial";
          session_id: string;
          started_at: string;
        };
        Insert: {
          block_index: number;
          created_at?: string;
          duration_seconds: number;
          ended_at?: string | null;
          id?: string;
          kind: "extension" | "initial";
          session_id: string;
          started_at: string;
        };
        Update: {
          block_index?: number;
          created_at?: string;
          duration_seconds?: number;
          ended_at?: string | null;
          id?: string;
          kind?: "extension" | "initial";
          session_id?: string;
          started_at?: string;
        };
        Relationships: [
          {
            columns: ["session_id"];
            foreignKeyName: "session_timer_blocks_session_id_fkey";
            isOneToOne: false;
            referencedColumns: ["id"];
            referencedRelation: "sessions";
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      check_in_timer_session: {
        Args: {
          input_checked_in_at: string;
          input_expected_revision: number;
          input_feedback: string;
          input_session_id: string;
        };
        Returns: Json;
      };
      complete_timer_block: {
        Args: {
          input_block_id: string;
          input_ended_at: string;
          input_expected_revision: number;
        };
        Returns: Json;
      };
      expire_timer_checkin: {
        Args: {
          input_expected_revision: number;
          input_expired_at: string;
          input_session_id: string;
        };
        Returns: Json;
      };
      revert_extension_start: {
        Args: {
          input_expected_revision: number;
          input_session_id: string;
        };
        Returns: Json;
      };
      revert_timer_start: {
        Args: {
          input_expected_revision: number;
          input_session_id: string;
        };
        Returns: Json;
      };
      start_extension_block: {
        Args: {
          input_duration_seconds: number;
          input_expected_revision: number;
          input_session_id: string;
          input_started_at: string;
        };
        Returns: Json;
      };
      start_timer_block: {
        Args: {
          input_duration_seconds: number;
          input_expected_revision: number;
          input_session_id: string;
          input_started_at: string;
        };
        Returns: Json;
      };
      stop_timer_block: {
        Args: {
          input_block_id: string;
          input_ended_at: string;
          input_expected_revision: number;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
