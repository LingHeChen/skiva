package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"skiva/apps/server/internal/platform"
	"syscall"
	"time"
)

func main() {
	if len(os.Args) == 3 && os.Args[1] == "git-hook" {
		os.Exit(platform.GitHookMain(os.Args[2]))
	}
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		if e := healthcheck(); e != nil {
			os.Exit(1)
		}
		return
	}
	if e := loadSecrets(); e != nil {
		slog.Error("configuration", "error", e)
		os.Exit(1)
	}
	if len(os.Args) == 2 && os.Args[1] == "migrate" {
		if e := migrate(); e != nil {
			slog.Error("migration", "error", e)
			os.Exit(1)
		}
		return
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	shutdown, e := platform.InitTelemetry(ctx)
	if e != nil {
		slog.Error("telemetry", "error", e)
		os.Exit(1)
	}
	defer shutdown(context.Background())
	s, e := platform.New(ctx)
	if e != nil {
		slog.Error("startup", "error", e)
		os.Exit(1)
	}
	defer s.DB.Close()
	if e = s.Bootstrap(ctx); e != nil {
		slog.Error("bootstrap", "error", e)
		os.Exit(1)
	}
	go s.Worker(ctx)
	addr := os.Getenv("SKIVA_LISTEN")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	srv := &http.Server{Addr: addr, Handler: s.Router(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		<-ctx.Done()
		c, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		srv.Shutdown(c)
	}()
	slog.Info("server ready", "address", addr)
	if e = srv.ListenAndServe(); e != http.ErrServerClosed {
		slog.Error("server", "error", e)
		os.Exit(1)
	}
}
