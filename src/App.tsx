import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router";
import { Layout } from "./components/Layout";
import { OnboardingGate } from "./components/OnboardingGate";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { History } from "./pages/History";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Session } from "./pages/Session";
import { SessionDetail } from "./pages/SessionDetail";
import { Settings } from "./pages/Settings";

type AppNavigatePayload = {
  source?: "detection" | "tray";
  to: "/" | "/settings";
};

export function AppNavigationBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const unlistenPromise = listen<AppNavigatePayload>(
      "app:navigate",
      (event) => {
        if (event.payload.to === "/") {
          navigate("/", {
            state: {
              sessionSource:
                event.payload.source === "detection" ? "detection" : "manual",
            },
          });
          return;
        }

        navigate(event.payload.to);
      },
    );

    return () => {
      void unlistenPromise.then((unlisten) => {
        unlisten();
      });
    };
  }, [navigate]);

  return null;
}

export function App() {
  return (
    <>
      <AppNavigationBridge />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <OnboardingGate />
            </ProtectedRoute>
          }
        >
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Session />} />
            <Route path="/history" element={<History />} />
            <Route path="/history/:sessionId" element={<SessionDetail />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
