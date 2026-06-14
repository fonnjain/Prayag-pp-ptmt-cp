import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useData } from "@/lib/data-provider";

export default function Login() {
  const [, setLocation] = useLocation();
  const { setRole } = useData();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent, role: "admin" | "planner" | "viewer") => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      setRole(role);
      setLocation("/");
    }, 600);
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
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" placeholder="m.planner@prayag.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <Button 
            className="w-full" 
            onClick={(e) => handleLogin(e, "planner")}
            disabled={isLoading}
          >
            {isLoading ? "Signing in..." : "Sign In"}
          </Button>
          <div className="text-xs text-center text-muted-foreground mt-4 pt-4 border-t w-full">
            <p className="mb-2 font-medium">Quick Access (Demo)</p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" onClick={(e) => handleLogin(e, "admin")}>Admin</Button>
              <Button variant="outline" size="sm" onClick={(e) => handleLogin(e, "viewer")}>Viewer</Button>
            </div>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}
