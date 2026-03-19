import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { Session } from "./pages/Session";

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
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Session />} />
          <Route
            path="/history"
            element={
              <PlaceholderPage
                title="History"
                description="Session history arrives in Phase 5 after the core coaching flow and timer are in place."
              />
            }
          />
          <Route
            path="/settings"
            element={
              <PlaceholderPage
                title="Settings"
                description="Account, detection, and email settings arrive in Phase 5. For now this route validates the protected shell."
              />
            }
          />
        </Route>
      </Routes>
    </>
  );
}
