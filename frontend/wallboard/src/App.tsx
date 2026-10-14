import { useState, type FormEvent } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { useCommandCenter } from "./commandCenter/CommandCenterContext";
import { AppSidebar } from "@/components/noc/AppSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DashboardPage } from "./pages/DashboardPage";
import { MapsPage } from "./pages/MapsPage";
import { SiteDetailPage, SitesPage } from "./pages/SitesPage";
import { DevicesPage } from "./pages/DevicesPage";
import { AlertsPage } from "./pages/AlertsPage";
import { WebsitesPage } from "./pages/WebsitesPage";
import { WebsiteDetailPage } from "./pages/WebsiteDetailPage";
import { FormalReportPage } from "./pages/FormalReportPage";
import { SettingsPage } from "./pages/SettingsPage";

function LoginScreen() {
  const { login, error: authError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const shownError = error ?? authError;

  return (
    <div className="loginPage relative flex min-h-full items-center justify-center overflow-hidden bg-background p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[42%] bg-[radial-gradient(ellipse_at_top,rgba(0,181,226,0.18)_0%,transparent_65%)]"
      />
      <div className="relative z-10 flex w-full max-w-[380px] flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-card shadow-[0_0_40px_rgba(0,181,226,0.12)]">
            <img
              src="/digital-penang-logo.png"
              alt="Digital Penang"
              className="h-8 w-auto object-contain"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in to check locations and websites</p>
          </div>
        </div>

        <form className="flex w-full flex-col gap-4" onSubmit={(e) => void submit(e)}>
          {shownError ? (
            <Alert variant="destructive">
              <AlertDescription>{shownError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-user" className="text-sm text-muted-foreground">
              Username
            </Label>
            <Input
              id="login-user"
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-11 rounded-xl"
              placeholder="Your username"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-pass" className="text-sm text-muted-foreground">
              Password
            </Label>
            <Input
              id="login-pass"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl"
              placeholder="Your password"
            />
          </div>
          <Button
            type="submit"
            disabled={busy || !username.trim() || !password}
            className="mt-1 h-11 w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Shell() {
  const { active, exit, clock } = useCommandCenter();

  return (
    <div className={`flex h-full ${active ? "" : ""}`}>
      {!active ? <AppSidebar /> : null}
      <main className="mainPane min-w-0 flex-1 overflow-auto">
        {active ? (
          <div className="sticky top-0 z-40 flex items-center gap-4 border-b border-border bg-[rgba(8,18,28,0.92)] px-4 py-2">
            <span className="font-[family-name:var(--font-display)] text-sm font-bold tracking-wide">
              Digital Penang NOC
            </span>
            <span className="ml-auto font-mono text-sm text-muted-foreground">{clock}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void exit()}>
              Exit fullscreen
            </Button>
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
          <Route path="/websites/:siteId" element={<WebsiteDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/reports/:exportId" element={<FormalReportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const { token } = useAuth();
  return (
    <TooltipProvider>
      <Toaster theme="dark" richColors closeButton position="top-right" />
      {!token ? <LoginScreen /> : <Shell />}
    </TooltipProvider>
  );
}
