-- +goose Up
ALTER TABLE snapshot_grants ADD COLUMN expires_at timestamptz;
CREATE INDEX snapshot_grants_expiry ON snapshot_grants(expires_at) WHERE expires_at IS NOT NULL;

-- +goose Down
DROP INDEX snapshot_grants_expiry;
ALTER TABLE snapshot_grants DROP COLUMN expires_at;
