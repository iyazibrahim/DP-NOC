import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { useCommandCenter } from "./commandCenter/CommandCenterContext";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./pages/DashboardPage";
import { MapsPage } from "./pages/MapsPage";
import { SiteDetailPage, SitesPage } from "./pages/SitesPage";
import { DevicesPage } from "./pages/DevicesPage";
import { AlertsPage } from "./pages/AlertsPage";
import { WebsitesPage } from "./pages/WebsitesPage";
import { SettingsPage } from "./pages/SettingsPage";

function LoginScreen() {
  const { login, error: authError } = useAuth();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shownError = error ?? authError;

  return (
    <div className="loginScreen">
      <div className="loginBox">
        <img
          src="/digital-penang-logo.png"
          alt="Digital Penang"
          className="loginLogoImg"
        />
        <p className="muted">Sign in to monitor collectors, uplink, and sites</p>
        {shownError && <div className="bannerError">{shownError}</div>}
        <label className="label">Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} />
        <label className="label">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button type="button" className="primary" disabled={busy} onClick={submit}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const { active, exit, clock } = useCommandCenter();

  return (
    <div className={`appShell${active ? " appShell--commandCenter" : ""}`}>
      {!active ? <Sidebar /> : null}
      <main className="mainPane">
        {active ? (
          <div className="commandCenterBar">
            <span className="commandCenterBrand">Digital Penang NOC</span>
            <span className="commandCenterClock">{clock}</span>
            <button type="button" className="commandCenterExit" onClick={() => void exit()}>
              Exit fullscreen
            </button>
          </div>
        ) : null}
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/maps" element={<MapsPage />} />
          <Route path="/sites" element={<SitesPage />} />
          <Route path="/sites/:id" element={<SiteDetailPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/websites" element={<WebsitesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const { token } = useAuth();
  if (!token) return <LoginScreen />;
  return <Shell />;
}
