package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"esdp/packages/protocol"
	"fmt"
	"github.com/go-chi/chi/v5"
	"net/http"
	"strings"
	"time"
)

type clientAuth struct {
	ID, Org, ProfileID, Name, Mode, Policy, ChannelID string
	Pinned, Active                                    *string
	Generation                                        int64
}

func (s *Server) authenticateClient(r *http.Request) (clientAuth, error) {
	var c clientAuth
	t := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	e := s.DB.QueryRow(r.Context(), `SELECT m.id,m.org_id,p.id,p.name,p.consistency_mode,p.offline_policy,p.channel_id,p.pinned_snapshot_id,ch.active_snapshot_id,ch.generation FROM mount_clients m JOIN agent_profiles p ON p.id=m.profile_id AND p.org_id=m.org_id JOIN channels ch ON ch.id=p.channel_id AND ch.org_id=p.org_id WHERE m.credential_hash=$1 AND m.revoked_at IS NULL AND m.expires_at>now() AND p.enabled`, protocol.Digest([]byte(t))).Scan(&c.ID, &c.Org, &c.ProfileID, &c.Name, &c.Mode, &c.Policy, &c.ChannelID, &c.Pinned, &c.Active, &c.Generation)
	return c, e
}
func (s *Server) clientAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, e := s.authenticateClient(r)
		if e != nil {
			fail(w, r, 403, "CLIENT_FORBIDDEN", "Client credential expired, revoked or unavailable")
			return
		}
		if p := r.URL.Query().Get("profileId"); p != "" && p != c.ProfileID && p != c.Name {
			fail(w, r, 403, "PROFILE_FORBIDDEN", "Credential is limited to its assigned profile")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey("client"), c)))
	})
}
func clientOf(r *http.Request) clientAuth { return r.Context().Value(ctxKey("client")).(clientAuth) }
func (s *Server) distributionProfile(w http.ResponseWriter, r *http.Request) {
	c := clientOf(r)
	jsonOut(w, 200, map[string]any{"id": c.ProfileID, "name": c.Name, "channelId": c.ChannelID, "consistencyMode": c.Mode, "policy": map[string]any{"offline": c.Policy, "leaseSeconds": 60}, "activeSnapshot": c.Active, "pinnedSnapshotId": c.Pinned, "generation": c.Generation})
}
func (s *Server) manifestFor(r *http.Request, c clientAuth) (protocol.Manifest, error) {
	snapshot := r.URL.Query().Get("snapshotId")
	if snapshot == "" {
		if c.Mode == "pinned" && c.Pinned != nil {
			snapshot = *c.Pinned
		} else if c.Active != nil {
			snapshot = *c.Active
		}
	}
	if snapshot == "" {
		return protocol.Manifest{}, errors.New("Channel has no published snapshot")
	}
	allowed := (c.Active != nil && snapshot == *c.Active) || (c.Pinned != nil && snapshot == *c.Pinned)
	if !allowed {
		_ = s.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM snapshot_grants WHERE client_id=$1 AND snapshot_id=$2)", c.ID, snapshot).Scan(&allowed)
	}
	if !allowed {
		return protocol.Manifest{}, errors.New("Snapshot is not authorized for this client")
	}
	rows, e := s.DB.Query(r.Context(), `SELECT i.skill_name,v.metadata FROM release_items i JOIN release_snapshots sn ON sn.id=i.snapshot_id JOIN skill_versions v ON v.id=i.skill_version_id JOIN profile_skills ps ON ps.skill_name=i.skill_name AND ps.profile_id=$2 AND ps.enabled WHERE i.snapshot_id=$1 AND sn.org_id=$3 ORDER BY i.skill_name`, snapshot, c.ProfileID, c.Org)
	if e != nil {
		return protocol.Manifest{}, e
	}
	defer rows.Close()
	files := []protocol.File{}
	for rows.Next() {
		var name string
		var meta []byte
		if e = rows.Scan(&name, &meta); e != nil {
			return protocol.Manifest{}, e
		}
		var data struct {
			Files []protocol.File `json:"files"`
		}
		if e = json.Unmarshal(meta, &data); e != nil {
			return protocol.Manifest{}, e
		}
		for _, f := range data.Files {
			f.Path = name + "/" + f.Path
			files = append(files, f)
		}
	}
	if e = rows.Err(); e != nil {
		return protocol.Manifest{}, e
	}
	b, e := protocol.Canonical(files)
	if e != nil {
		return protocol.Manifest{}, e
	}
	return protocol.Manifest{SchemaVersion: 1, SnapshotID: snapshot, ManifestDigest: protocol.Digest(b), Generation: c.Generation, ProfileID: c.ProfileID, Files: files}, nil
}
func (s *Server) manifest(w http.ResponseWriter, r *http.Request) {
	c := clientOf(r)
	m, e := s.manifestFor(r, c)
	if e != nil {
		fail(w, r, 403, "SNAPSHOT_FORBIDDEN", e.Error())
		return
	}
	_, e = s.DB.Exec(r.Context(), "INSERT INTO snapshot_grants(client_id,snapshot_id) VALUES($1,$2) ON CONFLICT DO NOTHING", c.ID, m.SnapshotID)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	w.Header().Set("Cache-Control", "private, no-cache")
	etag := `"` + m.ManifestDigest + ":" + fmt.Sprint(m.Generation) + `"`
	w.Header().Set("ETag", etag)
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(304)
		return
	}
	jsonOut(w, 200, m)
}
func (s *Server) object(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("snapshotId") == "" {
		fail(w, r, 400, "SNAPSHOT_REQUIRED", "snapshotId is required")
		return
	}
	m, e := s.manifestFor(r, clientOf(r))
	if e != nil {
		fail(w, r, 403, "SNAPSHOT_FORBIDDEN", e.Error())
		return
	}
	digest := chi.URLParam(r, "digest")
	found := false
	for _, f := range m.Files {
		if f.Digest == digest {
			found = true
			break
		}
	}
	if !found {
		fail(w, r, 403, "OBJECT_FORBIDDEN", "Object is not in the authorized view")
		return
	}
	b, e := s.get(digest)
	if e != nil {
		fail(w, r, 503, "OBJECT_UNAVAILABLE", "Artifact integrity check failed")
		return
	}
	w.Header().Set("ETag", `"`+digest+`"`)
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeContent(w, r, digest, time.Time{}, bytes.NewReader(b))
}
func (s *Server) heartbeat(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SnapshotID  *string `json:"snapshotId"`
		Generation  int64   `json:"generation"`
		CacheBytes  int64   `json:"cacheBytes"`
		CacheHits   int64   `json:"cacheHits"`
		CacheMisses int64   `json:"cacheMisses"`
		Version     string  `json:"version"`
		Status      string  `json:"status"`
	}
	if !decode(w, r, &in) {
		return
	}
	c := clientOf(r)
	if in.SnapshotID != nil {
		var allowed bool
		s.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM snapshot_grants WHERE client_id=$1 AND snapshot_id=$2)", c.ID, *in.SnapshotID).Scan(&allowed)
		if !allowed {
			fail(w, r, 403, "SNAPSHOT_FORBIDDEN", "Unknown snapshot")
			return
		}
	}
	_, e := s.DB.Exec(r.Context(), "UPDATE mount_clients SET last_seen_at=now(),last_snapshot_id=$2,telemetry=$3 WHERE id=$1", c.ID, in.SnapshotID, mustJSON(in))
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]any{"generation": c.Generation, "leaseSeconds": 60})
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	f, ok := w.(http.Flusher)
	if !ok {
		fail(w, r, 503, "STREAM_UNAVAILABLE", "Streaming unavailable")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	last := ""
	for {
		c, e := s.authenticateClient(r)
		if e != nil {
			fmt.Fprint(w, "event: revoked\ndata: {}\n\n")
			f.Flush()
			return
		}
		event := fmt.Sprint(c.Generation)
		if c.Active != nil {
			event += ":" + *c.Active
		}
		if event != last {
			fmt.Fprintf(w, "id: %s\nevent: update\ndata: %s\n\n", event, mustJSON(map[string]any{"generation": c.Generation, "snapshotId": c.Active, "eventId": event}))
			last = event
		} else {
			fmt.Fprint(w, ": heartbeat\n\n")
		}
		f.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
