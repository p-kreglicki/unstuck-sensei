import { useEffect } from "react";
import type { Session } from "@supabase/supabase-js";
import { useAuth } from "./useAuth";
import { useDetection } from "./useDetection";
import type { Database } from "../lib/database.types";
import { supabase } from "../lib/supabase";

type DetectionSensitivity = NonNullable<
  Database["public"]["Tables"]["profiles"]["Row"]["detection_sensitivity"]
>;

type DetectionProfile = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "detection_enabled" | "detection_sensitivity"
>;

export async function loadDetectionConfig(userId: string): Promise<{
  enabled: boolean;
  sensitivity: DetectionSensitivity;
}> {
  const { data, error } = await supabase
    .from("profiles")
    .select("detection_enabled, detection_sensitivity")
    .eq("id", userId)
    .maybeSingle<DetectionProfile>();

  if (error) {
    throw error;
  }

  return {
    enabled: data?.detection_enabled ?? true,
    sensitivity: data?.detection_sensitivity ?? "medium",
  };
}

export function useDetectionSync(session: Session | null) {
  const { syncConfig } = useDetection();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        if (!session?.user.id) {
          await syncConfig({
            signedIn: false,
            enabled: false,
            sensitivity: "medium",
          });
          return;
        }

        const { enabled, sensitivity } = await loadDetectionConfig(session.user.id);

        if (cancelled) {
          return;
        }

        await syncConfig({
          signedIn: true,
          enabled,
          sensitivity,
        });
      } catch (error) {
        // Detection sync is helpful for desktop UX but should not block auth flows.
        if (import.meta.env.DEV) {
          console.warn("[detection] sync failed:", error);
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id, syncConfig]);
}

export function DetectionSyncBridge() {
  const { session } = useAuth();

  useDetectionSync(session);

  return null;
}
