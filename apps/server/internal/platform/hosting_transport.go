package platform

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/textproto"
	"os"
	"os/exec"
	"path/filepath"
	"skiva/packages/protocol"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func (s *Server) gitHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !hostingEnabled("ENABLED") {
		fail(w, r, 503, "HOSTING_DISABLED", "Git hosting disabled")
		return
	}
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	ip := net.ParseIP(host)
	secure := r.TLS != nil || (os.Getenv("SKIVA_GIT_TRUST_PROXY") == "true" && r.Header.Get("X-Forwarded-Proto") == "https")
	if !secure && !(os.Getenv("SKIVA_GIT_ALLOW_LOOPBACK_HTTP") == "true" && ip != nil && ip.IsLoopback() && !s.Production) {
		fail(w, r, 403, "TLS_REQUIRED", "HTTPS is required")
		return
	}
	_, token, ok := r.BasicAuth()
	if !ok || !strings.HasPrefix(token, "skiva_git_") {
		w.Header().Set("WWW-Authenticate", `Basic realm="Skiva Git"`)
		fail(w, r, 401, "GIT_AUTH_REQUIRED", "Git token required")
		return
	}
	var a actor
	var tokenID, repo string
	var scopes []string
	e := s.DB.QueryRow(r.Context(), `SELECT t.id,t.repository_id,u.id,u.org_id,t.scopes FROM git_access_tokens t JOIN users u ON u.id=t.owner_user_id AND u.org_id=t.org_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now() AND u.active`, protocol.Digest([]byte(token))).Scan(&tokenID, &repo, &a.ID, &a.Org, &scopes)
	if e != nil {
		w.Header().Set("WWW-Authenticate", `Basic realm="Skiva Git"`)
		fail(w, r, 401, "GIT_AUTH_REQUIRED", "Git token required")
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/git/"), "/")
	if len(parts) < 3 || !slugPattern.MatchString(parts[0]) || !strings.HasSuffix(parts[1], ".git") || !slugPattern.MatchString(strings.TrimSuffix(parts[1], ".git")) || strings.Contains(strings.ToLower(r.URL.EscapedPath()), "%") {
		fail(w, r, 404, "NOT_FOUND", "Repository unavailable")
		return
	}
	suffix := strings.Join(parts[2:], "/")
	service := r.URL.Query().Get("service")
	if r.Method == "GET" && suffix == "info/refs" && (service == "git-upload-pack" || service == "git-receive-pack") && len(r.URL.Query()) == 1 {
	} else if r.Method == "POST" && (suffix == "git-upload-pack" || suffix == "git-receive-pack") && r.URL.RawQuery == "" {
		service = suffix
		if r.Header.Get("Content-Type") != "application/x-"+service+"-request" {
			fail(w, r, 415, "CONTENT_TYPE", "Invalid Git content type")
			return
		}
	} else {
		fail(w, r, 404, "NOT_FOUND", "Unknown Git endpoint")
		return
	}
	write := service == "git-receive-pack"
	scope := "repo:read"
	if write {
		scope = "repo:write"
	}
	allowed := false
	for _, v := range scopes {
		allowed = allowed || v == scope
	}
	role, e := s.repoAccess(r.Context(), a, repo, write)
	if e != nil || !allowed {
		s.gitSecurity(r.Context(), a, repo, "scope_or_membership")
		fail(w, r, 404, "NOT_FOUND", "Repository unavailable")
		return
	}
	var storage, status string
	var raw []byte
	e = s.DB.QueryRow(r.Context(), `SELECT storage_id,status,hosting_policy FROM repositories WHERE id=$1 AND org_id=$2 AND namespace_slug=$3 AND slug=$4 AND source_type='managed' AND provision_state='active' AND deleted_at IS NULL`, repo, a.Org, parts[0], strings.TrimSuffix(parts[1], ".git")).Scan(&storage, &status, &raw)
	if e != nil {
		fail(w, r, 404, "NOT_FOUND", "Repository unavailable")
		return
	}
	if status == "disabled" || write && !hostingEnabled("WRITE_ENABLED") {
		fail(w, r, 403, "GIT_WRITE_DISABLED", "Repository access disabled")
		return
	}
	var policy HostingPolicy
	if json.Unmarshal(raw, &policy) != nil || policy.validate() != nil {
		fail(w, r, 503, "POLICY_UNAVAILABLE", "Hosting policy unavailable")
		return
	}
	dir, e := s.managedPath(storage)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
	defer cancel()
	// Serialize receiving and reconciliation across processes; no read of moving refs during acceptance.
	conn, e := s.DB.Acquire(ctx)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	defer conn.Release()
	if write {
		if _, e = conn.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended($1,0))", "hosting:"+repo); e != nil {
			s.dbError(w, r, e)
			return
		}
		defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock(hashtextextended($1,0))", "hosting:"+repo)
	}
	spool, _ := filepath.Abs(filepath.Join(s.Data, "git-spool"))
	if e = os.MkdirAll(spool, 0700); e != nil {
		s.dbError(w, r, e)
		return
	}
	temp, e := os.MkdirTemp(spool, ".request-")
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	defer os.RemoveAll(temp)
	if write {
		size, err := diskBytes(filepath.Dir(dir))
		if err != nil || size > 20<<30 {
			fail(w, r, 507, "STORAGE_FULL", "Git storage quota exceeded")
			return
		}
		var stat syscall.Statfs_t
		if syscall.Statfs(filepath.Dir(dir), &stat) != nil || uint64(stat.Bavail)*uint64(stat.Bsize) < uint64(policy.MaxPushBytes*2) {
			fail(w, r, 507, "STORAGE_FULL", "Insufficient Git storage headroom")
			return
		}
	}
	body, e := os.Create(filepath.Join(temp, "body"))
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	defer body.Close()
	n, e := io.Copy(body, http.MaxBytesReader(w, r.Body, policy.MaxPushBytes))
	if write {
		gitReceiveBytes.Add(n)
	}
	if e != nil {
		fail(w, r, 413, "PUSH_TOO_LARGE", "Git request exceeds limit")
		return
	}
	if _, e = body.Seek(0, 0); e != nil {
		s.dbError(w, r, e)
		return
	}
	executable := env("SKIVA_GIT_HOOK_EXECUTABLE", "")
	if executable == "" {
		executable, e = os.Executable()
		if e != nil {
			s.dbError(w, r, e)
			return
		}
	}
	// Only generated service hooks are reachable; repository contents never supply executable hooks.
	for _, mode := range []string{"pre-receive", "post-receive"} {
		shim := "#!/bin/sh\nexec '" + strings.ReplaceAll(executable, "'", "'\\''") + "' git-hook " + mode + "\n"
		if e = os.WriteFile(filepath.Join(temp, mode), []byte(shim), 0700); e != nil {
			s.dbError(w, r, e)
			return
		}
	}
	contextFile := filepath.Join(temp, "context.json")
	if e = os.WriteFile(contextFile, mustJSON(HookContext{repo, a.ID, a.Org, role, policy, spool}), 0600); e != nil {
		s.dbError(w, r, e)
		return
	}
	cmd := exec.CommandContext(ctx, "git", "-c", "core.hooksPath="+temp, "-c", "receive.maxInputSize="+strconv.FormatInt(policy.MaxPushBytes, 10), "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never", "http-backend")
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + temp, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0", "GIT_PROJECT_ROOT=" + filepath.Dir(dir), "PATH_INFO=/" + filepath.Base(dir) + "/" + suffix, "REQUEST_METHOD=" + r.Method, "QUERY_STRING=" + r.URL.RawQuery, "CONTENT_TYPE=" + r.Header.Get("Content-Type"), "CONTENT_LENGTH=" + strconv.FormatInt(n, 10), "REMOTE_USER=" + a.ID, "REMOTE_ADDR=" + host, "SERVER_PROTOCOL=HTTP/1.1", "GATEWAY_INTERFACE=CGI/1.1", "SKIVA_HOOK_CONTEXT=" + contextFile}
	if r.Header.Get("Git-Protocol") == "version=2" {
		cmd.Env = append(cmd.Env, "GIT_PROTOCOL=version=2")
	}
	cmd.Stdin = body
	var out limitedBuffer
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.WaitDelay = time.Second
	started := time.Now()
	e = cmd.Run()
	gitProcessCount.Add(1)
	gitProcessMillis.Add(time.Since(started).Milliseconds())
	if e != nil {
		if write {
			gitRejected.Add(1)
			s.gitSecurity(r.Context(), a, repo, "transport_failed")
		}
		fail(w, r, 502, "GIT_PROCESS_FAILED", "Git service failed or exceeded limits; retry fetch before pushing again")
		return
	}
	_, _ = conn.Exec(ctx, "UPDATE git_access_tokens SET last_used_at=now() WHERE id=$1", tokenID)
	if write && strings.Contains(out.String(), "[remote rejected]") {
		gitRejected.Add(1)
		s.gitSecurity(r.Context(), a, repo, "push_policy")
	}
	if write && strings.Contains(out.String(), "pre-receive hook declined") {
		gitRejected.Add(1)
		s.gitSecurity(r.Context(), a, repo, "push_policy")
	}
	reader := bufio.NewReader(&out)
	headers, e := textproto.NewReader(reader).ReadMIMEHeader()
	if e != nil {
		fail(w, r, 502, "GIT_RESPONSE_INVALID", "Git service response invalid")
		return
	}
	statusCode := 200
	if status := headers.Get("Status"); status != "" {
		fields := strings.Fields(status)
		if len(fields) > 0 {
			statusCode, _ = strconv.Atoi(fields[0])
		}
		if statusCode < 100 || statusCode > 599 {
			statusCode = 502
		}
	}
	for _, key := range []string{"Content-Type", "Cache-Control", "Expires", "Pragma"} {
		if v := headers.Get(key); v != "" {
			w.Header().Set(key, v)
		}
	}
	w.WriteHeader(statusCode)
	_, _ = io.Copy(w, reader)
}
