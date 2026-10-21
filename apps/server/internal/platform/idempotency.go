package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"skiva/packages/protocol"
	"github.com/jackc/pgx/v5"
	"io"
	"net/http"
	"strings"
)

type responseBuffer struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (b *responseBuffer) Header() http.Header { return b.header }
func (b *responseBuffer) WriteHeader(status int) {
	if b.status == 0 {
		b.status = status
	}
}
func (b *responseBuffer) Write(p []byte) (int, error) {
	if b.status == 0 {
		b.status = 200
	}
	return b.body.Write(p)
}
func (s *Server) idempotency(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		if key == "" || r.Method == "GET" || strings.Contains(r.URL.Path, "/auth/") || strings.Contains(r.URL.Path, "/channels/") || r.URL.Path == "/api/v1/me" || r.URL.Path == "/api/v1/settings" {
			next.ServeHTTP(w, r)
			return
		}
		if len(key) > 200 {
			fail(w, r, 400, "INVALID_IDEMPOTENCY_KEY", "Key must be at most 200 characters")
			return
		}
		body, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		if e != nil {
			fail(w, r, 400, "INVALID_BODY", "Request body exceeds limit")
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		hash := protocol.Digest(append([]byte(r.Method+" "+r.URL.Path+"\n"), body...))
		a := who(r)
		tx, e := s.DB.Begin(r.Context())
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		defer tx.Rollback(r.Context())
		if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", a.Org+a.ID+key); e != nil {
			s.dbError(w, r, e)
			return
		}
		var oldHash string
		var response []byte
		e = tx.QueryRow(r.Context(), "SELECT request_hash,response FROM idempotency_keys WHERE org_id=$1 AND actor_id=$2 AND key=$3", a.Org, a.ID, key).Scan(&oldHash, &response)
		if e == nil {
			if hash != oldHash {
				fail(w, r, 409, "IDEMPOTENCY_CONFLICT", "Key was used for a different request")
				return
			}
			var saved struct {
				Status int             `json:"status"`
				Body   json.RawMessage `json:"body"`
			}
			json.Unmarshal(response, &saved)
			jsonOut(w, saved.Status, saved.Body)
			return
		}
		if e != pgx.ErrNoRows {
			s.dbError(w, r, e)
			return
		}
		buf := &responseBuffer{header: http.Header{}}
		r = r.WithContext(context.WithValue(r.Context(), ctxKey("transaction"), tx))
		next.ServeHTTP(buf, r)
		if buf.status >= 200 && buf.status < 300 {
			storedBody := json.RawMessage(buf.body.Bytes())
			var fields map[string]any
			if json.Unmarshal(storedBody, &fields) == nil {
				if _, ok := fields["token"]; ok {
					delete(fields, "token")
					fields["notice"] = "Credential was already issued and is never stored. Rotate if it was not saved."
					storedBody = mustJSON(fields)
				}
			}
			saved := map[string]any{"status": buf.status, "body": storedBody}
			_, e = tx.Exec(r.Context(), "INSERT INTO idempotency_keys(org_id,actor_id,key,request_hash,response) VALUES($1,$2,$3,$4,$5)", a.Org, a.ID, key, hash, mustJSON(saved))
			if e == nil {
				e = tx.Commit(r.Context())
			}
			if e != nil {
				s.dbError(w, r, e)
				return
			}
		}
		for name, vals := range buf.header {
			w.Header()[name] = vals
		}
		w.WriteHeader(buf.status)
		w.Write(buf.body.Bytes())
	})
}
