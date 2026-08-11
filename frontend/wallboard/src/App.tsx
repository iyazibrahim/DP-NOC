import { useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { useCommandCenter } from "./commandCenter/CommandCenterContext";
import { AppSidebar } from "@/components/noc/AppSidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex min-h-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img
            src="/digital-penang-logo.png"
            alt="Digital Penang"
            className="mb-2 h-10 w-auto object-contain"
          />
          <CardTitle className="sr-only">Sign in</CardTitle>
          <CardDescription>Sign in to monitor collectors, uplink, and sites</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {shownError ? (
            <Alert variant="destructive">
              <AlertDescription>{shownError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-user">Username</Label>
            <Input
              id="login-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-pass">Password</Label>
            <Input
              id="login-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
            />
          </div>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </CardContent>
      </Card>
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
