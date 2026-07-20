import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { login as apiLogin } from "../api";

type AuthContextValue = {
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  error: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "noc_jwt";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    const r = await apiLogin(username, password);
    setToken(r.token);
  }, []);

  const logout = useCallback(() => setToken(null), []);

  const value = useMemo(
    () => ({ token, login, logout, error }),
    [token, login, logout, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
