CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS deployments (
  id UUID NOT NULL DEFAULT uuid_generate_v4(),
  host TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  entry_file TEXT NOT NULL,
  handler TEXT NOT NULL,
  is_current BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(id)
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

CREATE OR REPLACE FUNCTION create_deployment(id UUID,
                                             host TEXT,
                                             bucket_name TEXT,
                                             entry_file TEXT,
                                             handler TEXT,
                                             is_current BOOLEAN)
  RETURNS SETOF deployments AS $$
  BEGIN
    RETURN QUERY INSERT INTO deployments (id, host, bucket_name, entry_file, handler, is_current)
      VALUES (id, host, bucket_name, entry_file, handler, is_current) RETURNING *;
  END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION on_create_deployment()
  RETURNS trigger AS $$
  DECLARE
    payload TEXT;
  BEGIN
    payload := json_build_object('action', 'create_deployment', 'payload', row_to_json(NEW));
    PERFORM pg_notify('asteroid_notifications', payload);
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_create_deployment
  AFTER INSERT ON deployments
  FOR EACH ROW
  EXECUTE PROCEDURE on_create_deployment();

CREATE OR REPLACE FUNCTION on_delete_active_deployment()
  RETURNS trigger AS $$
  DECLARE
    payload TEXT;
  BEGIN
    payload := json_build_object('action', 'delete_active_deployment', 'payload', row_to_json(OLD));
    PERFORM pg_notify('asteroid_notifications', payload);
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_delete_active_deployment
  AFTER DELETE ON active_deployments
  -- TODO(cjihrig): Investigate making this FOR EACH STATEMENT and handling
  -- batch deletes to reduce the number of notifications.
  FOR EACH ROW
  EXECUTE PROCEDURE on_delete_active_deployment();
