package platform

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"skiva/packages/protocol"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"net/http"
	"time"
)

type oidcState struct {
	State    string `json:"state"`
	Verifier string `json:"verifier"`
	Nonce    string `json:"nonce"`
}

func (s *Server) oidcConfig(ctx context.Context) (*oidc.Provider, oauth2.Config, error) {
	p, e := oidc.NewProvider(ctx, env("SKIVA_OIDC_ISSUER", ""))
	if e != nil {
		return nil, oauth2.Config{}, e
	}
	return p, oauth2.Config{ClientID: env("SKIVA_OIDC_CLIENT_ID", ""), ClientSecret: env("SKIVA_OIDC_CLIENT_SECRET", ""), RedirectURL: s.Origin + "/api/v1/auth/oidc/callback", Endpoint: p.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "profile", "email"}}, nil
}
func (s *Server) oidcStart(w http.ResponseWriter, r *http.Request) {
	_, cfg, e := s.oidcConfig(r.Context())
	if e != nil {
		fail(w, r, 503, "OIDC_UNAVAILABLE", "Identity provider unavailable or not configured")
		return
	}
	state := oidcState{Token(), Token(), Token()}
	b, _ := json.Marshal(state)
	http.SetCookie(w, &http.Cookie{Name: "skiva_oidc", Value: base64.RawURLEncoding.EncodeToString(b), Path: "/api/v1/auth/oidc", HttpOnly: true, Secure: s.Production, SameSite: http.SameSiteLaxMode, MaxAge: 300})
	h := sha256.Sum256([]byte(state.Verifier))
	http.Redirect(w, r, cfg.AuthCodeURL(state.State, oidc.Nonce(state.Nonce), oauth2.SetAuthURLParam("code_challenge", base64.RawURLEncoding.EncodeToString(h[:])), oauth2.SetAuthURLParam("code_challenge_method", "S256")), http.StatusFound)
}
func (s *Server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	c, e := r.Cookie("skiva_oidc")
	if e != nil {
		fail(w, r, 401, "OIDC_STATE", "Missing login state")
		return
	}
	b, e := base64.RawURLEncoding.DecodeString(c.Value)
	var state oidcState
	if e != nil || json.Unmarshal(b, &state) != nil || state.State == "" || r.URL.Query().Get("state") != state.State {
		fail(w, r, 401, "OIDC_STATE", "Invalid login state")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "skiva_oidc", Value: "", Path: "/api/v1/auth/oidc", MaxAge: -1, HttpOnly: true, Secure: s.Production, SameSite: http.SameSiteLaxMode})
	p, cfg, e := s.oidcConfig(r.Context())
	if e != nil {
		fail(w, r, 503, "OIDC_UNAVAILABLE", "Identity provider unavailable")
		return
	}
	token, e := cfg.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.SetAuthURLParam("code_verifier", state.Verifier))
	if e != nil {
		fail(w, r, 401, "OIDC_EXCHANGE", "Identity token exchange failed")
		return
	}
	raw, _ := token.Extra("id_token").(string)
	idToken, e := p.Verifier(&oidc.Config{ClientID: cfg.ClientID}).Verify(r.Context(), raw)
	if e != nil || idToken.Nonce != state.Nonce {
		fail(w, r, 401, "OIDC_TOKEN", "Identity token validation failed")
		return
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if idToken.Claims(&claims) != nil || !claims.EmailVerified {
		fail(w, r, 403, "OIDC_EMAIL", "Verified enterprise email required")
		return
	}
	var id string
	e = s.DB.QueryRow(r.Context(), "SELECT id FROM users WHERE org_id=$1 AND active AND (subject=$2 OR (email=$3 AND subject LIKE 'local:%'))", s.Org, idToken.Issuer+":"+idToken.Subject, claims.Email).Scan(&id)
	if e != nil {
		fail(w, r, 403, "MEMBERSHIP_REQUIRED", "Ask your organization administrator to provision membership")
		return
	}
	_, e = s.DB.Exec(r.Context(), "UPDATE users SET subject=$2,password_hash=NULL WHERE id=$1", id, idToken.Issuer+":"+idToken.Subject)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	t := Token()
	_, e = s.DB.Exec(r.Context(), "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", protocol.Digest([]byte(t)), id, time.Now().Add(8*time.Hour))
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "skiva_session", Value: t, Path: "/", HttpOnly: true, Secure: s.Production, SameSite: http.SameSiteStrictMode, MaxAge: 28800})
	http.Redirect(w, r, "/dashboard", http.StatusFound)
}
