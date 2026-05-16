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
      website TEXT,
      inspection_status TEXT NOT NULL DEFAULT 'queued',
      signal_strength TEXT NOT NULL DEFAULT 'queued',
      signal_summary TEXT,
      fit_score INTEGER,
      fit_reason TEXT,
      next_step TEXT,
      discovery_source TEXT,
      discovery_query TEXT,
      discovery_score INTEGER,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(run_id, place_id)
    );

    CREATE TABLE IF NOT EXISTS business_inspections (
      cache_key TEXT PRIMARY KEY,
      place_id TEXT,
      domain TEXT,
      website TEXT,
      status TEXT NOT NULL,
      signal_strength TEXT NOT NULL,
      signal_summary TEXT,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
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
      ADD COLUMN IF NOT EXISTS discovery_source TEXT,
      ADD COLUMN IF NOT EXISTS discovery_query TEXT,
      ADD COLUMN IF NOT EXISTS discovery_score INTEGER;
  `);

  await pool.query(`DELETE FROM scout_runs WHERE created_at < now() - interval '30 days'`);
}

export async function query(text, params) {
  await migrate();
  return pool.query(text, params);
}
