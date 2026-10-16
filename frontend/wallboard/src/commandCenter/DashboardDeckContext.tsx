import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

export const ROTATE_STORAGE_KEY = "noc-wall-rotate";
export type RotateSeconds = 15 | 30 | 60;

export function readRotateSeconds(): RotateSeconds | null {
  try {
    const v = localStorage.getItem(ROTATE_STORAGE_KEY);
    if (v === "15" || v === "30" || v === "60") return Number(v) as RotateSeconds;
  } catch {
    /* ignore */
  }
  return null;
}

export type DeckChrome = {
  title: string;
  index: number;
  count: number;
  prev: () => void;
  next: () => void;
  progress: number;
};

type DeckContextValue = {
  chrome: DeckChrome | null;
  setChrome: (chrome: DeckChrome | null) => void;
  rotateSeconds: RotateSeconds | null;
  setRotateSeconds: (seconds: RotateSeconds | null) => void;
};

const DashboardDeckContext = createContext<DeckContextValue | null>(null);

export function DashboardDeckProvider({ children }: { children: ReactNode }) {
  const [chrome, setChrome] = useState<DeckChrome | null>(null);
  const [rotateSeconds, setRotateSecondsState] = useState<RotateSeconds | null>(readRotateSeconds);

  const setRotateSeconds = useCallback((seconds: RotateSeconds | null) => {
    setRotateSecondsState(seconds);
    try {
      localStorage.setItem(ROTATE_STORAGE_KEY, seconds == null ? "off" : String(seconds));
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ chrome, setChrome, rotateSeconds, setRotateSeconds }),
    [chrome, rotateSeconds, setRotateSeconds]
  );

  return <DashboardDeckContext.Provider value={value}>{children}</DashboardDeckContext.Provider>;
}

export function useDashboardDeck() {
  const ctx = useContext(DashboardDeckContext);
  if (!ctx) throw new Error("useDashboardDeck requires DashboardDeckProvider");
  return ctx;
}
