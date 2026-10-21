package main

import (
	"context"
	"encoding/json"
	"esdp/apps/mount/internal/mountfs"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
)

type Config struct {
	Server  string `json:"server"`
	Token   string `json:"token"`
	Profile string `json:"profile"`
	Mode    string `json:"mode"`
	Cache   string `json:"cache"`
}

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: skills-mount login|mount|status|refresh|unmount")
	}
	home, _ := os.UserConfigDir()
	cfgPath := filepath.Join(home, "esdp", "client.json")
	cfg := Config{}
	if b, e := os.ReadFile(cfgPath); e == nil {
		json.Unmarshal(b, &cfg)
	}
	f := flag.NewFlagSet(os.Args[1], flag.ContinueOnError)
	server := f.String("server", cfg.Server, "HTTPS server URL")
	profile := f.String("profile", cfg.Profile, "Profile ID or name")
	mode := f.String("mode", cfg.Mode, "dynamic or pinned (must match profile)")
	path := f.String("path", "", "mount directory")
	tokenFile := f.String("token-file", "", "0600 credential file")
	cache := f.String("cache", filepath.Join(home, "esdp", "cache"), "cache directory")
	repin := f.Bool("repin", false, "explicitly re-pin a running task (never during a task)")
	snapshot := f.String("snapshot", "", "explicit authorized pinned snapshot")
	if e := f.Parse(os.Args[2:]); e != nil {
		return e
	}
	token := os.Getenv("ESDP_CLIENT_TOKEN")
	if token == "" {
		token = cfg.Token
	}
	if *tokenFile != "" {
		st, e := os.Stat(*tokenFile)
		if e != nil {
			return e
		}
		if st.Mode().Perm()&0077 != 0 {
			return fmt.Errorf("credential file must have mode 0600")
		}
		b, e := os.ReadFile(*tokenFile)
		if e != nil {
			return e
		}
		token = strings.TrimSpace(string(b))
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	v := mountfs.New(*server, token, *profile, *mode, *cache)
	v.Snapshot = *snapshot
	switch os.Args[1] {
	case "login":
		if token == "" || *server == "" {
			return fmt.Errorf("supply --server and ESDP_CLIENT_TOKEN or --token-file")
		}
		if e := v.Refresh(ctx, false); e != nil {
			return e
		}
		cfg = Config{*server, token, *profile, *mode, *cache}
		b, _ := json.MarshalIndent(cfg, "", "  ")
		if e := os.MkdirAll(filepath.Dir(cfgPath), 0700); e != nil {
			return e
		}
		if e := os.WriteFile(cfgPath, b, 0600); e != nil {
			return e
		}
		fmt.Println("Credential verified and stored with mode 0600")
	case "mount":
		_ = v.LoadVerifiedCache()
		if *path == "" {
			return fmt.Errorf("--path is required")
		}
		if e := v.Refresh(ctx, false); e != nil && !v.Authorized() {
			return e
		}
		if e := os.MkdirAll(*path, 0755); e != nil {
			return e
		}
		if e := v.ServeControl(ctx, cancel); e != nil {
			return e
		}
		return mountfs.Mount(ctx, v, *path)
	case "refresh":
		out, e := mountfs.Control(ctx, *cache, "POST", fmt.Sprintf("/refresh?repin=%t", *repin))
		if e != nil {
			return e
		}
		b, _ := json.Marshal(out)
		fmt.Println(string(b))
	case "status":
		if out, e := mountfs.Control(ctx, *cache, "GET", "/status"); e == nil {
			b, _ := json.MarshalIndent(out, "", "  ")
			fmt.Println(string(b))
			return nil
		}
		fmt.Println("Mount is not running. Last verified disk manifest:")
		b, e := os.ReadFile(filepath.Join(*cache, "manifest.json"))
		if e != nil {
			return e
		}
		fmt.Println(string(b))
	case "unmount":
		if _, e := mountfs.Control(ctx, *cache, "POST", "/unmount"); e == nil {
			return nil
		}
		if *path == "" {
			return fmt.Errorf("--path is required")
		}
		return exec.CommandContext(ctx, "fusermount3", "-u", *path).Run()
	default:
		return fmt.Errorf("unknown command")
	}
	return nil
}
