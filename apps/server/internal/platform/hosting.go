package platform

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

func hostingEnabled(flag string) bool { return os.Getenv("SKIVA_MANAGED_GIT_"+flag) == "true" }

type HostingPolicy struct {
	ProtectedBranches []string `json:"protectedBranches"`
	TriggerRefs       []string `json:"triggerRefs"`
	DenyForcePush     bool     `json:"denyForcePush"`
	ProtectTags       bool     `json:"protectTags"`
	MaxPushBytes      int64    `json:"maxPushBytes"`
	MaxRepoBytes      int64    `json:"maxRepoBytes"`
	MaxFileBytes      int64    `json:"maxFileBytes"`
	MaxFiles          int      `json:"maxFiles"`
}

func defaultHostingPolicy(ref string) HostingPolicy {
	return HostingPolicy{[]string{ref}, []string{ref, "refs/tags/v*"}, true, true, 64 << 20, 512 << 20, 4 << 20, 10000}
}
func (p HostingPolicy) validate() error {
	if p.MaxPushBytes < 1024 || p.MaxPushBytes > 256<<20 || p.MaxRepoBytes < p.MaxPushBytes || p.MaxRepoBytes > 10<<30 || p.MaxFileBytes < 1 || p.MaxFileBytes > 32<<20 || p.MaxFiles < 1 || p.MaxFiles > 100000 {
		return errors.New("invalid hosting resource limits")
	}
	for _, refs := range [][]string{p.ProtectedBranches, p.TriggerRefs} {
		if len(refs) > 100 {
			return errors.New("too many ref rules")
		}
		for _, ref := range refs {
			if !(strings.HasPrefix(ref, "refs/heads/") || strings.HasPrefix(ref, "refs/tags/")) || strings.ContainsAny(ref, "\r\n ?[\\~^:") || strings.Contains(ref, "..") {
				return errors.New("invalid ref rule")
			}
		}
	}
	return nil
}
func (s *Server) managedPath(storage string) (string, error) {
	if _, e := uuid.Parse(storage); e != nil {
		return "", errors.New("invalid storage ID")
	}
	return filepath.Abs(filepath.Join(s.Data, "managed-git", storage+".git"))
}
func (s *Server) cloneURL(namespace, slug string) string {
	return strings.TrimRight(env("SKIVA_GIT_PUBLIC_URL", s.Origin), "/") + "/git/" + namespace + "/" + slug + ".git"
}
func (s *Server) repoAccess(ctx context.Context, a actor, id string, write bool) (string, error) {
	var role string
	e := s.DB.QueryRow(ctx, `SELECT CASE WHEN EXISTS(SELECT 1 FROM role_bindings WHERE user_id=$2 AND org_id=$3 AND role='org_admin') THEN 'maintainer' ELSE COALESCE((SELECT access_role FROM repository_members WHERE repository_id=r.id AND user_id=$2),'') END FROM repositories r WHERE r.id=$1 AND r.org_id=$3 AND r.deleted_at IS NULL AND r.source_type='managed'`, id, a.ID, a.Org).Scan(&role)
	if e != nil || role == "" || (write && role == "viewer") {
		return "", pgx.ErrNoRows
	}
	return role, nil
}
func (s *Server) saveManaged(w http.ResponseWriter, r *http.Request, in repoInput) {
	if !hostingEnabled("ENABLED") {
		fail(w, r, 503, "HOSTING_DISABLED", "Managed Git is disabled")
		return
	}
	if !strings.HasPrefix(in.DefaultRef, "refs/heads/") {
		fail(w, r, 400, "INVALID_REF", "Default ref must be a branch")
		return
	}
	if _, e := s.git(r.Context(), "", "check-ref-format", in.DefaultRef); e != nil {
		fail(w, r, 400, "INVALID_REF", "Invalid default branch")
		return
	}
	id := chi.URLParam(r, "id")
	if id != "" {
		role, e := s.repoAccess(r.Context(), who(r), id, true)
		if e != nil || role != "maintainer" {
			fail(w, r, 403, "FORBIDDEN", "Repository maintainer required")
			return
		}
		e = s.transaction(r, func(tx pgx.Tx) error {
			if in.Namespace != "" && !slugPattern.MatchString(in.Namespace) || in.Slug != "" && !slugPattern.MatchString(in.Slug) {
				return errors.New("invalid namespace or slug")
			}
			if in.Namespace != "" {
				if _, e := tx.Exec(r.Context(), "INSERT INTO git_namespaces(slug,org_id) VALUES($1,$2) ON CONFLICT DO NOTHING", in.Namespace, who(r).Org); e != nil {
					return e
				}
			}
			_, e := tx.Exec(r.Context(), `UPDATE repositories SET name=$3,status=$4,default_ref=$5,skill_root=$6,namespace_slug=COALESCE(NULLIF($7,''),namespace_slug),slug=COALESCE(NULLIF($8,''),slug) WHERE id=$1 AND org_id=$2`, id, who(r).Org, in.Name, in.Status, in.DefaultRef, in.SkillRoot, in.Namespace, in.Slug)
			if e != nil {
				return e
			}
			return audit(r.Context(), tx, who(r), "repository.update", "repository", id, nil, map[string]string{"name": in.Name, "status": in.Status})
		})
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		jsonOut(w, 200, map[string]string{"id": id})
		return
	}
	if !slugPattern.MatchString(in.Namespace) || !slugPattern.MatchString(in.Slug) || in.RemoteURL != "" || in.CredentialID != nil || in.WebhookSecretRef != nil {
		fail(w, r, 400, "INVALID_INPUT", "Managed repositories require namespace and slug, without external credentials")
		return
	}
	if in.Template == "" {
		in.Template = "single"
	}
	if in.Template != "single" && in.Template != "monorepo" && in.Template != "empty" {
		fail(w, r, 400, "INVALID_TEMPLATE", "Choose single, monorepo or empty")
		return
	}
	if !strings.HasPrefix(in.DefaultRef, "refs/heads/") {
		fail(w, r, 400, "INVALID_REF", "Default ref must be a branch")
		return
	}
	if _, e := s.git(r.Context(), "", "check-ref-format", in.DefaultRef); e != nil {
		fail(w, r, 400, "INVALID_REF", "Invalid default branch")
		return
	}
	id, storage := ID(), ID()
	policy := defaultHostingPolicy(in.DefaultRef)
	e := s.transaction(r, func(tx pgx.Tx) error {
		if _, e := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", "managed-create:"+who(r).Org); e != nil {
			return e
		}
		var count int
		if e := tx.QueryRow(r.Context(), "SELECT count(*) FROM repositories WHERE org_id=$1 AND source_type='managed'", who(r).Org).Scan(&count); e != nil {
			return e
		}
		if count >= 1000 {
			return errors.New("managed repository quota exceeded")
		}
		if _, e := tx.Exec(r.Context(), "INSERT INTO git_namespaces(slug,org_id) VALUES($1,$2) ON CONFLICT DO NOTHING", in.Namespace, who(r).Org); e != nil {
			return e
		}
		_, e := tx.Exec(r.Context(), `INSERT INTO repositories(id,org_id,name,remote_url,source_type,namespace_slug,slug,storage_id,provision_state,default_ref,skill_root,template,hosting_policy) VALUES($1,$2,$3,NULL,'managed',$4,$5,$6,'provisioning',$7,$8,$9,$10)`, id, who(r).Org, in.Name, in.Namespace, in.Slug, storage, in.DefaultRef, in.SkillRoot, in.Template, mustJSON(policy))
		if e != nil {
			return e
		}
		_, e = tx.Exec(r.Context(), `INSERT INTO repository_members(org_id,repository_id,user_id,access_role) VALUES($1,$2,$3,'maintainer')`, who(r).Org, id, who(r).ID)
		if e != nil {
			return e
		}
		return audit(r.Context(), tx, who(r), "repository.created", "repository", id, nil, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	// Provision only after the metadata/idempotency transaction commits. The worker repairs interruptions.
	jsonOut(w, 202, map[string]string{"id": id, "provisionState": "provisioning", "cloneUrl": s.cloneURL(in.Namespace, in.Slug)})
}
func (s *Server) provisionManaged(ctx context.Context, id string) error {
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
	var storage, ref, template, slug string
	e = conn.QueryRow(ctx, `SELECT storage_id,default_ref,template,slug FROM repositories WHERE id=$1 AND source_type='managed' AND provision_state IN ('provisioning','failed') AND deleted_at IS NULL`, id).Scan(&storage, &ref, &template, &slug)
	if e != nil {
		return e
	}
	dir, e := s.managedPath(storage)
	if e != nil {
		return e
	}
	provision := func() error {
		if _, e = os.Stat(filepath.Join(dir, "HEAD")); e == nil {
			return nil
		}
		if e = os.MkdirAll(filepath.Dir(dir), 0700); e != nil {
			return e
		}
		staging, e := os.MkdirTemp(filepath.Dir(dir), ".provision-")
		if e != nil {
			return e
		}
		defer os.RemoveAll(staging)
		if _, e = s.git(ctx, staging, "init", "--bare", "--initial-branch="+strings.TrimPrefix(ref, "refs/heads/")); e != nil {
			return e
		}
		for key, value := range map[string]string{"http.receivepack": "true", "http.uploadpack": "true", "receive.advertiseAtomic": "true", "receive.fsckObjects": "true", "transfer.fsckObjects": "true", "core.logAllRefUpdates": "true", "uploadpack.allowAnySHA1InWant": "false"} {
			if _, e = s.git(ctx, staging, "config", key, value); e != nil {
				return e
			}
		}
		if e = os.WriteFile(filepath.Join(staging, "git-daemon-export-ok"), nil, 0600); e != nil {
			return e
		}
		if template != "empty" {
			work, e := os.MkdirTemp(filepath.Dir(dir), ".template-")
			if e != nil {
				return e
			}
			defer os.RemoveAll(work)
			file := "SKILL.md"
			if template == "monorepo" {
				file = "skills/" + slug + "/SKILL.md"
			}
			if e = os.MkdirAll(filepath.Dir(filepath.Join(work, file)), 0700); e != nil {
				return e
			}
			if e = os.WriteFile(filepath.Join(work, file), []byte("---\nname: "+slug+"\ndescription: Describe when to use this skill\n---\n\n# "+slug+"\n\nAdd instructions and references here.\n"), 0600); e != nil {
				return e
			}
			for _, args := range [][]string{{"init", "--initial-branch=" + strings.TrimPrefix(ref, "refs/heads/")}, {"add", "."}, {"-c", "user.name=Skiva", "-c", "user.email=skiva@localhost", "commit", "-m", "Initialize skill"}} {
				if _, e = s.git(ctx, work, args...); e != nil {
					return e
				}
			}
			// Trusted local template transfer only; external providers keep file transport disabled.
			if _, e = s.git(ctx, staging, "-c", "protocol.file.allow=always", "fetch", work, ref+":"+ref); e != nil {
				return e
			}
		}
		return os.Rename(staging, dir)
	}
	e = provision()
	if e != nil {
		gitProvisionFailures.Add(1)
		_, _ = conn.Exec(ctx, "UPDATE repositories SET provision_state='failed',provision_error='Provisioning failed; worker will retry' WHERE id=$1", id)
		return e
	}
	_, e = conn.Exec(ctx, "UPDATE repositories SET provision_state='active',provision_error=NULL WHERE id=$1", id)
	return e
}
func (s *Server) hostingInfo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	role, e := s.repoAccess(r.Context(), who(r), id, false)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	var ns, slug, ref, state string
	var policy json.RawMessage
	e = s.DB.QueryRow(r.Context(), "SELECT namespace_slug,slug,default_ref,provision_state,hosting_policy FROM repositories WHERE id=$1", id).Scan(&ns, &slug, &ref, &state, &policy)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]any{"cloneUrl": s.cloneURL(ns, slug), "defaultRef": ref, "provisionState": state, "hostingPolicy": policy, "accessRole": role, "enabled": hostingEnabled("ENABLED"), "writeEnabled": hostingEnabled("WRITE_ENABLED"), "autoCiEnabled": hostingEnabled("AUTO_CI_ENABLED")})
}
func validGitPublicURL(raw string) bool {
	u, e := url.Parse(raw)
	return e == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.RawQuery == "" && u.Fragment == ""
}

func (s *Server) checkRepositoryAccess(w http.ResponseWriter, r *http.Request, manage bool) bool {
	var source string
	id := chi.URLParam(r, "id")
	if e := s.DB.QueryRow(r.Context(), "SELECT source_type FROM repositories WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL", id, who(r).Org).Scan(&source); e != nil {
		s.dbError(w, r, e)
		return false
	}
	if source == "external" {
		if !manage || has(who(r), "repo_maintainer") {
			return true
		}
	} else {
		role, e := s.repoAccess(r.Context(), who(r), id, manage)
		if e == nil && (!manage || role == "maintainer") {
			return true
		}
	}
	fail(w, r, 404, "NOT_FOUND", "Repository unavailable")
	return false
}
func (s *Server) repositoryManage(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.checkRepositoryAccess(w, r, true) {
			next(w, r)
		}
	}
}
