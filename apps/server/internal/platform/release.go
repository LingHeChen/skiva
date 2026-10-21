package platform

import (
	"encoding/json"
	"errors"
	"skiva/packages/protocol"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"net/http"
	"sort"
	"strings"
)

type releaseInput struct {
	VersionIDs          []string `json:"versionIds"`
	AcknowledgeWarnings bool     `json:"acknowledgeWarnings"`
}
type releaseItem struct {
	Name      string          `json:"name"`
	VersionID string          `json:"versionId"`
	Files     []protocol.File `json:"files"`
}

func (s *Server) compose(r *http.Request, in releaseInput) ([]releaseItem, []protocol.File, error) {
	if len(in.VersionIDs) == 0 || len(in.VersionIDs) > 1000 {
		return nil, nil, errors.New("Select 1–1000 skill versions")
	}
	items := []releaseItem{}
	files := []protocol.File{}
	names := map[string]bool{}
	for _, v := range in.VersionIDs {
		var meta []byte
		e := s.DB.QueryRow(r.Context(), `SELECT v.metadata FROM skill_versions v JOIN skills sk ON sk.id=v.skill_id JOIN pipeline_runs p ON p.id=v.pipeline_id WHERE v.id=$1 AND sk.org_id=$2 AND p.status='succeeded'`, v, who(r).Org).Scan(&meta)
		if e != nil {
			return nil, nil, errors.New("Version unavailable or not validated")
		}
		var data struct {
			Name        string          `json:"name"`
			Files       []protocol.File `json:"files"`
			Diagnostics []Diagnostic    `json:"diagnostics"`
		}
		if e = json.Unmarshal(meta, &data); e != nil {
			return nil, nil, e
		}
		if names[data.Name] {
			return nil, nil, errors.New("Duplicate skill name: " + data.Name)
		}
		names[data.Name] = true
		if len(data.Diagnostics) > 0 && !in.AcknowledgeWarnings {
			return nil, nil, errors.New("Review and acknowledge executable-content warnings")
		}
		items = append(items, releaseItem{data.Name, v, data.Files})
		for _, f := range data.Files {
			b, e := s.get(f.Digest)
			if e != nil || int64(len(b)) != f.Size {
				return nil, nil, errors.New("Artifact missing or corrupt: " + f.Path)
			}
			f.Path = data.Name + "/" + f.Path
			files = append(files, f)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return items, files, nil
}
func (s *Server) createRelease(w http.ResponseWriter, r *http.Request) {
	var in releaseInput
	if !decode(w, r, &in) {
		return
	}
	items, files, e := s.compose(r, in)
	if e != nil {
		fail(w, r, 422, "RELEASE_VALIDATION", e.Error())
		return
	}
	canonical, e := protocol.Canonical(files)
	if e != nil {
		fail(w, r, 422, "INVALID_MANIFEST", e.Error())
		return
	}
	digest := protocol.Digest(canonical)
	if strings.HasSuffix(r.URL.Path, "preview") {
		var impacts []byte
		e = s.DB.QueryRow(r.Context(), `SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name,'channelId',channel_id)),'[]') FROM agent_profiles WHERE org_id=$1 AND enabled`, who(r).Org).Scan(&impacts)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		jsonOut(w, 200, map[string]any{"items": items, "files": files, "manifestDigest": digest, "affectedProfiles": json.RawMessage(impacts)})
		return
	}
	id := ID()
	e = s.transaction(r, func(tx pgx.Tx) error {
		e := tx.QueryRow(r.Context(), `SELECT id FROM release_snapshots WHERE org_id=$1 AND manifest_digest=$2`, who(r).Org, digest).Scan(&id)
		if e == nil {
			return nil
		}
		if e != pgx.ErrNoRows {
			return e
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO release_snapshots(id,org_id,manifest_digest,created_by) VALUES($1,$2,$3,$4)", id, who(r).Org, digest, who(r).ID)
		if e != nil {
			return e
		}
		for _, item := range items {
			_, e = tx.Exec(r.Context(), "INSERT INTO release_items(snapshot_id,skill_name,skill_version_id) VALUES($1,$2,$3)", id, item.Name, item.VersionID)
			if e != nil {
				return e
			}
		}
		return audit(r.Context(), tx, who(r), "release.create", "release", id, nil, map[string]any{"manifestDigest": digest, "items": items})
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 201, map[string]any{"id": id, "manifestDigest": digest, "items": items})
}
func (s *Server) releases(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',s.id,'manifestDigest',s.manifest_digest,'createdAt',s.created_at,'createdBy',u.display_name,'skillCount',(SELECT count(*) FROM release_items WHERE snapshot_id=s.id),'status',CASE WHEN EXISTS(SELECT 1 FROM channels WHERE active_snapshot_id=s.id) THEN 'published' WHEN EXISTS(SELECT 1 FROM channel_history WHERE after_snapshot_id=s.id) THEN 'superseded' ELSE 'draft' END) FROM release_snapshots s JOIN users u ON u.id=s.created_by WHERE s.org_id=$1 ORDER BY s.created_at DESC`, who(r).Org)
}
func (s *Server) release(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, `SELECT jsonb_build_object('id',s.id,'manifestDigest',s.manifest_digest,'createdAt',s.created_at,'items',(SELECT jsonb_agg(jsonb_build_object('name',skill_name,'versionId',skill_version_id)) FROM release_items WHERE snapshot_id=s.id)) FROM release_snapshots s WHERE org_id=$1 AND id=$2`, who(r).Org, chi.URLParam(r, "id"))
}
func (s *Server) channels(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',c.id,'name',c.name,'snapshotId',c.active_snapshot_id,'generation',c.generation,'updatedAt',c.updated_at,'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'beforeSnapshotId',h.before_snapshot_id,'snapshotId',h.after_snapshot_id,'generation',h.generation,'actorId',h.actor_id,'reason',h.reason,'createdAt',h.created_at) ORDER BY h.created_at DESC) FROM channel_history h WHERE h.channel_id=c.id),'[]')) FROM channels c WHERE c.org_id=$1 ORDER BY name`, who(r).Org)
}

var errConflict = errors.New("channel generation changed")

func (s *Server) promote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SnapshotID         string `json:"snapshotId"`
		ExpectedGeneration int64  `json:"expectedGeneration"`
		Reason             string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Reason) == "" {
		fail(w, r, 400, "REASON_REQUIRED", "A reason is required")
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 200 {
		fail(w, r, 400, "IDEMPOTENCY_REQUIRED", "Supply Idempotency-Key")
		return
	}
	a := who(r)
	hash := protocol.Digest(append(mustJSON(in), []byte(r.URL.Path)...))
	result := map[string]any{}
	e := s.transaction(r, func(tx pgx.Tx) error {
		_, e := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", a.Org+a.ID+key)
		if e != nil {
			return e
		}
		var previousHash string
		var response []byte
		e = tx.QueryRow(r.Context(), "SELECT request_hash,response FROM idempotency_keys WHERE org_id=$1 AND actor_id=$2 AND key=$3", a.Org, a.ID, key).Scan(&previousHash, &response)
		if e == nil {
			if previousHash != hash {
				return errors.New("Idempotency key reused with different request")
			}
			return json.Unmarshal(response, &result)
		}
		if e != pgx.ErrNoRows {
			return e
		}
		var channel, name string
		var old *string
		var generation int64
		e = tx.QueryRow(r.Context(), "SELECT id,name,active_snapshot_id,generation FROM channels WHERE org_id=$1 AND (id::text=$2 OR name=$2) FOR UPDATE", a.Org, chi.URLParam(r, "id")).Scan(&channel, &name, &old, &generation)
		if e != nil {
			return e
		}
		if generation != in.ExpectedGeneration {
			return errConflict
		}
		var exists bool
		e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM release_snapshots WHERE id=$1 AND org_id=$2)", in.SnapshotID, a.Org).Scan(&exists)
		if e != nil {
			return e
		}
		if !exists {
			return pgx.ErrNoRows
		}
		if strings.HasSuffix(r.URL.Path, "rollback") {
			e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM channel_history WHERE channel_id=$1 AND after_snapshot_id=$2)", channel, in.SnapshotID).Scan(&exists)
			if e != nil {
				return e
			}
			if !exists {
				return errors.New("Rollback target must be in channel history")
			}
		}
		rows, e := tx.Query(r.Context(), "SELECT v.metadata FROM release_items i JOIN skill_versions v ON v.id=i.skill_version_id WHERE i.snapshot_id=$1", in.SnapshotID)
		if e != nil {
			return e
		}
		var all []protocol.File
		for rows.Next() {
			var meta []byte
			rows.Scan(&meta)
			var m struct {
				Files []protocol.File `json:"files"`
			}
			json.Unmarshal(meta, &m)
			all = append(all, m.Files...)
		}
		rows.Close()
		for _, f := range all {
			b, e := s.get(f.Digest)
			if e != nil || int64(len(b)) != f.Size {
				return errors.New("Snapshot contains missing or damaged blobs")
			}
		}
		_, e = tx.Exec(r.Context(), "UPDATE channels SET active_snapshot_id=$1,generation=generation+1,updated_at=now() WHERE id=$2 AND generation=$3", in.SnapshotID, channel, generation)
		if e != nil {
			return e
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO channel_history(id,channel_id,before_snapshot_id,after_snapshot_id,generation,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)", ID(), channel, old, in.SnapshotID, generation+1, a.ID, in.Reason)
		if e != nil {
			return e
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO outbox(id,org_id,channel_id,snapshot_id,generation) VALUES($1,$2,$3,$4,$5)", ID(), a.Org, channel, in.SnapshotID, generation+1)
		if e != nil {
			return e
		}
		result = map[string]any{"channel": name, "snapshotId": in.SnapshotID, "generation": generation + 1, "publishedAt": now()}
		if e = audit(r.Context(), tx, a, "channel."+pathAction(r), "channel", channel, map[string]any{"snapshotId": old, "generation": generation}, result); e != nil {
			return e
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO idempotency_keys(org_id,actor_id,key,request_hash,response) VALUES($1,$2,$3,$4,$5)", a.Org, a.ID, key, hash, mustJSON(result))
		return e
	})
	if e != nil {
		if errors.Is(e, errConflict) {
			promoteConflicts.Add(1)
			fail(w, r, 409, "RELEASE_CONFLICT", e.Error())
		} else {
			s.dbError(w, r, e)
		}
		return
	}
	jsonOut(w, 200, result)
}
func pathAction(r *http.Request) string { p := strings.Split(r.URL.Path, "/"); return p[len(p)-1] }
