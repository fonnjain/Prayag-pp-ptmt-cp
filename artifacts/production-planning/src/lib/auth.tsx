import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AuthUser = {
  id: number;
  email: string;
  role: "admin" | "user";
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Request failed");
  }
  return body as T;
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(url, init);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    try {
      const result = await requestJson<{ user: AuthUser }>("/api/auth/user");
      setUser(result.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      refresh,
      login: async (email, password) => {
        try {
          const result = await requestJson<{ user: AuthUser }>("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
          });
          setUser(result.user);
          return null;
        } catch (error) {
          return error instanceof Error ? error.message : "Unable to sign in";
        }
      },
      logout: async () => {
        await requestJson("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        setUser(null);
      },
    }),
    [isLoading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function AuthLoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-sm text-muted-foreground">Checking your session…</div>
    </div>
  );
}

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const message = await login(email, password);
    if (message) setError(message);
    setIsSubmitting(false);
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-lg">
        <div className="mb-8">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Prayag India</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to access production operations.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <label className="block text-sm font-medium">
            Email
            <input
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-10 w-full rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {isSubmitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}