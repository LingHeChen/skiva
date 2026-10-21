package platform

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"sync/atomic"
)

var gitReceiveBytes atomic.Int64
var gitProcessMillis atomic.Int64
var gitProcessCount atomic.Int64
var gitRejected atomic.Int64
var gitProvisionFailures atomic.Int64
var gitDiskBytes atomic.Int64
var gitRequests = map[string]int64{}

func (s *Server) gitSecurity(ctx context.Context, a actor, repo, reason string) {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return
	}
	defer tx.Rollback(ctx)
	_ = audit(ctx, tx, a, "git.access.rejected", "repository", repo, nil, map[string]string{"reason": reason})
	_ = tx.Commit(ctx)
}
func (s *Server) hostingMetrics(w http.ResponseWriter, r *http.Request) {
	metricsMu.Lock()
	for key, n := range gitRequests {
		fmt.Fprintf(w, "git_http_requests_total{%s} %d\n", key, n)
	}
	metricsMu.Unlock()
	fmt.Fprintf(w, "git_receive_bytes_total %d\ngit_push_rejected_total{reason=\"policy_or_transport\"} %d\ngit_process_duration_seconds_sum %g\ngit_process_duration_seconds_count %d\ngit_repo_disk_bytes %d\nmanaged_repository_provision_failures_total %d\n", gitReceiveBytes.Load(), gitRejected.Load(), float64(gitProcessMillis.Load())/1000, gitProcessCount.Load(), gitDiskBytes.Load(), gitProvisionFailures.Load())
	for name, q := range map[string]string{"git_ref_event_pending": "SELECT count(*) FROM repository_ref_events WHERE processed_at IS NULL", "git_ref_reconcile_lag_seconds": "SELECT COALESCE(extract(epoch FROM now()-min(observed_at)),0)::float8 FROM repository_ref_events WHERE processed_at IS NULL"} {
		var n float64
		if s.DB.QueryRow(r.Context(), q).Scan(&n) == nil {
			fmt.Fprintf(w, "%s %g\n", name, n)
		}
	}
}

// VerifyManagedStorage is used by backup restore/maintenance, never the request path.
func (s *Server) VerifyManagedStorage(ctx context.Context) error {
	rows, e := s.DB.Query(ctx, "SELECT id,storage_id FROM repositories WHERE source_type='managed' AND provision_state='active'")
	if e != nil {
		return e
	}
	type repo struct{ id, storage string }
	repos := []repo{}
	for rows.Next() {
		var v repo
		if e = rows.Scan(&v.id, &v.storage); e != nil {
			rows.Close()
			return e
		}
		repos = append(repos, v)
	}
	rows.Close()
	for _, v := range repos {
		dir, e := s.managedPath(v.storage)
		if e != nil {
			return e
		}
		if _, e = s.git(ctx, dir, "fsck", "--full"); e != nil {
			return fmt.Errorf("managed repository %s integrity failed: %w", v.id, e)
		}
		if _, e = s.git(ctx, dir, "for-each-ref", "--format=%(refname) %(objectname)"); e != nil {
			return e
		}
	}
	if size, e := diskBytes(filepath.Join(s.Data, "managed-git")); e == nil {
		gitDiskBytes.Store(size)
	}
	return nil
}
