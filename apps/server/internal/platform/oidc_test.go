package platform

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestIntegrationOIDCPKCEAndClaims(t *testing.T) {
	s, ts, _ := integration(t)
	s.Origin = ts.URL
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	nonce, challenge, issuer := "", "", ""
	audience := "esdp-test"
	signer, e := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "test"))
	if e != nil {
		t.Fatal(e)
	}
	idp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/keys", "response_types_supported": []string{"code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test", Use: "sig", Algorithm: "RS256"}}})
		case "/token":
			r.ParseForm()
			sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if base64.RawURLEncoding.EncodeToString(sum[:]) != challenge {
				http.Error(w, "invalid PKCE", 400)
				return
			}
			signed, _ := jwt.Signed(signer).Claims(jwt.Claims{Issuer: issuer, Subject: "enterprise-user", Audience: jwt.Audience{audience}, Expiry: jwt.NewNumericDate(time.Now().Add(time.Minute)), IssuedAt: jwt.NewNumericDate(time.Now())}).Claims(map[string]any{"nonce": nonce, "email": "test@example.com", "email_verified": true, "name": "Enterprise User"}).Serialize()
			json.NewEncoder(w).Encode(map[string]any{"access_token": "access", "token_type": "Bearer", "id_token": signed, "expires_in": 60})
		default:
			http.NotFound(w, r)
		}
	}))
	defer idp.Close()
	issuer = idp.URL
	t.Setenv("ESDP_OIDC_ISSUER", issuer)
	t.Setenv("ESDP_OIDC_CLIENT_ID", "esdp-test")
	s.DB.Exec(t.Context(), "UPDATE users SET subject='local:oidc-test' WHERE org_id=$1", s.Org)
	client := &http.Client{CheckRedirect: func(r *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	for _, wrongAudience := range []bool{true, false} {
		res, e := client.Get(ts.URL + "/api/v1/auth/oidc")
		if e != nil {
			t.Fatal(e)
		}
		cookies := res.Cookies()
		redirect, _ := url.Parse(res.Header.Get("Location"))
		res.Body.Close()
		if redirect.Query().Get("code_challenge_method") != "S256" {
			t.Fatal("PKCE missing")
		}
		nonce = redirect.Query().Get("nonce")
		challenge = redirect.Query().Get("code_challenge")
		if wrongAudience {
			audience = "attacker"
		} else {
			audience = "esdp-test"
		}
		req, _ := http.NewRequest("GET", ts.URL+"/api/v1/auth/oidc/callback?code=verified&state="+url.QueryEscape(redirect.Query().Get("state")), nil)
		for _, c := range cookies {
			req.AddCookie(c)
		}
		res, e = client.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		res.Body.Close()
		if wrongAudience {
			if res.StatusCode != 401 {
				t.Fatal("wrong audience accepted", res.StatusCode)
			}
			continue
		}
		if res.StatusCode != 302 {
			t.Fatal("OIDC login failed", res.StatusCode)
		}
		session := ""
		for _, c := range res.Cookies() {
			if c.Name == "esdp_session" {
				session = c.Value
				if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
					t.Fatal("unsafe session cookie")
				}
			}
		}
		if session == "" {
			t.Fatal("no session")
		}
		code, _ := request(t, ts, session, "GET", "/api/v1/me", nil, "")
		if code != 200 {
			t.Fatal("OIDC session unavailable")
		}
	}
	s.Production = true
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/auth/login", strings.NewReader(`{"email":"test@example.com","password":"anything"}`))
	res, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("production local login enabled")
	}
}
