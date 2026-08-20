import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input }  from "@/components/ui/input";
import { Label }  from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  required?: boolean; // when true, dialog cannot be closed without changing
}

export function ChangePasswordDialog({ open, onOpenChange, required }: ChangePasswordDialogProps) {
  const { refetch }   = useAuth();
  const { toast }     = useToast();

  const [current, setCurrent]     = useState("");
  const [next, setNext]           = useState("");
  const [confirm, setConfirm]     = useState("");
  const [error, setError]         = useState<string | null>(null);
  const [working, setWorking]     = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    if (next.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setWorking(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Password change failed");
      }
      toast({ title: "Password changed", description: "Your password has been updated." });
      setCurrent(""); setNext(""); setConfirm("");
      await refetch();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={required ? undefined : onOpenChange}>
      <DialogContent onInteractOutside={required ? (e) => e.preventDefault() : undefined}>
        <DialogHeader>
          <DialogTitle>
            {required ? "Change your password to continue" : "Change password"}
          </DialogTitle>
        </DialogHeader>
        {required && (
          <p className="text-sm text-muted-foreground -mt-2">
            Your account was created with a temporary password. Please set a new one before continuing.
          </p>
        )}
        <form id="cpw-form" onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="cpw-current">Current password</Label>
            <Input id="cpw-current" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required disabled={working} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpw-next">New password</Label>
            <Input id="cpw-next" type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} disabled={working} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cpw-confirm">Confirm new password</Label>
            <Input id="cpw-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required disabled={working} />
          </div>
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}
        </form>
        <DialogFooter>
          {!required && (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>Cancel</Button>
          )}
          <Button type="submit" form="cpw-form" disabled={working}>
            {working ? "Saving…" : "Change password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
