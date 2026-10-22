package platform

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"
)

func TestDistributionDatabaseFailureIsTransient(t *testing.T) {
	dsn := os.Getenv("SKIVA_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("SKIVA_TEST_DATABASE_URL required")
	}
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	db.Close() // An unavailable DB must never masquerade as a revoked credential.
	s := &Server{DB: db}
	req := httptest.NewRequest("GET", "/distribution/v1/manifest", nil)
	rec := httptest.NewRecorder()
	s.clientAuth(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Fatal("authenticated") })).ServeHTTP(rec, req)
	if rec.Code != 503 {
		t.Fatalf("got %d: %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	s.events(rec, req)
	if rec.Body.String() != "event: unavailable\ndata: {}\n\n" {
		t.Fatal(rec.Body.String())
	}
}

func TestPythonSDKDistribution(t *testing.T) {
	python := os.Getenv("SKIVA_SDK_PYTHON")
	if python == "" {
		t.Skip("SKIVA_SDK_PYTHON required for real Python SDK integration")
	}
	s, ts, token := integration(t)
	snapshots := []string{}
	for _, version := range []string{"A", "B"} {
		id := fixtureVersion(t, s, "sample", "---\nname: sample\ndescription: Test distribution\n---\nVersion "+version+"\n")
		status, out := request(t, ts, token, "POST", "/api/v1/releases", map[string]any{"versionIds": []string{id}}, "")
		if status != 201 {
			t.Fatal(status, out)
		}
		snapshots = append(snapshots, out["id"].(string))
	}
	channel := ID()
	if _, err := s.DB.Exec(context.Background(), "INSERT INTO channels(id,org_id,name) VALUES($1,$2,'sdk')", channel, s.Org); err != nil {
		t.Fatal(err)
	}
	status, out := request(t, ts, token, "POST", "/api/v1/agent-profiles", map[string]any{"name": "sdk", "channelId": channel, "consistencyMode": "dynamic", "offlinePolicy": "deny_on_disconnect", "skills": []string{"sample"}, "enabled": true}, "")
	if status != 200 {
		t.Fatal(status, out)
	}
	profile := out["id"].(string)
	status, out = request(t, ts, token, "POST", "/api/v1/mount-clients", map[string]any{"name": "python", "profileId": profile}, "")
	if status != 201 {
		t.Fatal(status, out)
	}
	config, _ := json.Marshal(map[string]any{"server": ts.URL, "admin": token, "token": out["token"], "client": out["id"], "profile": profile, "channel": channel, "snapshots": snapshots})
	cmd := exec.Command(python, "../../../../tests/sdk_distribution_e2e.py")
	cmd.Env = append(os.Environ(), "SKIVA_E2E_CONFIG="+string(config))
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Python SDK: %v\n%s", err, output)
	}
	t.Log(string(output))
}

func TestSnapshotGrantRetention(t *testing.T) {
	t.Setenv("SKIVA_SNAPSHOT_GRANT_TTL_SECONDS", "3600")
	s, ts, admin := integration(t)
	ctx := context.Background()
	snapshots := []string{}
	for _, content := range []string{"A", "B"} {
		version := fixtureVersion(t, s, "sample", content)
		code, out := request(t, ts, admin, "POST", "/api/v1/releases", map[string]any{"versionIds": []string{version}}, "")
		if code != 201 {
			t.Fatal(code, out)
		}
		snapshots = append(snapshots, out["id"].(string))
	}
	channel := ID()
	_, err := s.DB.Exec(ctx, "INSERT INTO channels(id,org_id,name,active_snapshot_id) VALUES($1,$2,'retention',$3)", channel, s.Org, snapshots[0])
	if err != nil {
		t.Fatal(err)
	}
	code, out := request(t, ts, admin, "POST", "/api/v1/agent-profiles", map[string]any{"name": "retention", "channelId": channel, "consistencyMode": "dynamic", "offlinePolicy": "allow_cached", "skills": []string{"sample"}, "enabled": true}, "")
	if code != 200 {
		t.Fatal(code, out)
	}
	code, out = request(t, ts, admin, "POST", "/api/v1/mount-clients", map[string]any{"name": "retention", "profileId": out["id"]}, "")
	if code != 201 {
		t.Fatal(code, out)
	}
	id, token := out["id"], out["token"].(string)
	code, out = request(t, ts, token, "GET", "/distribution/v1/manifest", nil, "")
	if code != 200 {
		t.Fatal(code, out)
	}
	var finite bool
	if err = s.DB.QueryRow(ctx, "SELECT expires_at>now() FROM snapshot_grants WHERE client_id=$1 AND snapshot_id=$2", id, snapshots[0]).Scan(&finite); err != nil || !finite {
		t.Fatal(finite, err)
	}
	// Capture a conditional request; authorization must precede 304.
	req := httptest.NewRequest("GET", "/distribution/v1/manifest", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	if rec.Code != 304 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	_, err = s.DB.Exec(ctx, "UPDATE channels SET active_snapshot_id=$2 WHERE id=$1", channel, snapshots[1])
	if err != nil {
		t.Fatal(err)
	}
	// Unexpired historical snapshots remain readable.
	code, out = request(t, ts, token, "GET", "/distribution/v1/manifest?snapshotId="+snapshots[0], nil, "")
	if code != 200 {
		t.Fatal(code, out)
	}
	_, err = s.DB.Exec(ctx, "UPDATE snapshot_grants SET expires_at=now()-interval '1 second' WHERE client_id=$1", id)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest("GET", "/distribution/v1/manifest?snapshotId="+snapshots[0], nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatal("expired historical grant", rec.Code, rec.Body.String())
	}
	// Expiry does not disable the current target.
	code, out = request(t, ts, token, "GET", "/distribution/v1/manifest", nil, "")
	if code != 200 || out["snapshotId"] != snapshots[1] {
		t.Fatal(code, out)
	}
	t.Setenv("SKIVA_SNAPSHOT_GRANT_TTL_SECONDS", "invalid")
	code, _ = request(t, ts, token, "GET", "/distribution/v1/manifest", nil, "")
	if code != 503 {
		t.Fatal(code)
	}
}
