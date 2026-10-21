package platform

import (
	"context"
	"fmt"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var metricsMu sync.Mutex
var contentRequests = map[int]int64{}
var apiRequests = map[int]int64{}
var auditFailures atomic.Int64
var promoteConflicts atomic.Int64

func InitTelemetry(ctx context.Context) (func(context.Context) error, error) {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	otel.SetTextMapPropagator(propagation.TraceContext{})
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		return func(context.Context) error { return nil }, nil
	}
	exporter, e := otlptracehttp.New(ctx)
	if e != nil {
		return nil, e
	}
	provider := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter), sdktrace.WithResource(resource.NewSchemaless(attribute.String("service.name", "esdp-server"))))
	otel.SetTracerProvider(provider)
	return provider.Shutdown, nil
}
func observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
		ctx, span := otel.Tracer("esdp").Start(ctx, r.Method)
		defer span.End()
		r = r.WithContext(ctx)
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		status := ww.Status()
		if status == 0 {
			status = 200
		}
		route := chi.RouteContext(r.Context()).RoutePattern()
		span.SetName(r.Method + " " + route)
		span.SetAttributes(attribute.String("request.id", fmt.Sprint(r.Context().Value(ctxKey("requestId")))), attribute.String("http.route", route), attribute.Int("http.response.status_code", status))
		metricsMu.Lock()
		apiRequests[status]++
		if strings.HasPrefix(r.URL.Path, "/distribution/") {
			contentRequests[status]++
		}
		metricsMu.Unlock()
		slog.Info("http.request", "requestId", r.Context().Value(ctxKey("requestId")), "method", r.Method, "route", route, "status", status, "durationMs", time.Since(start).Milliseconds())
	})
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	metricsMu.Lock()
	for _, item := range []struct {
		name string
		data map[int]int64
	}{{"http_requests_total", apiRequests}, {"content_requests_total", contentRequests}} {
		keys := []int{}
		for code := range item.data {
			keys = append(keys, code)
		}
		sort.Ints(keys)
		for _, code := range keys {
			fmt.Fprintf(w, "%s{status=\"%d\"} %d\n", item.name, code, item.data[code])
		}
	}
	metricsMu.Unlock()
	fmt.Fprintf(w, "audit_write_failures_total %d\nchannel_promote_conflicts_total %d\n", auditFailures.Load(), promoteConflicts.Load())
	queries := map[string]string{"esdp_job_queue_pending": "SELECT count(*) FROM job_queue WHERE status IN ('queued','running')", "esdp_clients_stale": "SELECT count(*) FROM mount_clients WHERE revoked_at IS NULL AND (last_seen_at IS NULL OR last_seen_at<now()-interval '5 minutes')", "esdp_credentials_expiring": "SELECT count(*) FROM mount_clients WHERE revoked_at IS NULL AND expires_at<now()+interval '7 days'", "esdp_repositories_error": "SELECT count(*) FROM repositories WHERE status='error' AND deleted_at IS NULL", "pipeline_failures_total": "SELECT count(*) FROM pipeline_runs WHERE status='failed'", "pipeline_duration_seconds_sum": "SELECT COALESCE(sum(extract(epoch FROM ended_at-started_at)),0)::float8 FROM pipeline_runs WHERE ended_at IS NOT NULL", "pipeline_duration_seconds_count": "SELECT count(*) FROM pipeline_runs WHERE ended_at IS NOT NULL"}
	for name, q := range queries {
		var n float64
		if s.DB.QueryRow(r.Context(), q).Scan(&n) == nil {
			fmt.Fprintf(w, "%s %g\n", name, n)
		}
	}
	clientRows, err := s.DB.Query(r.Context(), "SELECT id::text,COALESCE(extract(epoch FROM now()-last_seen_at),0)::float8,COALESCE((telemetry->>'cacheHits')::float8,0),COALESCE((telemetry->>'cacheMisses')::float8,0) FROM mount_clients WHERE revoked_at IS NULL")
	if err == nil {
		for clientRows.Next() {
			var id string
			var stale, hits, misses float64
			if clientRows.Scan(&id, &stale, &hits, &misses) == nil {
				fmt.Fprintf(w, "client_staleness_seconds{client=%q} %g\n", id, stale)
				if hits+misses > 0 {
					fmt.Fprintf(w, "mount_cache_hit_ratio{client=%q} %g\n", id, hits/(hits+misses))
				}
			}
		}
		clientRows.Close()
	}
	rows, e := s.DB.Query(r.Context(), "SELECT name,generation FROM channels WHERE org_id=$1", s.Org)
	if e == nil {
		defer rows.Close()
		for rows.Next() {
			var name string
			var gen int64
			rows.Scan(&name, &gen)
			fmt.Fprintf(w, "manifest_generation{channel=%q} %d\n", name, gen)
		}
	}
}

// Job payloads carry only trace metadata, never credentials.
func tracedPayload(ctx context.Context, values map[string]string) []byte {
	carrier := propagation.MapCarrier(values)
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	if id, ok := ctx.Value(ctxKey("requestId")).(string); ok {
		values["requestId"] = id
	}
	return mustJSON(values)
}
