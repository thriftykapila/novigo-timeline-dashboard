import { useRef, useState } from "react";
import type { FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlined from "@mui/icons-material/VisibilityOffOutlined";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Brand from "./Brand";

export default function Login() {
  const { user, signIn, expired } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const usernameMissing = hasSubmitted && !username.trim();
  const passwordMissing = hasSubmitted && !password;

  if (user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setHasSubmitted(true);
    setErrorMessage("");
    if (!username.trim()) {
      usernameRef.current?.focus();
      return;
    }
    if (!password) {
      passwordRef.current?.focus();
      return;
    }
    setIsSubmitting(true);
    try {
      await signIn(username.trim(), password);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to sign in. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story" aria-label="Production intelligence">
        <Brand light />
        <div className="story-content">
          <div className="eyebrow light-eyebrow">
            <span className="status-dot" /> PRODUCTION INTELLIGENCE
          </div>
          <h1>
            Every moment.
            <br />
            Every machine.
            <br />
            <span>In perspective.</span>
          </h1>
          <p>
            A clearer view of your production floor.
            <br />
            Turn every shift into your next improvement.
          </p>
          <div className="story-chart" aria-hidden="true">
            <div className="story-chart-top">
              <span>PRODUCTION TIMELINE</span>
              <span className="story-live">SHIFT OVERVIEW</span>
            </div>
            <div className="story-plot">
              <div className="story-band story-run-start" />
              <div className="story-band story-downtime" />
              <div className="story-band story-run-middle" />
              <div className="story-band story-break" />
              <div className="story-band story-run-end" />
              <svg viewBox="0 0 440 150" preserveAspectRatio="none">
                <path
                  d="M0 140 L45 128 L80 105 L125 101 L170 78 L220 70 L260 45 L310 37 L360 18 L440 5"
                  fill="none"
                  stroke="#b9d8ff"
                  strokeWidth="3"
                />
                {[
                  [45, 128],
                  [80, 105],
                  [125, 101],
                  [170, 78],
                  [220, 70],
                  [260, 45],
                  [310, 37],
                  [360, 18],
                ].map(([cx, cy]) => (
                  <circle
                    key={cx}
                    cx={cx}
                    cy={cy}
                    r="4"
                    fill="#fff"
                    stroke="#86b8ff"
                    strokeWidth="2"
                  />
                ))}
              </svg>
            </div>
            <div className="story-chart-times">
              <span>06:00</span>
              <span>10:00</span>
              <span>14:30</span>
            </div>
            <div className="story-legend">
              <span>
                <i className="legend-teal" />
                Runtime
              </span>
              <span>
                <i className="legend-coral" />
                Downtime
              </span>
              <span>
                <i className="legend-blue" />
                Production
              </span>
            </div>
          </div>
        </div>
        <div className="story-footer">
          Built for the people behind production.
        </div>
      </section>
      <section className="login-form-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="login-form-wrap">
          <span className="login-icon">
            <LockOutlined />
          </span>
          <div className="eyebrow">YOUR OPERATIONS, CONNECTED</div>
          <h2>Welcome back</h2>
          <p className="login-subtitle">
            Sign in to your production workspace.
          </p>
          {expired && (
            <Alert severity="info" className="login-alert">
              Your session has expired. Please sign in again.
            </Alert>
          )}
          {errorMessage && (
            <Alert severity="error" className="login-alert" role="alert">
              {errorMessage}
            </Alert>
          )}
          <form onSubmit={handleSubmit} noValidate>
            <TextField
              label="Username"
              name="username"
              inputRef={usernameRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              fullWidth
              disabled={isSubmitting}
              error={usernameMissing}
              helperText={usernameMissing ? "Enter your username." : " "}
              required
            />
            <TextField
              label="Password"
              name="password"
              inputRef={passwordRef}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              fullWidth
              disabled={isSubmitting}
              error={passwordMissing}
              helperText={passwordMissing ? "Enter your password." : " "}
              required
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        onClick={() =>
                          setShowPassword((isVisible) => !isVisible)
                        }
                        edge="end"
                      >
                        {showPassword ? (
                          <VisibilityOffOutlined />
                        ) : (
                          <VisibilityOutlined />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              size="large"
              disabled={isSubmitting}
              endIcon={
                isSubmitting ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <ArrowForwardRounded />
                )
              }
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="login-help">
            <LockOutlined fontSize="inherit" />
            <span>
              Your session is secured with token-based authentication.
            </span>
          </div>
          <div className="demo-credentials">
            <strong>Assignment access</strong>
            <p>
              Username <code>analytics_user</code>
              <br />
              Password <code>dashboard123</code>
            </p>
            <span>Explore production data for 1–7 September 2026.</span>
          </div>
        </div>
        <footer className="login-footer">
          Novigo Analytics <span>Production clarity, one shift at a time.</span>
        </footer>
      </section>
    </main>
  );
}
