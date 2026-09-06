import { useState, useMemo, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { PlanningReadiness } from "@/components/planning-readiness";
import {
  useListMasterProducts,
  useReclassifyMasterProduct,
  getListMasterProductsQueryKey,
  useGetMasterProductRateListReport,
  useGetMasterProductMrpReport,
  useImportMasterProductMrp,
  type ProductListRow,
  type ProductListResponse,
} from "@workspace/api-client-react";
import { useSegment } from "@/contexts/segment-context";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  ArrowUpDown,
  Loader2,
  AlertCircle,
  FileEdit,
  Upload,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Sort helpers
type SortConfig = { key: keyof ProductListRow; dir: "asc" | "desc" } | null;

// Reclassification schema
const reclassifySchema = z.object({
  category: z.string().min(1, "Category is required"),
  status: z.enum(["classified", "unclassified", "ambiguous"]),
  reason: z.string().min(5, "Reason must be at least 5 characters"),
});

export default function ProductsPage() {
  const { segment } = useSegment();
  const [productSegment, setProductSegment] = useState<"PTMT" | "Plumbing" | "CP">(segment);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Filters state
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [sort, setSort] = useState<SortConfig>(null);

  // Reclassification state
  const [reclassifyItem, setReclassifyItem] = useState<ProductListRow | null>(
    null
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    setProductSegment(segment);
  }, [segment]);

  const queryParams: any = { segment: productSegment };
  if (debouncedSearch) queryParams.search = debouncedSearch;
  if (status !== "all") queryParams.status = status;
  if (category !== "all") queryParams.category = category;
  if (source !== "all") queryParams.source = source;

  const { data: rawData, isLoading, isError } = useListMasterProducts(queryParams);
  const data = rawData as unknown as ProductListResponse | undefined;
  const { data: rawRateListReport } = useGetMasterProductRateListReport();
  const rateListReport = rawRateListReport as any;
  const { data: rawMrpReport, refetch: refetchMrp } = useGetMasterProductMrpReport();
  const mrpReport = rawMrpReport as any;
  const importMrp = useImportMasterProductMrp();
  const mrpInputRef = useRef<HTMLInputElement>(null);

  function handleMrpFile(file: File) {
    importMrp.mutate(
      { data: { file } },
      {
        onSuccess: () => {
          void refetchMrp();
          toast({
            title: "Authoritative MRP imported",
            description: "The source is preserved and PTMT planning remains held until approval.",
          });
        },
        onError: (error) => {
          toast({
            title: "MRP import failed",
            description: String((error as unknown as { message?: unknown } | null)?.message ?? "The workbook did not pass validation."),
            variant: "destructive",
          });
        },
      },
    );
  }

  const sortedRows = useMemo(() => {
    if (!data?.rows) return [];
    if (!sort) {
      return [...data.rows].sort((a, b) =>
        Number(b.status !== "classified") - Number(a.status !== "classified")
        || b.pendingQuantity - a.pendingQuantity
        || a.itemCode.localeCompare(b.itemCode)
        || (a.colour ?? "").localeCompare(b.colour ?? "")
      );
    }
    return [...data.rows].sort((a, b) => {
      const valA = a[sort.key];
      const valB = b[sort.key];
      if (valA === valB) return 0;
      if (valA == null) return sort.dir === "asc" ? -1 : 1;
      if (valB == null) return sort.dir === "asc" ? 1 : -1;
      if (valA < valB) return sort.dir === "asc" ? -1 : 1;
      if (valA > valB) return sort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data?.rows, sort]);

  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      classified: rows.filter((row) => row.status === "classified").length,
      unclassified: rows.filter((row) => row.status === "unclassified").length,
      ambiguous: rows.filter((row) => row.status === "ambiguous").length,
      unresolvedPending: rows
        .filter((row) => row.status !== "classified")
        .reduce((total, row) => total + row.pendingQuantity, 0),
      unresolvedDummy: rows
        .filter((row) => row.status !== "classified")
        .reduce((total, row) => total + row.dummyQuantity, 0),
    };
  }, [data?.rows]);

  // Form setup
  const form = useForm<z.infer<typeof reclassifySchema>>({
    resolver: zodResolver(reclassifySchema),
    defaultValues: {
      category: "",
      status: "unclassified",
      reason: "",
    },
  });

  useEffect(() => {
    if (reclassifyItem) {
      form.reset({
        category: reclassifyItem.category || "",
        status: (reclassifyItem.status as any) || "unclassified",
        reason: "",
      });
    }
  }, [reclassifyItem, form]);

  const reclassifyMutation = useReclassifyMasterProduct();

  function onReclassifySubmit(values: z.infer<typeof reclassifySchema>) {
    if (!reclassifyItem) return;
    reclassifyMutation.mutate(
      {
        itemCode: reclassifyItem.itemCode,
        colour: reclassifyItem.colour ?? "",
          data: {
            segment: productSegment as any,
          category: values.category,
          status: values.status as any,
          reason: values.reason,
        },
      },
      {
        onSuccess: () => {
          // Patch cache
          const queryKey = getListMasterProductsQueryKey(queryParams);
          queryClient.setQueryData(queryKey, (old: unknown) => {
            const oldData = old as ProductListResponse | undefined;
            if (!oldData || !oldData.rows) return old;
            const newRows = oldData.rows.map((r) =>
              r.itemCode === reclassifyItem.itemCode &&
              r.colour === reclassifyItem.colour
                ? {
                    ...r,
                    category: values.category,
                    status: values.status as any,
                    auditCount: r.auditCount + 1,
                  }
                : r
            );
            return { ...oldData, rows: newRows } as unknown;
          });
          toast({ title: "Product reclassified successfully" });
          setReclassifyItem(null);
        },
        onError: () => {
          toast({
            title: "Failed to reclassify product",
            variant: "destructive",
          });
        },
      }
    );
  }

  function handleSort(key: keyof ProductListRow) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" }
    );
  }

  function SortableHead({
    label,
    sortKey,
    className,
    align = "left",
  }: {
    label: string;
    sortKey: keyof ProductListRow;
    className?: string;
    align?: "left" | "right";
  }) {
    return (
      <TableHead className={className}>
        <button
          className={cn(
            "flex items-center gap-1.5 hover:text-foreground font-semibold w-full",
            align === "right" ? "justify-end" : "justify-start"
          )}
          onClick={() => handleSort(sortKey)}
        >
          {label}
          <ArrowUpDown
            className={cn(
              "h-3 w-3 transition-opacity",
              sort?.key === sortKey ? "opacity-100 text-primary" : "opacity-30"
            )}
          />
        </button>
      </TableHead>
    );
  }

  const getStatusBadge = (statusStr: string) => {
    switch (statusStr) {
      case "classified":
        return (
          <Badge
            variant="outline"
            className="bg-emerald-50 text-emerald-700 border-emerald-200"
          >
            Classified
          </Badge>
        );
      case "ambiguous":
        return (
          <Badge
            variant="outline"
            className="bg-amber-50 text-amber-700 border-amber-200"
          >
            Ambiguous
          </Badge>
        );
      case "unclassified":
        return (
          <Badge
            variant="outline"
            className="bg-slate-100 text-slate-700 border-slate-200"
          >
            Unclassified
          </Badge>
        );
      default:
        return <Badge variant="outline">{statusStr}</Badge>;
    }
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Complete catalogue and planning roster review. Unclassified demand stays visible without a guessed buffer.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Select
            value={productSegment}
            onValueChange={(value) => setProductSegment(value as "PTMT" | "Plumbing" | "CP")}
          >
            <SelectTrigger className="w-full sm:w-[130px] bg-card" data-testid="segment-filter">
              <SelectValue placeholder="Segment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PTMT">PTMT</SelectItem>
              <SelectItem value="Plumbing">Plumbing</SelectItem>
              <SelectItem value="CP">CP</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search product name or code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-card"
              data-testid="search-products-input"
            />
          </div>

          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-full sm:w-[150px] bg-card" data-testid="status-filter">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="classified">Classified</SelectItem>
              <SelectItem value="unclassified">Unclassified</SelectItem>
              <SelectItem value="ambiguous">Ambiguous</SelectItem>
            </SelectContent>
          </Select>

          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-[180px] bg-card" data-testid="category-filter">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {data?.categories?.map((c: string) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-full sm:w-[150px] bg-card" data-testid="source-filter">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="workbook">Workbook</SelectItem>
              <SelectItem value="rate-list">Rate list</SelectItem>
              <SelectItem value="catalogue">Catalogue</SelectItem>
              <SelectItem value="seed">Seed</SelectItem>
              <SelectItem value="mrp">MRP</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            ["Classified", summary.classified, "text-emerald-700"],
            ["Unclassified", summary.unclassified, "text-slate-700"],
            ["Ambiguous", summary.ambiguous, "text-amber-700"],
            ["Unresolved pending", summary.unresolvedPending.toLocaleString(), "text-primary"],
            ["Unresolved dummy", summary.unresolvedDummy.toLocaleString(), "text-primary"],
          ].map(([label, value, tone]) => (
            <Card key={label} className="bg-card/70">
              <CardContent className="p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
                <div className={cn("text-xl font-semibold mt-1", tone)}>{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-dashed">
          <CardContent className="p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-semibold">Governed PTMT rate list</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {rateListReport?.source
                    ? `${rateListReport.source.distinctCodeCount.toLocaleString()} distinct codes from ${rateListReport.source.filename}.`
                    : "No rate-list CSV has been uploaded yet."}
                  {" "}Rate-list-only products remain visible and unresolved categories are not given a buffer. July reconciliation uses the pending capture below against the effective PTMT roster.
                </p>
              </div>
              {rateListReport?.reconciliation && (
                <div className="text-xs sm:text-right text-muted-foreground">
                  <div className="font-medium text-foreground">
                    July: {rateListReport.reconciliation.matchedQuantity.toLocaleString()} matched
                  </div>
                  <div>
                    {rateListReport.reconciliation.unmatchedQuantity.toLocaleString()} across{" "}
                    {rateListReport.reconciliation.unmatchedCodeCount} absent codes
                  </div>
                </div>
              )}
            </div>
            {rateListReport?.coverage && (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs sm:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">Rate-list only</div>
                  <div className="font-semibold">{rateListReport.coverage.rateListOnlyCodeCount.toLocaleString()} codes</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Both sources</div>
                  <div className="font-semibold">{rateListReport.coverage.bothSourceCodeCount.toLocaleString()} codes</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Legacy July matched</div>
                  <div className="font-semibold">{rateListReport.coverage.legacyReconciliation?.matchedQuantity?.toLocaleString() ?? "—"} pcs</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Governed roster July matched</div>
                  <div className="font-semibold">{rateListReport.reconciliation?.matchedQuantity?.toLocaleString() ?? "—"} pcs</div>
                </div>
              </div>
            )}
            {rateListReport?.categorySplit?.after?.length > 0 && (
              <details className="mt-4 border-t pt-3 group">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-semibold text-foreground">
                  <span>PTMT category split after MRP-governed mapping</span>
                  <span className="text-muted-foreground font-normal group-open:hidden">
                    {rateListReport.categorySplit.after.length} categories · before/after
                  </span>
                  <span className="text-muted-foreground font-normal hidden group-open:inline">
                    Hide category split
                  </span>
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                   MRP wins when its series maps to an executable category, and explicit held categories remain held. An unresolved MRP series falls back to the rate list, except for the eleven premium proposals that still require Prayag's decision; Unclassified means neither source resolved a category.
                </p>
                <div className="mt-3 overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader className="bg-muted/30 sticky top-0">
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Before codes</TableHead>
                        <TableHead className="text-right">After codes</TableHead>
                        <TableHead className="text-right">Before July pcs</TableHead>
                        <TableHead className="text-right">After July pcs</TableHead>
                        <TableHead className="text-right">Multiplier</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rateListReport.categorySplit.after.map((afterEntry: {
                        category: string;
                        codeCount: number;
                        julySourceQuantity: number;
                        multiplier: number | null;
                      }) => {
                        const beforeEntry = rateListReport.categorySplit.before.find(
                          (entry: { category: string }) => entry.category === afterEntry.category,
                        );
                        return (
                          <TableRow key={afterEntry.category}>
                            <TableCell className="font-medium">{afterEntry.category}</TableCell>
                            <TableCell className="text-right">{(beforeEntry?.codeCount ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-semibold">{afterEntry.codeCount.toLocaleString()}</TableCell>
                            <TableCell className="text-right">{(beforeEntry?.julySourceQuantity ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-semibold">{afterEntry.julySourceQuantity.toLocaleString()}</TableCell>
                            <TableCell className="text-right font-mono">
                              {afterEntry.multiplier == null ? "—" : `${afterEntry.multiplier}×`}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
            {rateListReport?.reconciliation?.unmatchedCodes?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {rateListReport.reconciliation.unmatchedCodes.map((entry: { code: string; quantity: number }) => (
                  <Badge key={entry.code} variant="outline" className="font-mono text-[10px]">
                    {entry.code} · {entry.quantity.toLocaleString()}
                  </Badge>
                ))}
              </div>
            )}
            {rateListReport?.rangeAudit?.length > 0 && (
              <details className="mt-4 border-t pt-3 group">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-semibold text-foreground">
                  <span>RANGE NAME mapping audit</span>
                  <span className="text-muted-foreground font-normal group-open:hidden">
                    {rateListReport.rangeAudit.length} values · sorted by code coverage
                  </span>
                  <span className="text-muted-foreground font-normal hidden group-open:inline">
                    Hide audit
                  </span>
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  Categories are assigned from RANGE NAME only. Unclassified values remain demand-only until reviewed; no buffer is inferred.
                </p>
                <div className="mt-3 max-h-[32rem] overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="bg-muted/30 sticky top-0">
                      <TableRow>
                        <TableHead className="w-[70px] text-right">#</TableHead>
                        <TableHead>RANGE NAME</TableHead>
                        <TableHead>Resolved category</TableHead>
                        <TableHead className="w-[120px] text-right">Distinct codes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rateListReport.rangeAudit.map((entry: {
                        rangeName: string;
                        category: string;
                        codeCount: number;
                      }, index: number) => (
                        <TableRow key={`${entry.rangeName}-${entry.category}`}>
                          <TableCell className="text-right text-muted-foreground">{index + 1}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {entry.rangeName || <span className="italic text-muted-foreground">(blank)</span>}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={entry.category === "Unclassified"
                                ? "bg-slate-100 text-slate-700 border-slate-200"
                                : "bg-emerald-50 text-emerald-700 border-emerald-200"}
                            >
                              {entry.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {entry.codeCount.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
          </CardContent>
        </Card>

        <PlanningReadiness />

        <Card className="border-slate-200 bg-slate-50/40">
          <CardContent className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-2">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />
                <div>
                  <div className="text-sm font-semibold">Authoritative MRP details</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The September 2026 MRP workbook is the governing identity and series source. It is kept separate from the rate list; the readiness panel above shows source, approval, and input status separately.
                  </p>
                </div>
              </div>
              <div>
                <input
                  ref={mrpInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) handleMrpFile(file);
                    event.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => mrpInputRef.current?.click()}
                  disabled={importMrp.isPending}
                  className="border-amber-300 bg-background"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {importMrp.isPending ? "Importing…" : mrpReport?.source ? "Replace MRP" : "Import MRP workbook"}
                </Button>
              </div>
            </div>
            {mrpReport?.source && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-amber-200 pt-3 text-xs sm:grid-cols-5">
                <div><div className="text-muted-foreground">Products</div><div className="font-semibold">{Number(mrpReport.source.productRowCount ?? 0).toLocaleString()}</div></div>
                <div><div className="text-muted-foreground">Discontinued</div><div className="font-semibold">{Number(mrpReport.source.discontinuedRowCount ?? 0).toLocaleString()}</div></div>
                <div><div className="text-muted-foreground">Series values</div><div className="font-semibold">{Number(mrpReport.source.seriesValueCount ?? 0).toLocaleString()}</div></div>
                <div><div className="text-muted-foreground">PTMT held rows</div><div className="font-semibold">{Number(mrpReport.summary?.segmentSummary?.find((row: any) => row.segment === "PTMT")?.heldClassifications ?? 0).toLocaleString()}</div></div>
                <div><div className="text-muted-foreground">Source</div><div className="truncate font-mono" title={mrpReport.source.sha256}>{mrpReport.source.filename}</div></div>
              </div>
            )}
            {mrpReport?.source?.holdReason && (
              <div className="mt-3 rounded border border-amber-200 bg-background px-3 py-2 text-xs text-amber-900">
                <strong>Category approval detail:</strong> {mrpReport.source.holdReason}
              </div>
            )}
            {mrpReport?.summary?.july && (
              <div className="mt-3 text-xs text-muted-foreground">
                July combined coverage: <strong className="text-foreground">{Number(mrpReport.summary.july.matchedQuantity).toLocaleString()} matched</strong> / {Number(mrpReport.summary.july.sourceQuantity).toLocaleString()} source pcs; {Number(mrpReport.summary.july.unmatchedQuantity).toLocaleString()} pcs remain across {mrpReport.summary.july.unmatchedCodes?.length ?? 0} codes.
              </div>
            )}
            {mrpReport?.summary?.upstreamDiscontinuedApiCoverage && (
              <div className="mt-2 rounded border border-amber-200 bg-background px-3 py-2 text-xs text-amber-900">
                <strong>Discontinued-source boundary:</strong>{" "}
                <strong>{Number(mrpReport.summary.upstreamDiscontinuedApiCoverage.apiDiscontinuedFromRows).toLocaleString()}</strong> of{" "}
                <strong>{Number(mrpReport.summary.upstreamDiscontinuedApiCoverage.authoritativeFileRows).toLocaleString()}</strong> discontinued rows have
                <span className="font-mono"> discontinuedFrom </span>
                in the upstream API;{" "}
                <strong>{Number(mrpReport.summary.upstreamDiscontinuedApiCoverage.apiInvisibleAlreadyEffectiveRows).toLocaleString()}</strong> already-effective withdrawals are invisible there. The MRP file remains authoritative.
              </div>
            )}
            {mrpReport?.summary?.july?.pvcReconciliation && Number(mrpReport.summary.july.pvcReconciliation.differenceQuantity) !== 0 && (
              <div className="mt-2 rounded border border-amber-200 bg-background px-3 py-2 text-xs text-amber-900">
                <strong>P.V.C. Connections reconciliation:</strong> the previously stated July figure is{" "}
                <strong>{Number(mrpReport.summary.july.pvcReconciliation.previouslyStatedQuantity).toLocaleString()} pcs</strong>, while the
                six MRP-governed source codes total{" "}
                <strong>{Number(mrpReport.summary.july.pvcReconciliation.mrpGovernedQuantity).toLocaleString()} pcs</strong>. The{" "}
                {mrpReport.summary.july.pvcReconciliation.sourceCodeQuantities
                  .filter((entry: any) => Number(entry.quantity) > 0 && entry.code === "324-H")
                  .map((entry: any) => `${entry.code} (${Number(entry.quantity).toLocaleString()} pcs)`)
                  .join(", ") || "additional source line"}{" "}
                accounts for the difference; confirm the scope with Prayag before releasing capacity.
              </div>
            )}
            {mrpReport?.summary?.july?.categorySplit?.some((entry: any) => Number(entry.codeCount ?? 0) > 0) && (
              <details className="mt-3 border-t border-amber-200 pt-3 group">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-semibold">
                  <span>July demand and capacity by MRP category</span>
                  <span className="text-muted-foreground font-normal group-open:hidden">
                    {mrpReport.summary.july.categorySplit.filter((entry: any) => Number(entry.codeCount ?? 0) > 0).length} populated categories
                  </span>
                  <span className="text-muted-foreground font-normal hidden group-open:inline">Hide category split</span>
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  Demand is the July source quantity. Capacity is shown as the configured planning multiplier; held means Prayag still needs to approve a category/capacity line.
                </p>
                <div className="mt-3 overflow-x-auto rounded-md border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Codes</TableHead>
                        <TableHead className="text-right">July demand</TableHead>
                        <TableHead className="text-right">Capacity</TableHead>
                        <TableHead className="text-right">Multiplier</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mrpReport.summary.july.categorySplit
                        .filter((entry: any) => Number(entry.codeCount ?? 0) > 0)
                        .map((entry: any) => (
                          <TableRow key={entry.category}>
                            <TableCell className={entry.capacityStatus === "held" ? "font-medium text-amber-800" : "font-medium"}>
                              {entry.category}
                              {entry.capacityStatus === "held" && <Badge variant="outline" className="ml-2 border-amber-300 text-[10px] text-amber-800">Held</Badge>}
                            </TableCell>
                            <TableCell className="text-right">{Number(entry.codeCount).toLocaleString()}</TableCell>
                            <TableCell className="text-right font-semibold">{Number(entry.julyDemandQuantity).toLocaleString()}</TableCell>
                            <TableCell className="text-right">{entry.capacityStatus === "configured" ? "Configured" : "Held"}</TableCell>
                            <TableCell className="text-right font-mono">{entry.multiplier == null ? "—" : `${entry.multiplier}×`}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
            {mrpReport?.summary?.seriesCrosswalk && (
              <details className="mt-3 border-t border-amber-200 pt-3 group">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-xs font-semibold">
                  <span>Reviewed MRP series crosswalk</span>
                  <span className="text-muted-foreground font-normal group-open:hidden">
                    {mrpReport.summary.seriesCrosswalk.applied?.length ?? 0} applied ·{" "}
                    {mrpReport.summary.seriesCrosswalk.pendingReview?.length ?? 0} pending review ·{" "}
                    {mrpReport.summary.seriesCrosswalk.held?.length ?? 0} held
                  </span>
                  <span className="text-muted-foreground font-normal hidden group-open:inline">Hide crosswalk</span>
                </summary>
                <p className="mt-2 text-xs text-muted-foreground">
                  MRP remains authoritative for product identity and discontinuation. Finish labels such as Helix and Quadra are not categories: each product uses its governed RANGE NAME category. Products without executable range evidence remain Unclassified and visible for Prayag review.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded border bg-background px-3 py-2">
                    <div className="text-muted-foreground">Applied series</div>
                    <div className="font-semibold">{mrpReport.summary.seriesCrosswalk.applied?.length ?? 0}</div>
                  </div>
                  <div className="rounded border bg-background px-3 py-2">
                    <div className="text-muted-foreground">Applied July demand</div>
                    <div className="font-semibold">
                      {Number(mrpReport.summary.seriesCrosswalk.applied?.reduce((sum: number, row: any) => sum + Number(row.julyDemandQuantity ?? 0), 0) ?? 0).toLocaleString()} pcs
                    </div>
                  </div>
                  <div className="rounded border bg-background px-3 py-2">
                    <div className="text-muted-foreground">Pending-review demand</div>
                    <div className="font-semibold">
                      {Number(mrpReport.summary.seriesCrosswalk.pendingReview?.reduce((sum: number, row: any) => sum + Number(row.heldJulyDemandQuantity ?? 0), 0) ?? 0).toLocaleString()} pcs
                    </div>
                  </div>
                  <div className="rounded border bg-background px-3 py-2">
                  <div className="text-muted-foreground">Held / Unclassified demand</div>
                    <div className="font-semibold">
                      {Number((mrpReport.summary.seriesCrosswalk.all ?? [])
                        .reduce((sum: number, row: any) => sum + Number(row.heldJulyDemandQuantity ?? 0), 0)).toLocaleString()} pcs
                    </div>
                  </div>
                </div>
                <div className="mt-3 overflow-x-auto rounded-md border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>MRP series</TableHead>
                        <TableHead>Review scope</TableHead>
                        <TableHead>Effective category</TableHead>
                        <TableHead>Effective status</TableHead>
                        <TableHead className="text-right">Codes</TableHead>
                        <TableHead className="text-right">July demand</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        ...(mrpReport.summary.seriesCrosswalk.applied ?? []),
                        ...(mrpReport.summary.seriesCrosswalk.pendingReview ?? []),
                        ...(mrpReport.summary.seriesCrosswalk.existingRule ?? []),
                        ...(mrpReport.summary.seriesCrosswalk.held ?? []),
                      ].map((row: any) => (
                        <TableRow key={row.series}>
                          <TableCell className="font-mono text-xs">{row.series}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={row.status === "applied" || row.status === "existing_rule"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-amber-200 bg-amber-50 text-amber-800"}
                            >
                              {row.status === "applied"
                                ? "Applied crosswalk"
                                : row.status === "pending_review"
                                  ? "Pending review"
                                  : row.status === "existing_rule"
                                    ? "Existing rule"
                                    : "Held / unclassified"}
                            </Badge>
                          </TableCell>
                          <TableCell>{row.effectiveCategories?.join(", ") || row.category || "Unclassified"}</TableCell>
                          <TableCell>{row.effectiveStatus}</TableCell>
                          <TableCell className="text-right">{Number(row.codeCount ?? 0).toLocaleString()}</TableCell>
                          <TableCell className="text-right font-semibold">{Number(row.julyDemandQuantity ?? 0).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
            {mrpReport?.summary?.disagreements?.length > 0 && (
              <details className="mt-3 border-t border-amber-200 pt-3">
                <summary className="cursor-pointer text-xs font-semibold">
                  {Number(mrpReport.summary.disagreementCount).toLocaleString()} MRP/rate-list disagreements
                </summary>
                <div className="mt-2 max-h-48 overflow-auto rounded border bg-background">
                  <Table>
                    <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>MRP series category</TableHead><TableHead>Rate list</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {mrpReport.summary.disagreements.slice(0, 20).map((row: any) => (
                        <TableRow key={row.itemCode}><TableCell className="font-mono text-xs">{row.itemCode}</TableCell><TableCell className="text-xs">{row.mrpCategory}</TableCell><TableCell className="text-xs">{row.rateListCategory}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </details>
            )}
            {mrpReport?.summary?.readyToSendQuestion && (
              <p className="mt-3 text-xs text-muted-foreground">
                <strong>Ready-to-send question:</strong> {mrpReport.summary.readyToSendQuestion}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center p-12 text-destructive text-sm gap-2">
                <AlertCircle className="h-6 w-6" />
                <p>Failed to load products.</p>
              </div>
            ) : sortedRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-muted-foreground text-sm gap-2">
                <p>No products found matching the criteria.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <SortableHead label="Item" sortKey="itemCode" className="w-[120px]" />
                      <SortableHead label="Product" sortKey="productName" className="min-w-[200px]" />
                      <SortableHead label="Category" sortKey="category" className="w-[140px]" />
                      <SortableHead label="Classification" sortKey="status" className="w-[160px]" />
                      <SortableHead label="Demand" sortKey="pendingQuantity" className="w-[120px]" align="right" />
                      <TableHead className="w-[80px] text-center">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.map((row) => (
                      <TableRow key={row.key} className="hover:bg-muted/30">
                        <TableCell className="py-3 align-top">
                          <div className="font-mono text-sm font-medium">
                            {row.itemCode}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {row.colour ?? "Standard"}
                          </div>
                        </TableCell>
                        <TableCell className="py-3 align-top">
                          <div
                            className="text-sm font-medium line-clamp-2 leading-snug"
                            title={row.productName ?? ""}
                          >
                            {row.productName ?? "Name not available"}
                          </div>
                          {(row.inCatalogue || row.inPlanningWorkbook) && (
                            <div className="flex gap-1.5 mt-1.5">
                              {row.inCatalogue && (
                                <Badge
                                  variant="secondary"
                                  className="text-[9px] px-1.5 py-0 h-4 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
                                >
                                  Cat
                                </Badge>
                              )}
                              {row.inPlanningWorkbook && (
                                <Badge
                                  variant="secondary"
                                  className="text-[9px] px-1.5 py-0 h-4 bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
                                >
                                  WB
                                </Badge>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-3 align-top">
                          <div className="text-sm font-medium text-foreground">
                            {row.category}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">
                            {row.division}
                          </div>
                        </TableCell>
                        <TableCell className="py-3 align-top">
                          <div className="mb-1.5">
                            {getStatusBadge(row.status)}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono leading-tight">
                            Src: {row.source === "rate-list" ? "rate list" : row.source === "mrp" ? "MRP" : row.source ?? "None"}{" "}
                            {row.auditCount > 0 && (
                              <span className="text-amber-600 font-semibold">
                                · Audits: {row.auditCount}
                              </span>
                            )}
                          </div>
                          {row.lastSeenProductionMonth && (
                            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              Seen: {row.lastSeenProductionMonth}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-3 align-top text-right">
                          <div className="text-sm font-medium">
                            {row.pendingQuantity.toLocaleString()}{" "}
                            <span className="text-[10px] text-muted-foreground font-normal ml-0.5">
                              Pend
                            </span>
                          </div>
                          <div className="text-xs mt-0.5">
                            {row.dummyQuantity.toLocaleString()}{" "}
                            <span className="text-[10px] text-muted-foreground ml-0.5">
                              Dummy
                            </span>
                          </div>
                          <div className="text-xs mt-0.5">
                            {row.bufferReq == null ? "—" : row.bufferReq.toLocaleString()}{" "}
                            <span className="text-[10px] text-muted-foreground ml-0.5">
                              Buff
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 align-middle text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-primary"
                            onClick={() => setReclassifyItem(row)}
                            disabled={!row.inPlanningWorkbook}
                            data-testid={`reclassify-${row.itemCode}`}
                          >
                            <FileEdit className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Reclassify Dialog */}
        <Dialog
          open={!!reclassifyItem}
          onOpenChange={(open) => {
            if (!open) setReclassifyItem(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reclassify Product</DialogTitle>
              <DialogDescription>
                Update classification for{" "}
                <span className="font-mono font-medium text-foreground">
                  {reclassifyItem?.itemCode}
                </span>{" "}
                - {reclassifyItem?.productName}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onReclassifySubmit)}
                className="space-y-4 pt-2"
                data-testid="reclassify-form"
              >
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="reclassify-category">
                            <SelectValue placeholder="Select a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {data?.categories?.map((c: string) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="reclassify-status">
                            <SelectValue placeholder="Select a status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="classified">Classified</SelectItem>
                          <SelectItem value="unclassified">
                            Unclassified
                          </SelectItem>
                          <SelectItem value="ambiguous">Ambiguous</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason for Reclassification</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="e.g., Confirmed with production engineering..."
                          data-testid="reclassify-reason"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter className="pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReclassifyItem(null)}
                    disabled={reclassifyMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={reclassifyMutation.isPending}
                    data-testid="reclassify-submit"
                  >
                    {reclassifyMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save Changes
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
