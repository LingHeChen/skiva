package platform

import (
	"context"
	"encoding/base64"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"skiva/packages/protocol"
	"strings"
	"testing"
	"time"
)

func TestManagedGitCLI(t *testing.T) {
	s, ts, session := integration(t)
	ctx := context.Background()
	for _, flag := range []string{"ENABLED", "WRITE_ENABLED", "AUTO_CI_ENABLED"} {
		t.Setenv("SKIVA_MANAGED_GIT_"+flag, "true")
	}
	t.Setenv("SKIVA_GIT_ALLOW_LOOPBACK_HTTP", "true")
	bin := filepath.Join(t.TempDir(), "server")
	cmd := exec.Command("go", "build", "-o", bin, "../../cmd/server")
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("build hook: %v %s", e, b)
	}
	t.Setenv("SKIVA_GIT_HOOK_EXECUTABLE", bin)
	ns := "team-" + strings.ReplaceAll(ID(), "-", "")[:12]
	code, out := request(t, ts, session, "POST", "/api/v1/repositories", map[string]any{"name": ns, "sourceType": "managed", "namespace": ns, "slug": "sample", "template": "single", "defaultRef": "refs/heads/main"}, "create-managed")
	if code != 202 {
		t.Fatalf("create %d %v", code, out)
	}
	id := out["id"].(string)
	code, replay := request(t, ts, session, "POST", "/api/v1/repositories", map[string]any{"name": ns, "sourceType": "managed", "namespace": ns, "slug": "sample", "template": "single", "defaultRef": "refs/heads/main"}, "create-managed")
	if code != 202 || replay["id"] != id {
		t.Fatal("idempotency", code, replay)
	}
	if e := s.provisionManaged(ctx, id); e != nil {
		t.Fatal(e)
	}
	code, out = request(t, ts, session, "POST", "/api/v1/git-tokens", map[string]any{"name": "CLI", "repositoryId": id, "scopes": []string{"repo:read", "repo:write"}, "expiresAt": time.Now().Add(time.Hour)}, "git-pat")
	if code != 201 {
		t.Fatalf("token %d %v", code, out)
	}
	pat := out["token"].(string)
	patID := out["id"].(string)
	_, replay = request(t, ts, session, "POST", "/api/v1/git-tokens", map[string]any{"name": "CLI", "repositoryId": id, "scopes": []string{"repo:read", "repo:write"}, "expiresAt": time.Now().Add(time.Hour)}, "git-pat")
	if replay["token"] != nil {
		t.Fatal("PAT leaked on replay")
	}
	url := ts.URL + "/git/" + ns + "/sample.git"
	work := filepath.Join(t.TempDir(), "clone")
	git := func(success bool, args ...string) string {
		t.Helper()
		base := []string{"-c", "credential.helper=", "-c", "http.extraHeader=Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte("developer:"+pat))}
		c := exec.Command("git", append(base, args...)...)
		c.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
		b, e := c.CombinedOutput()
		if success && e != nil {
			t.Fatalf("git %v: %v %s", args, e, b)
		}
		if !success && e == nil {
			t.Fatalf("expected rejection %v %s", args, b)
		}
		return strings.TrimSpace(string(b))
	}
	git(true, "clone", url, work)
	git(true, "-C", work, "config", "user.name", "Test")
	git(true, "-C", work, "config", "user.email", "test@example.com")
	original := git(true, "-C", work, "rev-parse", "HEAD")
	for _, name := range []string{"A", "B"} {
		if e := os.WriteFile(filepath.Join(work, "notes.md"), []byte(name), 0600); e != nil {
			t.Fatal(e)
		}
		git(true, "-C", work, "add", ".")
		git(true, "-C", work, "commit", "-m", name)
		git(true, "-C", work, "push", "origin", "main")
	}
	latest := git(true, "-C", work, "rev-parse", "HEAD")
	s.hostingTick(ctx)
	var count int
	if e := s.DB.QueryRow(ctx, "SELECT count(*) FROM repository_ref_events WHERE repository_id=$1 AND source='hook'", id).Scan(&count); e != nil || count != 2 {
		t.Fatalf("push event count %d %v", count, e)
	}
	s.hostingTick(ctx)
	// Build both pinned pushes using the same existing pipeline, never the moving HEAD.
	rows, e := s.DB.Query(ctx, "SELECT DISTINCT new_oid FROM repository_ref_events WHERE repository_id=$1", id)
	if e != nil {
		t.Fatal(e)
	}
	oids := []string{}
	for rows.Next() {
		var oid string
		rows.Scan(&oid)
		oids = append(oids, oid)
	}
	rows.Close()
	for _, oid := range oids {
		if e = s.build(ctx, id, oid); e != nil {
			t.Fatal(e)
		}
	}
	if e = s.build(ctx, id, latest); e != nil {
		t.Fatal(e)
	}
	s.DB.QueryRow(ctx, "SELECT count(*) FROM pipeline_runs WHERE repository_id=$1", id).Scan(&count)
	if count != 3 {
		t.Fatalf("expected exactly 3 fixed commit builds, got %d", count)
	}
	git(true, "-C", work, "fetch", "origin")
	git(true, "-C", work, "tag", "v1")
	git(true, "-C", work, "push", "--atomic", "origin", "main", "v1")
	git(false, "-C", work, "push", "--force", "origin", original+":main")
	git(false, "-C", work, "push", "origin", ":main")
	// pre-receive rejects a complete multi-ref push, including the otherwise valid branch.
	git(true, "-C", work, "branch", "safe")
	git(false, "-C", work, "push", "--atomic", "--force", "origin", "safe", original+":main")
	git(true, "-C", work, "checkout", "-b", "unsafe")
	os.Symlink("/etc/passwd", filepath.Join(work, "escape"))
	git(true, "-C", work, "add", "escape")
	git(true, "-C", work, "commit", "-m", "unsafe")
	git(false, "-C", work, "push", "origin", "unsafe")
	git(true, "-C", work, "checkout", "main")
	for _, view := range []string{"git", "refs", "commits", "tree", "diff", "events", "members"} {
		c, b := request(t, ts, session, "GET", "/api/v1/repositories/"+id+"/"+view, nil, "")
		if c != 200 {
			t.Fatalf("browse %s: %d %v", view, c, b)
		}
	}
	// Dropped hook event is recovered from refs and reflog; includes intermediate accepted pushes.
	git(true, "-C", work, "commit", "--allow-empty", "-m", "lost-event")
	git(true, "-C", work, "push", "origin", "main")
	files, _ := os.ReadDir(filepath.Join(s.Data, "git-spool"))
	for _, f := range files {
		if strings.HasSuffix(f.Name(), ".json") {
			os.Remove(filepath.Join(s.Data, "git-spool", f.Name()))
		}
	}
	if e = s.reconcileManaged(ctx, id); e != nil {
		t.Fatal(e)
	}
	lost := git(true, "-C", work, "rev-parse", "HEAD")
	s.DB.QueryRow(ctx, "SELECT count(*) FROM repository_ref_events WHERE repository_id=$1 AND new_oid=$2", id, lost).Scan(&count)
	if count < 1 {
		t.Fatal("reconciliation lost commit")
	}
	// No credentials, wrong scope, expired/revoked and delivery/session credentials cannot access Git.
	res, e := http.Get(url + "/info/refs?service=git-upload-pack")
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("anonymous", res.StatusCode)
	}
	code, _ = request(t, ts, session, "POST", "/api/v1/git-tokens/"+patID+"/revoke", nil, "")
	if code != 200 {
		t.Fatal("revoke", code)
	}
	git(false, "-C", work, "fetch", "origin")
	var storage string
	s.DB.QueryRow(ctx, "SELECT storage_id FROM repositories WHERE id=$1", id).Scan(&storage)
	dir, _ := s.managedPath(storage)
	if _, e = s.git(ctx, dir, "fsck", "--full"); e != nil {
		t.Fatal(e)
	}
	// TLS endpoint uses the same gateway with native Git HTTPS.
	tls := httptest.NewTLSServer(s.Router())
	defer tls.Close()
	cert := filepath.Join(t.TempDir(), "ca.pem")
	if e = os.WriteFile(cert, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: tls.Certificate().Raw}), 0600); e != nil {
		t.Fatal(e)
	}
	_, out = request(t, ts, session, "POST", "/api/v1/git-tokens", map[string]any{"name": "TLS", "repositoryId": id, "scopes": []string{"repo:read", "repo:write"}, "expiresAt": time.Now().Add(time.Hour)}, "")
	pat = out["token"].(string)
	tlsWork := filepath.Join(t.TempDir(), "tls-clone")
	git(true, "-c", "http.sslCAInfo="+cert, "clone", tls.URL+"/git/"+ns+"/sample.git", tlsWork)
	git(true, "-C", tlsWork, "config", "user.name", "TLS")
	git(true, "-C", tlsWork, "config", "user.email", "tls@example.com")
	git(true, "-C", tlsWork, "commit", "--allow-empty", "-m", "HTTPS push")
	git(true, "-c", "http.sslCAInfo="+cert, "-C", tlsWork, "push", "origin", "main")
	git(true, "-c", "http.sslCAInfo="+cert, "-C", tlsWork, "fetch", "origin")
	// Repository ACL is independent from organization-level maintainer and release roles.
	user, userSession := ID(), Token()
	if _, e = s.DB.Exec(ctx, "INSERT INTO users(id,org_id,subject) VALUES($1,$2,$3)", user, s.Org, user); e != nil {
		t.Fatal(e)
	}
	s.DB.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", protocol.Digest([]byte(userSession)), user)
	c, _ := request(t, ts, userSession, "GET", "/api/v1/repositories/"+id+"/tree", nil, "")
	if c != 404 {
		t.Fatalf("nonmember tree status %d", c)
	}
	c, _ = request(t, ts, session, "PUT", "/api/v1/repositories/"+id+"/members", map[string]string{"userId": user, "accessRole": "contributor"}, "")
	if c != 200 {
		t.Fatal("member", c)
	}
	c, out = request(t, ts, userSession, "POST", "/api/v1/git-tokens", map[string]any{"name": "Contributor", "repositoryId": id, "scopes": []string{"repo:read", "repo:write"}, "expiresAt": time.Now().Add(time.Hour)}, "")
	if c != 201 {
		t.Fatal("contributor token", c, out)
	}
	pat = out["token"].(string)
	git(true, "-C", work, "fetch", "origin")
	git(true, "-C", work, "reset", "--hard", "origin/main")
	git(true, "-C", work, "commit", "--allow-empty", "-m", "contribution")
	git(false, "-C", work, "push", "origin", "main")
	git(true, "-C", work, "push", "origin", "HEAD:refs/heads/contribution")
	c, _ = request(t, ts, userSession, "PATCH", "/api/v1/repositories/"+id+"/policies", defaultHostingPolicy("refs/heads/main"), "")
	if c != 403 {
		t.Fatal("contributor policy", c)
	}
	c, _ = request(t, ts, session, "PUT", "/api/v1/repositories/"+id+"/members", map[string]string{"userId": user, "accessRole": "viewer"}, "")
	if c != 200 {
		t.Fatal(c)
	}
	git(false, "-C", work, "push", "origin", "HEAD:refs/heads/viewer")
	git(true, "-C", work, "fetch", "origin")
	s.DB.Exec(ctx, "UPDATE git_access_tokens SET expires_at=now()-interval '1 minute' WHERE owner_user_id=$1", user)
	git(false, "-C", work, "fetch", "origin")
	pat = session
	git(false, "-C", work, "fetch", "origin")
	// Read-only scope rejects receive-pack even for an administrator.
	_, out = request(t, ts, session, "POST", "/api/v1/git-tokens", map[string]any{"name": "Read only", "repositoryId": id, "scopes": []string{"repo:read"}, "expiresAt": time.Now().Add(time.Hour)}, "")
	pat = out["token"].(string)
	git(true, "-C", work, "fetch", "origin")
	git(false, "-C", work, "push", "origin", "HEAD:refs/heads/read-only")

	_, out = request(t, ts, session, "POST", "/api/v1/git-tokens", map[string]any{"name": "Quota", "repositoryId": id, "scopes": []string{"repo:read", "repo:write"}, "expiresAt": time.Now().Add(time.Hour)}, "")
	pat = out["token"].(string)
	policy := defaultHostingPolicy("refs/heads/main")
	policy.MaxFileBytes = 1024
	c, _ = request(t, ts, session, "PATCH", "/api/v1/repositories/"+id+"/policies", policy, "")
	if c != 200 {
		t.Fatal("policy", c)
	}
	if e = os.WriteFile(filepath.Join(work, "oversized.md"), []byte(strings.Repeat("too big\n", 500)), 0600); e != nil {
		t.Fatal(e)
	}
	git(true, "-C", work, "add", ".")
	git(true, "-C", work, "commit", "-m", "oversized object")
	git(false, "-C", work, "push", "origin", "HEAD:refs/heads/oversized")
	t.Setenv("SKIVA_MANAGED_GIT_WRITE_ENABLED", "false")
	git(false, "-C", work, "push", "origin", "HEAD:refs/heads/disabled")
	git(true, "-C", work, "fetch", "origin")
	for _, bad := range []string{"/git/" + ns + "%2fsample.git/info/refs?service=git-upload-pack", "/git/" + ns + "/sample.git/../config", "/git/" + ns + "/sample.git/HEAD"} {
		req, _ := http.NewRequest("GET", ts.URL+bad, nil)
		req.SetBasicAuth("user", pat)
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 404 {
			t.Fatal("unexpected Git path access", bad, response.StatusCode)
		}
	}

}

func TestManagedProvisionRecoveryAndFlags(t *testing.T) {
	s, ts, session := integration(t)
	ctx := context.Background()
	input := map[string]any{"name": "recovery-" + ID(), "sourceType": "managed", "namespace": "recover-" + strings.ReplaceAll(ID(), "-", "")[:12], "slug": "recover", "template": "empty"}
	t.Setenv("SKIVA_MANAGED_GIT_ENABLED", "false")
	code, _ := request(t, ts, session, "POST", "/api/v1/repositories", input, "")
	if code != 503 {
		t.Fatal("feature gate", code)
	}
	t.Setenv("SKIVA_MANAGED_GIT_ENABLED", "true")
	code, out := request(t, ts, session, "POST", "/api/v1/repositories", input, "")
	if code != 202 {
		t.Fatal(code, out)
	}
	id := out["id"].(string)
	// Simulate read-only/unavailable storage with a file occupying the storage root.
	if e := os.WriteFile(filepath.Join(s.Data, "managed-git"), []byte("unavailable"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := s.provisionManaged(ctx, id); e == nil {
		t.Fatal("expected failed provisioning")
	}
	var state string
	s.DB.QueryRow(ctx, "SELECT provision_state FROM repositories WHERE id=$1", id).Scan(&state)
	if state != "failed" {
		t.Fatal(state)
	}
	os.Remove(filepath.Join(s.Data, "managed-git"))
	if e := s.provisionManaged(ctx, id); e != nil {
		t.Fatal(e)
	}
	// Crash after atomic rename and before DB active: replay must preserve the existing source directory.
	s.DB.Exec(ctx, "UPDATE repositories SET provision_state='provisioning' WHERE id=$1", id)
	if e := s.provisionManaged(ctx, id); e != nil {
		t.Fatal(e)
	}
	s.DB.QueryRow(ctx, "SELECT provision_state FROM repositories WHERE id=$1", id).Scan(&state)
	if state != "active" {
		t.Fatal(state)
	}
	var storage string
	s.DB.QueryRow(ctx, "SELECT storage_id FROM repositories WHERE id=$1", id).Scan(&storage)
	dir, _ := s.managedPath(storage)
	if _, e := s.git(ctx, dir, "fsck", "--full"); e != nil {
		t.Fatal(e)
	}
	code, _ = request(t, ts, session, "PATCH", "/api/v1/repositories/"+id, map[string]any{"sourceType": "external", "remoteUrl": "https://example.com/x.git"}, "")
	if code != 400 {
		t.Fatal("conversion allowed", code)
	}
	code, _ = request(t, ts, session, "DELETE", "/api/v1/repositories/"+id, nil, "")
	if code != 200 {
		t.Fatal(code)
	}
	if _, e := os.Stat(filepath.Join(dir, "HEAD")); e != nil {
		t.Fatal("soft delete removed source")
	}
}
