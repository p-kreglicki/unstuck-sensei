import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { PlaceholderPage } from "./pages/PlaceholderPage";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route
          path="/"
          element={
            <PlaceholderPage
              title="Session"
              description="Core session flow lands in Phase 3. This shell confirms routing, auth gating, and layout structure."
            />
          }
        />
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
  );
}

export default App;
