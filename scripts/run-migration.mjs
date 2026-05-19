/**
 * One-shot migration runner for Supabase-hosted projects.
 *
 * Requires the direct Postgres connection URL (not the service role JWT).
 * Get it from:
 *   Supabase Dashboard → Settings → Database → Connection String
 *   → URI mode (NOT pooler / Transaction mode — DDL needs a real session)
 *
 *   Format: postgres://postgres:[PASSWORD]@db.mddxlwixadpshfynctgd.supabase.co:5432/postgres
 *
 * Quick usage (add DATABASE_URL temporarily as inline env var):
 *   DATABASE_URL="postgres://postgres:[PASSWORD]@db.mddxlwixadpshfynctgd.supabase.co:5432/postgres" \
 *   node scripts/run-migration.mjs supabase/migrations/v28_document_events.sql
 *
 * Or add DATABASE_URL to .env.local then:
 *   node -r dotenv/config scripts/run-migration.mjs supabase/migrations/v28_document_events.sql
 *
 * To apply ALL pending migrations (v28 is the only pending one):
 *   DATABASE_URL="..." node scripts/run-migration.mjs supabase/migrations/v28_document_events.sql
 */

import { readFileSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ── Parse args ────────────────────────────────────────────────────────────

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error("Usage: DATABASE_URL=... node scripts/run-migration.mjs <migration.sql>");
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error(`
  ERROR: DATABASE_URL not set.

  1. Go to: Supabase Dashboard → Settings → Database → Connection String
  2. Copy the "URI" value (direct connection, port 5432 — NOT the pooler)
  3. Run:

     DATABASE_URL="postgres://postgres:[PASSWORD]@db.mddxlwixadpshfynctgd.supabase.co:5432/postgres" \\
     node scripts/run-migration.mjs supabase/migrations/v28_document_events.sql
`);
  process.exit(1);
}

// ── Ensure pg is available ─────────────────────────────────────────────────

let Client;
try {
  ({ Client } = require("pg"));
} catch {
  const { execSync } = await import("child_process");
  console.log("Installing pg temporarily...");
  execSync("npm install --no-save pg", { stdio: "inherit" });
  ({ Client } = require("pg"));
}

// ── Run migration ─────────────────────────────────────────────────────────

const sql = readFileSync(migrationFile, "utf8");
console.log(`\n─── Applying: ${migrationFile} ───\n`);

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log("Connected.\n");

  // Run the full migration as a single transaction so it rolls back on error
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  console.log("✓ Migration applied.\n");

  // ── Post-migration verification ──────────────────────────────────────────
  console.log("─── Verifying v28 ───\n");

  const checks = [
    // Table exists
    { label: "table document_events",
      q: `SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'document_events'
          ) AS ok` },
    // RLS enabled
    { label: "RLS enabled",
      q: `SELECT relrowsecurity AS ok
            FROM pg_class WHERE oid = 'public.document_events'::regclass` },
    // Tenant-scoped SELECT policy
    { label: "SELECT policy exists",
      q: `SELECT EXISTS (
            SELECT 1 FROM pg_policies
             WHERE tablename = 'document_events'
               AND policyname = 'document_events_select'
          ) AS ok` },
    // doc_type CHECK constraint
    { label: "CHECK doc_type",
      q: `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.document_events'::regclass
               AND conname = 'chk_document_events_doc_type'
          ) AS ok` },
    // event_type CHECK constraint
    { label: "CHECK event_type",
      q: `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.document_events'::regclass
               AND conname = 'chk_document_events_event_type'
          ) AS ok` },
    // status CHECK constraint
    { label: "CHECK status",
      q: `SELECT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.document_events'::regclass
               AND conname = 'chk_document_events_status'
          ) AS ok` },
    // Compound index for invoice queries
    { label: "index tenant+invoice+created_at",
      q: `SELECT EXISTS (
            SELECT 1 FROM pg_indexes
             WHERE tablename = 'document_events'
               AND indexname  = 'idx_document_events_tenant_invoice'
          ) AS ok` },
    // Compound index for sale queries
    { label: "index tenant+sale+created_at",
      q: `SELECT EXISTS (
            SELECT 1 FROM pg_indexes
             WHERE tablename = 'document_events'
               AND indexname  = 'idx_document_events_tenant_sale'
          ) AS ok` },
  ];

  let allOk = true;
  for (const { label, q } of checks) {
    const { rows } = await client.query(q);
    const ok = rows[0]?.ok === true || rows[0]?.ok === "t";
    const mark = ok ? "✓" : "✗";
    if (!ok) allOk = false;
    console.log(`  ${mark}  ${label}`);
  }

  // Service-role INSERT test (bypasses RLS)
  await client.query(`
    INSERT INTO public.document_events
      (tenant_id, doc_type, event_type, status)
    SELECT id, 'pdf', 'generate', 'ok'
      FROM public.tenants LIMIT 1
    RETURNING id
  `);
  console.log("  ✓  service_role INSERT (bypasses RLS) — ok");

  // Clean up test row
  await client.query(`
    DELETE FROM public.document_events
     WHERE doc_type = 'pdf' AND event_type = 'generate'
       AND status = 'ok'
       AND created_at > now() - interval '1 minute'
  `);

  console.log(`\n${allOk ? "✓  All checks passed." : "⚠  Some checks FAILED — see above."}\n`);

} catch (err) {
  console.error("✗ Error:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
