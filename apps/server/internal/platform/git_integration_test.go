package platform

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIntegrationE03E04E06RealHTTPSGit(t *testing.T) {
	s, ts, admin := integration(t)
	ctx := context.Background()
	dir := t.TempDir()
	gitTest(t, dir, "init", "-b", "main")
	os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: sample\ndescription: Fixture\n---\n# Original\n"), 0600)
	gitTest(t, dir, "add", ".")
	gitTest(t, dir, "commit", "-m", "first")
	bare := filepath.Join(t.TempDir(), "skills.git")
	gitTest(t, dir, "clone", "--bare", dir, bare)
	gitTest(t, bare, "update-server-info")
	gitServer := httptest.NewTLSServer(http.FileServer(http.Dir(filepath.Dir(bare))))
	defer gitServer.Close()
	ca := filepath.Join(t.TempDir(), "ca.pem")
	os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: gitServer.Certificate().Raw}), 0600)
	t.Setenv("ESDP_GIT_CA_BUNDLE", ca)
	u, _ := url.Parse(gitServer.URL)
	s.AllowHosts = []string{u.Hostname()}
	t.Setenv("ESDP_TEST_WEBHOOK_SECRET", "fixture-secret")
	status, out := request(t, ts, admin, "POST", "/api/v1/repositories", map[string]any{"name": "fixture", "remoteUrl": gitServer.URL + "/skills.git", "defaultRef": "refs/heads/main", "skillRoot": "", "status": "active", "webhookSecretRef": "ESDP_TEST_WEBHOOK_SECRET"}, "")
	if status != 200 {
		t.Fatal(status, out)
	}
	repo := out["id"].(string)
	sha := gitTest(t, dir, "rev-parse", "HEAD")
	body, _ := json.Marshal(map[string]string{"ref": "refs/heads/main", "after": sha})
	mac := hmac.New(sha256.New, []byte("fixture-secret"))
	mac.Write(body)
	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest("POST", ts.URL+"/api/v1/webhooks/github/"+repo, bytes.NewReader(body))
		req.Header.Set("X-GitHub-Delivery", "delivery-1")
		req.Header.Set("X-Hub-Signature-256", "sha256="+hex.EncodeToString(mac.Sum(nil)))
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		res.Body.Close()
		if res.StatusCode != 202 {
			t.Fatal("webhook", res.StatusCode)
		}
	}
	var count int
	s.DB.QueryRow(ctx, "SELECT count(*) FROM webhook_deliveries WHERE repository_id=$1", repo).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate delivery", count)
	}
	if e := s.build(ctx, repo, sha); e != nil {
		t.Fatal(e)
	}
	if e := s.build(ctx, repo, sha); e != nil {
		t.Fatal(e)
	}
	s.DB.QueryRow(ctx, "SELECT count(*) FROM pipeline_runs WHERE repository_id=$1", repo).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate build", count)
	}
	var statusDB string
	s.DB.QueryRow(ctx, "SELECT status FROM pipeline_runs WHERE repository_id=$1", repo).Scan(&statusDB)
	if statusDB != "succeeded" {
		t.Fatal("scan failed", statusDB)
	}
	t.Setenv("ESDP_VALIDATOR_VERSION", "2")
	if e := s.build(ctx, repo, sha); e != nil {
		t.Fatal(e)
	}
	s.DB.QueryRow(ctx, "SELECT count(*) FROM pipeline_runs WHERE repository_id=$1", repo).Scan(&count)
	if count != 2 {
		t.Fatal("rule version not respected")
	}
	os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: sample\ndescription: Fixture\n---\n# Updated\n"), 0600)
	gitTest(t, dir, "add", ".")
	gitTest(t, dir, "commit", "-m", "second")
	gitTest(t, dir, "push", bare, "main")
	gitTest(t, bare, "update-server-info")
	s.reconcile(ctx)
	var queued int
	s.DB.QueryRow(ctx, "SELECT count(*) FROM job_queue WHERE payload->>'repositoryId'=$1", repo).Scan(&queued)
	if queued < 1 {
		t.Fatal("reconciliation did not queue")
	}
	if e := s.build(ctx, repo, ""); e != nil {
		t.Fatal(e)
	}
	var latest string
	s.DB.QueryRow(ctx, "SELECT last_commit_sha FROM repositories WHERE id=$1", repo).Scan(&latest)
	if latest != strings.TrimSpace(gitTest(t, dir, "rev-parse", "HEAD")) {
		t.Fatal("new commit not reconciled")
	}
}
