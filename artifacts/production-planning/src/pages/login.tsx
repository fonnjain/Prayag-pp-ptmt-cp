import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useData } from "@/lib/data-provider";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useData();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent, presetEmail?: string) => {
    e.preventDefault();
    const finalEmail = presetEmail ?? email;
    const finalPassword = presetEmail ? "prayag2026" : password;
    if (!finalEmail || !finalPassword) {
      toast({ variant: "destructive", title: "Missing credentials", description: "Enter your email and password." });
      return;
    }
    setIsLoading(true);
    try {
      await login(finalEmail, finalPassword);
      setLocation("/");
    } catch {
      toast({ variant: "destructive", title: "Sign in failed", description: "Invalid email or password." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md animate-in zoom-in-95 duration-300">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto bg-primary/10 w-12 h-12 rounded-lg flex items-center justify-center mb-4">
            <span className="text-primary font-bold text-xl">PP</span>
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Prayag Planning</CardTitle>
          <CardDescription>
            Sign in to access your production workspace
          </CardDescription>
        </CardHeader>
        <form onSubmit={(e) => handleLogin(e)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="planner@prayag.local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-2">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
            <div className="text-xs text-center text-muted-foreground mt-4 pt-4 border-t w-full">
              <p className="mb-2 font-medium">Quick Access (Demo)</p>
              <div className="flex justify-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={isLoading} onClick={(e) => handleLogin(e, "admin@prayag.local")}>Admin</Button>
                <Button type="button" variant="outline" size="sm" disabled={isLoading} onClick={(e) => handleLogin(e, "planner@prayag.local")}>Planner</Button>
                <Button type="button" variant="outline" size="sm" disabled={isLoading} onClick={(e) => handleLogin(e, "viewer@prayag.local")}>Viewer</Button>
              </div>
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
