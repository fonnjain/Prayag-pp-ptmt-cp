import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizePlumbingTabName,
  plumbingTabMatchesMaterial,
  selectPlumbingMaterialTab,
} from "./sheets.js";

test("Plumbing tab matching normalizes spacing, punctuation, and case", () => {
  assert.equal(normalizePlumbingTabName("  cpvc  pipe "), "CPVCPIPE");
  assert.equal(plumbingTabMatchesMaterial("CPVC PIPE", "CPVC"), true);
  assert.equal(plumbingTabMatchesMaterial("cpvc_pipe", "CPVC"), true);
  assert.equal(plumbingTabMatchesMaterial("MYSTERY PIPE", "CPVC"), false);
});

test("Plumbing tab selection prefers the full material tab over top-item and compound tabs", () => {
  const tabs = ["CPVC TOP ITEM", "CPVC PIPE", "CPVC", "CPVC PRODUCTION PLANING PIPE"];
  assert.equal(selectPlumbingMaterialTab(tabs, "CPVC"), "CPVC");
  assert.equal(selectPlumbingMaterialTab(["CPVC TOP ITEM", "CPVC PIPE"], "CPVC"), "CPVC PIPE");
  assert.equal(selectPlumbingMaterialTab(["UPVC-TOP-ITEM"], "UPVC"), "UPVC-TOP-ITEM");
});