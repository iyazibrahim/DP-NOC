import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

const STORAGE_KEY = "noc_command_center";

type CommandCenterContextValue = {
  active: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  clock: string;
};

const CommandCenterContext = createContext<CommandCenterContextValue | null>(null);

function formatClock(d: Date) {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

export function CommandCenterProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(() => sessionStorage.getItem(STORAGE_KEY) === "1");
  const [clock, setClock] = useState(() => formatClock(new Date()));

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, active ? "1" : "0");
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement && active) {
        setActive(false);
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [active]);

  const enter = useCallback(async () => {
    setActive(true);
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen may be blocked; CSS command-center mode still applies.
    }
  }, []);

  const exit = useCallback(async () => {
    setActive(false);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ active, enter, exit, clock }),
    [active, enter, exit, clock]
  );

  return (
    <CommandCenterContext.Provider value={value}>{children}</CommandCenterContext.Provider>
  );
}

export function useCommandCenter() {
  const ctx = useContext(CommandCenterContext);
  if (!ctx) throw new Error("useCommandCenter requires CommandCenterProvider");
  return ctx;
}
