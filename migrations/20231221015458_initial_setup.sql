CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host TEXT NOT NULL UNIQUE,
  bucket_name TEXT NOT NULL,
  entry_file TEXT NOT NULL,
  handler TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
