import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import bcrypt from "bcryptjs";
import {
  db,
  apiKeysTable,
  planRunResultsTable,
  planRunsTable,
  plantIngestionCacheTable,
  plantMonthSnapshotsTable,
  userSessionsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { createApp, setDatabaseReady } from "../app";
import { rateLimit, _resetApiKeyRateLimitsForTest } from "./auth-middleware";
import { countWorkingDaysElapsed } from "../lib/monitoring-calc";

const routeSource = readFileSync(join(process.cwd(), "src/routes/api-v1.ts"), "utf8");
const appSource = readFileSync(join(process.cwd(), "src/app.ts"), "utf8");

describe("versioned read-only API contract", () => {
  test("exposes exactly the four GET projection paths", () => {
    for (const path of ["/plan/items", "/calendar", "/summary", "/categories"]) {
      assert.match(routeSource, new RegExp(`router\\.get\\("${path.replace("/", "\\/")}"`));
    }
    assert.doesNotMatch(routeSource, /router\.(post|put|patch|delete)\(/);
  });

  test("does not exempt the corrective mutation from session auth", () => {
    assert.doesNotMatch(appSource, /corrective\/runs.*PATCH|method === "PATCH"/);
    assert.match(appSource, /method === "GET".*v1/);
  });

  test("counts calendar non-Sundays while retaining observed worked Sundays", () => {
    assert.equal(countWorkingDaysElapsed("2026-08", "2026-08-09"), 7);
    assert.equal(countWorkingDaysElapsed("2026-08", "2026-08-10"), 8);
  });
});

describe("per-key API rate limits", () => {
  beforeEach(() => _resetApiKeyRateLimitsForTest());

  test("uses the machine-analysis 60 request policy and emits standard headers", () => {
    const headers: Record<string, string> = {};
    let status = 200;
    const res = {
      set(value: string | Record<string, string>, maybeValue?: string) {
        if (typeof value === "string") headers[value] = maybeValue ?? "";
        else Object.assign(headers, value);
        return this;
      },
      status(value: number) { status = value; return this; },
      json() { return this; },
    } as never;
    const req = {} as never;
    const key = { id: 9001, consumer: "machine-analysis", scopes: ["read"], segmentScopes: ["PTMT"] };
    assert.equal(rateLimit(req, res, key), true);
    assert.equal(headers["X-RateLimit-Limit"], "60");
    assert.equal(headers["X-RateLimit-Remaining"], "59");
    assert.equal(status, 200);
  });
});

describe("versioned API over HTTP", () => {
  let server: Server;
  let rawKey: string;
  let keyId: number;

  beforeEach(async () => {
    setDatabaseReady(true);
    rawKey = `test_v1_${randomUUID()}`;
    const [row] = await db.insert(apiKeysTable).values({
      name: "v1 contract test",
      consumer: "machine-analysis",
      scopes: ["read"],
      segmentScopes: ["PTMT"],
      keyHash: createHash("sha256").update(rawKey).digest("hex"),
      keyPrefix: rawKey.slice(0, 14),
    }).returning({ id: apiKeysTable.id });
    keyId = row.id;
    server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  test.afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.delete(apiKeysTable).where(eq(apiKeysTable.id, keyId));
  });

  async function get(path: string, key?: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }

  test("rejects missing keys with 401 and isolates a PTMT key from Plumbing", async () => {
    const missing = await get("/api/v1/summary?month=9000-01");
    assert.equal(missing.status, 401);
    assert.equal(missing.body.error, "Missing Authorization: Bearer <api key>");

    const forbidden = await get("/api/v1/summary?month=9000-01&segment=Plumbing", rawKey);
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, "FORBIDDEN");
  });

  test("defaults omitted segment to PTMT and returns named local-cache unavailability", async () => {
    const response = await get("/api/v1/summary?month=9000-01", rawKey);
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "CACHE_UNAVAILABLE");
  });
});

describe("issued scoped API keys over HTTP", () => {
  const projectionPaths = ["/plan/items", "/calendar", "/summary", "/categories"] as const;
  type Segment = "PTMT" | "Plumbing";
  type IssuedKey = { id: number; raw: string; segment: Segment };

  let server: Server;
  let base: string;
  let adminId: number;
  let adminCookie = "";
  const issuedKeys: IssuedKey[] = [];

  async function findReadableMonth(segment: Segment): Promise<string> {
    const snapshots = await db
      .select({ month: plantMonthSnapshotsTable.month })
      .from(plantMonthSnapshotsTable)
      .where(and(
        eq(plantMonthSnapshotsTable.segment, segment),
        eq(plantMonthSnapshotsTable.planStatus, "monitoring"),
      ))
      .orderBy(desc(plantMonthSnapshotsTable.id));
    if (snapshots[0]) return snapshots[0].month;

    const runs = await db
      .select({ id: planRunsTable.id, month: planRunsTable.month })
      .from(planRunsTable)
      .where(and(
        eq(planRunsTable.segment, segment),
        eq(planRunsTable.status, "finalized"),
      ))
      .orderBy(desc(planRunsTable.id));
    for (const run of runs) {
      const [ingestion, result] = await Promise.all([
        db.select({ month: plantIngestionCacheTable.month })
          .from(plantIngestionCacheTable)
          .where(and(
            eq(plantIngestionCacheTable.month, run.month),
            eq(plantIngestionCacheTable.segment, segment),
          ))
          .limit(1),
        db.select({ id: planRunResultsTable.id })
          .from(planRunResultsTable)
          .where(eq(planRunResultsTable.runId, run.id))
          .limit(1),
      ]);
      if (ingestion[0] && result[0]) return run.month;
    }
    throw new Error(`No persisted readable plan data is available for ${segment}.`);
  }

  beforeEach(async () => {
    setDatabaseReady(true);
    const email = `api-key-contract-${randomUUID()}@example.com`;
    const passwordHash = await bcrypt.hash("temporary-admin-password", 4);
    const [admin] = await db.insert(usersTable).values({
      email,
      passwordHash,
      role: "admin",
      isActive: true,
      mustChangePassword: false,
    }).returning({ id: usersTable.id });
    adminId = admin.id;

    server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    base = `http://127.0.0.1:${address.port}`;

    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "temporary-admin-password" }),
    });
    assert.equal(login.status, 200);
    adminCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    assert.match(adminCookie, /^prayag_session=/);
  });

  test.afterEach(async () => {
    for (const key of issuedKeys.splice(0)) {
      if (adminCookie) {
        await fetch(`${base}/api/api-keys/${key.id}`, {
          method: "DELETE",
          headers: { cookie: adminCookie },
        });
      }
      await db.delete(apiKeysTable).where(eq(apiKeysTable.id, key.id));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, adminId));
    await db.delete(usersTable).where(eq(usersTable.id, adminId));
  });

  async function request(path: string, options: RequestInit = {}): Promise<{
    status: number;
    body: Record<string, unknown>;
  }> {
    const response = await fetch(`${base}${path}`, options);
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) as Record<string, unknown> : {},
    };
  }

  async function issueKey(name: string, consumer: string, segment: Segment): Promise<IssuedKey> {
    const response = await request("/api/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({
        name,
        consumer,
        scopes: ["read"],
        segmentScopes: [segment],
      }),
    });
    assert.equal(response.status, 201);
    const id = response.body.id;
    const raw = response.body.key;
    assert.equal(typeof id, "number");
    assert.equal(typeof raw, "string");
    const issued = { id: id as number, raw: raw as string, segment };
    issuedKeys.push(issued);
    return issued;
  }

  test("admin-issued PTMT and Plumbing keys read only their segment across all envelopes", async () => {
    const [ptmtMonth, plumbingMonth] = await Promise.all([
      findReadableMonth("PTMT"),
      findReadableMonth("Plumbing"),
    ]);
    const ptmtKey = await issueKey("temporary PTMT v1 contract", "machine-analysis", "PTMT");
    const plumbingKey = await issueKey("temporary Plumbing v1 contract", "mis", "Plumbing");

    for (const [key, month] of [[ptmtKey, ptmtMonth], [plumbingKey, plumbingMonth]] as const) {
      for (const path of projectionPaths) {
        const allowed = await request(`/api/v1${path}?month=${month}&segment=${key.segment}`, {
          headers: { authorization: `Bearer ${key.raw}` },
        });
        assert.equal(allowed.status, 200, `${key.segment} ${path} should be readable`);
        assert.equal(allowed.body.segment, key.segment);
        assert.equal(typeof allowed.body.metadata, "object");
        const envelopeField = path === "/plan/items"
          ? "items"
          : path === "/calendar"
            ? "workingDays"
            : path === "/summary"
              ? "targetMax"
              : "categories";
        assert.ok(envelopeField in allowed.body, `${path} response should include ${envelopeField}`);

        const oppositeSegment: Segment = key.segment === "PTMT" ? "Plumbing" : "PTMT";
        const forbidden = await request(`/api/v1${path}?month=${month}&segment=${oppositeSegment}`, {
          headers: { authorization: `Bearer ${key.raw}` },
        });
        assert.equal(forbidden.status, 403, `${key.segment} key must not read ${oppositeSegment} ${path}`);
        assert.equal(forbidden.body.error, "FORBIDDEN");
      }

      const mutation = await request("/api/v1/summary", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key.raw}`,
        },
        body: JSON.stringify({ month, segment: key.segment }),
      });
      assert.equal(mutation.status, 401, "API keys must not authenticate mutating v1 methods");
      assert.equal(mutation.body.code, "UNAUTHENTICATED");

      const adminMutation = await request("/api/api-keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key.raw}`,
        },
        body: JSON.stringify({ name: "must-not-be-created" }),
      });
      assert.equal(adminMutation.status, 401, "API keys must not reach browser/admin mutations");
      assert.equal(adminMutation.body.code, "UNAUTHENTICATED");
    }

    for (const key of [ptmtKey, plumbingKey]) {
      const revoke = await request(`/api/api-keys/${key.id}`, {
        method: "DELETE",
        headers: { cookie: adminCookie },
      });
      assert.equal(revoke.status, 200);
      const revoked = await request(`/api/v1/summary?month=2026-08&segment=${key.segment}`, {
        headers: { authorization: `Bearer ${key.raw}` },
      });
      assert.equal(revoked.status, 401, `${key.segment} key must stop working after revoke`);
      const index = issuedKeys.findIndex((candidate) => candidate.id === key.id);
      if (index >= 0) issuedKeys.splice(index, 1);
    }
  });
});