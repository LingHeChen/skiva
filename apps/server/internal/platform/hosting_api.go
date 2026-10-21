package platform

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"net/http"
	"skiva/packages/protocol"
	"strconv"
	"strings"
	"time"
)

func (s *Server) gitTokens(w http.ResponseWriter, r *http.Request) {
	a := who(r)
	if r.Method == "GET" {
		s.list(w, r, `SELECT jsonb_build_object('id',id,'name',name,'repositoryId',repository_id,'tokenPrefix',token_prefix,'scopes',scopes,'expiresAt',expires_at,'revokedAt',revoked_at,'lastUsedAt',last_used_at) FROM git_access_tokens WHERE org_id=$1 AND owner_user_id=$2`, a.Org, a.ID)
		return
	}
	if id := chi.URLParam(r, "id"); id != "" {
		e := s.transaction(r, func(tx pgx.Tx) error {
			tag, e := tx.Exec(r.Context(), `UPDATE git_access_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND org_id=$2 AND (owner_user_id=$3 OR $4)`, id, a.Org, a.ID, has(a, "org_admin"))
			if e != nil {
				return e
			}
			if tag.RowsAffected() != 1 {
				return pgx.ErrNoRows
			}
			return audit(r.Context(), tx, a, "git.token.revoked", "git_token", id, nil, nil)
		})
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		jsonOut(w, 200, map[string]bool{"ok": true})
		return
	}
	var in struct {
		Name         string    `json:"name"`
		RepositoryID string    `json:"repositoryId"`
		Scopes       []string  `json:"scopes"`
		ExpiresAt    time.Time `json:"expiresAt"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Name) < 1 || len(in.Name) > 100 || !in.ExpiresAt.After(time.Now()) || in.ExpiresAt.After(time.Now().Add(90*24*time.Hour)) || len(in.Scopes) < 1 || len(in.Scopes) > 2 {
		fail(w, r, 400, "INVALID_TOKEN", "Token requires a name, scopes and expiry within 90 days")
		return
	}
	write := false
	for _, v := range in.Scopes {
		if v != "repo:read" && v != "repo:write" {
			fail(w, r, 400, "INVALID_SCOPE", "Unknown Git scope")
			return
		}
		write = write || v == "repo:write"
	}
	if _, e := s.repoAccess(r.Context(), a, in.RepositoryID, write); e != nil {
		fail(w, r, 403, "FORBIDDEN", "Repository access required")
		return
	}
	token := "skiva_git_" + Token()
	id := ID()
	e := s.transaction(r, func(tx pgx.Tx) error {
		_, e := tx.Exec(r.Context(), `INSERT INTO git_access_tokens(id,org_id,owner_user_id,repository_id,name,token_hash,token_prefix,scopes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, a.Org, a.ID, in.RepositoryID, in.Name, protocol.Digest([]byte(token)), token[:16], in.Scopes, in.ExpiresAt)
		if e != nil {
			return e
		}
		return audit(r.Context(), tx, a, "git.token.created", "git_token", id, nil, map[string]any{"repositoryId": in.RepositoryID, "scopes": in.Scopes, "expiresAt": in.ExpiresAt})
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	jsonOut(w, 201, map[string]any{"id": id, "token": token, "expiresAt": in.ExpiresAt})
}
func (s *Server) hostingPolicy(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	role, e := s.repoAccess(r.Context(), who(r), id, true)
	if e != nil || role != "maintainer" {
		fail(w, r, 403, "FORBIDDEN", "Repository maintainer required")
		return
	}
	var p HostingPolicy
	if !decode(w, r, &p) {
		return
	}
	if e = p.validate(); e != nil {
		fail(w, r, 400, "INVALID_POLICY", e.Error())
		return
	}
	e = s.transaction(r, func(tx pgx.Tx) error {
		_, e := tx.Exec(r.Context(), "UPDATE repositories SET hosting_policy=$2 WHERE id=$1", id, mustJSON(p))
		if e != nil {
			return e
		}
		return audit(r.Context(), tx, who(r), "git.policy.updated", "repository", id, nil, p)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, p)
}
func (s *Server) hostingMembers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	role, e := s.repoAccess(r.Context(), who(r), id, false)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	if r.Method == "GET" {
		s.list(w, r, `SELECT jsonb_build_object('id',m.user_id,'email',u.email,'accessRole',m.access_role) FROM repository_members m JOIN users u ON u.id=m.user_id WHERE m.repository_id=$1`, id)
		return
	}
	if role != "maintainer" {
		fail(w, r, 403, "FORBIDDEN", "Repository maintainer required")
		return
	}
	var in struct {
		UserID     string `json:"userId"`
		AccessRole string `json:"accessRole"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.AccessRole != "viewer" && in.AccessRole != "contributor" && in.AccessRole != "maintainer" && in.AccessRole != "none" {
		fail(w, r, 400, "INVALID_ROLE", "Unknown repository role")
		return
	}
	e = s.transaction(r, func(tx pgx.Tx) error {
		if in.AccessRole == "none" {
			_, e = tx.Exec(r.Context(), "DELETE FROM repository_members WHERE repository_id=$1 AND user_id=$2", id, in.UserID)
		} else {
			_, e = tx.Exec(r.Context(), `INSERT INTO repository_members(org_id,repository_id,user_id,access_role) VALUES($1,$2,$3,$4) ON CONFLICT(repository_id,user_id) DO UPDATE SET access_role=excluded.access_role`, who(r).Org, id, in.UserID, in.AccessRole)
		}
		if e != nil {
			return e
		}
		return audit(r.Context(), tx, who(r), "git.member.updated", "repository", id, nil, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}
func (s *Server) hostingBrowse(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, e := s.repoAccess(r.Context(), who(r), id, false); e != nil {
		s.dbError(w, r, e)
		return
	}
	if strings.HasSuffix(r.URL.Path, "/events") {
		s.list(w, r, `SELECT jsonb_build_object('id',e.id,'ref',refname,'oldOid',old_oid,'newOid',new_oid,'source',source,'observedAt',observed_at,'processedAt',processed_at,'error',error_text,'jobId',job_id,'jobStatus',j.status,'pipelines',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'status',p.status)) FROM pipeline_runs p WHERE p.repository_id=e.repository_id AND p.commit_sha=COALESCE(j.payload->>'commitSha',e.new_oid)),'[]')) FROM repository_ref_events e LEFT JOIN job_queue j ON j.id=e.job_id WHERE e.repository_id=$1`, id)
		return
	}
	var storage, ref string
	if e := s.DB.QueryRow(r.Context(), "SELECT storage_id,default_ref FROM repositories WHERE id=$1 AND provision_state='active'", id).Scan(&storage, &ref); e != nil {
		s.dbError(w, r, e)
		return
	}
	dir, e := s.managedPath(storage)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	limit := 50
	if n, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && n > 0 && n <= 200 {
		limit = n
	}
	offset := 0
	if n, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && n >= 0 && n <= 100000 {
		offset = n
	}
	if strings.HasSuffix(r.URL.Path, "/refs") {
		b, err := s.git(r.Context(), dir, "for-each-ref", "--sort=refname", "--format=%(refname) %(objectname)", "refs/heads/", "refs/tags/")
		if err != nil {
			s.dbError(w, r, err)
			return
		}
		items := []map[string]string{}
		for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			f := strings.Fields(line)
			if len(f) == 2 {
				items = append(items, map[string]string{"ref": f[0], "oid": f[1]})
			}
		}
		end := min(offset+limit, len(items))
		offset = min(offset, len(items))
		jsonOut(w, 200, map[string]any{"items": items[offset:end], "nextOffset": func() any {
			if end < len(items) {
				return end
			}
			return nil
		}()})
		return
	}
	commit := r.URL.Query().Get("commit")
	if commit == "" {
		commit = r.URL.Query().Get("ref")
	}
	if commit == "" {
		commit = ref
	}
	if !shaPattern.MatchString(commit) && (!strings.HasPrefix(commit, "refs/") || strings.ContainsAny(commit, "~^:?*[\\ \r\n") || strings.Contains(commit, "..")) {
		fail(w, r, 400, "INVALID_COMMIT", "Use a full SHA or ref name")
		return
	}
	resolved, err := s.git(r.Context(), dir, "rev-parse", "--verify", commit+"^{commit}")
	if err != nil {
		fail(w, r, 404, "COMMIT_NOT_FOUND", "Commit unavailable; an empty repository has no history")
		return
	}
	commit = strings.TrimSpace(string(resolved))
	var b []byte
	switch {
	case strings.HasSuffix(r.URL.Path, "/commits"):
		b, e = s.git(r.Context(), dir, "log", "--format=%H%x00%an%x00%aI%x00%s", "--max-count="+strconv.Itoa(limit), "--skip="+strconv.Itoa(offset), commit, "--")
		items := []map[string]string{}
		for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			f := strings.SplitN(line, "\x00", 4)
			if len(f) == 4 {
				items = append(items, map[string]string{"oid": f[0], "author": f[1], "date": f[2], "subject": f[3]})
			}
		}
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		jsonOut(w, 200, map[string]any{"items": items, "commit": commit, "nextOffset": func() any {
			if len(items) == limit {
				return offset + limit
			}
			return nil
		}()})
		return
	case strings.HasSuffix(r.URL.Path, "/tree"):
		b, e = s.git(r.Context(), dir, "ls-tree", "-rlz", "--full-tree", commit)
		items := []map[string]string{}
		for _, line := range strings.Split(string(b), "\x00") {
			f := strings.SplitN(line, "\t", 2)
			if len(f) == 2 {
				meta := strings.Fields(f[0])
				if len(meta) == 4 {
					items = append(items, map[string]string{"path": f[1], "mode": meta[0], "oid": meta[2], "size": meta[3]})
				}
			}
		}
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		end := min(offset+limit, len(items))
		offset = min(offset, len(items))
		jsonOut(w, 200, map[string]any{"items": items[offset:end], "commit": commit, "nextOffset": func() any {
			if end < len(items) {
				return end
			}
			return nil
		}()})
		return
	case strings.HasSuffix(r.URL.Path, "/diff"):
		from := r.URL.Query().Get("from")
		if from != "" && !shaPattern.MatchString(from) {
			fail(w, r, 400, "INVALID_COMMIT", "Diff base must be a full SHA")
			return
		}
		args := []string{"show", "--format=", "--no-ext-diff", "--no-textconv", "--no-renames", commit, "--"}
		if from != "" {
			args = []string{"diff", "--no-ext-diff", "--no-textconv", "--no-renames", from, commit, "--"}
		}
		b, e = s.git(r.Context(), dir, args...)
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		truncated := len(b) > 256<<10
		if truncated {
			b = b[:256<<10]
		}
		jsonOut(w, 200, map[string]any{"commit": commit, "diff": string(b), "truncated": truncated, "limitBytes": 256 << 10})
		return
	}
	fail(w, r, 404, "NOT_FOUND", "Unknown repository view")
}
