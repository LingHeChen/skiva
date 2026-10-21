package platform

import (
	"encoding/json"
	"errors"
	"skiva/packages/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
)

const profileJSON = `jsonb_build_object('id',p.id,'name',p.name,'channelId',p.channel_id,'channel',c.name,'consistencyMode',p.consistency_mode,'offlinePolicy',p.offline_policy,'pinnedSnapshotId',p.pinned_snapshot_id,'enabled',p.enabled,'skills',COALESCE((SELECT jsonb_agg(skill_name ORDER BY skill_name) FROM profile_skills WHERE profile_id=p.id AND enabled),'[]'))`

func (s *Server) profiles(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, "SELECT "+profileJSON+" FROM agent_profiles p JOIN channels c ON c.id=p.channel_id WHERE p.org_id=$1 ORDER BY p.created_at DESC", who(r).Org)
}
func (s *Server) profile(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, "SELECT "+profileJSON+" FROM agent_profiles p JOIN channels c ON c.id=p.channel_id WHERE p.org_id=$1 AND p.id=$2", who(r).Org, chi.URLParam(r, "id"))
}
func (s *Server) saveProfile(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name             string   `json:"name"`
		ChannelID        string   `json:"channelId"`
		ConsistencyMode  string   `json:"consistencyMode"`
		OfflinePolicy    string   `json:"offlinePolicy"`
		PinnedSnapshotID *string  `json:"pinnedSnapshotId"`
		Skills           []string `json:"skills"`
		Enabled          bool     `json:"enabled"`
	}
	if existing := chi.URLParam(r, "id"); existing != "" {
		var current []byte
		if e := s.DB.QueryRow(r.Context(), "SELECT "+profileJSON+" FROM agent_profiles p JOIN channels c ON c.id=p.channel_id WHERE p.org_id=$1 AND p.id=$2", who(r).Org, existing).Scan(&current); e != nil {
			s.dbError(w, r, e)
			return
		}
		if e := json.Unmarshal(current, &in); e != nil {
			s.dbError(w, r, e)
			return
		}
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Name == "" || (in.ConsistencyMode != "dynamic" && in.ConsistencyMode != "pinned") || (in.OfflinePolicy != "allow_cached" && in.OfflinePolicy != "deny_on_disconnect") {
		fail(w, r, 400, "INVALID_PROFILE", "Name, consistency mode and offline policy are required")
		return
	}
	id := chi.URLParam(r, "id")
	create := id == ""
	if create {
		id = ID()
	}
	e := s.transaction(r, func(tx pgx.Tx) error {
		var before json.RawMessage
		if !create {
			if e := tx.QueryRow(r.Context(), "SELECT "+profileJSON+" FROM agent_profiles p JOIN channels c ON c.id=p.channel_id WHERE p.org_id=$1 AND p.id=$2 FOR UPDATE OF p", who(r).Org, id).Scan(&before); e != nil {
				return e
			}
		}
		var ok bool
		e := tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM channels WHERE id=$1 AND org_id=$2)", in.ChannelID, who(r).Org).Scan(&ok)
		if e != nil {
			return e
		}
		if !ok {
			return errors.New("Channel not in organization")
		}
		if in.PinnedSnapshotID != nil {
			e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM release_snapshots WHERE id=$1 AND org_id=$2)", *in.PinnedSnapshotID, who(r).Org).Scan(&ok)
			if e != nil || !ok {
				return errors.New("Snapshot not in organization")
			}
		}
		for _, name := range in.Skills {
			e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM skills WHERE org_id=$1 AND canonical_name=$2)", who(r).Org, name).Scan(&ok)
			if e != nil || !ok {
				return errors.New("Unknown skill: " + name)
			}
		}
		if create {
			_, e = tx.Exec(r.Context(), `INSERT INTO agent_profiles(id,org_id,name,channel_id,consistency_mode,offline_policy,pinned_snapshot_id,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, who(r).Org, in.Name, in.ChannelID, in.ConsistencyMode, in.OfflinePolicy, in.PinnedSnapshotID, in.Enabled)
		} else {
			var tag interface{ RowsAffected() int64 }
			t, err := tx.Exec(r.Context(), `UPDATE agent_profiles SET name=$3,channel_id=$4,consistency_mode=$5,offline_policy=$6,pinned_snapshot_id=$7,enabled=$8 WHERE id=$1 AND org_id=$2`, id, who(r).Org, in.Name, in.ChannelID, in.ConsistencyMode, in.OfflinePolicy, in.PinnedSnapshotID, in.Enabled)
			tag = t
			e = err
			if e == nil && tag.RowsAffected() != 1 {
				return pgx.ErrNoRows
			}
		}
		if e != nil {
			return e
		}
		_, e = tx.Exec(r.Context(), "DELETE FROM profile_skills WHERE profile_id=$1", id)
		if e != nil {
			return e
		}
		for _, name := range in.Skills {
			_, e = tx.Exec(r.Context(), "INSERT INTO profile_skills(profile_id,skill_name) VALUES($1,$2) ON CONFLICT DO NOTHING", id, name)
			if e != nil {
				return e
			}
		}
		return audit(r.Context(), tx, who(r), "profile.save", "profile", id, before, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]string{"id": id})
}

const clientJSON = `jsonb_build_object('id',m.id,'name',m.name,'profileId',m.profile_id,'profileName',p.name,'revokedAt',m.revoked_at,'lastSeenAt',m.last_seen_at,'snapshotId',m.last_snapshot_id,'expiresAt',m.expires_at,'telemetry',m.telemetry,'status',CASE WHEN m.revoked_at IS NOT NULL THEN 'revoked' WHEN m.last_seen_at>now()-interval '60 seconds' THEN 'online' WHEN m.last_seen_at>now()-interval '5 minutes' THEN 'stale' ELSE 'offline' END)`

func (s *Server) clients(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, "SELECT "+clientJSON+" FROM mount_clients m JOIN agent_profiles p ON p.id=m.profile_id WHERE m.org_id=$1 ORDER BY m.created_at DESC", who(r).Org)
}
func (s *Server) client(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, "SELECT "+clientJSON+" FROM mount_clients m JOIN agent_profiles p ON p.id=m.profile_id WHERE m.org_id=$1 AND m.id=$2", who(r).Org, chi.URLParam(r, "id"))
}
func (s *Server) createClient(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name      string `json:"name"`
		ProfileID string `json:"profileId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		fail(w, r, 400, "INVALID_INPUT", "Client name is required")
		return
	}
	id, token := ID(), Token()
	e := s.transaction(r, func(tx pgx.Tx) error {
		tag, e := tx.Exec(r.Context(), `INSERT INTO mount_clients(id,org_id,profile_id,name,credential_hash) SELECT $1,$2,p.id,$4,$5 FROM agent_profiles p WHERE p.id=$3 AND p.org_id=$2 AND p.enabled`, id, who(r).Org, in.ProfileID, in.Name, protocol.Digest([]byte(token)))
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return pgx.ErrNoRows
		}
		return audit(r.Context(), tx, who(r), "client.register", "client", id, nil, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	jsonOut(w, 201, map[string]any{"id": id, "token": token, "notice": "Copy now. This credential is shown only once."})
}
func (s *Server) clientAction(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	action := pathAction(r)
	token := Token()
	e := s.transaction(r, func(tx pgx.Tx) error {
		q := "UPDATE mount_clients SET credential_hash=$3,expires_at=now()+interval '30 days' WHERE id=$1 AND org_id=$2 AND revoked_at IS NULL"
		args := []any{id, who(r).Org, protocol.Digest([]byte(token))}
		if action == "revoke" {
			q = "UPDATE mount_clients SET revoked_at=now() WHERE id=$1 AND org_id=$2"
			args = args[:2]
		}
		tag, e := tx.Exec(r.Context(), q, args...)
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return pgx.ErrNoRows
		}
		return audit(r.Context(), tx, who(r), "client."+action, "client", id, nil, map[string]string{"action": action})
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if action == "rotate" {
		jsonOut(w, 200, map[string]string{"token": token})
	} else {
		jsonOut(w, 200, map[string]bool{"revoked": true})
	}
}
