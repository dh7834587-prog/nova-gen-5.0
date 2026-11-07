import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface RouterValue {
  path: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function currentPath(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

/**
 * A tiny history router. NOVA needs nested module routes and deep links but not
 * the weight of a routing dependency, so this wraps the History API directly.
 */
export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const next = to.startsWith("/") ? to : `/${to}`;
    if (next === currentPath()) return;
    if (options?.replace) window.history.replaceState({}, "", next);
    else window.history.pushState({}, "", next);
    setPath(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter must be used inside RouterProvider");
  return value;
}
