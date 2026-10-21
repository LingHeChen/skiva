package platform

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"skiva/packages/protocol"
	"strings"
	"time"
)

var shaPattern = regexp.MustCompile(`^[0-9a-f]{40}([0-9a-f]{24})?$`)

type repoInput struct {
	SourceType       string  `json:"sourceType"`
	Namespace        string  `json:"namespace"`
	Slug             string  `json:"slug"`
	Template         string  `json:"template"`
	Name             string  `json:"name"`
	RemoteURL        string  `json:"remoteUrl"`
	DefaultRef       string  `json:"defaultRef"`
	SkillRoot        string  `json:"skillRoot"`
	CredentialID     *string `json:"credentialId"`
	WebhookSecretRef *string `json:"webhookSecretRef"`
	Status           string  `json:"status"`
}

func (s *Server) validateRemote(ctx context.Context, raw string) error {
	u, e := url.Parse(raw)
	if e != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "ssh") || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("Only HTTPS or SSH Git URLs are allowed")
	}
	if u.User != nil {
		if _, ok := u.User.Password(); ok {
			return errors.New("Use a credential reference, not a URL password")
		}
		if u.Scheme == "https" {
			return errors.New("HTTPS URL credentials are forbidden")
		}
	}
	allowed := false
	for _, h := range s.AllowHosts {
		if h == u.Hostname() {
			allowed = true
		}
	}
	ips, e := net.DefaultResolver.LookupIPAddr(ctx, u.Hostname())
	if e != nil {
		return e
	}
	for _, ip := range ips {
		if !allowed && (ip.IP.IsPrivate() || ip.IP.IsLoopback() || ip.IP.IsLinkLocalUnicast() || ip.IP.IsUnspecified() || ip.IP.IsMulticast()) {
			return errors.New("Private/local Git targets require explicit host allowlisting")
		}
	}
	return nil
}
func (s *Server) secret(ref string) (string, error) {
	if !regexp.MustCompile(`^[A-Z][A-Z0-9_]{2,100}$`).MatchString(ref) {
		return "", errors.New("Secret reference must be an environment variable name")
	}
	v := os.Getenv(ref)
	if v == "" {
		return "", errors.New("Secret reference is not configured")
	}
	return v, nil
}
func (s *Server) git(ctx context.Context, dir string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	base := []string{"-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never", "-c", "protocol.ext.allow=never", "-c", "http.followRedirects=false", "-c", "credential.helper=", "-c", "submodule.recurse=false"}
	cmd := exec.CommandContext(ctx, "git", append(base, args...)...)
	cmd.Dir = dir
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + filepath.Join(s.Data, "git-home"), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0", "GIT_SSH_COMMAND=ssh -oBatchMode=yes -oStrictHostKeyChecking=yes"}
	if opts, ok := ctx.Value(ctxKey("gitOptions")).(gitOptions); ok {
		cmd.Env = append(cmd.Env, opts.Env...)
		if opts.SSH != "" {
			cmd.Env = append(cmd.Env, "GIT_SSH_COMMAND="+opts.SSH)
		}
	}
	if ca := os.Getenv("SKIVA_GIT_CA_BUNDLE"); ca != "" {
		cmd.Env = append(cmd.Env, "GIT_SSL_CAINFO="+ca)
	}
	var out limitedBuffer
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	e := cmd.Run()
	if e != nil {
		return nil, errors.New("Git command failed (check remote, network and credentials)")
	}
	return out.Bytes(), nil
}

type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 32<<20 {
		return 0, errors.New("Git output exceeds limit")
	}
	return b.Buffer.Write(p)
}
func (s *Server) repositories(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',id,'name',name,'sourceType',source_type,'namespace',namespace_slug,'slug',slug,'provisionState',provision_state,'provisionError',provision_error,'hostingPolicy',hosting_policy,'lastPushAt',last_push_at,'remoteUrl',remote_url,'defaultRef',default_ref,'skillRoot',skill_root,'status',status,'lastCommitSha',last_commit_sha,'lastSyncAt',last_sync_at,'createdAt',created_at) FROM repositories WHERE org_id=$1 AND deleted_at IS NULL AND (source_type='external' OR EXISTS(SELECT 1 FROM role_bindings WHERE user_id=$2 AND org_id=$1 AND role='org_admin') OR EXISTS(SELECT 1 FROM repository_members WHERE repository_id=repositories.id AND user_id=$2)) ORDER BY created_at DESC`, who(r).Org, who(r).ID)
}
func (s *Server) repository(w http.ResponseWriter, r *http.Request) {
	if !s.checkRepositoryAccess(w, r, false) {
		return
	}
	s.one(w, r, `SELECT jsonb_build_object('id',id,'name',name,'sourceType',source_type,'namespace',namespace_slug,'slug',slug,'provisionState',provision_state,'provisionError',provision_error,'hostingPolicy',hosting_policy,'lastPushAt',last_push_at,'remoteUrl',remote_url,'defaultRef',default_ref,'skillRoot',skill_root,'status',status,'credentialId',credential_id,'webhookSecretRef',webhook_secret_ref,'lastCommitSha',last_commit_sha,'lastSyncAt',last_sync_at,'accessRole',(SELECT access_role FROM repository_members WHERE repository_id=repositories.id AND user_id=$3),'syncJobs',COALESCE((SELECT jsonb_agg(j) FROM (SELECT id,status,error,attempts,created_at FROM job_queue WHERE payload->>'repositoryId'=repositories.id::text ORDER BY created_at DESC LIMIT 5) j),'[]')) FROM repositories WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL`, who(r).Org, chi.URLParam(r, "id"), who(r).ID)
}
func (s *Server) saveRepository(w http.ResponseWriter, r *http.Request) {
	var in repoInput
	if existing := chi.URLParam(r, "id"); existing != "" {
		if e := s.DB.QueryRow(r.Context(), "SELECT name,COALESCE(remote_url,''),default_ref,skill_root,credential_id,webhook_secret_ref,status,source_type FROM repositories WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL", existing, who(r).Org).Scan(&in.Name, &in.RemoteURL, &in.DefaultRef, &in.SkillRoot, &in.CredentialID, &in.WebhookSecretRef, &in.Status, &in.SourceType); e != nil {
			s.dbError(w, r, e)
			return
		}
		if in.Status == "error" {
			in.Status = "active"
		}
	}
	if !decode(w, r, &in) {
		return
	}
	if in.DefaultRef == "" {
		in.DefaultRef = "refs/heads/main"
	}
	if in.Status == "" {
		in.Status = "active"
	}
	if in.SkillRoot != "" && !protocol.ValidPath(in.SkillRoot) {
		fail(w, r, 400, "INVALID_PATH", "Invalid skill root")
		return
	}
	if len(in.Name) < 1 || !strings.HasPrefix(in.DefaultRef, "refs/") || strings.ContainsAny(in.DefaultRef, " \r\n~^:?*[\\") || (in.Status != "active" && in.Status != "disabled") {
		fail(w, r, 400, "INVALID_INPUT", "Invalid repository fields")
		return
	}
	if existing := chi.URLParam(r, "id"); existing != "" {
		var source string
		if e := s.DB.QueryRow(r.Context(), "SELECT source_type FROM repositories WHERE id=$1 AND org_id=$2", existing, who(r).Org).Scan(&source); e != nil {
			s.dbError(w, r, e)
			return
		}
		if in.SourceType != source {
			fail(w, r, 400, "SOURCE_IMMUTABLE", "Repository source cannot be converted")
			return
		}
	}
	if in.SourceType == "managed" {
		s.saveManaged(w, r, in)
		return
	}
	if in.SourceType != "" && in.SourceType != "external" {
		fail(w, r, 400, "INVALID_SOURCE", "Unknown repository source")
		return
	}
	if e := s.validateRemote(r.Context(), in.RemoteURL); e != nil {
		fail(w, r, 422, "REMOTE_POLICY", e.Error())
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
			if e := tx.QueryRow(r.Context(), "SELECT jsonb_build_object('name',name,'sourceType',source_type,'namespace',namespace_slug,'slug',slug,'provisionState',provision_state,'provisionError',provision_error,'hostingPolicy',hosting_policy,'lastPushAt',last_push_at,'remoteUrl',remote_url,'defaultRef',default_ref,'skillRoot',skill_root,'credentialId',credential_id,'webhookSecretRef',webhook_secret_ref,'status',status) FROM repositories WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR UPDATE", id, who(r).Org).Scan(&before); e != nil {
				return e
			}
		}
		if in.CredentialID != nil {
			var ok bool
			if e := tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM repository_credentials WHERE id=$1 AND org_id=$2)", *in.CredentialID, who(r).Org).Scan(&ok); e != nil {
				return e
			}
			if !ok {
				return errors.New("invalid credential")
			}
		}
		if create {
			_, e := tx.Exec(r.Context(), `INSERT INTO repositories(id,org_id,name,remote_url,default_ref,skill_root,credential_id,webhook_secret_ref,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, id, who(r).Org, in.Name, in.RemoteURL, in.DefaultRef, in.SkillRoot, in.CredentialID, in.WebhookSecretRef, in.Status)
			if e != nil {
				return e
			}
		} else {
			tag, e := tx.Exec(r.Context(), `UPDATE repositories SET name=$3,remote_url=$4,default_ref=$5,skill_root=$6,credential_id=$7,webhook_secret_ref=$8,status=$9 WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL`, id, who(r).Org, in.Name, in.RemoteURL, in.DefaultRef, in.SkillRoot, in.CredentialID, in.WebhookSecretRef, in.Status)
			if e != nil {
				return e
			}
			if tag.RowsAffected() != 1 {
				return pgx.ErrNoRows
			}
		}
		return audit(r.Context(), tx, who(r), "repository.save", "repository", id, before, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]string{"id": id})
}
func (s *Server) repositoryAction(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var remote, ref, status string
	e := s.DB.QueryRow(r.Context(), "SELECT COALESCE(remote_url,''),default_ref,status FROM repositories WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL", id, who(r).Org).Scan(&remote, &ref, &status)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	if remote == "" {
		role, err := s.repoAccess(r.Context(), who(r), id, true)
		if err != nil || role != "maintainer" {
			fail(w, r, 403, "FORBIDDEN", "Repository maintainer required")
			return
		}
		if strings.HasSuffix(r.URL.Path, "test-connection") {
			s.hostingInfo(w, r)
			return
		}
	}
	if strings.HasSuffix(r.URL.Path, "test-connection") {
		if e = s.validateRemote(r.Context(), remote); e == nil {
			gc, cleanup, err := s.remoteContext(r.Context(), id, remote)
			defer cleanup()
			e = err
			if e == nil {
				_, e = s.git(gc, "", "ls-remote", "--exit-code", remote, ref)
			}
		}
		if e != nil {
			fail(w, r, 422, "GIT_CONNECTION", e.Error())
			return
		}
		jsonOut(w, 200, map[string]bool{"connected": true})
		return
	}
	if status == "disabled" {
		fail(w, r, 409, "REPOSITORY_DISABLED", "Enable repository first")
		return
	}
	job := ID()
	e = s.transaction(r, func(tx pgx.Tx) error {
		_, e := tx.Exec(r.Context(), "INSERT INTO job_queue(id,kind,payload) VALUES($1,'sync',$2)", job, tracedPayload(r.Context(), map[string]string{"repositoryId": id}))
		if e != nil {
			return e
		}
		return audit(r.Context(), tx, who(r), "repository.sync", "repository", id, nil, map[string]string{"jobId": job})
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 202, map[string]string{"runId": job, "jobId": job})
}
func (s *Server) deleteRepository(w http.ResponseWriter, r *http.Request) {
	if !s.checkRepositoryAccess(w, r, true) {
		return
	}
	id := chi.URLParam(r, "id")
	e := s.transaction(r, func(tx pgx.Tx) error {
		t, e := tx.Exec(r.Context(), "UPDATE repositories SET deleted_at=now(),status='disabled' WHERE id=$1 AND org_id=$2", id, who(r).Org)
		if e != nil {
			return e
		}
		if t.RowsAffected() != 1 {
			return pgx.ErrNoRows
		}
		return audit(r.Context(), tx, who(r), "repository.delete", "repository", id, nil, nil)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}
func (s *Server) webhook(w http.ResponseWriter, r *http.Request) {
	id, p := chi.URLParam(r, "repositoryId"), chi.URLParam(r, "provider")
	var secretRef, ref string
	e := s.DB.QueryRow(r.Context(), "SELECT COALESCE(webhook_secret_ref,''),default_ref FROM repositories WHERE id=$1 AND source_type='external' AND status='active' AND deleted_at IS NULL", id).Scan(&secretRef, &ref)
	if e != nil {
		fail(w, r, 404, "NOT_FOUND", "Repository unavailable")
		return
	}
	secret, e := s.secret(secretRef)
	if e != nil {
		fail(w, r, 503, "SECRET_UNAVAILABLE", "Webhook secret is not configured")
		return
	}
	body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if e != nil {
		fail(w, r, 400, "INVALID_BODY", "Payload too large")
		return
	}
	delivery := ""
	valid := false
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))
	switch p {
	case "github":
		delivery = r.Header.Get("X-GitHub-Delivery")
		valid = hmac.Equal([]byte(r.Header.Get("X-Hub-Signature-256")), []byte("sha256="+sig))
	case "gitea":
		delivery = r.Header.Get("X-Gitea-Delivery")
		valid = hmac.Equal([]byte(r.Header.Get("X-Gitea-Signature")), []byte(sig))
	case "gitlab":
		delivery = r.Header.Get("X-Gitlab-Event-UUID")
		valid = hmac.Equal([]byte(r.Header.Get("X-Gitlab-Token")), []byte(secret))
	}
	if !valid || delivery == "" || len(delivery) > 200 {
		fail(w, r, 401, "INVALID_SIGNATURE", "Webhook verification failed")
		return
	}
	var data struct {
		Ref   string `json:"ref"`
		After string `json:"after"`
	}
	if json.Unmarshal(body, &data) != nil || !shaPattern.MatchString(data.After) {
		fail(w, r, 400, "INVALID_COMMIT", "A full commit SHA is required")
		return
	}
	if data.Ref != ref {
		jsonOut(w, 202, map[string]bool{"ignored": true})
		return
	}
	e = s.transaction(r, func(tx pgx.Tx) error {
		tag, e := tx.Exec(r.Context(), "INSERT INTO webhook_deliveries(id,repository_id,provider,delivery_id,payload_sha256) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", ID(), id, p, delivery, protocol.Digest(body))
		if e != nil || tag.RowsAffected() == 0 {
			return e
		}
		_, e = tx.Exec(r.Context(), "INSERT INTO job_queue(id,kind,payload) VALUES($1,'sync',$2)", ID(), tracedPayload(r.Context(), map[string]string{"repositoryId": id, "commitSha": data.After}))
		return e
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 202, map[string]bool{"accepted": true})
}

var _ = fmt.Sprintf
