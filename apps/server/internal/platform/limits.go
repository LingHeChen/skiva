package platform

import (
	"net"
	"net/http"
	"sync"
	"time"
)

type bucket struct {
	Count int
	Start time.Time
}

func rateLimit(next http.Handler) http.Handler {
	var mu sync.Mutex
	ips := map[string]bucket{}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		key := host
		limit := 600
		if r.URL.Path == "/api/v1/auth/login" {
			key += "login"
			limit = 20
		}
		mu.Lock()
		b := ips[key]
		if time.Since(b.Start) > time.Minute {
			b = bucket{Start: time.Now()}
		}
		b.Count++
		ips[key] = b
		if len(ips) > 10000 {
			for k, v := range ips {
				if time.Since(v.Start) > 2*time.Minute {
					delete(ips, k)
				}
			}
		}
		mu.Unlock()
		if b.Count > limit {
			w.Header().Set("Retry-After", "60")
			fail(w, r, 429, "RATE_LIMITED", "Too many requests; retry in one minute")
			return
		}
		next.ServeHTTP(w, r)
	})
}
