import { useCallback, useEffect, useState } from "react";
import { apiRequest, useAuth, type AuthUser } from "@/lib/auth";

type ManagedUser = AuthUser;

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "", role: "user" as "admin" | "user" });
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const result = await apiRequest<{ users: ManagedUser[] }>("/api/users");
      setUsers(result.users);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function addUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("add");
    setError("");
    try {
      await apiRequest("/api/users", { method: "POST", body: JSON.stringify(form) });
      setForm({ email: "", password: "", role: "user" });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add user");
    } finally {
      setBusy(null);
    }
  }

  async function changeRole(id: number, role: "admin" | "user") {
    setBusy(`role-${id}`);
    setError("");
    try {
      await apiRequest(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change role");
    } finally {
      setBusy(null);
    }
  }

  async function resetUserPassword(id: number) {
    if (resetPassword.length < 8) {
      setError("Reset password must be at least 8 characters");
      return;
    }
    setBusy(`reset-${id}`);
    setError("");
    try {
      await apiRequest(`/api/users/${id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetId(null);
      setResetPassword("");
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reset password");
    } finally {
      setBusy(null);
    }
  }

  async function removeUser(id: number) {
    if (!window.confirm("Remove this user? They will be signed out immediately.")) return;
    setBusy(`remove-${id}`);
    setError("");
    try {
      await apiRequest(`/api/users/${id}`, { method: "DELETE" });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove user");
    } finally {
      setBusy(null);
    }
  }

  if (user?.role !== "admin") {
    return <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Administrator access required.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Administration</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">User management</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage who can access Prayag production operations.</p>
      </div>

      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Add a user</h2>
        <form onSubmit={addUser} className="mt-4 grid gap-3 md:grid-cols-[1.5fr_1fr_150px_auto]">
          <input
            required
            type="email"
            placeholder="name@prayagindia.com"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            required
            minLength={8}
            type="password"
            placeholder="Temporary password"
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value as "admin" | "user" })}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="user">Normal User</option>
            <option value="admin">Admin</option>
          </select>
          <button disabled={busy === "add"} className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {busy === "add" ? "Adding…" : "Add user"}
          </button>
        </form>
      </section>

      {error && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h2 className="font-semibold">Users</h2>
        </div>
        {loading ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">No users found.</p>
        ) : (
          <div className="divide-y divide-border">
            {users.map((managedUser) => (
              <div key={managedUser.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{managedUser.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {managedUser.id === user.id ? "You · " : ""}
                    {managedUser.isActive ? "Active" : "Inactive"}
                  </p>
                </div>
                <select
                  aria-label={`Role for ${managedUser.email}`}
                  value={managedUser.role}
                  disabled={busy === `role-${managedUser.id}`}
                  onChange={(event) => void changeRole(managedUser.id, event.target.value as "admin" | "user")}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="user">Normal User</option>
                  <option value="admin">Admin</option>
                </select>
                {resetId === managedUser.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      minLength={8}
                      type="password"
                      placeholder="New password"
                      value={resetPassword}
                      onChange={(event) => setResetPassword(event.target.value)}
                      className="h-9 w-36 rounded-md border border-input bg-background px-3 text-sm"
                    />
                    <button onClick={() => void resetUserPassword(managedUser.id)} disabled={busy === `reset-${managedUser.id}`} className="h-9 rounded-md bg-secondary px-3 text-xs font-semibold">
                      Save
                    </button>
                    <button onClick={() => { setResetId(null); setResetPassword(""); }} className="h-9 rounded-md px-2 text-xs text-muted-foreground">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setResetId(managedUser.id)} className="h-9 rounded-md border border-border px-3 text-xs font-medium">
                    Reset password
                  </button>
                )}
                <button
                  onClick={() => void removeUser(managedUser.id)}
                  disabled={managedUser.id === user.id || busy === `remove-${managedUser.id}`}
                  className="h-9 rounded-md border border-destructive/30 px-3 text-xs font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}