import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/hirenear';

export const pool = new Pool({
  connectionString: DATABASE_URL,
});

let migrationPromise = null;

export async function migrate() {
  if (!migrationPromise) {
    migrationPromise = runMigrations();
  }
  return migrationPromise;
}

async function runMigrations() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS scout_runs (
      id TEXT PRIMARY KEY,
      resume_text TEXT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      radius INTEGER NOT NULL,
      location_label TEXT,
      target_lanes JSONB NOT NULL DEFAULT '[]'::jsonb,
      avoid_terms TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      summary TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS scout_businesses (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES scout_runs(id) ON DELETE CASCADE,
      place_id TEXT NOT NULL,
      name TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      vicinity TEXT,
      rating DOUBLE PRECISION,
      user_ratings_total INTEGER,
      primary_type_display_name TEXT,
      business_status TEXT,
      google_maps_uri TEXT,
      weekday_descriptions JSONB,
      website TEXT,
      inspection_status TEXT NOT NULL DEFAULT 'queued',
      signal_strength TEXT NOT NULL DEFAULT 'queued',
      signal_summary TEXT,
      company_profile JSONB,
      fit_score INTEGER,
      match_summary TEXT,
      match_signals JSONB,
      fit_reason TEXT,
      next_step TEXT,
      discovery_source TEXT,
      discovery_query TEXT,
      discovery_score INTEGER,
      contact_email TEXT,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(run_id, place_id)
    );

    CREATE TABLE IF NOT EXISTS business_inspections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key TEXT NOT NULL,
      place_id TEXT,
      run_id TEXT REFERENCES scout_runs(id) ON DELETE SET NULL,
      domain TEXT,
      website TEXT,
      status TEXT NOT NULL,
      signal_strength TEXT NOT NULL,
      signal_summary TEXT,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
      company_profile JSONB,
      contact_email TEXT,
      error TEXT,
      inspected_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS scout_opportunities (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES scout_runs(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL REFERENCES scout_businesses(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      description TEXT,
      signal_strength TEXT NOT NULL DEFAULT 'weak',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS scout_matches (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES scout_runs(id) ON DELETE CASCADE,
      business_id TEXT REFERENCES scout_businesses(id) ON DELETE CASCADE,
      opportunity_id TEXT REFERENCES scout_opportunities(id) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      match_level TEXT NOT NULL,
      fit_score INTEGER NOT NULL,
      reason TEXT NOT NULL,
      next_step TEXT NOT NULL,
      raw JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS scout_interest (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES scout_runs(id) ON DELETE CASCADE,
      business_place_id TEXT NOT NULL,
      business_name TEXT NOT NULL,
      business_contact_email TEXT,
      seeker_email TEXT NOT NULL,
      fit_score INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      notified_at TIMESTAMPTZ,
      match_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
      opened_at TIMESTAMPTZ,
      contacted_at TIMESTAMPTZ,
      seeker_confirmed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS business_signups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      business_name TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      email TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      hiring_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
      current_hiring_channel TEXT,
      hires_per_year TEXT,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      contacted_at TIMESTAMPTZ,
      converted_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_scout_interest_match_token
      ON scout_interest(match_token);

    CREATE INDEX IF NOT EXISTS idx_business_signups_created_at
      ON business_signups(created_at DESC);
  `);

  await pool.query(`
    ALTER TABLE scout_runs
      ADD COLUMN IF NOT EXISTS target_lanes JSONB NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS avoid_terms TEXT;
  `);

  await pool.query(`
    ALTER TABLE scout_runs
      ADD COLUMN IF NOT EXISTS extracted_signals JSONB;
  `);

  await pool.query(`
    ALTER TABLE scout_businesses
      ADD COLUMN IF NOT EXISTS contact_email TEXT,
      ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS match_summary TEXT,
      ADD COLUMN IF NOT EXISTS match_signals JSONB,
      ADD COLUMN IF NOT EXISTS discovery_source TEXT,
      ADD COLUMN IF NOT EXISTS discovery_query TEXT,
      ADD COLUMN IF NOT EXISTS discovery_score INTEGER,
      ADD COLUMN IF NOT EXISTS primary_type_display_name TEXT,
      ADD COLUMN IF NOT EXISTS business_status TEXT,
      ADD COLUMN IF NOT EXISTS google_maps_uri TEXT,
      ADD COLUMN IF NOT EXISTS weekday_descriptions JSONB,
      ADD COLUMN IF NOT EXISTS company_profile JSONB;
  `);

  await pool.query(`
    ALTER TABLE business_inspections
      ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid(),
      ADD COLUMN IF NOT EXISTS run_id TEXT REFERENCES scout_runs(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS company_profile JSONB,
      ADD COLUMN IF NOT EXISTS contact_email TEXT;
  `);

  await pool.query(`
    UPDATE business_inspections
    SET id = gen_random_uuid()
    WHERE id IS NULL;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN unnest(c.conkey) AS key(attnum) ON true
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
        WHERE n.nspname = 'public'
          AND t.relname = 'business_inspections'
          AND c.contype = 'p'
          AND a.attname = 'cache_key'
      ) THEN
        ALTER TABLE business_inspections DROP CONSTRAINT IF EXISTS business_inspections_pkey;
      END IF;
    END
    $$;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'business_inspections'
          AND c.contype = 'p'
      ) THEN
        ALTER TABLE business_inspections ADD PRIMARY KEY (id);
      END IF;
    END
    $$;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_business_inspections_cache_key_inspected_at
      ON business_inspections(cache_key, inspected_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_business_inspections_domain_inspected_at
      ON business_inspections(domain, inspected_at DESC);
  `);

  await pool.query(`
    ALTER TABLE scout_interest
      ADD COLUMN IF NOT EXISTS business_contact_email TEXT,
      ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS match_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
      ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS seeker_confirmed_at TIMESTAMPTZ;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_scout_interest_match_token
      ON scout_interest(match_token);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_business_signups_created_at
      ON business_signups(created_at DESC);
  `);

  await pool.query(`DELETE FROM scout_runs WHERE created_at < now() - interval '30 days'`);

  await pool.query(`
    DELETE FROM business_inspections old
    WHERE old.inspected_at < now() - interval '180 days'
      AND NOT EXISTS (
        SELECT 1
        FROM business_inspections recent
        WHERE recent.cache_key = old.cache_key
          AND recent.inspected_at > now() - interval '180 days'
      )
  `);
}

export async function query(text, params) {
  await migrate();
  return pool.query(text, params);
}
