-- +goose Up
ALTER TABLE repositories ALTER COLUMN remote_url DROP NOT NULL;
ALTER TABLE repositories ADD COLUMN source_type text NOT NULL DEFAULT 'external' CHECK(source_type IN ('external','managed'));
ALTER TABLE repositories ADD COLUMN namespace_slug text;
ALTER TABLE repositories ADD COLUMN slug text;
ALTER TABLE repositories ADD COLUMN storage_id uuid UNIQUE;
ALTER TABLE repositories ADD COLUMN provision_state text CHECK(provision_state IN ('provisioning','active','failed'));
ALTER TABLE repositories ADD COLUMN provision_error text;
ALTER TABLE repositories ADD COLUMN template text NOT NULL DEFAULT 'empty' CHECK(template IN ('empty','single','monorepo'));
ALTER TABLE repositories ADD COLUMN hosting_policy jsonb NOT NULL DEFAULT '{}';
ALTER TABLE repositories ADD COLUMN last_push_at timestamptz;
ALTER TABLE repositories ADD CONSTRAINT repository_source_fields CHECK (
 (source_type='external' AND remote_url IS NOT NULL AND storage_id IS NULL) OR
 (source_type='managed' AND remote_url IS NULL AND storage_id IS NOT NULL AND namespace_slug IS NOT NULL AND slug IS NOT NULL AND provision_state IS NOT NULL AND credential_id IS NULL AND webhook_secret_ref IS NULL));
-- Namespace ownership prevents an ambiguous /git/{namespace}/{slug}.git route across organizations.
CREATE TABLE git_namespaces (slug text PRIMARY KEY, org_id uuid NOT NULL REFERENCES organizations(id), UNIQUE(org_id,slug));
ALTER TABLE repositories ADD CONSTRAINT repository_namespace_org FOREIGN KEY(org_id,namespace_slug) REFERENCES git_namespaces(org_id,slug);
CREATE UNIQUE INDEX managed_repository_name ON repositories(org_id,namespace_slug,slug) WHERE source_type='managed';
CREATE TABLE repository_members (
 org_id uuid NOT NULL, repository_id uuid NOT NULL, user_id uuid NOT NULL,
 access_role text NOT NULL CHECK(access_role IN ('viewer','contributor','maintainer')),
 PRIMARY KEY(repository_id,user_id), FOREIGN KEY(org_id,repository_id) REFERENCES repositories(org_id,id), FOREIGN KEY(org_id,user_id) REFERENCES users(org_id,id));
CREATE TABLE git_access_tokens (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, owner_user_id uuid NOT NULL, repository_id uuid NOT NULL,
 name text NOT NULL, token_hash text NOT NULL UNIQUE, token_prefix text NOT NULL,
 scopes text[] NOT NULL CHECK(scopes <@ ARRAY['repo:read','repo:write']::text[] AND cardinality(scopes)>0),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz,
 FOREIGN KEY(org_id,repository_id) REFERENCES repositories(org_id,id), FOREIGN KEY(org_id,owner_user_id) REFERENCES users(org_id,id));
CREATE TABLE repository_ref_events (
 id uuid PRIMARY KEY, repository_id uuid NOT NULL REFERENCES repositories(id), refname text NOT NULL,
 old_oid text NOT NULL, new_oid text NOT NULL, source text NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz, attempt_count integer NOT NULL DEFAULT 0, error_text text, job_id uuid REFERENCES job_queue(id),
 UNIQUE(repository_id,refname,old_oid,new_oid));
CREATE INDEX ref_events_pending ON repository_ref_events(processed_at,observed_at);
CREATE TABLE repository_observed_refs (repository_id uuid NOT NULL REFERENCES repositories(id), refname text NOT NULL, oid text NOT NULL, PRIMARY KEY(repository_id,refname));
-- +goose Down
-- Intentionally refuse destructive rollback of hosted source data. Roll back code with flags off.
-- +goose StatementBegin
DO $$ BEGIN RAISE EXCEPTION 'Managed Git migration is forward-only; disable feature flags to roll back'; END $$;
-- +goose StatementEnd
