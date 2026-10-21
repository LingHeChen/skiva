package platform

import (
	"context"
	"errors"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

type gitOptions struct {
	Env     []string
	SSH     string
	Cleanup func()
}

func (s *Server) remoteContext(ctx context.Context, repo, remote string) (context.Context, func(), error) {
	if e := s.validateRemote(ctx, remote); e != nil {
		return ctx, func() {}, e
	}
	u, _ := url.Parse(remote)
	ips, e := net.DefaultResolver.LookupIPAddr(ctx, u.Hostname())
	if e != nil || len(ips) == 0 {
		return ctx, func() {}, errors.New("Git DNS resolution failed")
	}
	allowed := false
	for _, h := range s.AllowHosts {
		allowed = allowed || h == u.Hostname()
	}
	ip := ips[0].IP
	for _, candidate := range ips {
		if candidate.IP.To4() != nil {
			ip = candidate.IP
			break
		}
	}
	if !allowed && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast()) {
		return ctx, func() {}, errors.New("Git DNS target violates policy")
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9.:-]+$`).MatchString(u.Hostname()) {
		return ctx, func() {}, errors.New("invalid Git hostname")
	}
	opts := gitOptions{}
	cleanup := func() {}
	port := u.Port()
	if u.Scheme == "https" {
		if port == "" {
			port = "443"
		}
		resolved := ip.String()
		if ip.To4() == nil {
			resolved = "[" + resolved + "]"
		}
		opts.Env = []string{"GIT_CONFIG_COUNT=1", "GIT_CONFIG_KEY_0=http.curloptResolve", "GIT_CONFIG_VALUE_0=" + u.Hostname() + ":" + port + ":" + resolved}
	} else {
		opts.SSH = "ssh -oBatchMode=yes -oStrictHostKeyChecking=yes -oHostName=" + ip.String() + " -oHostKeyAlias=" + u.Hostname()
		known := env("ESDP_SSH_KNOWN_HOSTS", "")
		if known != "" {
			if strings.ContainsAny(known, " '\n\r\t") {
				return ctx, cleanup, errors.New("invalid known-hosts path")
			}
			opts.SSH += " -oUserKnownHostsFile=" + known
		}
	}
	var ref *string
	e = s.DB.QueryRow(ctx, "SELECT c.secret_ref FROM repositories r LEFT JOIN repository_credentials c ON c.id=r.credential_id AND c.org_id=r.org_id WHERE r.id=$1", repo).Scan(&ref)
	if e != nil {
		return ctx, cleanup, e
	}
	if ref != nil {
		secret, e := s.secret(*ref)
		if e != nil {
			return ctx, cleanup, e
		}
		if u.Scheme == "https" {
			if strings.ContainsAny(secret, "\r\n") {
				return ctx, cleanup, errors.New("invalid HTTP credential")
			}
			opts.Env[0] = "GIT_CONFIG_COUNT=2"
			opts.Env = append(opts.Env, "GIT_CONFIG_KEY_1=http.extraHeader", "GIT_CONFIG_VALUE_1=Authorization: "+secret)
		} else {
			dir := filepath.Join(s.Data, "credentials")
			if e = os.MkdirAll(dir, 0700); e != nil {
				return ctx, cleanup, e
			}
			f, e := os.CreateTemp(dir, "ssh-")
			if e != nil {
				return ctx, cleanup, e
			}
			if _, e = f.WriteString(secret); e != nil {
				f.Close()
				os.Remove(f.Name())
				return ctx, cleanup, e
			}
			f.Close()
			absolute, _ := filepath.Abs(f.Name())
			if strings.ContainsAny(absolute, " '\n\r\t") {
				os.Remove(f.Name())
				return ctx, cleanup, errors.New("credential directory cannot contain whitespace")
			}
			opts.SSH += " -oIdentitiesOnly=yes -i " + absolute
			cleanup = func() { os.Remove(f.Name()) }
		}
	}
	return context.WithValue(ctx, ctxKey("gitOptions"), opts), cleanup, nil
}
