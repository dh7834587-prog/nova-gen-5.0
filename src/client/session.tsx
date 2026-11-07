import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorMessage } from "./api.js";
import type { AuthProviderStatus, Entitlement, PublicUser } from "../shared/types.js";

interface MeResponse {
  user: PublicUser | null;
  entitlement: Entitlement | null;
  accessibleModules: string[];
  providers?: AuthProviderStatus[];
}

interface SessionValue {
  loading: boolean;
  user: PublicUser | null;
  entitlement: Entitlement | null;
  accessibleModules: string[];
  providers: AuthProviderStatus[];
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: PublicUser) => void;
  setEntitlement: (entitlement: Entitlement) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUserState] = useState<PublicUser | null>(null);
  const [entitlement, setEntitlementState] = useState<Entitlement | null>(null);
  const [accessibleModules, setAccessibleModules] = useState<string[]>([]);
  const [providers, setProviders] = useState<AuthProviderStatus[]>([]);

  const apply = useCallback((payload: MeResponse) => {
    setUserState(payload.user);
    setEntitlementState(payload.entitlement);
    setAccessibleModules(payload.accessibleModules ?? []);
    if (payload.providers) setProviders(payload.providers);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const payload = await api<MeResponse>("/api/auth/me");
      apply(payload);
    } catch {
      apply({ user: null, entitlement: null, accessibleModules: [] });
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const payload = await api<MeResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      apply(payload);
      setLoading(false);
    },
    [apply],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const payload = await api<MeResponse>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      apply(payload);
      setLoading(false);
    },
    [apply],
  );

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (error) {
      // A failed logout must still clear the local view; the cookie may already be gone.
      console.warn("logout:", errorMessage(error));
    }
    apply({ user: null, entitlement: null, accessibleModules: [] });
  }, [apply]);

  const value = useMemo<SessionValue>(
    () => ({
      loading,
      user,
      entitlement,
      accessibleModules,
      providers,
      refresh,
      login,
      register,
      logout,
      setUser: (next: PublicUser) => setUserState(next),
      setEntitlement: (next: Entitlement) => setEntitlementState(next),
    }),
    [loading, user, entitlement, accessibleModules, providers, refresh, login, register, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
