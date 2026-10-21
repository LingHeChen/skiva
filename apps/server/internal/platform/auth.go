package platform

import (
	"context"
	"encoding/json"
	"skiva/packages/protocol"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"strings"
	"time"
)

func (s *Server) Bootstrap(ctx context.Context) error {
	password := env("SKIVA_ADMIN_PASSWORD", "")
	if len(password) < 14 {
		return require(false, "SKIVA_ADMIN_PASSWORD must contain at least 14 characters")
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	org := env("SKIVA_ORG_ID", "019a03d8-0000-7000-8000-000000000001")
	e = tx.QueryRow(ctx, "SELECT id FROM organizations WHERE id=$1", org).Scan(&org)
	if e == pgx.ErrNoRows {
		_, e = tx.Exec(ctx, "INSERT INTO organizations(id,name) VALUES($1,'Enterprise Skills')", org)
		if e != nil {
			return e
		}
	} else if e != nil {
		return e
	}
	s.Org = org
	var exists bool
	e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM users WHERE org_id=$1)", org).Scan(&exists)
	if e != nil {
		return e
	}
	if !exists {
		hash, e := bcrypt.GenerateFromPassword([]byte(password), 12)
		if e != nil {
			return e
		}
		u := ID()
		_, e = tx.Exec(ctx, `INSERT INTO users(id,org_id,subject,email,display_name,password_hash) VALUES($1,$2,'local:admin',$3,'Administrator',$4)`, u, org, env("SKIVA_ADMIN_EMAIL", "admin@localhost"), string(hash))
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, "INSERT INTO role_bindings(id,org_id,user_id,role) VALUES($1,$2,$3,'org_admin')", ID(), org, u)
		if e != nil {
			return e
		}
	}
	for _, name := range []string{"stable", "canary"} {
		_, e = tx.Exec(ctx, "INSERT INTO channels(id,org_id,name) VALUES($1,$2,$3) ON CONFLICT(org_id,name) DO NOTHING", ID(), org, name)
		if e != nil {
			return e
		}
	}
	_, e = tx.Exec(ctx, "INSERT INTO settings(org_id) VALUES($1) ON CONFLICT DO NOTHING", org)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rid := ID()
		w.Header().Set("X-Request-ID", rid)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		r = r.WithContext(context.WithValue(r.Context(), ctxKey("requestId"), rid))
		if r.Method != "GET" && r.Method != "HEAD" {
			origin := r.Header.Get("Origin")
			if origin != "" && origin != s.Origin {
				fail(w, r, 403, "CSRF", "Origin not allowed")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if token == "" {
			if c, e := r.Cookie("skiva_session"); e == nil {
				token = c.Value
			}
		}
		var a actor
		e := s.DB.QueryRow(r.Context(), `SELECT u.id,u.org_id,COALESCE(array_agg(rb.role) FILTER(WHERE rb.role IS NOT NULL),'{}') FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN role_bindings rb ON rb.user_id=u.id AND rb.org_id=u.org_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active GROUP BY u.id`, protocol.Digest([]byte(token))).Scan(&a.ID, &a.Org, &a.Roles)
		if e != nil {
			fail(w, r, 401, "UNAUTHENTICATED", "Sign in required")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey("actor"), a)))
	})
}
func (s *Server) permit(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !has(who(r), roles...) {
				fail(w, r, 403, "FORBIDDEN", "Your role does not permit this operation")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
func (s *Server) session(w http.ResponseWriter, r *http.Request, user string) {
	token := Token()
	_, e := s.DB.Exec(r.Context(), "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", protocol.Digest([]byte(token)), user, time.Now().Add(8*time.Hour))
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "skiva_session", Value: token, Path: "/", HttpOnly: true, Secure: s.Production, SameSite: http.SameSiteStrictMode, MaxAge: 28800})
	jsonOut(w, 200, map[string]any{"authenticated": true, "expiresIn": 28800})
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if s.Production {
		fail(w, r, 403, "SSO_REQUIRED", "Use enterprise SSO")
		return
	}
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decode(w, r, &in) {
		return
	}
	var id, hash string
	e := s.DB.QueryRow(r.Context(), "SELECT id,password_hash FROM users WHERE email=$1 AND active AND subject LIKE 'local:%'", in.Email).Scan(&id, &hash)
	if e != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password)) != nil {
		fail(w, r, 401, "INVALID_CREDENTIALS", "Invalid credentials")
		return
	}
	s.session(w, r, id)
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, e := r.Cookie("skiva_session"); e == nil {
		_, _ = s.DB.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", protocol.Digest([]byte(c.Value)))
	}
	http.SetCookie(w, &http.Cookie{Name: "skiva_session", Value: "", Path: "/", HttpOnly: true, Secure: s.Production, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	jsonOut(w, 200, map[string]bool{"ok": true})
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	a := who(r)
	s.one(w, r, `SELECT jsonb_build_object('id',u.id,'email',u.email,'displayName',u.display_name,'orgId',u.org_id,'roles',$2::jsonb) FROM users u WHERE id=$1`, a.ID, mustJSON(a.Roles))
}
func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }
func (s *Server) account(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DisplayName string `json:"displayName"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.DisplayName) < 1 || len(in.DisplayName) > 100 {
		fail(w, r, 400, "INVALID_INPUT", "Display name must be 1–100 characters")
		return
	}
	e := s.transaction(r, func(tx pgx.Tx) error {
		_, e := tx.Exec(r.Context(), "UPDATE users SET display_name=$1 WHERE id=$2", in.DisplayName, who(r).ID)
		if e != nil {
			return e
		}
		return audit(r.Context(), tx, who(r), "account.update", "user", who(r).ID, nil, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	s.me(w, r)
}
func (s *Server) refreshSession(w http.ResponseWriter, r *http.Request) {
	if c, e := r.Cookie("skiva_session"); e == nil {
		_, e = s.DB.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", protocol.Digest([]byte(c.Value)))
		if e != nil {
			s.dbError(w, r, e)
			return
		}
	}
	s.session(w, r, who(r).ID)
}
