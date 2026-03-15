import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useContext,
  useEffect,
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

  async function refreshStatus(): Promise<DetectionState> {
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
  }

  async function runCommand(
    command: "dismiss_nudge" | "pause_detection" | "resume_detection",
  ) {
    if (!isTauri()) {
      setState(defaultDetectionState);
      return;
    }

    await invoke(command);
    await refreshStatus();
  }

  async function syncConfig(config: DetectionConfig) {
    if (!isTauri()) {
      setState(defaultDetectionState);
      return;
    }

    await invoke("sync_detection_config", config);
    await refreshStatus();
  }

  async function pause() {
    await runCommand("pause_detection");
  }

  async function resume() {
    await runCommand("resume_detection");
  }

  async function dismissNudge() {
    await runCommand("dismiss_nudge");
  }

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

    const refreshVisibleStatus = () => {
      void getDetectionStatus()
        .then(applyStatus)
        .catch((error) => {
          logDetectionError("failed to refresh visible detection status", error);
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshVisibleStatus();
      }
    };

    const handleWindowFocus = () => {
      refreshVisibleStatus();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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

  return (
    <DetectionContext.Provider
      value={{
        dismissNudge,
        pause,
        refreshStatus,
        resume,
        state,
        syncConfig,
      }}
    >
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
