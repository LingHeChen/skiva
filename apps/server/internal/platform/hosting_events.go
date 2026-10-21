package platform

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) hostingTick(ctx context.Context) {
	if !hostingEnabled("ENABLED") {
		return
	}
	rows, e := s.DB.Query(ctx, `SELECT id FROM repositories WHERE source_type='managed' AND deleted_at IS NULL AND provision_state IN ('provisioning','failed') ORDER BY created_at LIMIT 20`)
	if e != nil {
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		_ = s.provisionManaged(ctx, id)
	}
	spool := filepath.Join(s.Data, "git-spool")
	files, _ := os.ReadDir(spool)
	for i, f := range files {
		if i >= 1000 {
			break
		}
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		p := filepath.Join(spool, f.Name())
		b, e := os.ReadFile(p)
		if e != nil || len(b) > 1<<20 {
			continue
		}
		var ev PushEvent
		if json.Unmarshal(b, &ev) != nil {
			continue
		}
		if s.recordPush(ctx, ev, "hook") == nil {
			_ = os.Remove(p)
		}
	}
	rows, e = s.DB.Query(ctx, `SELECT id FROM repositories WHERE source_type='managed' AND provision_state='active' AND status!='disabled' AND deleted_at IS NULL`)
	if e != nil {
		return
	}
	ids = nil
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		_ = s.reconcileManaged(ctx, id)
	}
	if hostingEnabled("AUTO_CI_ENABLED") {
		s.dispatchRefEvents(ctx)
	}
}
func (s *Server) recordPush(ctx context.Context, ev PushEvent, source string) error {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var org string
	if e = tx.QueryRow(ctx, "SELECT org_id FROM repositories WHERE id=$1 AND source_type='managed'", ev.Repository).Scan(&org); e != nil {
		return e
	}
	changed := false
	for _, u := range ev.Updates {
		if !shaPattern.MatchString(u.Old) || !shaPattern.MatchString(u.New) {
			continue
		}
		tag, e := tx.Exec(ctx, `INSERT INTO repository_ref_events(id,repository_id,refname,old_oid,new_oid,source) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, ID(), ev.Repository, u.Ref, u.Old, u.New, source)
		if e != nil {
			return e
		}
		if tag.RowsAffected() > 0 {
			changed = true
			if e = audit(ctx, tx, actor{ID: ev.Actor, Org: org}, "git.ref.accepted", "repository", ev.Repository, nil, u); e != nil {
				return e
			}
		}
	}
	if changed {
		if _, e = tx.Exec(ctx, "UPDATE repositories SET last_push_at=now() WHERE id=$1", ev.Repository); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (s *Server) reconcileManaged(ctx context.Context, id string) error {
	conn, e := s.DB.Acquire(ctx)
	if e != nil {
		return e
	}
	defer conn.Release()
	var locked bool
	if e = conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1,0))", "hosting:"+id).Scan(&locked); e != nil || !locked {
		return e
	}
	defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock(hashtextextended($1,0))", "hosting:"+id)
	var storage string
	if e = conn.QueryRow(ctx, "SELECT storage_id FROM repositories WHERE id=$1", id).Scan(&storage); e != nil {
		return e
	}
	dir, e := s.managedPath(storage)
	if e != nil {
		return e
	}
	b, e := s.git(ctx, dir, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/", "refs/tags/")
	if e != nil {
		return e
	}
	current := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) == 2 {
			current[f[0]] = f[1]
		}
	}
	rows, e := conn.Query(ctx, "SELECT refname,oid FROM repository_observed_refs WHERE repository_id=$1", id)
	if e != nil {
		return e
	}
	old := map[string]string{}
	for rows.Next() {
		var ref, oid string
		if rows.Scan(&ref, &oid) == nil {
			old[ref] = oid
		}
	}
	rows.Close()
	updates := []RefUpdate{}
	zero := strings.Repeat("0", 40)
	for ref, oid := range current {
		if old[ref] != oid {
			before := old[ref]
			if before == "" {
				before = zero
			}
			updates = append(updates, RefUpdate{ref, before, oid})
		}
	}
	for ref, oid := range old {
		if current[ref] == "" {
			updates = append(updates, RefUpdate{ref, oid, zero})
		}
	}
	// Reflogs recover intermediate accepted pushes even if a post-receive hook or spool write failed.
	_ = filepath.WalkDir(filepath.Join(dir, "logs", "refs"), func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(filepath.Join(dir, "logs"), p)
		if err != nil {
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > 8<<20 {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(data), "\n") {
			f := strings.Fields(line)
			if len(f) >= 2 && shaPattern.MatchString(f[0]) && shaPattern.MatchString(f[1]) {
				updates = append(updates, RefUpdate{filepath.ToSlash(rel), f[0], f[1]})
			}
		}
		return nil
	})
	if len(updates) > 0 {
		if e = s.recordPush(ctx, PushEvent{Repository: id, Actor: "reconciler", Updates: updates}, "reconcile"); e != nil {
			return e
		}
	}
	tx, e := conn.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "DELETE FROM repository_observed_refs WHERE repository_id=$1", id); e != nil {
		return e
	}
	for ref, oid := range current {
		if _, e = tx.Exec(ctx, "INSERT INTO repository_observed_refs(repository_id,refname,oid) VALUES($1,$2,$3)", id, ref, oid); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (s *Server) dispatchRefEvents(ctx context.Context) {
	for i := 0; i < 100; i++ {
		tx, e := s.DB.Begin(ctx)
		if e != nil {
			return
		}
		var id, repo, ref, oid, storage string
		var raw []byte
		e = tx.QueryRow(ctx, `SELECT e.id,e.repository_id,e.refname,e.new_oid,r.storage_id,r.hosting_policy FROM repository_ref_events e JOIN repositories r ON r.id=e.repository_id WHERE e.processed_at IS NULL AND r.deleted_at IS NULL AND r.status!='disabled' AND r.provision_state='active' ORDER BY e.observed_at LIMIT 1 FOR UPDATE OF e SKIP LOCKED`).Scan(&id, &repo, &ref, &oid, &storage, &raw)
		if e != nil {
			tx.Rollback(ctx)
			return
		}
		var policy HostingPolicy
		_ = json.Unmarshal(raw, &policy)
		var job any
		if !zeroOID(oid) && matchRefs(policy.TriggerRefs, ref) {
			dir, err := s.managedPath(storage)
			if err == nil {
				var b []byte
				b, err = s.git(ctx, dir, "rev-parse", "--verify", oid+"^{commit}")
				oid = strings.TrimSpace(string(b))
			}
			if err != nil {
				_, _ = tx.Exec(ctx, "UPDATE repository_ref_events SET attempt_count=attempt_count+1,error_text='Commit unavailable; restore repository objects' WHERE id=$1", id)
				_ = tx.Commit(ctx)
				return
			}
			jid := ID()
			_, e = tx.Exec(ctx, `INSERT INTO job_queue(id,kind,payload) VALUES($1,'sync',$2)`, jid, mustJSON(map[string]string{"repositoryId": repo, "commitSha": oid, "refEventId": id, "ref": ref}))
			job = jid
		}
		if e == nil {
			_, e = tx.Exec(ctx, "UPDATE repository_ref_events SET processed_at=now(),attempt_count=attempt_count+1,error_text=NULL,job_id=$2 WHERE id=$1", id, job)
		}
		if e != nil {
			tx.Rollback(ctx)
			return
		}
		if tx.Commit(ctx) != nil {
			return
		}
	}
}
