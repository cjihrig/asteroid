CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS deployments (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  host TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  entry_file TEXT NOT NULL,
  handler TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  UNIQUE(host)
);

CREATE TABLE IF NOT EXISTS active_deployments (
  id UUID NOT NULL,
  host TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  entry_file TEXT NOT NULL,
  handler TEXT NOT NULL,
  k8s_resource TEXT DEFAULT NULL,
  is_inited BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(id),
  FOREIGN KEY(id) REFERENCES deployments(id),
  UNIQUE(host)
);
