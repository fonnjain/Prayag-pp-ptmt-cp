import { useState, useEffect, type FormEvent } from "react";
import { useAuth }                              from "@/contexts/auth-context";
import { Button }                               from "@/components/ui/button";
import { Input }                                from "@/components/ui/input";
import { Label }                                from "@/components/ui/label";
import { Badge }                                from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Trash2, ShieldCheck, Shield, KeyRound } from "lucide-react";

interface UserRecord {
  id: number;
  email: string;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const { toast }     = useToast();

  const [users, setUsers]         = useState<UserRecord[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const [showAdd, setShowAdd]               = useState(false);
  const [addEmail, setAddEmail]             = useState("");
  const [addPassword, setAddPassword]       = useState("");
  const [addRole, setAddRole]               = useState<"admin" | "user">("user");
  const [addWorking, setAddWorking]         = useState(false);

  const [resetTarget, setResetTarget]       = useState<UserRecord | null>(null);
  const [resetPassword, setResetPassword]   = useState("");
  const [resetWorking, setResetWorking]     = useState(false);

  const [deleteTarget, setDeleteTarget]     = useState<UserRecord | null>(null);
  const [deleteWorking, setDeleteWorking]   = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/auth/users") as UserRecord[];
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (me?.role !== "admin") {
    return (
      <div className="p-8 text-center text-muted-foreground">
        You do not have permission to view this page.
      </div>
    );
  }

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    setAddWorking(true);
    try {
      const created = await apiFetch("/auth/users", {
        method: "POST",
        body: JSON.stringify({ email: addEmail, password: addPassword, role: addRole }),
      }) as UserRecord;
      setUsers((prev) => [...prev, created]);
      setShowAdd(false);
      setAddEmail(""); setAddPassword(""); setAddRole("user");
      toast({ title: "User added", description: created.email });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally {
      setAddWorking(false);
    }
  };

  const handleRoleToggle = async (u: UserRecord) => {
    const newRole = u.role === "admin" ? "user" : "admin";
    try {
      const updated = await apiFetch(`/auth/users/${u.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      }) as UserRecord;
      setUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
      toast({ title: "Role updated", description: `${u.email} is now ${newRole}` });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    }
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setResetWorking(true);
    try {
      await apiFetch(`/auth/users/${resetTarget.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      setResetTarget(null);
      setResetPassword("");
      toast({ title: "Password reset", description: `${resetTarget.email} must sign in with the new password.` });
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally {
      setResetWorking(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteWorking(true);
    try {
      await apiFetch(`/auth/users/${deleteTarget.id}`, { method: "DELETE" });
      setUsers((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      toast({ title: "User removed", description: deleteTarget.email });
      setDeleteTarget(null);
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" });
    } finally {
      setDeleteWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage who can access the Prayag production apps.</p>
        </div>
        <Button onClick={() => setShowAdd(true)} size="sm" className="gap-1.5">
          <UserPlus size={15} /> Add user
        </Button>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-4 py-3">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="border rounded-lg divide-y">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{u.email}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                    {u.role === "admin" ? "Admin" : "User"}
                  </Badge>
                  {!u.isActive && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Inactive</Badge>}
                  {u.mustChangePassword && (
                    <span className="text-[10px] text-amber-600">must change password</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <Button
                  variant="outline" size="sm"
                  title={u.role === "admin" ? "Demote to User" : "Promote to Admin"}
                  onClick={() => void handleRoleToggle(u)}
                  disabled={u.id === me?.id}
                  className="h-7 px-2 gap-1 text-xs"
                >
                  {u.role === "admin"
                    ? <><Shield size={13} /> Make User</>
                    : <><ShieldCheck size={13} /> Make Admin</>
                  }
                </Button>

                <Button
                  variant="outline" size="sm"
                  title="Reset password"
                  onClick={() => { setResetTarget(u); setResetPassword(""); }}
                  className="h-7 px-2 gap-1 text-xs"
                >
                  <KeyRound size={13} /> Reset
                </Button>

                <Button
                  variant="outline" size="sm"
                  title="Remove user"
                  onClick={() => setDeleteTarget(u)}
                  disabled={u.id === me?.id}
                  className="h-7 px-2 text-destructive hover:text-destructive"
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </div>
          ))}

          {users.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted-foreground text-center">No users yet.</p>
          )}
        </div>
      )}

      {/* ── Add user dialog ── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add user</DialogTitle></DialogHeader>
          <form id="add-user-form" onSubmit={(e) => { void handleAdd(e); }} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="au-email">Email address</Label>
              <Input id="au-email" type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} required disabled={addWorking} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="au-password">Initial password</Label>
              <Input id="au-password" type="password" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} required minLength={8} disabled={addWorking} placeholder="min 8 characters" />
              <p className="text-xs text-muted-foreground">The user will be prompted to change this after first sign-in.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div className="flex gap-3">
                {(["user", "admin"] as const).map((r) => (
                  <label key={r} className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input type="radio" name="au-role" value={r} checked={addRole === r} onChange={() => setAddRole(r)} />
                    {r === "admin" ? "Admin" : "Normal User"}
                  </label>
                ))}
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)} disabled={addWorking}>Cancel</Button>
            <Button type="submit" form="add-user-form" disabled={addWorking}>
              {addWorking ? "Adding…" : "Add user"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset password dialog ── */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset password — {resetTarget?.email}</DialogTitle></DialogHeader>
          <form id="reset-pw-form" onSubmit={(e) => { void handleReset(e); }} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rp-password">New password</Label>
              <Input id="rp-password" type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} required minLength={8} disabled={resetWorking} placeholder="min 8 characters" />
              <p className="text-xs text-muted-foreground">Active sessions will be invalidated. The user must sign in again.</p>
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)} disabled={resetWorking}>Cancel</Button>
            <Button type="submit" form="reset-pw-form" disabled={resetWorking}>
              {resetWorking ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the account. They will no longer be able to sign in.
              {deleteTarget?.role === "admin" && " Make sure at least one other admin account remains."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteWorking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()} disabled={deleteWorking} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteWorking ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
