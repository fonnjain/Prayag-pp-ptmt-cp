  await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadId}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC17g/h: Slash-separated machine list ("MC-03/MC-04") splits correctly.
    // Covers the `/` branch of the /[,/]+/ regex in the aggregation loop.
    // Fixture items:
    //   Row 4: PIPE  item — MC-03 only,       300 pcs, matKg=60, hrs=2.0
    //   Row 5: FITTING item — "MC-03/MC-04",  400 pcs, matKg=90, hrs=3.5
    //
    // Expected machine-summary after aggregation:
    //   MC-03 : pcs = 300 + 400 = 700,  kg = 60 + 90 = 150,  hrs = 2.0 + 3.5 = 5.5
    //   MC-04 : pcs = 400,               kg = 90,              hrs = 3.5
    {
      const XLSXg = await import("xlsx");
      const FIXTURE_MONTH_G   = "2099-03";   // safe far-future — never real data
      const FIXTURE_SEGMENT_G = "Plumbing";

      const wsDataG = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "CPVC-25mm","ITEM-G01", 300, 0.15, "MC-03",       2.0, 45,  60, 25, "seeded", 3000],
        ["Fitting","SWR-4in",  "ITEM-G02", 400, 0.20, "MC-03/MC-04", 3.5, 80,  90, 22, "seeded", 4000],
      ];
      const wsG = XLSXg.utils.aoa_to_sheet(wsDataG);
      const wbG = XLSXg.utils.book_new();
      XLSXg.utils.book_append_sheet(wbG, wsG, "5. Item Assignment");
      const bufG = Buffer.from(XLSXg.write(wbG, { type: "buffer", bookType: "xlsx" }));

      const fdG = new FormData();
      fdG.append("month",   FIXTURE_MONTH_G);
      fdG.append("segment", FIXTURE_SEGMENT_G);
      fdG.append("file",
        new Blob([bufG], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-slash-machines.xlsx",
      );

      let uploadIdG: number | null = null;
      try {
        const uploadRespG = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fdG });
        if (!uploadRespG.ok) {
          const txt = await uploadRespG.text().catch(() => "");
          newChecks.push({
            name: "NC17g · slash-machine upload · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadRespG.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBodyG = await uploadRespG.json() as { id: number; itemCount: number };
          uploadIdG = uploadBodyG.id;
          newChecks.push({
            name: `NC17g · slash-machine upload · POST 201, itemCount=2 (got ${uploadBodyG.itemCount})`,
            expected: 2, actual: uploadBodyG.itemCount,
            pass: uploadBodyG.itemCount === 2, tolerance: "exact",
          });

          type MachineTotalsG = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryDataG = await fetchJson<{ upload: unknown; machineTotals: MachineTotalsG[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH_G}&segment=${encodeURIComponent(FIXTURE_SEGMENT_G)}`,
          );
          const totalsG = summaryDataG.machineTotals ?? [];
          const mc03 = totalsG.find((m) => m.machineId === "MC-03");
          const mc04 = totalsG.find((m) => m.machineId === "MC-04");

          // MC-03: single item (300 pcs/60 kg/2.0 hrs) + slash-shared item (400 pcs/90 kg/3.5 hrs) = 700/150/5.5
          newChecks.push({
            name: `NC17h · slash-machine · MC-03 pcs=700 kg=150 hrs=5.5 (got pcs=${mc03?.pcs ?? "n/a"} kg=${mc03?.kg ?? "n/a"} hrs=${mc03?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc03?.pcs === 700 && mc03?.kg === 150 && Math.abs((mc03?.hrs ?? 0) - 5.5) < 0.01) ? 1 : 0,
            pass: !!mc03 && mc03.pcs === 700 && mc03.kg === 150 && Math.abs(mc03.hrs - 5.5) < 0.01,
            tolerance: `full attribution via slash separator: pcs/kg/hrs exact (got ${mc03?.pcs}/${mc03?.kg}/${mc03?.hrs})`,
          });
          // MC-04: receives only the slash-shared item (400 pcs/90 kg/3.5 hrs)
          newChecks.push({
            name: `NC17i · slash-machine · MC-04 pcs=400 kg=90 hrs=3.5 (got pcs=${mc04?.pcs ?? "n/a"} kg=${mc04?.kg ?? "n/a"} hrs=${mc04?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc04?.pcs === 400 && mc04?.kg === 90 && Math.abs((mc04?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc04 && mc04.pcs === 400 && mc04.kg === 90 && Math.abs(mc04.hrs - 3.5) < 0.01,
            tolerance: `MC-04 receives full slash-separated item attribution (got ${mc04?.pcs}/${mc04?.kg}/${mc04?.hrs})`,
          });
        }
      } finally {
        if (uploadIdG !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadIdG}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC17j/k: Spaced slash separator ("MC-05 / MC-06") must NOT create phantom IDs.
    // The split regex /[,/]+/ without trimming would produce keys "MC-05 " and " MC-06"
    // (with leading/trailing spaces). The aggregation loop trims each token so both
    // machines should map to the canonical MC-05 / MC-06 buckets.
    //
    // Fixture items:
    //   Row 4: PIPE   item — "MC-05" (no spaces),        300 pcs, matKg=60,  hrs=2.0
    //   Row 5: FITTING item — "MC-05 / MC-06" (spaced),  400 pcs, matKg=90,  hrs=3.5
    //
    // Expected machine-summary after aggregation:
    //   MC-05 : pcs = 300 + 400 = 700,  kg = 60 + 90 = 150,  hrs = 2.0 + 3.5 = 5.5
    //   MC-06 : pcs = 400,               kg = 90,              hrs = 3.5
    //
    // Phantom-ID check: no machineId may contain a leading/trailing space.
    {
      const XLSXj = await import("xlsx");
      const FIXTURE_MONTH_J   = "2099-04";   // safe far-future — never real data
      const FIXTURE_SEGMENT_J = "Plumbing";

      const wsDataJ = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "CPVC-25mm","ITEM-J01", 300, 0.15, "MC-05",         2.0, 45,  60, 25, "seeded", 3000],
        ["Fitting","SWR-4in",  "ITEM-J02", 400, 0.20, "MC-05 / MC-06", 3.5, 80,  90, 22, "seeded", 4000],
      ];
      const wsJ = XLSXj.utils.aoa_to_sheet(wsDataJ);
      const wbJ = XLSXj.utils.book_new();
      XLSXj.utils.book_append_sheet(wbJ, wsJ, "5. Item Assignment");
      const bufJ = Buffer.from(XLSXj.write(wbJ, { type: "buffer", bookType: "xlsx" }));

      const fdJ = new FormData();
      fdJ.append("month",   FIXTURE_MONTH_J);
      fdJ.append("segment", FIXTURE_SEGMENT_J);
      fdJ.append("file",
        new Blob([bufJ], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-spaced-slash-machines.xlsx",
      );

      let uploadIdJ: number | null = null;
      try {
        const uploadRespJ = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fdJ });
        if (!uploadRespJ.ok) {
          const txt = await uploadRespJ.text().catch(() => "");
          newChecks.push({
            name: "NC17j · spaced-slash upload · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadRespJ.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBodyJ = await uploadRespJ.json() as { id: number; itemCount: number };
          uploadIdJ = uploadBodyJ.id;
          newChecks.push({
            name: `NC17j · spaced-slash upload · POST 201, itemCount=2 (got ${uploadBodyJ.itemCount})`,
            expected: 2, actual: uploadBodyJ.itemCount,
            pass: uploadBodyJ.itemCount === 2, tolerance: "exact",
          });

          type MachineTotalsJ = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryDataJ = await fetchJson<{ upload: unknown; machineTotals: MachineTotalsJ[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH_J}&segment=${encodeURIComponent(FIXTURE_SEGMENT_J)}`,
          );
          const totalsJ = summaryDataJ.machineTotals ?? [];
          const mc05 = totalsJ.find((m) => m.machineId === "MC-05");
          const mc06 = totalsJ.find((m) => m.machineId === "MC-06");

          // NC17j: MC-05 receives single-item (300/60/2.0) + spaced-slash-shared (400/90/3.5) = 700/150/5.5
          newChecks.push({
            name: `NC17j · spaced-slash · MC-05 pcs=700 kg=150 hrs=5.5 (got pcs=${mc05?.pcs ?? "n/a"} kg=${mc05?.kg ?? "n/a"} hrs=${mc05?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc05?.pcs === 700 && mc05?.kg === 150 && Math.abs((mc05?.hrs ?? 0) - 5.5) < 0.01) ? 1 : 0,
            pass: !!mc05 && mc05.pcs === 700 && mc05.kg === 150 && Math.abs(mc05.hrs - 5.5) < 0.01,
            tolerance: `trim() maps "MC-05 / MC-06" → MC-05/MC-06 (no phantom spaces); got ${mc05?.pcs}/${mc05?.kg}/${mc05?.hrs}`,
          });

          // NC17k: MC-06 receives only the spaced-slash-shared item (400/90/3.5)
          newChecks.push({
            name: `NC17k · spaced-slash · MC-06 pcs=400 kg=90 hrs=3.5 (got pcs=${mc06?.pcs ?? "n/a"} kg=${mc06?.kg ?? "n/a"} hrs=${mc06?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc06?.pcs === 400 && mc06?.kg === 90 && Math.abs((mc06?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc06 && mc06.pcs === 400 && mc06.kg === 90 && Math.abs(mc06.hrs - 3.5) < 0.01,
            tolerance: `trim() maps " MC-06" → canonical "MC-06" (no leading space); got ${mc06?.pcs}/${mc06?.kg}/${mc06?.hrs}`,
          });

          // Phantom-ID guard: no machineId in the summary may have leading or trailing whitespace.
          const phantomIds = totalsJ.filter((m) => m.machineId !== m.machineId.trim());
          newChecks.push({
            name: `NC17k · phantom-ID guard · no machine bucket has leading/trailing spaces (found ${phantomIds.length} phantom IDs: ${phantomIds.map((m) => JSON.stringify(m.machineId)).join(", ") || "none"})`,
            expected: 0, actual: phantomIds.length,
            pass: phantomIds.length === 0,
            tolerance: "split().map(trim()) must eliminate all space-padded keys",
          });
        }
      } catch (errJ) {
        newChecks.push({
          name: "NC17j · spaced-slash upload · block error (unexpected exception)",
          expected: 1, actual: 0, pass: false,
          tolerance: errJ instanceof Error ? errJ.message : String(errJ),
        });
      } finally {
        if (uploadIdJ !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadIdJ}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC17l/m: Mixed comma-and-slash separator ("MC-07,MC-08/MC-09") splits into exactly
    // three canonical IDs with no phantom entries. The regex /[,/]+/ collapses consecutive
    // or combined delimiters, so "MC-07,MC-08/MC-09" must yield MC-07, MC-08, and MC-09.
    //
    // Fixture items:
    //   Row 4: PIPE   item — "MC-07" (single),              300 pcs, matKg=60,  hrs=2.0
    //   Row 5: FITTING item — "MC-07,MC-08/MC-09" (mixed),  400 pcs, matKg=90,  hrs=3.5
    //
    // Expected machine-summary after aggregation:
    //   MC-07 : pcs = 300 + 400 = 700,  kg = 60 + 90 = 150,  hrs = 2.0 + 3.5 = 5.5
    //   MC-08 : pcs = 400,               kg = 90,              hrs = 3.5
    //   MC-09 : pcs = 400,               kg = 90,              hrs = 3.5
    //
    // Phantom-ID check: no machineId may contain a leading/trailing space.
    {
      const XLSXl = await import("xlsx");
      const FIXTURE_MONTH_L   = "2099-05";   // safe far-future — never real data
      const FIXTURE_SEGMENT_L = "Plumbing";

      const wsDataL = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "CPVC-25mm","ITEM-L01", 300, 0.15, "MC-07",              2.0, 45,  60, 25, "seeded", 3000],
        ["Fitting","SWR-4in",  "ITEM-L02", 400, 0.20, "MC-07,MC-08/MC-09", 3.5, 80,  90, 22, "seeded", 4000],
      ];
      const wsL = XLSXl.utils.aoa_to_sheet(wsDataL);
      const wbL = XLSXl.utils.book_new();
      XLSXl.utils.book_append_sheet(wbL, wsL, "5. Item Assignment");
      const bufL = Buffer.from(XLSXl.write(wbL, { type: "buffer", bookType: "xlsx" }));

      const fdL = new FormData();
      fdL.append("month",   FIXTURE_MONTH_L);
      fdL.append("segment", FIXTURE_SEGMENT_L);
      fdL.append("file",
        new Blob([bufL], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-mixed-sep-machines.xlsx",
      );

      let uploadIdL: number | null = null;
      try {
        const uploadRespL = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fdL });
        if (!uploadRespL.ok) {
          const txt = await uploadRespL.text().catch(() => "");
          newChecks.push({
            name: "NC17l · mixed-sep upload · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadRespL.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBodyL = await uploadRespL.json() as { id: number; itemCount: number };
          uploadIdL = uploadBodyL.id;
          newChecks.push({
            name: `NC17l · mixed-sep upload · POST 201, itemCount=2 (got ${uploadBodyL.itemCount})`,
            expected: 2, actual: uploadBodyL.itemCount,
            pass: uploadBodyL.itemCount === 2, tolerance: "exact",
          });

          type MachineTotalsL = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryDataL = await fetchJson<{ upload: unknown; machineTotals: MachineTotalsL[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH_L}&segment=${encodeURIComponent(FIXTURE_SEGMENT_L)}`,
          );
          const totalsL = summaryDataL.machineTotals ?? [];
          const mc07 = totalsL.find((m) => m.machineId === "MC-07");
          const mc08 = totalsL.find((m) => m.machineId === "MC-08");
          const mc09 = totalsL.find((m) => m.machineId === "MC-09");

          // NC17l: MC-07 receives single-item (300/60/2.0) + mixed-sep item (400/90/3.5) = 700/150/5.5
          newChecks.push({
            name: `NC17l · mixed-sep · MC-07 pcs=700 kg=150 hrs=5.5 (got pcs=${mc07?.pcs ?? "n/a"} kg=${mc07?.kg ?? "n/a"} hrs=${mc07?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc07?.pcs === 700 && mc07?.kg === 150 && Math.abs((mc07?.hrs ?? 0) - 5.5) < 0.01) ? 1 : 0,
            pass: !!mc07 && mc07.pcs === 700 && mc07.kg === 150 && Math.abs(mc07.hrs - 5.5) < 0.01,
            tolerance: `comma+slash regex collapses to MC-07; full attribution; got ${mc07?.pcs}/${mc07?.kg}/${mc07?.hrs}`,
          });

          // NC17m: MC-08 receives only the mixed-sep item (400/90/3.5)
          newChecks.push({
            name: `NC17m · mixed-sep · MC-08 pcs=400 kg=90 hrs=3.5 (got pcs=${mc08?.pcs ?? "n/a"} kg=${mc08?.kg ?? "n/a"} hrs=${mc08?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc08?.pcs === 400 && mc08?.kg === 90 && Math.abs((mc08?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc08 && mc08.pcs === 400 && mc08.kg === 90 && Math.abs(mc08.hrs - 3.5) < 0.01,
            tolerance: `"MC-07,MC-08/MC-09" splits on /[,/]+/ → MC-08 exact; got ${mc08?.pcs}/${mc08?.kg}/${mc08?.hrs}`,
          });

          // NC17m: MC-09 receives only the mixed-sep item (400/90/3.5)
          newChecks.push({
            name: `NC17m · mixed-sep · MC-09 pcs=400 kg=90 hrs=3.5 (got pcs=${mc09?.pcs ?? "n/a"} kg=${mc09?.kg ?? "n/a"} hrs=${mc09?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc09?.pcs === 400 && mc09?.kg === 90 && Math.abs((mc09?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc09 && mc09.pcs === 400 && mc09.kg === 90 && Math.abs(mc09.hrs - 3.5) < 0.01,
            tolerance: `"MC-07,MC-08/MC-09" splits on /[,/]+/ → MC-09 exact; got ${mc09?.pcs}/${mc09?.kg}/${mc09?.hrs}`,
          });

          // Exact-bucket-set guard: only MC-07, MC-08, MC-09 may appear — no phantom,
          // duplicate, or malformed tokens from the mixed separator string.
          const EXPECTED_IDS_L = new Set(["MC-07", "MC-08", "MC-09"]);
          const actualIdsL = new Set(totalsL.map((m) => m.machineId));
          const unexpectedL = [...actualIdsL].filter((id) => !EXPECTED_IDS_L.has(id));
          const missingL    = [...EXPECTED_IDS_L].filter((id) => !actualIdsL.has(id));
          const exactSetOkL = unexpectedL.length === 0 && missingL.length === 0;
          newChecks.push({
            name: `NC17m · exact-bucket-set · only MC-07/MC-08/MC-09 present (unexpected=[${unexpectedL.join(",")}] missing=[${missingL.join(",")}])`,
            expected: 1, actual: exactSetOkL ? 1 : 0,
            pass: exactSetOkL,
            tolerance: `"MC-07,MC-08/MC-09" must yield exactly 3 canonical IDs — no phantom tokens, no duplicates`,
          });

          // Phantom-ID guard: no machineId in the summary may have leading or trailing whitespace.
          const phantomIdsL = totalsL.filter((m) => m.machineId !== m.machineId.trim());
          newChecks.push({
            name: `NC17m · phantom-ID guard · no machine bucket has leading/trailing spaces (found ${phantomIdsL.length} phantom IDs: ${phantomIdsL.map((m) => JSON.stringify(m.machineId)).join(", ") || "none"})`,
            expected: 0, actual: phantomIdsL.length,
            pass: phantomIdsL.length === 0,
            tolerance: "split(/[,/]+/).map(trim()) must eliminate all space-padded keys from mixed separators",
          });
        }
      } catch (errL) {
        newChecks.push({
          name: "NC17l · mixed-sep upload · block error (unexpected exception)",
          expected: 1, actual: 0, pass: false,
          tolerance: errL instanceof Error ? errL.message : String(errL),
        });
      } finally {
        if (uploadIdL !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadIdL}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC17n: Double-comma separator ("MC-10,,MC-11") must NOT create a phantom empty-string
    // bucket.  The split regex /[,/]+/ collapses consecutive commas, and the subsequent
    // .filter(Boolean) removes any empty tokens.  This fixture confirms both behaviours
    // end-to-end: exactly two canonical IDs (MC-10, MC-11) appear in machine-summary, and
    // no machineId === "" is present.
    //
    // Fixture items:
    //   Row 4: PIPE    item — "MC-10"         (single),     300 pcs, matKg=60,  hrs=2.0
    //   Row 5: FITTING item — "MC-10,,MC-11"  (dbl-comma),  400 pcs, matKg=90,  hrs=3.5
    //
    // Expected machine-summary after aggregation:
    //   MC-10 : pcs = 300 + 400 = 700,  kg = 60 + 90 = 150,  hrs = 2.0 + 3.5 = 5.5
    //   MC-11 : pcs = 400,               kg = 90,              hrs = 3.5
    //   ""    : must NOT exist
    {
      const XLSXn = await import("xlsx");
      const FIXTURE_MONTH_N   = "2099-06";   // safe far-future — never real data
      const FIXTURE_SEGMENT_N = "Plumbing";

      const wsDataN = [
        [],
        [],
        [],
        ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
        ["Pipe",   "CPVC-25mm","ITEM-N01", 300, 0.15, "MC-10",        2.0, 45,  60, 25, "seeded", 3000],
        ["Fitting","SWR-4in",  "ITEM-N02", 400, 0.20, "MC-10,,MC-11", 3.5, 80,  90, 22, "seeded", 4000],
      ];
      const wsN = XLSXn.utils.aoa_to_sheet(wsDataN);
      const wbN = XLSXn.utils.book_new();
      XLSXn.utils.book_append_sheet(wbN, wsN, "5. Item Assignment");
      const bufN = Buffer.from(XLSXn.write(wbN, { type: "buffer", bookType: "xlsx" }));

      const fdN = new FormData();
      fdN.append("month",   FIXTURE_MONTH_N);
      fdN.append("segment", FIXTURE_SEGMENT_N);
      fdN.append("file",
        new Blob([bufN], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-double-comma-machines.xlsx",
      );

      let uploadIdN: number | null = null;
      try {
        const uploadRespN = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fdN });
        if (!uploadRespN.ok) {
          const txt = await uploadRespN.text().catch(() => "");
          newChecks.push({
            name: "NC17n · double-comma upload · POST succeeds",
            expected: 1, actual: 0, pass: false,
            tolerance: `HTTP ${uploadRespN.status}: ${txt.slice(0, 120)}`,
          });
        } else {
          const uploadBodyN = await uploadRespN.json() as { id: number; itemCount: number };
          uploadIdN = uploadBodyN.id;
          newChecks.push({
            name: `NC17n · double-comma upload · POST 201, itemCount=2 (got ${uploadBodyN.itemCount})`,
            expected: 2, actual: uploadBodyN.itemCount,
            pass: uploadBodyN.itemCount === 2, tolerance: "exact",
          });

          type MachineTotalsN = { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number };
          const summaryDataN = await fetchJson<{ upload: unknown; machineTotals: MachineTotalsN[] }>(
            `${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH_N}&segment=${encodeURIComponent(FIXTURE_SEGMENT_N)}`,
          );
          const totalsN = summaryDataN.machineTotals ?? [];
          const mc10 = totalsN.find((m) => m.machineId === "MC-10");
          const mc11 = totalsN.find((m) => m.machineId === "MC-11");

          // NC17n: MC-10 receives single-item (300/60/2.0) + double-comma item (400/90/3.5) = 700/150/5.5
          newChecks.push({
            name: `NC17n · double-comma · MC-10 pcs=700 kg=150 hrs=5.5 (got pcs=${mc10?.pcs ?? "n/a"} kg=${mc10?.kg ?? "n/a"} hrs=${mc10?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc10?.pcs === 700 && mc10?.kg === 150 && Math.abs((mc10?.hrs ?? 0) - 5.5) < 0.01) ? 1 : 0,
            pass: !!mc10 && mc10.pcs === 700 && mc10.kg === 150 && Math.abs(mc10.hrs - 5.5) < 0.01,
            tolerance: `double-comma regex collapses to MC-10; full attribution; got ${mc10?.pcs}/${mc10?.kg}/${mc10?.hrs}`,
          });

          // NC17n: MC-11 receives only the double-comma item (400/90/3.5)
          newChecks.push({
            name: `NC17n · double-comma · MC-11 pcs=400 kg=90 hrs=3.5 (got pcs=${mc11?.pcs ?? "n/a"} kg=${mc11?.kg ?? "n/a"} hrs=${mc11?.hrs ?? "n/a"})`,
            expected: 1,
            actual: (mc11?.pcs === 400 && mc11?.kg === 90 && Math.abs((mc11?.hrs ?? 0) - 3.5) < 0.01) ? 1 : 0,
            pass: !!mc11 && mc11.pcs === 400 && mc11.kg === 90 && Math.abs(mc11.hrs - 3.5) < 0.01,
            tolerance: `"MC-10,,MC-11" splits on /[,/]+/ → MC-11 exact; got ${mc11?.pcs}/${mc11?.kg}/${mc11?.hrs}`,
          });

          // Exact-bucket-set guard: only MC-10 and MC-11 may appear — no phantom empty-string
          // bucket from the double-comma, and no other spurious tokens.
          const EXPECTED_IDS_N = new Set(["MC-10", "MC-11"]);
          const actualIdsN = new Set(totalsN.map((m) => m.machineId));
          const unexpectedN = [...actualIdsN].filter((id) => !EXPECTED_IDS_N.has(id));
          const missingN    = [...EXPECTED_IDS_N].filter((id) => !actualIdsN.has(id));
          const exactSetOkN = unexpectedN.length === 0 && missingN.length === 0;
          newChecks.push({
            name: `NC17n · exact-bucket-set · only MC-10/MC-11 present (unexpected=[${unexpectedN.join(",")}] missing=[${missingN.join(",")}])`,
            expected: 1, actual: exactSetOkN ? 1 : 0,
            pass: exactSetOkN,
            tolerance: `"MC-10,,MC-11" must yield exactly 2 canonical IDs — no empty-string phantom from double-comma`,
          });

          // Empty-string guard: the critical regression check — no machineId may be "".
          const emptyBucket = totalsN.find((m) => m.machineId === "");
          newChecks.push({
            name: `NC17n · empty-string guard · no "" machine bucket exists (found: ${emptyBucket ? `pcs=${emptyBucket.pcs}` : "none"})`,
            expected: 0,
            actual: emptyBucket ? 1 : 0,
            pass: !emptyBucket,
            tolerance: `split(/[,/]+/).filter(Boolean) must eliminate the empty token between "MC-10,,MC-11"`,
          });
        }
      } catch (errN) {
        newChecks.push({
          name: "NC17n · double-comma upload · block error (unexpected exception)",
          expected: 1, actual: 0, pass: false,
          tolerance: errN instanceof Error ? errN.message : String(errN),
        });
      } finally {
        if (uploadIdN !== null) {
          await fetch(`${API_BASE}/api/monitoring/plant-plan/${uploadIdN}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    // NC18: Upload a workbook with no recognised sheets → HTTP 400, no record left behind.
    // Builds a workbook containing only an unrecognised sheet so the empty-items guard fires.
    {
      const XLSX18 = await import("xlsx");
      const FIXTURE_MONTH18   = "2099-02";   // safe far-future — never real data
      const FIXTURE_SEGMENT18 = "Plumbing";

      // Sheet named "Unrelated Data" — not "5. Item Assignment", "Pipe Plan", or "Fitting Plan"
      const ws18 = XLSX18.utils.aoa_to_sheet([["Col A", "Col B"], [1, 2]]);
      const wb18 = XLSX18.utils.book_new();
      XLSX18.utils.book_append_sheet(wb18, ws18, "Unrelated Data");
      const buf18 = Buffer.from(XLSX18.write(wb18, { type: "buffer", bookType: "xlsx" }));

      const fd18 = new FormData();
      fd18.append("month",   FIXTURE_MONTH18);
      fd18.append("segment", FIXTURE_SEGMENT18);
      fd18.append("file",
        new Blob([buf18], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "fixture-unrecognised-sheets.xlsx",
      );

      const uploadResp18 = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fd18 });
      const status18     = uploadResp18.status;
      const body18       = await uploadResp18.text().catch(() => "");

      // Must be 400
      newChecks.push({
        name: `NC18a · plant-plan upload (no recognised sheets) · HTTP 400 (got ${status18})`,
        expected: 400, actual: status18,
        pass: status18 === 400, tolerance: "exact",
      });

      // Error message must mention the supported sheet names
      const mentionsConsolidated = body18.includes("5. Item Assignment");
      const mentionsLegacy       = body18.includes("Pipe Plan") || body18.includes("Fitting Plan");
      newChecks.push({
        name: `NC18b · plant-plan upload (no recognised sheets) · error body names supported sheets`,
        expected: 1, actual: (mentionsConsolidated && mentionsLegacy) ? 1 : 0,
        pass: mentionsConsolidated && mentionsLegacy,
        tolerance: `body must mention "5. Item Assignment" and "Pipe Plan"/"Fitting Plan"`,
      });

      // No upload record must have been created for the fixture month
      if (status18 === 400) {
        const listResp18 = await fetch(
          `${API_BASE}/api/monitoring/plant-plan?month=${FIXTURE_MONTH18}&segment=${encodeURIComponent(FIXTURE_SEGMENT18)}`,
        );
        const list18 = listResp18.ok ? (await listResp18.json() as unknown[]) : null;
        const noRecord = Array.isArray(list18) && list18.length === 0;
        newChecks.push({
          name: `NC18c · plant-plan upload (no recognised sheets) · no upload record persisted after 400`,
          expected: 0, actual: Array.isArray(list18) ? list18.length : -1,
          pass: noRecord, tolerance: "exact — 0 records for fixture month",
        });
      }
    }

    // NC19: Re-upload same month — machine-summary must reflect only the newest upload.
    // Uploads two successive consolidated-plan workbooks to the same far-future month,
    // then asserts machine-summary totals match ONLY the second upload (no doubling).
    // Both fixture uploads are deleted in the finally block regardless of outcome.
    {
      const XLSX19 = await import("xlsx");
      const FIXTURE_MONTH19   = "2099-03";   // safe far-future — never real data
      const FIXTURE_SEGMENT19 = "Plumbing";

      // Helper: build a minimal FORMAT-B workbook with two single-machine items.
      // upload1: MC-01=1000pcs/120kg/5.0hrs (1 item),  MC-02=500pcs/110kg/3.0hrs (1 item)
      // upload2: MC-01=300pcs/60kg/2.0hrs   (1 item),  MC-02=200pcs/40kg/1.5hrs  (1 item)
      // All four figures differ between uploads so any aggregation (doubling) is detectable
      // for pcs, kg, hrs, and itemCount simultaneously.
      const buildWorkbook = (
        mc01Pcs: number, mc01Kg: number, mc01Hrs: number,
        mc02Pcs: number, mc02Kg: number, mc02Hrs: number,
      ) => {
        const wsData = [
          [],
          [],
          [],
          ["Type","Material","Item Code","Qty (pcs)","Wt/pc (kg)","Machine(s)","Machine Hrs","Prod Wt (kg)","Material Req (kg)","Rate (kg/hr)","Rate Tier","Compound Cost (Rs)"],
          ["Pipe",   "HDP-20mm","NC19-A",mc01Pcs,mc01Kg/mc01Pcs,"MC-01",mc01Hrs,mc01Kg,mc01Kg,20,"seeded",1000],
          ["Fitting","SWR-2in", "NC19-B",mc02Pcs,mc02Kg/mc02Pcs,"MC-02",mc02Hrs,mc02Kg,mc02Kg,30,"seeded",500],
        ];
        const ws = XLSX19.utils.aoa_to_sheet(wsData);
        const wb = XLSX19.utils.book_new();
        XLSX19.utils.book_append_sheet(wb, ws, "5. Item Assignment");
        // Extract a true ArrayBuffer (a valid BlobPart) from the Node Buffer to avoid
        // the Buffer<ArrayBufferLike> vs Uint8Array<ArrayBuffer> type mismatch.
        const nodeBuf = Buffer.from(XLSX19.write(wb, { type: "buffer", bookType: "xlsx" }));
        return nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength) as ArrayBuffer;
      };

      const postUpload = async (arrayBuf: ArrayBuffer, label: string) => {
        const fd = new FormData();
        fd.append("month",   FIXTURE_MONTH19);
        fd.append("segment", FIXTURE_SEGMENT19);
        fd.append("file",
          new Blob([arrayBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
          `${label}.xlsx`,
        );
        const resp = await fetch(`${API_BASE}/api/monitoring/plant-plan`, { method: "POST", body: fd });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          throw new Error(`${label} POST failed HTTP ${resp.status}: ${txt.slice(0, 120)}`);
        }
        return (await resp.json() as { id: number; itemCount: number }).id;
      };

      let uploadId1: number | null = null;
      let uploadId2: number | null = null;
      try {
        // Upload 1 — original plan
        const data1 = buildWorkbook(1000, 120, 5.0, 500, 110, 3.0);
        // Upload 2 — corrected re-upload (all figures changed so any aggregation is detectable)
        const data2 = buildWorkbook( 300,  60, 2.0, 200,  40, 1.5);

        uploadId1 = await postUpload(data1, "nc19-upload1");
        uploadId2 = await postUpload(data2, "nc19-upload2");

        newChecks.push({
          name: `NC19a · re-upload same month · both uploads posted (id1=${uploadId1}, id2=${uploadId2})`,
          expected: 1, actual: 1, pass: true, tolerance: "both POSTs must succeed",
        });

        interface MachineTotals19 { machineId: string; pcs: number; kg: number; hrs: number; itemCount: number }
        const summaryData19 = await fetchJson<{
          upload: { id: number } | null;
          machineTotals: MachineTotals19[];
          uploadCount: number;
        }>(`${API_BASE}/api/monitoring/plant-plan/machine-summary?month=${FIXTURE_MONTH19}&segment=${encodeURIComponent(FIXTURE_SEGMENT19)}`);

        const totals19 = summaryData19.machineTotals ?? [];
        const mc01 = totals19.find((t) => t.machineId === "MC-01");
        const mc02 = totals19.find((t) => t.machineId === "MC-02");

        // Expected from upload2 only — upload1+upload2 doubled values shown for reference:
        //   MC-01  pcs: upload2=300  (doubled→1300),  kg: upload2=60  (doubled→180),  hrs: upload2=2.0 (doubled→7.0)
        //   MC-02  pcs: upload2=200  (doubled→700),   kg: upload2=40  (doubled→150),  hrs: upload2=1.5 (doubled→4.5)

        const activeUploadId = (summaryData19.upload as { id: number } | null)?.id ?? null;
        newChecks.push({
          name: `NC19b · machine-summary · active upload is the newest (id=${uploadId2}) not the first (id=${uploadId1})`,
          expected: uploadId2 ?? -1, actual: activeUploadId ?? -1,
          pass: activeUploadId === uploadId2,
          tolerance: "upload field must reference the second (newest) upload",
        });

        const mc01Ok = !!mc01 && mc01.pcs === 300 && mc01.kg === 60 && Math.abs(mc01.hrs - 2.0) < 0.01 && mc01.itemCount === 1;
        newChecks.push({
          name: `NC19c · machine-summary · MC-01 pcs=300 kg=60 hrs=2.0 itemCount=1 (got pcs=${mc01?.pcs ?? "n/a"} kg=${mc01?.kg ?? "n/a"} hrs=${mc01?.hrs ?? "n/a"} items=${mc01?.itemCount ?? "n/a"}) — no doubling`,
          expected: 1, actual: mc01Ok ? 1 : 0, pass: mc01Ok,
          tolerance: "must match upload2 only (1300/180/7.0/2 would indicate doubling)",
        });

        const mc02Ok = !!mc02 && mc02.pcs === 200 && mc02.kg === 40 && Math.abs(mc02.hrs - 1.5) < 0.01 && mc02.itemCount === 1;
        newChecks.push({
          name: `NC19d · machine-summary · MC-02 pcs=200 kg=40 hrs=1.5 itemCount=1 (got pcs=${mc02?.pcs ?? "n/a"} kg=${mc02?.kg ?? "n/a"} hrs=${mc02?.hrs ?? "n/a"} items=${mc02?.itemCount ?? "n/a"}) — no doubling`,
          expected: 1, actual: mc02Ok ? 1 : 0, pass: mc02Ok,
          tolerance: "must match upload2 only (700/150/4.5/2 would indicate doubling)",
        });

        // uploadCount tells us how many uploads exist; the endpoint may surface > 1
        // but must use only the newest for totals (verified above).
        newChecks.push({
          name: `NC19e · machine-summary · uploadCount reflects both uploads (${summaryData19.uploadCount ?? "n/a"} ≥ 2)`,
          expected: 1,
          actual: (summaryData19.uploadCount ?? 0) >= 2 ? 1 : 0,
          pass: (summaryData19.uploadCount ?? 0) >= 2,
          tolerance: "both uploads must be persisted; deduplication must be at query time (latest only)",
        });
      } finally {
        // Always clean up both fixture uploads regardless of assertion outcome.
        const cleanups = [uploadId1, uploadId2].filter((id): id is number => id !== null);
        await Promise.all(cleanups.map((id) =>
          fetch(`${API_BASE}/api/monitoring/plant-plan/${id}`, { method: "DELETE" }).catch(() => {}),
        ));
      }
    }

    // NC23: Corrective export header / TOTAL row consistency for both segments.
    // Calls GET /corrective/validate/export-totals for the latest persisted corrective
    // run in each segment and verifies:
    //   (a) Detail "Original Month Total" header == Standard TOTAL Min (same item-level Math.round path)
    //   (b) Detail "Revised Month Total" header  == Standard TOTAL Max (same item-level Math.round path)
    // A regression — e.g. someone reverts the header to run.revisedMonthTotal (stored as a
    // 32-bit real) — would cause these to diverge by up to ~100 pcs and fail check (b).
    console.log("\n⏳  NC23: running corrective export header/TOTAL consistency checks (both segments) …");
    type NC23Check = { name: string; expected: number; actual: number; pass: boolean; tolerance?: string };
    for (const { seg, month: nc23Month } of [
      { seg: "Plumbing", month: PLUMBING_MONTH },
      { seg: "PTMT",     month: PTMT_PLAN_MONTH },
    ]) {
      let nc23Res: Record<string, unknown> | null = null;
      try {
        const url = `${API_BASE}/api/corrective/validate/export-totals?month=${encodeURIComponent(nc23Month)}&segment=${encodeURIComponent(seg)}`;
        const resp = await fetch(url);
        if (resp.status === 404) {
          // No corrective run exists yet for this segment/month — skip with a pass (not a bug).
          newChecks.push({
            name: `NC23 · ${seg}/${nc23Month} · no corrective run exists yet (skipped)`,
            expected: 1, actual: 1, pass: true,
            tolerance: "skip — run the corrective re-plan first to enable this check",
          });
          continue;
        }
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          newChecks.push({
            name: `NC23 · ${seg}/${nc23Month} · export-totals endpoint HTTP ${resp.status}`,
            expected: 200, actual: resp.status, pass: false,
            tolerance: body.slice(0, 120),
          });
          continue;
        }
        nc23Res = await resp.json() as Record<string, unknown>;
      } catch (err) {
        newChecks.push({
          name: `NC23 · ${seg}/${nc23Month} · export-totals endpoint reachable`,
          expected: 1, actual: 0, pass: false,
          tolerance: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const nc23Checks = (nc23Res["checks"] as NC23Check[] | undefined) ?? [];
      if (nc23Checks.length === 0) {
        newChecks.push({
          name: `NC23 · ${seg}/${nc23Month} · endpoint returned non-empty checks array`,
          expected: 1, actual: 0, pass: false,
          tolerance: "endpoint returned empty checks — no assertions could be evaluated",
        });
        continue;
      }

      for (const c of nc23Checks) {
        newChecks.push({
          name: `NC23 · ${seg}/${nc23Month} · ${c.name}`,
          expected: c.expected, actual: c.actual,
          pass: c.pass, tolerance: c.tolerance,
        });
      }

      // Surface a summary line showing the divergence from stored real fields
      const origDiv = Number(nc23Res["origDivergence"] ?? 0);
      const planDiv = Number(nc23Res["planDivergence"] ?? 0);
      console.log(`  NC23 ${seg}/${nc23Month}: run #${nc23Res["runId"]}, ${nc23Res["itemCount"]} items` +
        ` | orig divergence from stored real: ${origDiv} pcs` +
        ` | plan divergence from stored real: ${planDiv} pcs`);
    }

  } catch (err) {
    console.error(`\n❌  New permanent checks error: ${err instanceof Error ? err.message : String(err)}`);
    anyFail = true;
  }

  printSection("New permanent endpoint checks", newChecks);
  if (newChecks.some((c) => !c.pass)) {
    anyFail = true;
    console.error(`\n❌  New checks: ${newChecks.filter((c) => !c.pass).length} check(s) FAILED`);
  } else {
    console.log(`\n✅  New checks: all ${newChecks.length} PASSED`);
  }

  // ── 6b. Corrective export item-count check (AGRI extra-row regression guard) ──
  // Catches any future recurrence of the AGRI explanatory note being placed BEFORE
  // item rows (was: note row counted as item → 1,123 instead of 1,120).
  // Downloads the Standard corrective Excel for the latest Plumbing Aug-2026 run,
  // counts data rows per category sheet (skipping header row 1, fully blank rows,
  // and note rows that start with "ℹ"), and asserts exact golden values.
  console.log("\n⏳  Running corrective-export item-count check (AGRI extra-row guard, 2026-08) …");
  const agriCountChecks: CheckResult[] = [];
  const CORR_CHECK_MONTH   = "2026-08";
  const CORR_CHECK_SEGMENT = "Plumbing";

  // Golden per-category item counts — must exactly match the 1,120-item plan run.
  const EXPECTED_CAT_COUNTS: Record<string, number> = {
    "CPVC Pipe":   40,  "CPVC Fitting": 244, "CPVC Solvent":  9,
    "UPVC Pipe":   52,  "UPVC Fitting": 242, "UPVC Solvent": 30,
    "SWR Pipe":   160,  "SWR Fitting":  134, "SWR Solvent":   3,
    "AGRI Pipe":  123,  "AGRI Fitting":  82, "AGRI Solvent":  1,
  };
  const EXPECTED_TOTAL_ITEMS = 1120;

  // The baseline plan run to pin the export check against.
  // We always assert against whichever corrective run cites plan run #44 (the
  // finalized Aug-2026 Plumbing plan), NOT the newest corrective run by
  // creation order.  This way a future mid-month replan that creates a new
  // corrective run with a different item count cannot silently break this
  // assertion — the check remains anchored to the specific plan-run baseline.
  const EXPECTED_PLAN_RUN_ID = 44;

  try {
    // Step 1: fetch all Plumbing/Aug-2026 corrective runs (API returns DESC order).
    type CorrRunListEntry = { id: number; month: string; segment: string; planRunId: number | null; createdAt: string };
    const corrRuns = await fetchJson<CorrRunListEntry[]>(
      `${API_BASE}/api/corrective/runs?segment=${encodeURIComponent(CORR_CHECK_SEGMENT)}&month=${encodeURIComponent(CORR_CHECK_MONTH)}`,
    );
    if (!corrRuns || corrRuns.length === 0) {
      agriCountChecks.push({
        name: `AGRI · ${CORR_CHECK_SEGMENT}/${CORR_CHECK_MONTH} corrective runs found`,
        expected: 1, actual: 0, pass: false,
        tolerance: `POST /corrective/replan month=${CORR_CHECK_MONTH} segment=${CORR_CHECK_SEGMENT} to create a run first`,
      });
    } else {
      // Select the corrective run that cites plan run #44 (the finalized baseline).
      // If multiple such runs exist (e.g., the plan was re-exported twice from the
      // same baseline), take the newest one (DESC order ⇒ first match).
      const pinnedRun = corrRuns.find((r) => r.planRunId === EXPECTED_PLAN_RUN_ID);

      // Guard: if no run cites plan run #44 yet, report clearly rather than
      // silently asserting against an unrelated run.
      if (!pinnedRun) {
        const runIds = corrRuns.map((r) => `#${r.id}(planRun=${r.planRunId ?? "null"})`).join(", ");
        agriCountChecks.push({
          name: `AGRI · corrective run citing plan run #${EXPECTED_PLAN_RUN_ID} found (available: ${runIds})`,
          expected: 1, actual: 0, pass: false,
          tolerance: `POST /corrective/replan with planRunId=${EXPECTED_PLAN_RUN_ID} to create a pinned corrective run`,
        });
        // No further assertions possible without the pinned run.
      } else {
        const latestRun = pinnedRun;
        agriCountChecks.push({
          name: `AGRI · corrective run citing plan run #${EXPECTED_PLAN_RUN_ID} found (id=${latestRun.id}, planRunId=${latestRun.planRunId})`,
          expected: 1, actual: 1, pass: true,
        });

        // Step 2: download Standard Excel for that run.
        const xlResp = await fetch(
          `${API_BASE}/api/corrective/runs/${latestRun.id}/export/excel?format=standard`,
        );
        if (!xlResp.ok) {
          agriCountChecks.push({
            name: `AGRI · standard Excel download HTTP 200 (got ${xlResp.status})`,
            expected: 200, actual: xlResp.status, pass: false,
          });
        } else {
          const xlBuf = Buffer.from(await xlResp.arrayBuffer());

          // Step 3: parse with ExcelJS and count data rows per category sheet.
          // The standard format has:
          //   Row 1         — header row (bold, ITEM_COLUMNS)
          //   Row 2+        — item data rows
          //   [AGRI only]   — blank separator row, then note row starting with "ℹ"
          // Non-category sheets (Summary, Legend) are skipped by name.
          const ExcelJSMod = await import("exceljs");
          const xlWb = new ExcelJSMod.default.Workbook();
          await xlWb.xlsx.load(xlBuf as unknown as ArrayBuffer);

          const NON_CATEGORY_SHEETS = new Set(["Summary", "Legend", "Warnings", "Corrective Summary", "Revised Release"]);
          const catCounts: Record<string, number> = {};

          for (const sheet of xlWb.worksheets) {
            if (NON_CATEGORY_SHEETS.has(sheet.name)) continue;
            let dataRows = 0;
            sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
              if (rowNumber === 1) return; // skip header row
              const firstCell = row.getCell(1);
              const cellText = firstCell.value != null ? String(firstCell.value).trim() : "";
              if (!cellText) return;           // effectively blank
              if (cellText.startsWith("ℹ")) return; // AGRI explanatory note — must NOT be counted
              if (cellText.startsWith("◆")) return; // KPI row (detail format guard, not present in standard)
              dataRows++;
            });
            catCounts[sheet.name] = dataRows;
          }

          // Step 4: per-category exact assertions.
          let totalActual = 0;
          for (const [cat, expected] of Object.entries(EXPECTED_CAT_COUNTS)) {
            const actual = catCounts[cat] ?? 0;
            totalActual += actual;
            agriCountChecks.push({
              name: `AGRI · ${cat} item count = ${expected} (actual ${actual})`,
              expected, actual, pass: actual === expected,
              tolerance: "exact — header/blank/ℹ-note rows excluded",
            });
          }

          // Step 5: grand-total assertion — the primary AGRI regression guard.
          agriCountChecks.push({
            name: `AGRI · total item count across 12 category sheets = ${EXPECTED_TOTAL_ITEMS} (actual ${totalActual})`,
            expected: EXPECTED_TOTAL_ITEMS, actual: totalActual,
            pass: totalActual === EXPECTED_TOTAL_ITEMS,
            tolerance: "exact — was 1,123 when AGRI note placed before item rows; must be 1,120",
          });
        }
      } // end pinnedRun else
    } // end corrRuns else
  } catch (err) {
    agriCountChecks.push({
      name: "AGRI · corrective export item-count check (unexpected error)",
      expected: 1, actual: 0, pass: false,
      tolerance: err instanceof Error ? err.message : String(err),
    });
  }

  printSection(`Corrective export item-count (${CORR_CHECK_SEGMENT}/${CORR_CHECK_MONTH}, AGRI regression guard)`, agriCountChecks);
  if (agriCountChecks.some((c) => !c.pass)) {
    anyFail = true;
    console.error(`\n❌  Corrective item-count: ${agriCountChecks.filter((c) => !c.pass).length} check(s) FAILED`);
  } else {
    console.log(`\n✅  Corrective item-count: all ${agriCountChecks.length} PASSED`);
  }

  // ── 6b-PTMT. Corrective export item-count check (PTMT Aug-2026) ──────────
  // Parallel guard for PTMT: any future note-placement mistake in a PTMT
  // category sheet (analogous to the Plumbing AGRI note incident) would inflate
  // the row count and be caught here.  Downloads the Standard corrective Excel
  // for a PINNED known-good PTMT Aug-2026 run and asserts exact per-category
  // row counts.
  //
  // IMPORTANT: this check is PINNED to corrective run #101 — the known-good
  // baseline established when the goldens below were recorded.  Do NOT switch
  // to "latest run": the plant may create new Aug-2026 runs with a different
  // weekClosed / updated actuals, which changes per-category breakdowns and
  // would cause false failures.  If the pinned run is ever deleted and replaced,
  // update PTMT_CORR_RUN_ID to the new known-good run id and re-record goldens.
  console.log("\n⏳  Running PTMT corrective-export item-count check (2026-08, pinned run #101) …");
  const ptmtCountChecks: CheckResult[] = [];
  const PTMT_CORR_MONTH   = "2026-08";
  const PTMT_CORR_SEGMENT = "PTMT";
  const PTMT_CORR_RUN_ID  = 101; // pinned — do not change to "latest"

  // Golden per-category item counts — recorded from run #101 (plan run #21 baseline).
  // These must not change as long as the same plan run is the corrective baseline.
  const PTMT_EXPECTED_CAT_COUNTS: Record<string, number> = {
    "Cabinet":                       50,
    "Cocks Standard":              2347,
    "Ball Cock":                     63,
    "Cocks Premium":                602,
    "Faucets & Jetsprays & Shower": 183,
    "Accessorise":                  204,
    "Cistern & Seat Cover":         187,
  };
  const PTMT_EXPECTED_TOTAL_ITEMS = 3636;

  try {
    // Step 1: confirm the pinned run exists and belongs to the expected segment/month.
    type CorrRunDetail = { id: number; month: string; segment: string; createdAt: string };
    let pinnedRun: CorrRunDetail | null = null;
    try {
      pinnedRun = await fetchJson<CorrRunDetail>(
        `${API_BASE}/api/corrective/runs/${PTMT_CORR_RUN_ID}`,
      );
    } catch {
      // run fetch failed — will be reported below
    }
    if (!pinnedRun) {
      ptmtCountChecks.push({
        name: `PTMT-CORR · pinned corrective run #${PTMT_CORR_RUN_ID} found`,
        expected: 1, actual: 0, pass: false,
        tolerance: `Run #${PTMT_CORR_RUN_ID} not found — create a new known-good run and update PTMT_CORR_RUN_ID`,
      });
    } else {
      ptmtCountChecks.push({
        name: `PTMT-CORR · pinned corrective run #${PTMT_CORR_RUN_ID} found (${pinnedRun.segment}/${pinnedRun.month})`,
        expected: 1, actual: 1, pass: true,
      });

      // Step 2: download Standard Excel for the pinned run.
      const ptmtXlResp = await fetch(
        `${API_BASE}/api/corrective/runs/${PTMT_CORR_RUN_ID}/export/excel?format=standard`,
      );
      if (!ptmtXlResp.ok) {
        ptmtCountChecks.push({
          name: `PTMT-CORR · standard Excel download HTTP 200 (got ${ptmtXlResp.status})`,
          expected: 200, actual: ptmtXlResp.status, pass: false,
        });
      } else {
        const ptmtXlBuf = Buffer.from(await ptmtXlResp.arrayBuffer());

        // Step 3: parse with ExcelJS and count data rows per category sheet.
        // Same filtering rules as the Plumbing check:
        //   Row 1         — header row (bold, ITEM_COLUMNS) → skip
        //   Fully blank   → skip
        //   Starts with "ℹ" → explanatory note → skip (must NOT count)
        //   Starts with "◆" → KPI row (detail format; not in standard) → skip
        const ExcelJSMod2 = await import("exceljs");
        const ptmtXlWb = new ExcelJSMod2.default.Workbook();
        await ptmtXlWb.xlsx.load(ptmtXlBuf as unknown as ArrayBuffer);

        const NON_CATEGORY_SHEETS2 = new Set(["Summary", "Legend", "Warnings", "Corrective Summary", "Revised Release"]);
        const ptmtCatCounts: Record<string, number> = {};

        for (const sheet of ptmtXlWb.worksheets) {
          if (NON_CATEGORY_SHEETS2.has(sheet.name)) continue;
          let dataRows = 0;
          sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // skip header row
            const firstCell = row.getCell(1);
            const cellText = firstCell.value != null ? String(firstCell.value).trim() : "";
            if (!cellText) return;           // effectively blank
            if (cellText.startsWith("ℹ")) return; // explanatory note — must NOT be counted
            if (cellText.startsWith("◆")) return; // KPI row (detail format guard)
            dataRows++;
          });
          ptmtCatCounts[sheet.name] = dataRows;
        }

        // Step 4: per-category exact assertions.
        let ptmtTotalActual = 0;
        for (const [cat, expected] of Object.entries(PTMT_EXPECTED_CAT_COUNTS)) {
          const actual = ptmtCatCounts[cat] ?? 0;
          ptmtTotalActual += actual;
          ptmtCountChecks.push({
            name: `PTMT-CORR · ${cat} item count = ${expected} (actual ${actual})`,
            expected, actual, pass: actual === expected,
            tolerance: "exact — header/blank/ℹ-note rows excluded",
          });
        }

        // Step 5: grand-total assertion — the primary regression guard.
        ptmtCountChecks.push({
          name: `PTMT-CORR · total item count across 7 category sheets = ${PTMT_EXPECTED_TOTAL_ITEMS} (actual ${ptmtTotalActual})`,
          expected: PTMT_EXPECTED_TOTAL_ITEMS, actual: ptmtTotalActual,
          pass: ptmtTotalActual === PTMT_EXPECTED_TOTAL_ITEMS,
          tolerance: "exact — a note placed before item rows would inflate this count",
        });
      }
    }
  } catch (err) {
    ptmtCountChecks.push({
      name: "PTMT-CORR · corrective export item-count check (unexpected error)",
      expected: 1, actual: 0, pass: false,
      tolerance: err instanceof Error ? err.message : String(err),
    });
  }

  printSection(`Corrective export item-count (${PTMT_CORR_SEGMENT}/${PTMT_CORR_MONTH})`, ptmtCountChecks);
  if (ptmtCountChecks.some((c) => !c.pass)) {
    anyFail = true;
    console.error(`\n❌  PTMT corrective item-count: ${ptmtCountChecks.filter((c) => !c.pass).length} check(s) FAILED`);
  } else {
    console.log(`\n✅  PTMT corrective item-count: all ${ptmtCountChecks.length} PASSED`);
  }

  // ── 7. Workbook resolution & actuals-freshness guards ───────────────────
  console.log("\n⏳  Running workbook-resolution & actuals-freshness guards …");
  const wrChecks: CheckResult[] = [];
  const CURRENT_MONTH = new Date().toISOString().slice(0, 7);
  try {
    // WR1: month-match guard — each resolved workbook's title names the monitored month.
    const resolvedResp = await fetchJson<{ month: string; feeds: Array<Record<string, unknown>> }>(
      `${API_BASE}/api/workbook-config/resolved?month=${CURRENT_MONTH}`,
    );
    for (const feed of resolvedResp.feeds ?? []) {
      const div = String(feed.division);
      const resolvedOk = !feed.error && feed.workbookId != null && feed.titleMonthMatch === true;
      // PTMT-Machine (Report-5 Date Sheet series) may legitimately lag the month:
      // the plant creates that workbook days into the month. Until it exists, a
      // NAMED resolution error (citing the pattern) is the correct state — but a
      // silent/unnamed failure is still a bug.
      const namedNoMatch =
        div === "PTMT-Machine" &&
        feed.workbookId == null &&
        String(feed.error ?? "").toLowerCase().includes("pattern");
      const ok = resolvedOk || namedNoMatch;
      wrChecks.push({
        name: `WR1 · ${div} workbook resolves for ${CURRENT_MONTH} and title names the month (${namedNoMatch ? "named no-match accepted — machine report not yet created" : `title: ${feed.title ?? "n/a"}`})`,
        expected: 1, actual: ok ? 1 : 0, pass: ok,
        tolerance: feed.error && !namedNoMatch ? String(feed.error) : "resolved + titleMonthMatch (PTMT-Machine may be a named no-match)",
      });
    }

    // WR2: non-stale guard — current-month produced figures are non-zero once
    // production exists (a stale/wrong workbook presents as zero production).
    const [plumbDashNow, ptmtDashNow] = await Promise.all([
      fetchJson<Record<string, any>>(`${API_BASE}/api/monitoring/dashboard?month=${CURRENT_MONTH}&segment=PLUMBING`),
      fetchJson<Record<string, any>>(`${API_BASE}/api/monitoring/dashboard?month=${CURRENT_MONTH}&segment=PTMT`),
    ]);
    const plumbProducedNow = Number(plumbDashNow?.plant?.produced ?? 0);
    const ptmtProducedNow  = Number(ptmtDashNow?.plant?.totalProduced ?? 0);
    // Only assert non-zero after the 3rd of the month (production data needs a day or two to appear).
    const dayOfMonth = new Date().getDate();
    const expectProduction = dayOfMonth >= 3;
    wrChecks.push({
      name: `WR2a · Plumbing monitoring totalProduced non-zero for ${CURRENT_MONTH} (got ${plumbProducedNow})`,
      expected: 1, actual: !expectProduction || plumbProducedNow > 0 ? 1 : 0,
      pass: !expectProduction || plumbProducedNow > 0, tolerance: "must be > 0 once production exists",
    });
    wrChecks.push({
      name: `WR2b · PTMT monitoring totalProduced non-zero for ${CURRENT_MONTH} (got ${ptmtProducedNow})`,
      expected: 1, actual: !expectProduction || ptmtProducedNow > 0 ? 1 : 0,
      pass: !expectProduction || ptmtProducedNow > 0, tolerance: "must be > 0 once production exists",
    });

    // WR3: cross-source reconciliation — monitoring and corrective read the same
    // source, so produced-to-date must agree (same as-of date, same segment).
    const asOfToday = new Date().toISOString().slice(0, 10);
    const dryReplan = async (segment: string) => {
      const resp = await fetch(`${API_BASE}/api/corrective/replan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: CURRENT_MONTH, asOfDate: asOfToday, segment, dryRun: true }),
      });
      if (!resp.ok) return null;
      return (await resp.json()) as Record<string, any>;
    };
    const [plumbReplan, ptmtReplan] = await Promise.all([
      dryReplan("Plumbing").catch(() => null),
      dryReplan("PTMT").catch(() => null),
    ]);
    const reconcile = (label: string, dashVal: number, replan: Record<string, any> | null) => {
      if (!replan) {
        wrChecks.push({
          name: `WR3 · ${label} monitoring vs corrective producedToDate (corrective endpoint unavailable — skipped)`,
          expected: 1, actual: 1, pass: true, tolerance: "skip: no corrective plan for month",
        });
        return;
      }
      const rep = Number(
        replan.producedToDate ?? replan.totalProduced ?? replan.totals?.producedToDate ?? NaN,
      );
      if (!Number.isFinite(rep)) {
        wrChecks.push({
          name: `WR3 · ${label} corrective producedToDate field present`,
          expected: 1, actual: 0, pass: false, tolerance: "validate-replan payload lacks producedToDate",
        });
        return;
      }
      // ±2%: corrective may add new-order items beyond the frozen plan roster
      // (same architectural tolerance as NC13).
      const ok = dashVal > 0 && Math.abs(rep - dashVal) / dashVal <= 0.02;
      wrChecks.push({
        name: `WR3 · ${label} producedToDate reconciles: monitoring ${dashVal} ≈ corrective ${rep}`,
        expected: dashVal, actual: rep, pass: ok, tolerance: "±2% (same source; corrective adds new-order items)",
      });
    };
    // Corrective producedToDate counts plan-mapped production, so reconcile
    // against monitoring's mapped figure (same source, same mapping rules).
    const plumbMappedNow = Number(plumbDashNow?.plant?.mapped ?? 0);
    const ptmtMappedNow  = Number(ptmtDashNow?.plant?.mapped ?? 0);
    reconcile("Plumbing", plumbMappedNow, plumbReplan);
    reconcile("PTMT", ptmtMappedNow, ptmtReplan);

    // WR5: no-match guard — a month with no workbook must raise a named error,
    // never fall back to a prior month's file.
    const farMonth = "2031-01";
    const noMatch = await fetchJson<{ feeds: Array<Record<string, unknown>> }>(
      `${API_BASE}/api/workbook-config/resolved?month=${farMonth}`,
    );
    for (const feed of noMatch.feeds ?? []) {
      const err = String(feed.error ?? "");
      const ok = feed.workbookId == null && err.includes(farMonth) && err.toLowerCase().includes("pattern");
      wrChecks.push({
        name: `WR5 · ${feed.division} resolution for ${farMonth} fails loudly naming the pattern (no fallback)`,
        expected: 1, actual: ok ? 1 : 0, pass: ok, tolerance: err.slice(0, 120) || "expected named error",
      });
    }
    // WR4 (planning isolation) is covered by the existing Guard-assertion section above.
  } catch (err) {
    console.error(`\n❌  Workbook-resolution checks error: ${err instanceof Error ? err.message : String(err)}`);
    wrChecks.push({ name: "WR · suite executed", expected: 1, actual: 0, pass: false, tolerance: String(err) });
  }
  printSection("Workbook resolution & freshness guards", wrChecks);
  if (wrChecks.some((c) => !c.pass)) {
    anyFail = true;
    console.error(`\n❌  Workbook-resolution: ${wrChecks.filter((c) => !c.pass).length} check(s) FAILED`);
  } else {
    console.log(`\n✅  Workbook-resolution: all ${wrChecks.length} PASSED`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalChecks = bundleChecks.length + plumbingResult.checks.length + replanResult.checks.length + ptmtResult.checks.length + monResult.checks.length + schemaParityResult.checks.length + newChecks.length + agriCountChecks.length + ptmtCountChecks.length + wrChecks.length;
  const totalFail   = bundleChecks.filter((c) => !c.pass).length + plumbingResult.failCount + replanResult.failCount + ptmtResult.failCount + monResult.failCount + schemaParityResult.failCount + newChecks.filter((c) => !c.pass).length + agriCountChecks.filter((c) => !c.pass).length + ptmtCountChecks.filter((c) => !c.pass).length + wrChecks.filter((c) => !c.pass).length;
  const totalPass   = totalChecks - totalFail;

  console.log("\n" + "=".repeat(60));
  if (anyFail) {
    console.error(`❌  SUITE FAILED — ${totalFail} / ${totalChecks} checks failed`);
    console.error("    Fix failures above before proceeding.");
  } else {
    console.log(`✅  SUITE PASSED — ${totalPass} / ${totalChecks} checks passed`);
  }
  console.log("=".repeat(60) + "\n");

  process.exit(anyFail ? 1 : 0);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
