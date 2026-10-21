package platform

import (
	"encoding/json"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"strings"
	"time"
)

func (s *Server) dashboard(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, `SELECT jsonb_build_object('repositories',(SELECT count(*) FROM repositories WHERE org_id=$1 AND deleted_at IS NULL),'skills',(SELECT count(*) FROM skills WHERE org_id=$1),'releases',(SELECT count(*) FROM release_snapshots WHERE org_id=$1),'clients',(SELECT count(*) FROM mount_clients WHERE org_id=$1 AND revoked_at IS NULL),'failedPipelines',(SELECT count(*) FROM pipeline_runs p JOIN repositories r ON r.id=p.repository_id WHERE r.org_id=$1 AND p.status='failed'),'offlineClients',(SELECT count(*) FROM mount_clients WHERE org_id=$1 AND revoked_at IS NULL AND (last_seen_at IS NULL OR last_seen_at<now()-interval '5 minutes')))`, who(r).Org)
}
func (s *Server) members(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',u.id,'email',u.email,'displayName',u.display_name,'active',u.active,'roles',COALESCE((SELECT jsonb_agg(role) FROM role_bindings WHERE user_id=u.id AND org_id=u.org_id),'[]')) FROM users u WHERE u.org_id=$1 ORDER BY u.created_at`, who(r).Org)
}
func validRole(role string) bool {
	for _, v := range []string{"org_admin", "repo_maintainer", "release_manager", "agent_manager", "auditor"} {
		if role == v {
			return true
		}
	}
	return false
}
func (s *Server) memberRoles(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Roles []string `json:"roles"`
	}
	if !decode(w, r, &in) {
		return
	}
	for _, v := range in.Roles {
		if !validRole(v) {
			fail(w, r, 400, "INVALID_ROLE", "Unknown role")
			return
		}
	}
	id := chi.URLParam(r, "id")
	e := s.transaction(r, func(tx pgx.Tx) error {
		var ok bool
		e := tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM users WHERE id=$1 AND org_id=$2)", id, who(r).Org).Scan(&ok)
		if e != nil {
			return e
		}
		if !ok {
			return pgx.ErrNoRows
		}
		if id == who(r).ID {
			admin := false
			for _, v := range in.Roles {
				admin = admin || v == "org_admin"
			}
			if !admin {
				return errors.New("Cannot remove your own administrator role")
			}
		}
		var before json.RawMessage
		if e := tx.QueryRow(r.Context(), "SELECT jsonb_build_object('roles',COALESCE(jsonb_agg(role),'[]')) FROM role_bindings WHERE user_id=$1 AND org_id=$2", id, who(r).Org).Scan(&before); e != nil {
			return e
		}
		_, e = tx.Exec(r.Context(), "DELETE FROM role_bindings WHERE user_id=$1 AND org_id=$2", id, who(r).Org)
		if e != nil {
			return e
		}
		for _, v := range in.Roles {
			_, e = tx.Exec(r.Context(), "INSERT INTO role_bindings(id,org_id,user_id,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", ID(), who(r).Org, id, v)
			if e != nil {
				return e
			}
		}
		return audit(r.Context(), tx, who(r), "member.roles", "user", id, before, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}
func (s *Server) createMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email       string   `json:"email"`
		DisplayName string   `json:"displayName"`
		Password    string   `json:"password"`
		Roles       []string `json:"roles"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !strings.Contains(in.Email, "@") || len(in.Password) < 14 || len(in.Roles) == 0 {
		fail(w, r, 400, "INVALID_MEMBER", "Email, role and password of at least 14 characters required")
		return
	}
	for _, v := range in.Roles {
		if !validRole(v) {
			fail(w, r, 400, "INVALID_ROLE", "Unknown role")
			return
		}
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(in.Password), 12)
	id := ID()
	e := s.transaction(r, func(tx pgx.Tx) error {
		_, e := tx.Exec(r.Context(), "INSERT INTO users(id,org_id,subject,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5,$6)", id, who(r).Org, "local:"+in.Email, in.Email, in.DisplayName, string(hash))
		if e != nil {
			return e
		}
		for _, v := range in.Roles {
			_, e = tx.Exec(r.Context(), "INSERT INTO role_bindings(id,org_id,user_id,role) VALUES($1,$2,$3,$4)", ID(), who(r).Org, id, v)
			if e != nil {
				return e
			}
		}
		return audit(r.Context(), tx, who(r), "member.create", "user", id, nil, map[string]any{"email": in.Email, "roles": in.Roles})
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 201, map[string]string{"id": id})
}
func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, `SELECT jsonb_build_object('name',o.name,'policy',s.value,'oidcConfigured',$2::boolean,'production',$3::boolean) FROM organizations o JOIN settings s ON s.org_id=o.id WHERE o.id=$1`, who(r).Org, env("ESDP_OIDC_ISSUER", "") != "", s.Production)
}
func (s *Server) saveSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name   string         `json:"name"`
		Policy map[string]any `json:"policy"`
	}
	if !decode(w, r, &in) {
		return
	}
	policy := defaultPolicy()
	if e := json.Unmarshal(mustJSON(in.Policy), &policy); e != nil {
		fail(w, r, 400, "INVALID_POLICY", e.Error())
		return
	}
	if e := validatePolicy(policy); e != nil {
		fail(w, r, 400, "INVALID_POLICY", e.Error())
		return
	}
	in.Policy = map[string]any{}
	json.Unmarshal(mustJSON(policy), &in.Policy)
	if in.Name == "" {
		fail(w, r, 400, "INVALID_SETTINGS", "Organization name is required")
		return
	}
	e := s.transaction(r, func(tx pgx.Tx) error {
		var before json.RawMessage
		if e := tx.QueryRow(r.Context(), "SELECT jsonb_build_object('name',o.name,'policy',s.value) FROM organizations o JOIN settings s ON s.org_id=o.id WHERE o.id=$1 FOR UPDATE OF o,s", who(r).Org).Scan(&before); e != nil {
			return e
		}
		_, e := tx.Exec(r.Context(), "UPDATE organizations SET name=$1 WHERE id=$2", in.Name, who(r).Org)
		if e != nil {
			return e
		}
		_, e = tx.Exec(r.Context(), "UPDATE settings SET value=$1 WHERE org_id=$2", mustJSON(in.Policy), who(r).Org)
		if e != nil {
			return e
		}
		return audit(r.Context(), tx, who(r), "settings.update", "organization", who(r).Org, before, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	s.settings(w, r)
}
func (s *Server) credentials(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',id,'name',name,'secretRef',secret_ref,'createdAt',created_at) FROM repository_credentials WHERE org_id=$1 ORDER BY created_at DESC`, who(r).Org)
}
func (s *Server) saveCredential(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name      string `json:"name"`
		SecretRef string `json:"secretRef"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Name == "" {
		fail(w, r, 400, "INVALID_INPUT", "Name is required")
		return
	}
	if _, e := s.secret(in.SecretRef); e != nil {
		fail(w, r, 422, "SECRET_UNAVAILABLE", e.Error())
		return
	}
	id := chi.URLParam(r, "id")
	create := id == ""
	if create {
		id = ID()
	}
	e := s.transaction(r, func(tx pgx.Tx) error {
		if create {
			_, e := tx.Exec(r.Context(), "INSERT INTO repository_credentials(id,org_id,name,secret_ref) VALUES($1,$2,$3,$4)", id, who(r).Org, in.Name, in.SecretRef)
			if e != nil {
				return e
			}
		} else {
			t, e := tx.Exec(r.Context(), "UPDATE repository_credentials SET name=$3,secret_ref=$4 WHERE id=$1 AND org_id=$2", id, who(r).Org, in.Name, in.SecretRef)
			if e != nil {
				return e
			}
			if t.RowsAffected() != 1 {
				return pgx.ErrNoRows
			}
		}
		return audit(r.Context(), tx, who(r), "credential.save", "credential", id, nil, map[string]string{"name": in.Name})
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]string{"id": id})
}
func (s *Server) audits(w http.ResponseWriter, r *http.Request) {
	for _, key := range []string{"from", "until"} {
		if value := r.URL.Query().Get(key); value != "" {
			if _, e := time.Parse(time.RFC3339, value); e != nil {
				fail(w, r, 400, "INVALID_DATE", "Use RFC3339 date filters")
				return
			}
		}
	}
	s.list(w, r, `SELECT jsonb_build_object('id',id,'actorId',actor_id,'action',action,'targetType',target_type,'targetId',target_id,'requestId',request_id,'before',before_state,'after',after_state,'createdAt',created_at) FROM audit_logs WHERE org_id=$1 AND ($2='' OR action ILIKE '%'||$2||'%') AND ($3='' OR actor_id=$3) AND ($4='' OR target_id=$4) AND (NULLIF($5,'')::timestamptz IS NULL OR created_at>=NULLIF($5,'')::timestamptz) AND (NULLIF($6,'')::timestamptz IS NULL OR created_at<=NULLIF($6,'')::timestamptz) ORDER BY id DESC`, who(r).Org, r.URL.Query().Get("action"), r.URL.Query().Get("actor"), r.URL.Query().Get("target"), r.URL.Query().Get("from"), r.URL.Query().Get("until"))
}
func (s *Server) notifications(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',n.id,'title',n.title,'href',n.href,'createdAt',n.created_at,'read',EXISTS(SELECT 1 FROM notification_reads WHERE notification_id=n.id AND user_id=$2)) FROM notifications n WHERE n.org_id=$1 ORDER BY n.created_at DESC`, who(r).Org, who(r).ID)
}
func (s *Server) readNotification(w http.ResponseWriter, r *http.Request) {
	_, e := s.DB.Exec(r.Context(), "INSERT INTO notification_reads(notification_id,user_id) SELECT id,$2 FROM notifications WHERE id=$1 AND org_id=$3 ON CONFLICT DO NOTHING", chi.URLParam(r, "id"), who(r).ID, who(r).Org)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}

var _ = json.Marshal

func (s *Server) updateMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Active bool `json:"active"`
	}
	if !decode(w, r, &in) {
		return
	}
	id := chi.URLParam(r, "id")
	if id == who(r).ID && !in.Active {
		fail(w, r, 409, "SELF_DISABLE", "Cannot disable your own account")
		return
	}
	e := s.transaction(r, func(tx pgx.Tx) error {
		var before bool
		e := tx.QueryRow(r.Context(), "SELECT active FROM users WHERE id=$1 AND org_id=$2 FOR UPDATE", id, who(r).Org).Scan(&before)
		if e != nil {
			return e
		}
		_, e = tx.Exec(r.Context(), "UPDATE users SET active=$3 WHERE id=$1 AND org_id=$2", id, who(r).Org, in.Active)
		if e != nil {
			return e
		}
		return audit(r.Context(), tx, who(r), "member.status", "user", id, map[string]bool{"active": before}, in)
	})
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 200, map[string]bool{"ok": true})
}
