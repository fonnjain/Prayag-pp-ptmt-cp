import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Lock, Save, Settings2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { role, division, sourceConfigs, updateSourceConfig } = useData();
  const { toast } = useToast();
  
  // Local state for editing to prevent immediate context updates while typing
  const [configs, setConfigs] = useState(sourceConfigs);

  if (role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-[60vh]">
        <Lock className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
        <h3 className="text-xl font-medium">Access Restricted</h3>
        <p className="text-muted-foreground mt-2">Only administrators can access and modify settings.</p>
      </div>
    );
  }

  const handleSave = () => {
    configs.forEach(c => updateSourceConfig(c.id, c));
    toast({
      title: "Settings saved",
      description: "Source configurations have been updated.",
    });
  };

  const updateLocalConfig = (id: string, field: string, value: string) => {
    setConfigs(configs.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const filteredConfigs = configs.filter(c => c.division === division);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Settings</h1>
          <p className="text-muted-foreground">Configuration for {division}</p>
        </div>
        <Button onClick={handleSave} className="gap-2">
          <Save className="h-4 w-4" />
          Save Changes
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            Data Source Integrations
          </CardTitle>
          <CardDescription>
            Map Google Sheets and external systems to the planning engine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block border rounded-md overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Data Type</TableHead>
                  <TableHead>Target Scope</TableHead>
                  <TableHead>File ID / Source</TableHead>
                  <TableHead>Tab Pattern</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConfigs.map((config) => (
                  <TableRow key={config.id}>
                    <TableCell className="font-medium">
                      <Badge variant="secondary">{config.dataType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{config.appliesTo}</TableCell>
                    <TableCell>
                      <Input 
                        className="h-8 font-mono text-xs" 
                        value={config.fileId} 
                        onChange={(e) => updateLocalConfig(config.id, "fileId", e.target.value)} 
                      />
                    </TableCell>
                    <TableCell>
                      <Input 
                        className="h-8 font-mono text-xs" 
                        value={config.tabPattern} 
                        onChange={(e) => updateLocalConfig(config.id, "tabPattern", e.target.value)} 
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile view */}
          <div className="md:hidden space-y-4">
            {filteredConfigs.map((config) => (
              <div key={config.id} className="border rounded-md p-4 space-y-3 bg-card">
                <div className="flex justify-between items-center">
                  <Badge variant="secondary">{config.dataType}</Badge>
                  <span className="text-xs text-muted-foreground">{config.appliesTo}</span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">File ID</Label>
                  <Input 
                    className="h-8 font-mono text-xs" 
                    value={config.fileId} 
                    onChange={(e) => updateLocalConfig(config.id, "fileId", e.target.value)} 
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tab Pattern</Label>
                  <Input 
                    className="h-8 font-mono text-xs" 
                    value={config.tabPattern} 
                    onChange={(e) => updateLocalConfig(config.id, "tabPattern", e.target.value)} 
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
