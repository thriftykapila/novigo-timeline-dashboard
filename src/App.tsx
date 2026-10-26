import { lazy, Suspense } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
const Dashboard = lazy(() => import("./components/Dashboard"));
import Login from "./components/Login";
import Brand from "./components/Brand";
function SessionRoutes() {
  const { user, restoring, restoreError, retryRestore, signOut } = useAuth();
  if (restoring)
    return (
      <main className="session-loading">
        <Brand />
        <CircularProgress size={28} />
        <p>Validating your session…</p>
      </main>
    );
  if (restoreError)
    return (
      <main className="session-loading">
        <Brand />
        <Alert severity="error">{restoreError}</Alert>
        <Button variant="contained" onClick={retryRestore}>
          Retry session validation
        </Button>
        <Button onClick={() => void signOut().catch(() => {})}>
          Return to sign in
        </Button>
      </main>
    );
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          user ? (
            <Suspense
              fallback={
                <main className="session-loading">
                  <CircularProgress size={28} />
                  <p>Opening your workspace…</p>
                </main>
              }
            >
              <Dashboard />
            </Suspense>
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="*"
        element={<Navigate to={user ? "/dashboard" : "/login"} replace />}
      />
    </Routes>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SessionRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
