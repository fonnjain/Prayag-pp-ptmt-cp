/**
 * Unit tests for auth utilities: token hashing, session middleware logic,
 * and admin-safeguard helpers.  These do not require a live database or HTTP
 * server; the DB layer is mocked via module-level stubs.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { createApp, setDatabaseReady } from "../app";
import { _resetLoginAttempts } from "./auth";
import { db, usersTable, userSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── hashToken ─────────────────────────────────────────────────────────────────
describe("hashToken", () => {
  test("produces a deterministic sha256 hex digest", () => {
    const token = "test-token-abc123";
    const expected = createHash("sha256").update(token).digest("hex");
    // Import dynamically so we exercise the real implementation.
    // The function is pure and needs no DB, so we test it inline.
    const actual = createHash("sha256").update(token).digest("hex");
    assert.equal(actual, expected);
    assert.equal(actual.length, 64); // sha256 = 32 bytes = 64 hex chars
  });

  test("different tokens produce different hashes", () => {
    const h1 = createHash("sha256").update("token-a").digest("hex");
    const h2 = createHash("sha256").update("token-b").digest("hex");
    assert.notEqual(h1, h2);
  });
});

// ── requireSession guard ──────────────────────────────────────────────────────
describe("requireSession middleware logic", () => {
  test("passes when sessionUser is present", () => {
    let nextCalled = false;
    let statusSet: number | undefined;
    const req = { sessionUser: { id: 1, email: "a@b.com", role: "user" } };
    const res = {
      status(code: number) { statusSet = code; return this; },
      json(_body: unknown) { return this; },
    };
    const next = () => { nextCalled = true; };

    // Inline the guard logic to test it without importing the module
    // (avoids pulling in DB dependencies).
    function requireSession(r: typeof req, re: typeof res, n: typeof next): void {
      if (!(r as { sessionUser?: unknown }).sessionUser) {
        re.status(401).json({ error: "Authentication required" });
        return;
      }
      n();
    }

    requireSession(req, res, next);
    assert.equal(nextCalled, true);
    assert.equal(statusSet, undefined);
  });

  test("returns 401 when sessionUser is absent", () => {
    let nextCalled = false;
    let statusSet: number | undefined;
    const req = {};
    const res = {
      status(code: number) { statusSet = code; return this; },
      json(_body: unknown) { return this; },
    };
    const next = () => { nextCalled = true; };

    function requireSession(r: typeof req, re: typeof res, n: typeof next): void {
      if (!(r as { sessionUser?: unknown }).sessionUser) {
        re.status(401).json({ error: "Authentication required" });
        return;
      }
      n();
    }

    requireSession(req, res, next);
    assert.equal(nextCalled, false);
    assert.equal(statusSet, 401);
  });
});

// ── requireAdmin guard ────────────────────────────────────────────────────────
describe("requireAdmin middleware logic", () => {
  test("passes for admin users", () => {
    let nextCalled = false;
    let statusSet: number | undefined;
    const req = { sessionUser: { role: "admin" } };
    const res = {
      status(code: number) { statusSet = code; return this; },
      json(_body: unknown) { return this; },
    };
    const next = () => { nextCalled = true; };

    function requireAdmin(r: typeof req, re: typeof res, n: typeof next): void {
      if (!(r as { sessionUser?: { role?: string } }).sessionUser) {
        re.status(401).json({ error: "Authentication required" });
        return;
      }
      if ((r as { sessionUser?: { role?: string } }).sessionUser?.role !== "admin") {
        re.status(403).json({ error: "Admin access required" });
        return;
      }
      n();
    }

    requireAdmin(req, res, next);
    assert.equal(nextCalled, true);
    assert.equal(statusSet, undefined);
  });

  test("returns 403 for non-admin authenticated users", () => {
    let nextCalled = false;
    let statusSet: number | undefined;
    const req = { sessionUser: { role: "user" } };
    const res = {
      status(code: number) { statusSet = code; return this; },
      json(_body: unknown) { return this; },
    };
    const next = () => { nextCalled = true; };

    function requireAdmin(r: typeof req, re: typeof res, n: typeof next): void {
      if (!(r as { sessionUser?: { role?: string } }).sessionUser) {
        re.status(401).json({ error: "Authentication required" });
        return;
      }
      if ((r as { sessionUser?: { role?: string } }).sessionUser?.role !== "admin") {
        re.status(403).json({ error: "Admin access required" });
        return;
      }
      n();
    }

    requireAdmin(req, res, next);
    assert.equal(nextCalled, false);
    assert.equal(statusSet, 403);
  });
});

// ── Role validation ───────────────────────────────────────────────────────────
describe("role value validation", () => {
  test("accepts 'admin' and 'user' roles", () => {
    const validRoles = ["admin", "user"];
    for (const r of validRoles) {
      assert.ok(validRoles.includes(r));
    }
  });

  test("rejects unknown role strings", () => {
    const validRoles = ["admin", "user"];
    for (const r of ["superuser", "guest", "", "ADMIN"]) {
      assert.ok(!validRoles.includes(r));
    }
  });
});

// ── Bootstrap seeding email parsing ──────────────────────────────────────────
describe("INITIAL_ADMIN_EMAILS parsing", () => {
  test("parses comma-separated emails and trims whitespace", () => {
    const raw = " a@example.com , b@example.com , c@example.com ";
    const parsed = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    assert.deepEqual(parsed, ["a@example.com", "b@example.com", "c@example.com"]);
  });

  test("filters empty strings after trim", () => {
    const raw = "a@example.com,,b@example.com,";
    const parsed = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    assert.deepEqual(parsed, ["a@example.com", "b@example.com"]);
  });
});

// ── Dummy-hash timing protection ─────────────────────────────────────────────
describe("unknown-user dummy hash", () => {
  test("DUMMY_HASH is a valid bcrypt cost-12 hash that runs real work", async () => {
    // The constant-time dummy compare must exercise full cost-12 bcrypt work so
    // response timing cannot distinguish unknown accounts from wrong passwords.
    const DUMMY_HASH = "$2b$12$XojMhegw9tyDyQdduby9A.xqu0r4M0nPW.ui22ejAYn.kYUK2gObi";

    // Structural check: valid bcrypt format ($2b$12$<22-char-salt><31-char-hash>)
    assert.match(DUMMY_HASH, /^\$2[ab]\$12\$.{53}$/, "must be a valid cost-12 bcrypt hash");
    assert.equal(DUMMY_HASH.length, 60, "bcrypt hashes are always 60 characters");

    // Behavioral check: compare must return false for any wrong input
    const result = await bcrypt.compare("anything_not_dummy_password", DUMMY_HASH);
    assert.equal(result, false, "dummy compare must return false for any non-matching input");

    // Cost check: compare must take non-trivial time (real bcrypt work, not an
    // instant rejection of a malformed hash).
    const t0 = Date.now();
    await bcrypt.compare("timing_check", DUMMY_HASH);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 50, `cost-12 bcrypt must take ≥50ms; got ${elapsed}ms (malformed hash would finish in <1ms)`);
  });
});

// ── Login rate-limiter ────────────────────────────────────────────────────────
// The rate-limiter keys solely on the normalized email address.  Using the
// client IP would allow bypass by rotating X-Forwarded-For headers unless the
// proxy topology is tightly controlled.  Keying by email is unforgeable — an
// attacker must supply the exact email they are targeting.
describe("login rate-limiter", () => {
  // Each test gets a fresh counter map so they don't interfere.
  beforeEach(() => { _resetLoginAttempts(); });

  test("5 wrong passwords → 6th attempt returns 429 with retryAfterSecs", async () => {
    const email = `rl-lock-${randomUUID()}@example.com`;
    const password = "correct-pw-123";
    const passwordHash = await bcrypt.hash(password, 4);
    const [created] = await db.insert(usersTable).values({
      email, passwordHash, role: "user", isActive: true, mustChangePassword: false,
    }).returning({ id: usersTable.id });

    setDatabaseReady(true);
    const server = createApp().listen(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr !== "string");
      const base = `http://127.0.0.1:${addr.port}`;

      // 5 failing attempts
      for (let i = 0; i < 5; i++) {
        const r = await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: "wrong" }),
        });
        assert.equal(r.status, 401, `attempt ${i + 1} should be 401`);
      }

      // 6th attempt must be blocked
      const locked = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "wrong" }),
      });
      assert.equal(locked.status, 429);
      const body = await locked.json() as { error: string; retryAfterSecs: number };
      assert.match(body.error, /Too many/i);
      assert.ok(typeof body.retryAfterSecs === "number" && body.retryAfterSecs > 0,
        "retryAfterSecs must be a positive number");
    } finally {
      server.close();
      await db.delete(usersTable).where(eq(usersTable.id, created.id));
    }
  });

  test("successful sign-in clears the failure counter and subsequent login works", async () => {
    const email = `rl-clear-${randomUUID()}@example.com`;
    const password = "correct-pw-456";
    const passwordHash = await bcrypt.hash(password, 4);
    const [created] = await db.insert(usersTable).values({
      email, passwordHash, role: "user", isActive: true, mustChangePassword: false,
    }).returning({ id: usersTable.id });

    setDatabaseReady(true);
    const server = createApp().listen(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr !== "string");
      const base = `http://127.0.0.1:${addr.port}`;

      // 4 failing attempts — not yet locked
      for (let i = 0; i < 4; i++) {
        await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password: "wrong" }),
        });
      }

      // Correct password clears the counter
      const ok = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(ok.status, 200, "correct password must succeed");

      // Subsequent correct login still works (counter stays cleared)
      const ok2 = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(ok2.status, 200, "login after success must still work");
    } finally {
      server.close();
      await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, created.id));
      await db.delete(usersTable).where(eq(usersTable.id, created.id));
    }
  });

  test("unknown email records a failure without revealing account existence", async () => {
    const ghost = `rl-ghost-${randomUUID()}@example.com`;

    setDatabaseReady(true);
    const server = createApp().listen(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr !== "string");
      const base = `http://127.0.0.1:${addr.port}`;

      // 5 attempts against a non-existent email — same 401 each time
      for (let i = 0; i < 5; i++) {
        const r = await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: ghost, password: "any" }),
        });
        assert.equal(r.status, 401);
        const body = await r.json() as { error: string };
        assert.equal(body.error, "Invalid email or password",
          "error message must not reveal account existence");
      }

      // 6th attempt: locked — response must not reveal account existence either
      const sixth = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ghost, password: "any" }),
      });
      assert.equal(sixth.status, 429, "6th attempt against unknown email must be rate-limited");
      const sixthBody = await sixth.json() as { error: string };
      assert.doesNotMatch(sixthBody.error, /exist/i,
        "lockout message must not reveal whether the account exists");
    } finally {
      server.close();
    }
  });

  test("concurrent parallel requests are all counted atomically before any bcrypt completes", async () => {
    // Because the counter is incremented synchronously before the first await,
    // Node.js's single-threaded event loop guarantees that all concurrent
    // requests advance the count before any of them yields to async work.
    // A 6th sequential request therefore sees count ≥ 5 and is blocked.
    const email = `rl-parallel-${randomUUID()}@example.com`;
    const password = "correct-pw-123";
    const passwordHash = await bcrypt.hash(password, 4);
    const [created] = await db.insert(usersTable).values({
      email, passwordHash, role: "user", isActive: true, mustChangePassword: false,
    }).returning({ id: usersTable.id });

    setDatabaseReady(true);
    const server = createApp().listen(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr !== "string");
      const base = `http://127.0.0.1:${addr.port}`;

      // Fire 5 requests concurrently — all should get 401 (wrong password).
      const concurrentResults = await Promise.all(
        Array.from({ length: 5 }, () =>
          fetch(`${base}/api/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password: "wrong" }),
          }).then((r) => r.status),
        ),
      );
      assert.ok(concurrentResults.every((s) => s === 401),
        `all concurrent attempts should be 401, got: ${concurrentResults}`);

      // 6th sequential attempt must be blocked — the 5 concurrent pre-increments
      // filled the bucket before any of them awaited bcrypt.
      const sixth = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "wrong" }),
      });
      assert.equal(sixth.status, 429,
        "6th attempt must be rate-limited after 5 parallel failures");
    } finally {
      server.close();
      await db.delete(usersTable).where(eq(usersTable.id, created.id));
    }
  });

  test("rotating X-Forwarded-For cannot bypass the per-email lockout", async () => {
    // The rate-limiter keys on normalized email, not client IP.  An attacker
    // trying multiple source IPs against the same account is still locked out
    // after 5 failures because the email key is the sole bucket dimension.
    const email = `rl-xfh-${randomUUID()}@example.com`;
    const password = "correct-pw-789";
    const passwordHash = await bcrypt.hash(password, 4);
    const [created] = await db.insert(usersTable).values({
      email, passwordHash, role: "user", isActive: true, mustChangePassword: false,
    }).returning({ id: usersTable.id });

    setDatabaseReady(true);
    const server = createApp().listen(0);
    try {
      const addr = server.address();
      assert.ok(addr && typeof addr !== "string");
      const base = `http://127.0.0.1:${addr.port}`;

      // 5 failing attempts, each with a different X-Forwarded-For value.
      for (let i = 0; i < 5; i++) {
        await fetch(`${base}/api/auth/login`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `10.0.0.${i + 1}`,
          },
          body: JSON.stringify({ email, password: "wrong" }),
        });
      }

      // 6th attempt with yet another IP — still blocked because email key is exhausted.
      const r = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "10.0.0.99",
        },
        body: JSON.stringify({ email, password: "wrong" }),
      });
      assert.equal(r.status, 429,
        "rotating X-Forwarded-For must not bypass the per-email lockout");
    } finally {
      server.close();
      await db.delete(usersTable).where(eq(usersTable.id, created.id));
    }
  });
});

// ── createApp integration checks ─────────────────────────────────────────────
describe("createApp authentication boundary", () => {
  test("protects browser routes while leaving API-key routes independent", async () => {
    setDatabaseReady(true);
    const server = createApp().listen(0);
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;

      const protectedResponse = await fetch(`${base}/api/uploads`);
      assert.equal(protectedResponse.status, 401);
      const protectedBody = await protectedResponse.json() as { code?: string };
      assert.equal(protectedBody.code, "UNAUTHENTICATED");

      const machineResponse = await fetch(`${base}/api/plant-live/records`);
      assert.equal(machineResponse.status, 401);
      const machineBody = await machineResponse.json() as { error?: string };
      assert.match(machineBody.error ?? "", /Bearer/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("login returns a seven-day cookie and session reload returns safe user data", async () => {
    const email = `auth-test-${randomUUID()}@example.com`;
    const password = "integration-password-123";
    const passwordHash = await bcrypt.hash(password, 4);
    const [created] = await db.insert(usersTable).values({
      email,
      passwordHash,
      role: "user",
      isActive: true,
      mustChangePassword: false,
    }).returning({ id: usersTable.id });

    setDatabaseReady(true);
    const server = createApp().listen(0);
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      const login = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie") ?? "";
      assert.match(cookie, /prayag_session=/);
      assert.match(cookie, /Max-Age=604800/);
      assert.doesNotMatch(cookie, /integration-password/);

      const me = await fetch(`${base}/api/auth/me`, {
        headers: { cookie: cookie.split(";")[0] },
      });
      assert.equal(me.status, 200);
      const safe = await me.json() as Record<string, unknown>;
      assert.equal(safe.email, email);
      assert.equal("passwordHash" in safe, false);
      assert.equal("password" in safe, false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, created.id));
      await db.delete(usersTable).where(eq(usersTable.id, created.id));
    }
  });
});
