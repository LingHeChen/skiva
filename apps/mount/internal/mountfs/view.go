package mountfs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"skiva/packages/protocol"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var ErrDenied = errors.New("authorization unavailable or revoked")

type Index struct {
	Manifest protocol.Manifest
	Files    map[string]protocol.File
}
type View struct {
	refs                                        map[string]int
	Server, Token, Profile, Mode, Policy, Cache string
	HTTP                                        *http.Client
	current                                     atomic.Pointer[Index]
	mu                                          sync.Mutex
	authorized                                  atomic.Bool
	policy                                      atomic.Pointer[authorizationPolicy]
	lastAuth                                    atomic.Int64
	Lease                                       time.Duration
	Snapshot                                    string
	Hits                                        atomic.Int64
	Misses                                      atomic.Int64
}

func New(server, token, profile, mode, cache string) *View {
	v := &View{Server: strings.TrimRight(server, "/"), Token: token, Profile: profile, Mode: mode, Cache: cache, Policy: "deny_on_disconnect", Lease: 60 * time.Second, HTTP: &http.Client{Timeout: 30 * time.Second}}
	return v
}
func (v *View) request(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	u, parseErr := url.Parse(v.Server)
	if parseErr != nil || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"))) {
		return nil, errors.New("HTTPS required outside loopback development")
	}
	req, e := http.NewRequestWithContext(ctx, method, v.Server+"/distribution/v1"+path, bytes.NewReader(body))
	if e != nil {
		return nil, e
	}
	req.Header.Set("Authorization", "Bearer "+v.Token)
	req.Header.Set("Content-Type", "application/json")
	resp, e := v.HTTP.Do(req)
	if e != nil {
		return nil, e
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		v.revoke()
		return nil, ErrDenied
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("distribution request returned %d", resp.StatusCode)
	}
	b, e := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	return b, e
}
func (v *View) Refresh(ctx context.Context, repin bool) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	b, e := v.request(ctx, "GET", "/profile", nil)
	if e != nil {
		return e
	}
	var p struct {
		ID     string `json:"id"`
		Name   string `json:"name"`
		Mode   string `json:"consistencyMode"`
		Policy struct {
			Offline      string `json:"offline"`
			LeaseSeconds int    `json:"leaseSeconds"`
		} `json:"policy"`
	}
	if e = json.Unmarshal(b, &p); e != nil {
		return e
	}
	if v.Profile != "" && v.Profile != p.ID && v.Profile != p.Name {
		return ErrDenied
	}
	if v.Mode != "" && v.Mode != p.Mode {
		return errors.New("Requested consistency mode differs from authoritative Profile")
	}
	v.Mode = p.Mode
	v.Policy = p.Policy.Offline
	v.Lease = time.Duration(p.Policy.LeaseSeconds) * time.Second
	v.policy.Store(&authorizationPolicy{v.Policy, v.Lease})
	v.authorized.Store(true)
	_ = os.Remove(filepath.Join(v.Cache, "revoked"))
	v.lastAuth.Store(time.Now().UnixNano())

	query := "/manifest?profileId=" + url.QueryEscape(p.ID)
	if v.Mode == "pinned" && v.current.Load() != nil && !repin {
		query += "&snapshotId=" + url.QueryEscape(v.current.Load().Manifest.SnapshotID)
	} else if v.Snapshot != "" {
		query += "&snapshotId=" + url.QueryEscape(v.Snapshot)
	}
	b, e = v.request(ctx, "GET", query, nil)
	if e != nil {
		return e
	}
	var m protocol.Manifest
	if e = json.Unmarshal(b, &m); e != nil {
		return e
	}
	if e = m.Validate(); e != nil {
		return e
	}
	idx := &Index{Manifest: m, Files: map[string]protocol.File{}}
	for _, f := range m.Files {
		idx.Files[f.Path] = f
		if _, e = v.blob(ctx, m.SnapshotID, f); e != nil {
			return e
		}
	}
	metadata, _ := json.Marshal(m)
	if e = atomicWrite(filepath.Join(v.Cache, "manifest.json"), metadata); e != nil {
		return e
	}
	if e = v.persist(m); e != nil {
		return e
	}
	v.current.Store(idx)
	return nil
}
func (v *View) Authorized() bool {
	if !v.authorized.Load() {
		return false
	}
	p := v.policy.Load()
	if p == nil {
		return false
	}
	return p.Offline == "allow_cached" || time.Since(time.Unix(0, v.lastAuth.Load())) <= p.Lease
}
func (v *View) Current() *Index { return v.current.Load() }
func (v *View) blob(ctx context.Context, snapshot string, f protocol.File) ([]byte, error) {
	if !protocol.ValidDigest(f.Digest) {
		return nil, errors.New("invalid digest")
	}
	p := filepath.Join(v.Cache, "objects", f.Digest[7:])
	if b, e := os.ReadFile(p); e == nil && int64(len(b)) == f.Size && protocol.Digest(b) == f.Digest {
		v.Hits.Add(1)
		return b, nil
	}
	v.Misses.Add(1)
	var last error
	for attempt := 0; attempt < 3; attempt++ {
		b, e := v.request(ctx, "GET", "/objects/"+f.Digest+"?snapshotId="+url.QueryEscape(snapshot), nil)
		if errors.Is(e, ErrDenied) {
			return nil, e
		}
		if e == nil {
			if int64(len(b)) != f.Size || protocol.Digest(b) != f.Digest {
				e = errors.New("blob hash or size mismatch")
			} else {
				if e = atomicWrite(p, b); e == nil {
					return b, nil
				}
			}
		}
		last = e
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(1<<attempt) * 100 * time.Millisecond):
		}
	}
	return nil, last
}
func atomicWrite(p string, b []byte) error {
	if e := os.MkdirAll(filepath.Dir(p), 0700); e != nil {
		return e
	}
	f, e := os.CreateTemp(filepath.Dir(p), ".download-")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(b); e != nil {
		f.Close()
		return e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = os.Rename(f.Name(), p); e != nil {
		return e
	}
	dir, e := os.Open(filepath.Dir(p))
	if e != nil {
		return e
	}
	defer dir.Close()
	return dir.Sync()
}

type Handle struct {
	once             sync.Once
	view             *View
	Snapshot, Digest string
	data             []byte
}

func (v *View) Open(ctx context.Context, path string) (*Handle, error) {
	if !v.Authorized() {
		return nil, ErrDenied
	}
	idx := v.current.Load()
	if idx == nil {
		return nil, errors.New("no verified manifest")
	}
	f, ok := idx.Files[path]
	if !ok {
		return nil, os.ErrNotExist
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	b, e := v.blob(ctx, idx.Manifest.SnapshotID, f)
	if e != nil {
		return nil, e
	}
	if v.refs == nil {
		v.refs = map[string]int{}
	}
	v.refs[f.Digest]++
	return &Handle{view: v, Snapshot: idx.Manifest.SnapshotID, Digest: f.Digest, data: b}, nil
}
func (h *Handle) ReadAt(p []byte, off int64) (int, error) {
	if !h.view.Authorized() {
		return 0, ErrDenied
	}
	return bytes.NewReader(h.data).ReadAt(p, off)
}
func (h *Handle) Close() {
	h.once.Do(func() {
		h.view.mu.Lock()
		defer h.view.mu.Unlock()
		h.view.refs[h.Digest]--
		if h.view.refs[h.Digest] <= 0 {
			delete(h.view.refs, h.Digest)
		}
	})
}
func (h *Handle) Size() int64 { return int64(len(h.data)) }
func (v *View) Entries(dir string) []string {
	idx := v.current.Load()
	if idx == nil {
		return nil
	}
	prefix := ""
	if dir != "" {
		prefix = dir + "/"
	}
	set := map[string]bool{}
	for p := range idx.Files {
		if strings.HasPrefix(p, prefix) {
			set[strings.SplitN(strings.TrimPrefix(p, prefix), "/", 2)[0]] = true
		}
	}
	names := []string{}
	for n := range set {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}
func (v *View) Heartbeat(ctx context.Context) error {
	idx := v.current.Load()
	if idx == nil {
		return nil
	}
	var size int64
	entries, _ := os.ReadDir(filepath.Join(v.Cache, "objects"))
	for _, entry := range entries {
		if info, e := entry.Info(); e == nil && info.Mode().IsRegular() {
			size += info.Size()
		}
	}
	b, _ := json.Marshal(map[string]any{"snapshotId": idx.Manifest.SnapshotID, "generation": idx.Manifest.Generation, "cacheBytes": size, "cacheHits": v.Hits.Load(), "cacheMisses": v.Misses.Load(), "version": "1.0.0", "status": "mounted"})
	_, e := v.request(ctx, "POST", "/clients/heartbeat", b)
	if e == nil {
		v.lastAuth.Store(time.Now().UnixNano())
	}
	return e
}
func (v *View) Run(ctx context.Context) {
	go v.events(ctx)
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_ = v.Refresh(ctx, false)
			_ = v.Heartbeat(ctx)
			_ = v.CollectCache(1 << 30)
		}
	}
}
func (v *View) events(ctx context.Context) {
	delay := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", v.Server+"/distribution/v1/events", nil)
		req.Header.Set("Authorization", "Bearer "+v.Token)
		client := &http.Client{Transport: v.HTTP.Transport}
		res, e := client.Do(req)
		if e == nil {
			if res.StatusCode == 401 || res.StatusCode == 403 {
				v.revoke()
				res.Body.Close()
				return
			}
			if res.StatusCode == 200 {
				consumeEvents(ctx, v, res.Body)
			}
			res.Body.Close()
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		if delay < 30*time.Second {
			delay *= 2
		}
	}
}
