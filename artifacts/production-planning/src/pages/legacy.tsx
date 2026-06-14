import { useData } from "@/lib/data-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Lock, History, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/utils";

export default function Legacy() {
  const { role, division, legacyScopes, runLegacyImport } = useData();
  const { toast } = useToast();

  if (role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-[60vh]">
        <Lock className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
        <h3 className="text-xl font-medium">Access Restricted</h3>
        <p className="text-muted-foreground mt-2">Only administrators can perform legacy data imports.</p>
      </div>
    );
  }

  const handleImport = (scope: string, status: string) => {
    if (status === "done") {
      toast({
        variant: "destructive",
        title: "Import Refused",
        description: `Scope "${scope}" has already been imported. Re-importing requires manual database intervention to prevent duplicates.`,
      });
      return;
    }

    runLegacyImport(scope);
    toast({
      title: "Import Started",
      description: `Legacy import for "${scope}" is processing in the background.`,
    });
  };

  const filteredScopes = legacyScopes.filter(s => s.division === division);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Legacy Import Ledger</h1>
        <p className="text-muted-foreground">One-time bulk imports for {division}</p>
      </div>

      <div className="bg-amber-500/10 border border-amber-200 rounded-md p-4 flex gap-3 text-amber-800">
        <AlertCircle className="h-5 w-5 shrink-0" />
        <div className="text-sm">
          <strong>Caution:</strong> Legacy imports are destructive operations that populate base historical data. They are designed to be run exactly once per scope per division. Attempting to rerun a completed scope will be rejected.
        </div>
      </div>

      <div className="grid gap-4">
        {filteredScopes.map((scope) => (
          <Card key={scope.scope} className={`${scope.status === 'done' ? 'bg-muted/30 border-muted' : ''}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-semibold text-lg">{scope.scope}</h3>
                  {scope.status === 'done' ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-200 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Done
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200 gap-1">
                      <Clock className="h-3 w-3" /> Pending
                    </Badge>
                  )}
                </div>
                {scope.importedAt && (
                  <p className="text-xs text-muted-foreground">
                    Imported on {formatDateTime(scope.importedAt)}
                  </p>
                )}
              </div>
              
              <Button 
                variant={scope.status === 'done' ? "secondary" : "default"}
                onClick={() => handleImport(scope.scope, scope.status)}
                className="w-full sm:w-auto"
              >
                {scope.status === 'done' ? "Already Imported" : "Run Import"}
              </Button>
            </div>
          </Card>
        ))}
        {filteredScopes.length === 0 && (
          <div className="p-12 text-center border rounded-lg bg-card text-muted-foreground">
            No legacy import scopes defined for {division}.
          </div>
        )}
      </div>
    </div>
  );
}
