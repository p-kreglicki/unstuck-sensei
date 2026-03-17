import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type DetectionState = {
  nudgeActive: boolean;
  resumeInSeconds: number | null;
  status:
    | "active"
    | "cooldown"
    | "disabled"
    | "notifying"
    | "paused"
    | "suppressed";
};

export type DetectionConfig = {
  enabled: boolean;
  sensitivity: "high" | "low" | "medium";
  signedIn: boolean;
};

type DetectionContextValue = {
  dismissNudge(): Promise<void>;
  pause(): Promise<void>;
  refreshStatus(): Promise<DetectionState>;
  resume(): Promise<void>;
  state: DetectionState;
  syncConfig(config: DetectionConfig): Promise<void>;
};

const DETECTION_STATE_CHANGED_EVENT = "detection-state-changed";

const defaultDetectionState: DetectionState = {
  nudgeActive: false,
  resumeInSeconds: null,
  status: "disabled",
};

const DetectionContext = createContext<DetectionContextValue | null>(null);

function logDetectionError(message: string, error: unknown) {
  if (import.meta.env.DEV) {
    console.warn(`[detection] ${message}`, error);
  }
}

async function getDetectionStatus(): Promise<DetectionState> {
  return invoke<DetectionState>("get_detection_status");
}

export function DetectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DetectionState>(defaultDetectionState);

  const refreshStatus = useCallback(async (): Promise<DetectionState> => {
    if (!isTauri()) {
      setState(defaultDetectionState);
      return defaultDetectionState;
    }

    try {
      const nextState = await getDetectionStatus();
      setState(nextState);
      return nextState;
    } catch (error) {
      logDetectionError("failed to refresh detection status", error);
      throw error;
    }
  }, []);

  const runCommand = useCallback(async (
    command: "dismiss_nudge" | "pause_detection" | "resume_detection",
  ) => {
    if (!isTauri()) {
      setState(defaultDetectionState);
      return;
    }

    await invoke(command);
  }, []);

  const syncConfig = useCallback(async (config: DetectionConfig) => {
    if (!isTauri()) {
      setState(defaultDetectionState);
      return;
    }

    await invoke("sync_detection_config", config);
  }, []);

  const pause = useCallback(async () => {
    await runCommand("pause_detection");
  }, [runCommand]);

  const resume = useCallback(async () => {
    await runCommand("resume_detection");
  }, [runCommand]);

  const dismissNudge = useCallback(async () => {
    await runCommand("dismiss_nudge");
  }, [runCommand]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;

    const applyStatus = (nextState: DetectionState) => {
      if (active) {
        setState(nextState);
      }
    };

    const refreshFocusedStatus = () => {
      void getDetectionStatus()
        .then(applyStatus)
        .catch((error) => {
          logDetectionError("failed to refresh focused detection status", error);
        });
    };

    const unlistenPromise = listen<DetectionState>(
      DETECTION_STATE_CHANGED_EVENT,
      (event) => {
        applyStatus(event.payload);
      },
    );

    void getDetectionStatus()
      .then(applyStatus)
      .catch((error) => {
        logDetectionError("failed to load initial detection status", error);
      });

    const handleWindowFocus = () => {
      refreshFocusedStatus();
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      active = false;
      window.removeEventListener("focus", handleWindowFocus);
      void unlistenPromise
        .then((unlisten) => {
          unlisten();
        })
        .catch((error) => {
          logDetectionError("failed to detach detection listener", error);
        });
    };
  }, []);

  const value = useMemo(
    () => ({
      dismissNudge,
      pause,
      refreshStatus,
      resume,
      state,
      syncConfig,
    }),
    [dismissNudge, pause, refreshStatus, resume, state, syncConfig],
  );

  return (
    <DetectionContext.Provider value={value}>
      {children}
    </DetectionContext.Provider>
  );
}

export function useDetection() {
  const value = useContext(DetectionContext);

  if (!value) {
    throw new Error("useDetection must be used within a DetectionProvider.");
  }

  return value;
}
