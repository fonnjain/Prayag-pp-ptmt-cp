import { useState } from "react";
import { useAuth, apiRequest } from "@/lib/auth";

export default function AccountPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    setSaving(true);
    try {
      await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setMessage("Password updated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Account</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">{user?.email}</p>
      </div>
      <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Change password</h2>
        <p className="mt-1 text-sm text-muted-foreground">Use at least 8 characters and keep it private.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            Current password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-sm font-medium">
            New password
            <input
              required
              minLength={8}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? "Saving…" : "Update password"}
          </button>
        </form>
      </section>
    </div>
  );
}