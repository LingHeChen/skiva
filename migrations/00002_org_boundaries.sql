-- +goose Up
-- Composite foreign keys prevent accidental cross-organization references even for new code paths.
ALTER TABLE users ADD CONSTRAINT users_org_id_unique UNIQUE(org_id,id);
ALTER TABLE repository_credentials ADD CONSTRAINT credentials_org_id_unique UNIQUE(org_id,id);
ALTER TABLE repositories ADD CONSTRAINT repos_org_id_unique UNIQUE(org_id,id);
ALTER TABLE channels ADD CONSTRAINT channels_org_id_unique UNIQUE(org_id,id);
ALTER TABLE release_snapshots ADD CONSTRAINT snapshots_org_id_unique UNIQUE(org_id,id);
ALTER TABLE agent_profiles ADD CONSTRAINT profiles_org_id_unique UNIQUE(org_id,id);
ALTER TABLE role_bindings ADD CONSTRAINT role_user_org FOREIGN KEY(org_id,user_id) REFERENCES users(org_id,id);
ALTER TABLE repositories ADD CONSTRAINT repo_credential_org FOREIGN KEY(org_id,credential_id) REFERENCES repository_credentials(org_id,id);
ALTER TABLE skills ADD CONSTRAINT skill_repo_org FOREIGN KEY(org_id,repository_id) REFERENCES repositories(org_id,id);
ALTER TABLE release_snapshots ADD CONSTRAINT snapshot_creator_org FOREIGN KEY(org_id,created_by) REFERENCES users(org_id,id);
ALTER TABLE channels ADD CONSTRAINT channel_snapshot_org FOREIGN KEY(org_id,active_snapshot_id) REFERENCES release_snapshots(org_id,id);
ALTER TABLE agent_profiles ADD CONSTRAINT profile_channel_org FOREIGN KEY(org_id,channel_id) REFERENCES channels(org_id,id);
ALTER TABLE agent_profiles ADD CONSTRAINT profile_snapshot_org FOREIGN KEY(org_id,pinned_snapshot_id) REFERENCES release_snapshots(org_id,id);
ALTER TABLE mount_clients ADD CONSTRAINT client_profile_org FOREIGN KEY(org_id,profile_id) REFERENCES agent_profiles(org_id,id);
ALTER TABLE mount_clients ADD CONSTRAINT client_snapshot_org FOREIGN KEY(org_id,last_snapshot_id) REFERENCES release_snapshots(org_id,id);
-- +goose StatementBegin
CREATE FUNCTION check_release_item_org() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM release_snapshots sn JOIN skill_versions v ON v.id=NEW.skill_version_id JOIN skills s ON s.id=v.skill_id AND s.org_id=sn.org_id WHERE sn.id=NEW.snapshot_id) THEN
  RAISE EXCEPTION 'cross organization release item';
 END IF;
 RETURN NEW;
END; $$;
-- +goose StatementEnd
CREATE TRIGGER release_item_org BEFORE INSERT ON release_items FOR EACH ROW EXECUTE FUNCTION check_release_item_org();
-- +goose Down
DROP TRIGGER release_item_org ON release_items;
DROP FUNCTION check_release_item_org();
ALTER TABLE mount_clients DROP CONSTRAINT client_snapshot_org,DROP CONSTRAINT client_profile_org;
ALTER TABLE agent_profiles DROP CONSTRAINT profile_snapshot_org,DROP CONSTRAINT profile_channel_org;
ALTER TABLE channels DROP CONSTRAINT channel_snapshot_org;
ALTER TABLE release_snapshots DROP CONSTRAINT snapshot_creator_org;
ALTER TABLE skills DROP CONSTRAINT skill_repo_org;
ALTER TABLE repositories DROP CONSTRAINT repo_credential_org;
ALTER TABLE role_bindings DROP CONSTRAINT role_user_org;
ALTER TABLE agent_profiles DROP CONSTRAINT profiles_org_id_unique;
ALTER TABLE release_snapshots DROP CONSTRAINT snapshots_org_id_unique;
ALTER TABLE channels DROP CONSTRAINT channels_org_id_unique;
ALTER TABLE repositories DROP CONSTRAINT repos_org_id_unique;
ALTER TABLE repository_credentials DROP CONSTRAINT credentials_org_id_unique;
ALTER TABLE users DROP CONSTRAINT users_org_id_unique;
