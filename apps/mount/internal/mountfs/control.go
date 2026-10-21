package mountfs

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func (v *View) ServeControl(ctx context.Context, cancel context.CancelFunc) error {
	if e := os.MkdirAll(v.Cache, 0700); e != nil {
		return e
	}
	socket := filepath.Join(v.Cache, "mount.sock")
	if _, e := os.Stat(socket); e == nil {
		return errors.New("mount control socket exists; use status/unmount or remove a confirmed stale socket")
	}
	l, e := net.Listen("unix", socket)
	if e != nil {
		return e
	}
	os.Chmod(socket, 0600)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) {
		idx := v.Current()
		json.NewEncoder(w).Encode(map[string]any{"mounted": true, "authorized": v.Authorized(), "index": idx, "cacheHits": v.Hits.Load(), "cacheMisses": v.Misses.Load()})
	})
	mux.HandleFunc("POST /refresh", func(w http.ResponseWriter, r *http.Request) {
		repin := r.URL.Query().Get("repin") == "true"
		if e := v.Refresh(r.Context(), repin); e != nil {
			http.Error(w, e.Error(), 503)
			return
		}
		json.NewEncoder(w).Encode(map[string]bool{"refreshed": true, "repinned": repin})
	})
	mux.HandleFunc("POST /unmount", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]bool{"unmounting": true})
		cancel()
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() { <-ctx.Done(); server.Close(); os.Remove(socket) }()
	go server.Serve(l)
	return nil
}
func Control(ctx context.Context, cache, method, path string) (map[string]any, error) {
	transport := &http.Transport{DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", filepath.Join(cache, "mount.sock"))
	}}
	client := &http.Client{Transport: transport, Timeout: 35 * time.Second}
	req, _ := http.NewRequestWithContext(ctx, method, "http://localhost"+path, nil)
	res, e := client.Do(req)
	if e != nil {
		return nil, e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, errors.New("mount control request failed")
	}
	var out map[string]any
	e = json.NewDecoder(res.Body).Decode(&out)
	return out, e
}
