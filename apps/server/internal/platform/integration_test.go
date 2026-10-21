package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"skiva/packages/protocol"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func integration(t *testing.T) (*Server, *httptest.Server, string) {
	t.Helper()
	dsn := os.Getenv("SKIVA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("SKIVA_TEST_DATABASE_URL required")
	}
	db, e := pgxpool.New(context.Background(), dsn)
	if e != nil {
		t.Fatal(e)
	}
	s := &Server{DB: db, Data: t.TempDir()}
	os.MkdirAll(filepath.Join(s.Data, "objects"), 0700)
	org, user, token := ID(), ID(), Token()
	_, e = db.Exec(context.Background(), "INSERT INTO organizations(id,name) VALUES($1,'Integration')", org)
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(context.Background(), "INSERT INTO users(id,org_id,subject,email) VALUES($1,$2,$3,'test@example.com')", user, org, user)
	if e != nil {
		t.Fatal(e)
	}
	db.Exec(context.Background(), "INSERT INTO role_bindings(id,org_id,user_id,role) VALUES($1,$2,$3,'org_admin')", ID(), org, user)
	db.Exec(context.Background(), "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", protocol.Digest([]byte(token)), user)
	s.Org = org
	ts := httptest.NewServer(s.Router())
	t.Cleanup(func() { ts.Close(); db.Close() })
	return s, ts, token
}
func request(t *testing.T, ts *httptest.Server, token, method, path string, body any, key string) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(method, ts.URL+path, bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+token)
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	var out map[string]any
	json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}
func fixtureVersion(t *testing.T, s *Server, name, content string) string {
	t.Helper()
	ctx := context.Background()
	repo, run, skill, version := ID(), ID(), ID(), ID()
	digest, e := s.put([]byte(content))
	if e != nil {
		t.Fatal(e)
	}
	files := []protocol.File{{Path: "SKILL.md", Type: "file", Size: int64(len(content)), Digest: digest, Mode: 0444}}
	b, _ := protocol.Canonical(files)
	statements := []struct {
		q string
		a []any
	}{{"INSERT INTO repositories(id,org_id,name,remote_url) VALUES($1,$2,$3,'https://example.com/repo')", []any{repo, s.Org, repo}}, {"INSERT INTO pipeline_runs(id,repository_id,commit_sha,config_digest,validator_version,status) VALUES($1,$2,$3,'config','1','succeeded')", []any{run, repo, fmt.Sprintf("%040d", 1)}}, {"INSERT INTO skills(id,org_id,repository_id,relative_path,canonical_name) VALUES($1,$2,$3,'.',$4)", []any{skill, s.Org, repo, name}}, {"INSERT INTO skill_versions(id,skill_id,pipeline_id,commit_sha,content_digest,manifest_digest,metadata) VALUES($1,$2,$3,$4,$5,$5,$6)", []any{version, skill, run, fmt.Sprintf("%040d", 1), protocol.Digest(b), mustJSON(map[string]any{"name": name, "files": files, "diagnostics": []Diagnostic{}})}}}
	for _, st := range statements {
		if _, e = s.DB.Exec(ctx, st.q, st.a...); e != nil {
			t.Fatal(e)
		}
	}
	return version
}
func TestIntegrationE07E08E09E10E14E18E20(t *testing.T) {
	s, ts, token := integration(t)
	ctx := context.Background()
	v1 := fixtureVersion(t, s, "sample", "old")
	v2 := fixtureVersion(t, s, "sample", "new")
	snapshots := []string{}
	for _, v := range []string{v1, v2} {
		status, out := request(t, ts, token, "POST", "/api/v1/releases", map[string]any{"versionIds": []string{v}}, "")
		if status != 201 {
			t.Fatalf("release %d %+v", status, out)
		}
		snapshots = append(snapshots, out["id"].(string))
	}
	channel := ID()
	_, e := s.DB.Exec(ctx, "INSERT INTO channels(id,org_id,name) VALUES($1,$2,'stable')", channel, s.Org)
	if e != nil {
		t.Fatal(e)
	}
	body := map[string]any{"snapshotId": snapshots[0], "expectedGeneration": 0, "reason": "initial"}
	status, out := request(t, ts, token, "POST", "/api/v1/channels/"+channel+"/promote", body, "first")
	if status != 200 {
		t.Fatalf("promote %d %+v", status, out)
	}
	status, out = request(t, ts, token, "POST", "/api/v1/channels/"+channel+"/promote", body, "first")
	if status != 200 || out["generation"] != float64(1) {
		t.Fatal("idempotency failed", status, out)
	}
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			code, _ := request(t, ts, token, "POST", "/api/v1/channels/"+channel+"/promote", map[string]any{"snapshotId": snapshots[1], "expectedGeneration": 1, "reason": "concurrent"}, fmt.Sprint("concurrent", i))
			codes <- code
		}(i)
	}
	wg.Wait()
	close(codes)
	ok, conflict := 0, 0
	for code := range codes {
		if code == 200 {
			ok++
		}
		if code == 409 {
			conflict++
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatal("lost concurrent update", ok, conflict)
	}
	status, out = request(t, ts, token, "POST", "/api/v1/channels/"+channel+"/rollback", map[string]any{"snapshotId": snapshots[0], "expectedGeneration": 2, "reason": "rollback test"}, "rollback")
	if status != 200 {
		t.Fatal(status, out)
	}
	status, out = request(t, ts, token, "POST", "/api/v1/agent-profiles", map[string]any{"name": "agent", "channelId": channel, "consistencyMode": "dynamic", "offlinePolicy": "allow_cached", "skills": []string{"sample"}, "enabled": true}, "")
	if status != 200 {
		t.Fatal(status, out)
	}
	profile := out["id"].(string)
	status, out = request(t, ts, token, "PATCH", "/api/v1/agent-profiles/"+profile, map[string]any{"name": "renamed-agent"}, "")
	if status != 200 {
		t.Fatal("partial profile patch", status, out)
	}
	var before, after string
	if e := s.DB.QueryRow(context.Background(), "SELECT before_state->>'name',after_state->>'name' FROM audit_logs WHERE org_id=$1 AND target_id=$2 AND before_state IS NOT NULL ORDER BY created_at DESC LIMIT 1", s.Org, profile).Scan(&before, &after); e != nil || before != "agent" || after != "renamed-agent" {
		t.Fatal("profile audit state", before, after, e)
	}
	status, out = request(t, ts, token, "GET", "/api/v1/agent-profiles/"+profile, nil, "")
	if status != 200 || out["enabled"] != true || out["channelId"] != channel {
		t.Fatal("partial patch lost fields", out)
	}

	status, out = request(t, ts, token, "POST", "/api/v1/mount-clients", map[string]any{"name": "test", "profileId": profile}, "")
	if status != 201 {
		t.Fatal(status, out)
	}
	clientID, clientToken := out["id"].(string), out["token"].(string)
	status, out = request(t, ts, clientToken, "GET", "/distribution/v1/manifest", nil, "")
	if status != 200 || out["snapshotId"] != snapshots[0] {
		t.Fatal(status, out)
	}
	status, _ = request(t, ts, clientToken, "GET", "/api/v1/repositories", nil, "")
	if status != 401 {
		t.Fatal("client accessed admin API")
	}
	status, _ = request(t, ts, clientToken, "GET", "/distribution/v1/objects/"+protocol.Digest([]byte("new"))+"?snapshotId="+snapshots[0], nil, "")
	if status != 403 {
		t.Fatal("digest theft allowed")
	}
	status, out = request(t, ts, token, "POST", "/api/v1/mount-clients/"+clientID+"/rotate", map[string]any{}, "")
	if status != 200 {
		t.Fatal(status, out)
	}
	newToken := out["token"].(string)
	status, _ = request(t, ts, clientToken, "GET", "/distribution/v1/manifest", nil, "")
	if status != 403 {
		t.Fatal("old credential works")
	}
	status, _ = request(t, ts, newToken, "GET", "/distribution/v1/manifest", nil, "")
	if status != 200 {
		t.Fatal("new credential fails")
	}
	request(t, ts, token, "POST", "/api/v1/mount-clients/"+clientID+"/revoke", map[string]any{}, "")
	status, _ = request(t, ts, newToken, "GET", "/distribution/v1/manifest", nil, "")
	if status != 403 {
		t.Fatal("revoked credential works")
	}
	var audits int
	s.DB.QueryRow(ctx, "SELECT count(*) FROM audit_logs WHERE org_id=$1", s.Org).Scan(&audits)
	if audits < 8 {
		t.Fatal("missing audit trail", audits)
	}
	if _, e = s.DB.Exec(ctx, "UPDATE audit_logs SET action='tamper' WHERE org_id=$1", s.Org); e == nil {
		t.Fatal("audit mutation accepted")
	}
}
func TestIntegrationRBACOrganizationsPaginationAndIdempotency(t *testing.T) {
	s, ts, admin := integration(t)
	ctx := context.Background()
	roles := []string{"repo_maintainer", "release_manager", "agent_manager", "auditor"}
	for _, role := range roles {
		user, token := ID(), Token()
		s.DB.Exec(ctx, "INSERT INTO users(id,org_id,subject) VALUES($1,$2,$3)", user, s.Org, user)
		s.DB.Exec(ctx, "INSERT INTO role_bindings(id,org_id,user_id,role) VALUES($1,$2,$3,$4)", ID(), s.Org, user, role)
		s.DB.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", protocol.Digest([]byte(token)), user)
		status, _ := request(t, ts, token, "PATCH", "/api/v1/settings", map[string]any{"name": "hacked", "policy": map[string]any{}}, "")
		if status != 403 {
			t.Fatalf("%s changed settings: %d", role, status)
		}
		if role != "release_manager" {
			status, _ = request(t, ts, token, "POST", "/api/v1/releases", map[string]any{"versionIds": []string{}}, "")
			if status != 403 {
				t.Fatalf("%s created release: %d", role, status)
			}
		}
	}
	v := fixtureVersion(t, s, "sample", "bytes")
	body := map[string]any{"versionIds": []string{v}}
	status, out := request(t, ts, admin, "POST", "/api/v1/releases", body, "create-release-once")
	if status != 201 {
		t.Fatal(status, out)
	}
	status, again := request(t, ts, admin, "POST", "/api/v1/releases", body, "create-release-once")
	if status != 201 || out["id"] != again["id"] {
		t.Fatal("creation idempotency failed", status, again)
	}
	status, _ = request(t, ts, admin, "POST", "/api/v1/releases", map[string]any{"versionIds": []string{}}, "create-release-once")
	if status != 409 {
		t.Fatal("key reuse accepted")
	}
	for i := 0; i < 5; i++ {
		id := ID()
		s.DB.Exec(ctx, "INSERT INTO repositories(id,org_id,name,remote_url) VALUES($1,$2,$3,'https://example.com/repo')", id, s.Org, id)
	}
	status, first := request(t, ts, admin, "GET", "/api/v1/repositories?limit=2", nil, "")
	if status != 200 || len(first["items"].([]any)) != 2 || first["nextCursor"] == nil {
		t.Fatal("pagination failed", status, first)
	}
	status, second := request(t, ts, admin, "GET", "/api/v1/repositories?limit=2&cursor="+first["nextCursor"].(string), nil, "")
	if status != 200 || first["items"].([]any)[0].(map[string]any)["id"] == second["items"].([]any)[0].(map[string]any)["id"] {
		t.Fatal("cursor repeated first page")
	}
	otherOrg, otherUser := ID(), ID()
	s.DB.Exec(ctx, "INSERT INTO organizations(id,name) VALUES($1,'Other')", otherOrg)
	s.DB.Exec(ctx, "INSERT INTO users(id,org_id,subject) VALUES($1,$2,$3)", otherUser, otherOrg, otherUser)
	if _, e := s.DB.Exec(ctx, "INSERT INTO role_bindings(id,org_id,user_id,role) VALUES($1,$2,$3,'org_admin')", ID(), s.Org, otherUser); e == nil {
		t.Fatal("cross organization role reference accepted")
	}
}
func TestIntegrationCanaryOfflineAndCorruption(t *testing.T) {
	s, ts, token := integration(t)
	ctx := context.Background()
	v := fixtureVersion(t, s, "sample", "immutable bytes")
	_, release := request(t, ts, token, "POST", "/api/v1/releases", map[string]any{"versionIds": []string{v}}, "")
	snapshot := release["id"].(string)
	stable, canary := ID(), ID()
	for name, id := range map[string]string{"stable": stable, "canary": canary} {
		if _, e := s.DB.Exec(ctx, "INSERT INTO channels(id,org_id,name) VALUES($1,$2,$3)", id, s.Org, name); e != nil {
			t.Fatal(e)
		}
	}
	code, out := request(t, ts, token, "POST", "/api/v1/channels/"+canary+"/promote", map[string]any{"snapshotId": snapshot, "expectedGeneration": 0, "reason": "canary"}, "canary")
	if code != 200 {
		t.Fatal(code, out)
	}
	var unchanged bool
	s.DB.QueryRow(ctx, "SELECT active_snapshot_id IS NULL AND generation=0 FROM channels WHERE id=$1", stable).Scan(&unchanged)
	if !unchanged {
		t.Fatal("canary changed stable")
	}
	_, p := request(t, ts, token, "POST", "/api/v1/agent-profiles", map[string]any{"name": "canary", "channelId": canary, "consistencyMode": "dynamic", "offlinePolicy": "allow_cached", "skills": []string{"sample"}, "enabled": true}, "")
	_, client := request(t, ts, token, "POST", "/api/v1/mount-clients", map[string]any{"name": "offline", "profileId": p["id"]}, "client-idempotent")
	clientToken := client["token"].(string)
	code, replayed := request(t, ts, token, "POST", "/api/v1/mount-clients", map[string]any{"name": "offline", "profileId": p["id"]}, "client-idempotent")
	if code != 201 || replayed["token"] != nil || replayed["id"] != client["id"] {
		t.Fatal("credential replay not safe")
	}
	s.DB.Exec(ctx, "UPDATE repositories SET remote_url='https://offline.invalid/repo',deleted_at=now(),status='disabled' WHERE org_id=$1", s.Org)
	code, _ = request(t, ts, clientToken, "GET", "/distribution/v1/manifest", nil, "")
	if code != 200 {
		t.Fatal("source offline affects snapshot")
	}
	digest := protocol.Digest([]byte("immutable bytes"))
	req, _ := http.NewRequest("GET", ts.URL+"/distribution/v1/objects/"+digest+"?snapshotId="+snapshot, nil)
	req.Header.Set("Authorization", "Bearer "+clientToken)
	req.Header.Set("Range", "bytes=0-3")
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	res.Body.Close()
	if res.StatusCode != 206 {
		t.Fatal("range response", res.StatusCode)
	}
	os.WriteFile(filepath.Join(s.Data, "objects", digest[7:]), []byte("tampered"), 0600)
	code, _ = request(t, ts, clientToken, "GET", "/distribution/v1/objects/"+digest+"?snapshotId="+snapshot, nil, "")
	if code != 503 {
		t.Fatal("corrupt bytes delivered", code)
	}
	code, _ = request(t, ts, token, "POST", "/api/v1/channels/"+stable+"/promote", map[string]any{"snapshotId": snapshot, "expectedGeneration": 0, "reason": "must fail integrity"}, "bad-blob")
	if code < 400 {
		t.Fatal("corrupt release promoted")
	}
}
