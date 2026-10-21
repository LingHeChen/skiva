package platform

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"skiva/packages/protocol"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	DB         *pgxpool.Pool
	Data       string
	Org        string
	AllowHosts []string
	Production bool
	Origin     string
}
type actor struct {
	ID    string
	Org   string
	Roles []string
}
type ctxKey string

func ID() string { return uuid.Must(uuid.NewV7()).String() }
func Token() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func New(ctx context.Context) (*Server, error) {
	if hostingEnabled("ENABLED") && os.Getenv("SKIVA_ENV") == "production" && !validGitPublicURL(os.Getenv("SKIVA_GIT_PUBLIC_URL")) {
		return nil, errors.New("SKIVA_GIT_PUBLIC_URL must be an HTTPS origin for managed hosting")
	}
	db, e := pgxpool.New(ctx, env("SKIVA_DATABASE_URL", "postgres://skiva:skiva-dev@localhost:55432/skiva?sslmode=disable"))
	if e != nil {
		return nil, e
	}
	if e = db.Ping(ctx); e != nil {
		return nil, e
	}
	s := &Server{DB: db, Data: env("SKIVA_DATA_DIR", ".data"), AllowHosts: strings.FieldsFunc(os.Getenv("SKIVA_GIT_ALLOWLIST"), func(r rune) bool { return r == ',' }), Production: os.Getenv("SKIVA_ENV") == "production", Origin: env("SKIVA_WEB_ORIGIN", "http://localhost:3000")}
	e = os.MkdirAll(filepath.Join(s.Data, "objects"), 0700)
	return s, e
}
func jsonOut(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, r *http.Request, status int, code, msg string) {
	w.Header().Set("Cache-Control", "no-store")
	jsonOut(w, status, map[string]any{"error": map[string]any{"code": code, "message": msg, "requestId": r.Context().Value(ctxKey("requestId"))}})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, r, 400, "INVALID_INPUT", e.Error())
		return false
	}
	return true
}
func who(r *http.Request) actor { a, _ := r.Context().Value(ctxKey("actor")).(actor); return a }
func has(a actor, roles ...string) bool {
	for _, v := range a.Roles {
		if v == "org_admin" {
			return true
		}
		for _, r := range roles {
			if v == r {
				return true
			}
		}
	}
	return false
}
func (s *Server) dbError(w http.ResponseWriter, r *http.Request, e error) {
	slog.Error("database operation", "requestId", r.Context().Value(ctxKey("requestId")), "error", e)
	if errors.Is(e, pgx.ErrNoRows) {
		fail(w, r, 404, "NOT_FOUND", "Resource not found")
		return
	}
	var pg *pgconn.PgError
	if errors.As(e, &pg) {
		switch {
		case strings.HasPrefix(pg.Code, "22"):
			fail(w, r, 400, "INVALID_INPUT", "Invalid resource identifier or field value")
		case pg.Code == "23505":
			fail(w, r, 409, "RESOURCE_CONFLICT", "A resource with this identity already exists")
		case pg.Code == "23503" || pg.Code == "23514":
			fail(w, r, 422, "REFERENCE_INVALID", "Referenced resource or constraint is invalid")
		case pg.Code == "40001" || pg.Code == "40P01":
			fail(w, r, 409, "TRANSACTION_CONFLICT", "Concurrent change; refresh and retry")
		default:
			fail(w, r, 503, "DATABASE_UNAVAILABLE", "Database operation unavailable")
		}
		return
	}
	fail(w, r, 422, "OPERATION_FAILED", "Operation could not be completed; check resource state and diagnostics")
}
func audit(ctx context.Context, tx pgx.Tx, a actor, action, typ, id string, before, after any) error {
	b, _ := json.Marshal(before)
	c, _ := json.Marshal(after)
	_, e := tx.Exec(ctx, `INSERT INTO audit_logs(id,org_id,actor_type,actor_id,action,target_type,target_id,request_id,before_state,after_state) VALUES($1,$2,'user',$3,$4,$5,$6,$7,$8,$9)`, ID(), a.Org, a.ID, action, typ, id, ctx.Value(ctxKey("requestId")), b, c)
	if e != nil {
		auditFailures.Add(1)
	}
	return e
}
func (s *Server) transaction(r *http.Request, f func(pgx.Tx) error) error {
	if tx, ok := r.Context().Value(ctxKey("transaction")).(pgx.Tx); ok {
		return f(tx)
	}
	tx, e := s.DB.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if e = f(tx); e != nil {
		return e
	}
	return tx.Commit(r.Context())
}
func (s *Server) put(b []byte) (string, error) {
	d := protocol.Digest(b)
	p := filepath.Join(s.Data, "objects", d[7:])
	if old, e := os.ReadFile(p); e == nil {
		if protocol.Digest(old) != d {
			return "", errors.New("CAS corruption")
		}
		return d, nil
	}
	f, e := os.CreateTemp(filepath.Dir(p), ".write-")
	if e != nil {
		return "", e
	}
	defer os.Remove(f.Name())
	if _, e = f.Write(b); e != nil {
		f.Close()
		return "", e
	}
	if e = f.Sync(); e != nil {
		f.Close()
		return "", e
	}
	f.Close()
	if e = os.Link(f.Name(), p); e != nil && !os.IsExist(e) {
		return "", e
	}
	if dir, err := os.Open(filepath.Dir(p)); err == nil {
		err = dir.Sync()
		dir.Close()
		if err != nil {
			return "", err
		}
	}
	return d, nil
}
func (s *Server) get(d string) ([]byte, error) {
	if !protocol.ValidDigest(d) {
		return nil, errors.New("invalid digest")
	}
	b, e := os.ReadFile(filepath.Join(s.Data, "objects", d[7:]))
	if e == nil && protocol.Digest(b) != d {
		e = errors.New("CAS integrity failure")
	}
	return b, e
}
func (s *Server) list(w http.ResponseWriter, r *http.Request, query string, args ...any) {
	limit := 50
	if n, e := strconv.Atoi(r.URL.Query().Get("limit")); e == nil && n > 0 && n <= 200 {
		limit = n
	}
	cursor := ""
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		b, e := base64.RawURLEncoding.DecodeString(raw)
		if e != nil {
			fail(w, r, 400, "INVALID_CURSOR", "Invalid pagination cursor")
			return
		}
		cursor = string(b)
	}
	n := len(args)
	query = fmt.Sprintf("SELECT item FROM (%s) AS results(item) WHERE ($%d='' OR item->>'id'<$%d) ORDER BY item->>'id' DESC LIMIT $%d", query, n+1, n+1, n+2)
	args = append(args, cursor, limit+1)
	rows, e := s.DB.Query(r.Context(), query, args...)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	defer rows.Close()
	items := []json.RawMessage{}
	for rows.Next() {
		var b []byte
		if e = rows.Scan(&b); e != nil {
			s.dbError(w, r, e)
			return
		}
		items = append(items, b)
	}
	if e = rows.Err(); e != nil {
		s.dbError(w, r, e)
		return
	}
	var next any
	if len(items) > limit {
		items = items[:limit]
		var last struct {
			ID string `json:"id"`
		}
		json.Unmarshal(items[len(items)-1], &last)
		next = base64.RawURLEncoding.EncodeToString([]byte(last.ID))
	}
	jsonOut(w, 200, map[string]any{"items": items, "nextCursor": next})

}
func (s *Server) one(w http.ResponseWriter, r *http.Request, q string, args ...any) {
	var b []byte
	e := s.DB.QueryRow(r.Context(), q, args...).Scan(&b)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, json.RawMessage(b))
}
func now() string { return time.Now().UTC().Format(time.RFC3339) }
func require(ok bool, msg string) error {
	if !ok {
		return fmt.Errorf("%s", msg)
	}
	return nil
}
