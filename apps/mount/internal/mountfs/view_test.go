package mountfs

import (
	"context"
	"encoding/json"
	"skiva/packages/protocol"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fixture(t testing.TB, mode, policy string) (*View, *atomic.Int64, *atomic.Bool, func()) {
	t.Helper()
	var generation atomic.Int64
	generation.Store(1)
	var revoke atomic.Bool
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if revoke.Load() {
			w.WriteHeader(403)
			return
		}
		switch {
		case strings.HasSuffix(r.URL.Path, "/profile"):
			json.NewEncoder(w).Encode(map[string]any{"id": "profile", "name": "agent", "consistencyMode": mode, "policy": map[string]any{"offline": policy, "leaseSeconds": 1}})
		case strings.HasSuffix(r.URL.Path, "/manifest"):
			content := "old"
			snapshot := "old-snapshot"
			if generation.Load() > 1 && r.URL.Query().Get("snapshotId") != "old-snapshot" {
				content = "new"
				snapshot = "new-snapshot"
			}
			files := []protocol.File{{Path: "skill/SKILL.md", Type: "file", Size: 3, Digest: protocol.Digest([]byte(content)), Mode: 0444}}
			b, _ := protocol.Canonical(files)
			json.NewEncoder(w).Encode(protocol.Manifest{SchemaVersion: 1, SnapshotID: snapshot, ProfileID: "profile", Generation: generation.Load(), ManifestDigest: protocol.Digest(b), Files: files})
		case strings.Contains(r.URL.Path, "/objects/"):
			content := "old"
			if strings.HasSuffix(r.URL.Path, protocol.Digest([]byte("new"))) {
				content = "new"
			}
			io.WriteString(w, content)
		default:
			io.WriteString(w, "{}")
		}
	}))
	v := New(s.URL, "token", "profile", mode, t.TempDir())
	if e := v.Refresh(context.Background(), false); e != nil {
		t.Fatal(e)
	}
	return v, &generation, &revoke, s.Close
}
func read(t *testing.T, h *Handle) string {
	t.Helper()
	b := make([]byte, 3)
	_, e := h.ReadAt(b, 0)
	if e != nil && e != io.EOF {
		t.Fatal(e)
	}
	return string(b)
}
func TestE11DynamicHandles(t *testing.T) {
	v, g, _, close := fixture(t, "dynamic", "allow_cached")
	defer close()
	h, e := v.Open(context.Background(), "skill/SKILL.md")
	if e != nil {
		t.Fatal(e)
	}
	g.Store(2)
	if e = v.Refresh(context.Background(), false); e != nil {
		t.Fatal(e)
	}
	next, _ := v.Open(context.Background(), "skill/SKILL.md")
	if read(t, h) != "old" || read(t, next) != "new" {
		t.Fatal("handle identity lost")
	}
}
func TestE12Pinned(t *testing.T) {
	v, g, _, close := fixture(t, "pinned", "allow_cached")
	defer close()
	g.Store(2)
	v.Refresh(context.Background(), false)
	h, _ := v.Open(context.Background(), "skill/SKILL.md")
	if read(t, h) != "old" {
		t.Fatal("pinned changed")
	}
	v.Refresh(context.Background(), true)
	h, _ = v.Open(context.Background(), "skill/SKILL.md")
	if read(t, h) != "new" {
		t.Fatal("repin failed")
	}
}
func TestE13Offline(t *testing.T) {
	for _, policy := range []string{"allow_cached", "deny_on_disconnect"} {
		t.Run(policy, func(t *testing.T) {
			v, _, _, close := fixture(t, "dynamic", policy)
			close()
			v.lastAuth.Store(time.Now().Add(-2 * time.Second).UnixNano())
			_, e := v.Open(context.Background(), "skill/SKILL.md")
			if (e == nil) != (policy == "allow_cached") {
				t.Fatalf("incorrect policy: %v", e)
			}
		})
	}
}
func TestE14RevocationStopsExistingHandles(t *testing.T) {
	v, _, revoked, close := fixture(t, "dynamic", "allow_cached")
	defer close()
	h, _ := v.Open(context.Background(), "skill/SKILL.md")
	revoked.Store(true)
	if v.Refresh(context.Background(), false) != ErrDenied {
		t.Fatal("expected revoked")
	}
	if _, e := h.ReadAt(make([]byte, 3), 0); e != ErrDenied {
		t.Fatal("old handle retained access")
	}
}
func TestCacheRestartAndCorruption(t *testing.T) {
	v, _, _, close := fixture(t, "dynamic", "allow_cached")
	cache := v.Cache
	server := v.Server
	close()
	restored := New(server, "token", "profile", "dynamic", cache)
	if e := restored.LoadVerifiedCache(); e != nil {
		t.Fatal(e)
	}
	h, e := restored.Open(context.Background(), "skill/SKILL.md")
	if e != nil || read(t, h) != "old" {
		t.Fatal("cache restart failed", e)
	}
	restored.revoke()
	again := New(server, "token", "profile", "dynamic", cache)
	if again.LoadVerifiedCache() != ErrDenied {
		t.Fatal("revoked credential resurrected")
	}
}
func TestConcurrentRefreshAndRead(t *testing.T) {
	v, g, _, close := fixture(t, "dynamic", "allow_cached")
	defer close()
	done := make(chan struct{})
	go func() {
		defer closeChan(done)
		for i := 0; i < 10; i++ {
			g.Store(int64(i%2 + 1))
			if e := v.Refresh(context.Background(), false); e != nil {
				t.Error(e)
			}
		}
	}()
	for i := 0; i < 30; i++ {
		h, e := v.Open(context.Background(), "skill/SKILL.md")
		if e != nil {
			t.Fatal(e)
		}
		got := read(t, h)
		if got != "old" && got != "new" {
			t.Fatal("mixed bytes")
		}
	}
	<-done
}
func closeChan(ch chan struct{}) { close(ch) }
func BenchmarkCachedOpen(b *testing.B) {
	for _, clients := range []int{10, 100} {
		b.Run(fmt.Sprint(clients, "-concurrent"), func(b *testing.B) {
			v, _, _, close := fixture(b, "dynamic", "allow_cached")
			defer close()
			previous := runtime.GOMAXPROCS(1)
			defer runtime.GOMAXPROCS(previous)
			b.SetParallelism(clients)
			b.ResetTimer()
			b.RunParallel(func(pb *testing.PB) {
				for pb.Next() {
					h, e := v.Open(context.Background(), "skill/SKILL.md")
					if e != nil {
						b.Fatal(e)
					}
					data := make([]byte, 3)
					h.ReadAt(data, 0)
					h.Close()
				}
			})
		})
	}
}
