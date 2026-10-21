package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

// File-backed secrets are loaded only in the parent server, never in Git hooks.
func loadSecrets() error {
	for _, key := range []string{"SKIVA_DATABASE_URL", "SKIVA_ADMIN_PASSWORD", "SKIVA_OIDC_CLIENT_SECRET"} {
		file := os.Getenv(key + "_FILE")
		if file == "" {
			continue
		}
		if os.Getenv(key) != "" {
			return fmt.Errorf("configure only one of %s and %s_FILE", key, key)
		}
		f, e := os.Open(file)
		if e != nil {
			return fmt.Errorf("cannot read %s_FILE", key)
		}
		b, e := io.ReadAll(io.LimitReader(f, 65537))
		f.Close()
		if e != nil || len(b) > 65536 {
			return fmt.Errorf("invalid %s_FILE", key)
		}
		value := strings.TrimRight(string(b), "\r\n")
		if value == "" {
			return fmt.Errorf("empty %s_FILE", key)
		}
		if e = os.Setenv(key, value); e != nil {
			return e
		}
	}
	return nil
}
func healthcheck() error {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:8080/healthz", nil)
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		return errors.New("backend unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("backend unhealthy")
	}
	return nil
}
func migrate() error {
	if os.Getenv("SKIVA_DATABASE_URL") == "" {
		return errors.New("database URL required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "goose", "-dir", "/migrations", "up")
	cmd.Env = append(os.Environ(), "GOOSE_DRIVER=postgres", "GOOSE_DBSTRING="+os.Getenv("SKIVA_DATABASE_URL"))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
