package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"gopkg.in/yaml.v3"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"skiva/apps/server/internal/db"
	"skiva/packages/protocol"
	"strconv"
	"strings"
	"time"
)

type Diagnostic struct {
	RuleID   string `json:"ruleId"`
	Severity string `json:"severity"`
	Path     string `json:"path"`
	Line     int    `json:"line"`
	Message  string `json:"message"`
}
type builtSkill struct {
	Name        string
	Description string
	Root        string
	Files       []protocol.File
	Digest      string
	Diagnostics []Diagnostic
}

func (s *Server) Worker(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	reconcile := time.NewTicker(time.Minute)
	defer reconcile.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-reconcile.C:
			s.reconcile(ctx)
		case <-tick.C:
			s.hostingTick(ctx)
			s.job(ctx)
		}
	}
}
func (s *Server) reconcile(ctx context.Context) {
	_, _ = s.DB.Exec(ctx, `INSERT INTO job_queue(id,kind,payload) SELECT gen_random_uuid(),'sync',jsonb_build_object('repositoryId',r.id) FROM repositories r WHERE source_type='external' AND status IN ('active','error') AND deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM job_queue j WHERE j.payload->>'repositoryId'=r.id::text AND j.status IN ('queued','running'))`)
}
func (s *Server) job(ctx context.Context) {
	claimed, e := db.New(s.DB).ClaimJob(ctx)
	id := claimed.ID
	payload := claimed.Payload
	if e != nil {
		return
	}
	var p map[string]string
	if e = json.Unmarshal(payload, &p); e == nil {
		parent := otel.GetTextMapPropagator().Extract(ctx, propagation.MapCarrier(p))
		parent, span := otel.Tracer("skiva").Start(parent, "pipeline.job")
		span.SetAttributes(attribute.String("job.id", fmt.Sprint(id)), attribute.String("repository.id", p["repositoryId"]), attribute.String("request.id", p["requestId"]))
		defer span.End()
		c, cancel := context.WithTimeout(parent, 4*time.Minute)
		if p["ref"] != "" {
			c = context.WithValue(c, ctxKey("buildRef"), p["ref"])
		}
		e = s.build(c, p["repositoryId"], p["commitSha"])
		cancel()
	}
	if e != nil {
		_, _ = s.DB.Exec(ctx, `UPDATE job_queue SET status=CASE WHEN attempts<3 THEN 'queued' ELSE 'failed' END,error=$2,run_after=now()+interval '30 seconds',leased_until=NULL WHERE id=$1`, id, e.Error())
		_, _ = s.DB.Exec(ctx, `UPDATE repositories SET status='error' WHERE id=$1 AND status!='disabled'`, p["repositoryId"])
	} else {
		_, _ = s.DB.Exec(ctx, "UPDATE job_queue SET status='succeeded',leased_until=NULL WHERE id=$1", id)
	}
}
func (s *Server) build(ctx context.Context, repo, commit string) error {
	buildStarted := time.Now()
	var remote, ref, root, org, source, storage string
	e := s.DB.QueryRow(ctx, "SELECT COALESCE(remote_url,''),default_ref,skill_root,org_id,source_type,COALESCE(storage_id::text,'') FROM repositories WHERE id=$1 AND status!='disabled' AND deleted_at IS NULL", repo).Scan(&remote, &ref, &root, &org, &source, &storage)
	if e != nil {
		return e
	}
	if source == "managed" {
		if selected, ok := ctx.Value(ctxKey("buildRef")).(string); ok && selected != "" {
			ref = selected
		}
	}
	if source == "external" {
		if e = s.validateRemote(ctx, remote); e != nil {
			return e
		}
	}
	conn, e := s.DB.Acquire(ctx)
	if e != nil {
		return e
	}
	defer conn.Release()
	var locked bool
	if e = conn.QueryRow(ctx, "SELECT pg_try_advisory_lock(hashtextextended($1,0))", repo).Scan(&locked); e != nil {
		return e
	}
	if !locked {
		return errors.New("repository build is already leased")
	}
	defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock(hashtextextended($1,0))", repo)
	dir := ""
	if source == "managed" {
		dir, e = s.managedPath(storage)
		if e != nil {
			return e
		}
		if commit == "" {
			b, err := s.git(ctx, dir, "rev-parse", "--verify", ref+"^{commit}")
			if err != nil {
				return err
			}
			commit = strings.TrimSpace(string(b))
		}
	} else {
		gc, cleanup, e := s.remoteContext(ctx, repo, remote)
		if e != nil {
			return e
		}
		defer cleanup()
		ctx = gc
		dir = filepath.Join(s.Data, "git", repo)
		if e = os.MkdirAll(dir, 0700); e != nil {
			return e
		}
		if _, e = os.Stat(filepath.Join(dir, "HEAD")); os.IsNotExist(e) {
			if _, e = s.git(ctx, dir, "init", "--bare"); e != nil {
				return e
			}
		}
		if _, e = s.git(ctx, dir, "fetch", "--no-tags", "--no-recurse-submodules", remote, ref); e != nil {
			return e
		}
		if commit == "" {
			b, e := s.git(ctx, dir, "rev-parse", "--verify", "FETCH_HEAD^{commit}")
			if e != nil {
				return e
			}
			commit = strings.TrimSpace(string(b))
		}
	}
	if !shaPattern.MatchString(commit) {
		return errors.New("invalid full commit")
	}
	if _, e = s.git(ctx, dir, "cat-file", "-e", commit+"^{commit}"); e != nil {
		return e
	}
	fetchEnded := time.Now()
	policy := s.policyFor(ctx, org)
	ctx = context.WithValue(ctx, ctxKey("validationPolicy"), policy)
	effectiveRoot, configBytes, effectivePolicy, configErr := s.repoConfig(ctx, dir, commit, root, ref)
	ctx = context.WithValue(ctx, ctxKey("validationPolicy"), effectivePolicy)
	config := protocol.Digest(append(append([]byte(effectiveRoot), configBytes...), mustJSON(policy)...))
	validator := env("SKIVA_VALIDATOR_VERSION", "1")
	run := ID()
	var status string
	e = s.DB.QueryRow(ctx, `INSERT INTO pipeline_runs(id,repository_id,commit_sha,config_digest,validator_version,status,attempt,started_at) VALUES($1,$2,$3,$4,$5,'running',1,now()) ON CONFLICT(repository_id,commit_sha,config_digest,validator_version) DO UPDATE SET attempt=pipeline_runs.attempt+CASE WHEN pipeline_runs.status IN ('failed','queued','running') THEN 1 ELSE 0 END,status=CASE WHEN pipeline_runs.status IN ('failed','queued','running') THEN 'running' ELSE pipeline_runs.status END RETURNING id,status`, run, repo, commit, config, validator).Scan(&run, &status)
	if e != nil {
		return e
	}
	if status == "succeeded" {
		return nil
	}
	scanStarted := time.Now()
	skills, diags, e := s.scan(ctx, dir, commit, effectiveRoot)
	scanEnded := time.Now()
	if configErr != nil {
		diags = append(diags, Diagnostic{"REPOSITORY_CONFIG", "blocker", ".skills-platform.yaml", 1, configErr.Error()})
	}
	if e != nil {
		diags = append(diags, Diagnostic{"TREE_SCAN", "blocker", "", 0, e.Error()})
	}
	blocked := false
	for _, d := range diags {
		if d.Severity == "blocker" {
			blocked = true
		}
	}
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	final := "succeeded"
	if blocked {
		final = "failed"
	}
	for _, step := range []string{"fetch", "discover", "validate", "artifact"} {
		st := "succeeded"
		if blocked && (step == "validate" || step == "artifact") {
			st = "failed"
		}
		_, e = tx.Exec(ctx, `INSERT INTO pipeline_steps(id,pipeline_id,step_key,status,diagnostics,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(pipeline_id,step_key) DO UPDATE SET status=excluded.status,diagnostics=excluded.diagnostics,started_at=excluded.started_at,ended_at=excluded.ended_at`, ID(), run, step, st, mustJSON(diags), func() time.Time {
			if step == "fetch" {
				return buildStarted
			}
			return scanStarted
		}(), func() time.Time {
			if step == "fetch" {
				return fetchEnded
			}
			return scanEnded
		}())
		if e != nil {
			return e
		}
	}
	if !blocked {
		for _, sk := range skills {
			var sid string
			e = tx.QueryRow(ctx, `INSERT INTO skills(id,org_id,repository_id,relative_path,canonical_name,description) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(repository_id,relative_path) DO UPDATE SET canonical_name=excluded.canonical_name,description=excluded.description RETURNING id`, ID(), org, repo, sk.Root, sk.Name, sk.Description).Scan(&sid)
			if e != nil {
				return e
			}
			_, e = tx.Exec(ctx, `INSERT INTO skill_versions(id,skill_id,pipeline_id,commit_sha,content_digest,manifest_digest,metadata) VALUES($1,$2,$3,$4,$5,$5,$6) ON CONFLICT(skill_id,content_digest) DO NOTHING`, ID(), sid, run, commit, sk.Digest, mustJSON(map[string]any{"files": sk.Files, "name": sk.Name, "description": sk.Description, "diagnostics": sk.Diagnostics}))
			if e != nil {
				return e
			}
			for _, f := range sk.Files {
				_, e = tx.Exec(ctx, "INSERT INTO artifacts(digest,byte_size,storage_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", f.Digest, f.Size, f.Digest[7:])
				if e != nil {
					return e
				}
			}
		}
	}
	_, e = tx.Exec(ctx, "UPDATE pipeline_runs SET status=$2,ended_at=now(),error_summary=$3 WHERE id=$1", run, final, func() any {
		if blocked {
			return "Validation failed; see diagnostics"
		}
		return nil
	}())
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "UPDATE repositories SET status='active',last_commit_sha=$2,last_sync_at=now() WHERE id=$1 AND status!='disabled'", repo, commit)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO notifications(id,org_id,title,href) VALUES($1,$2,$3,$4)", ID(), org, "Pipeline "+final, "/pipelines/"+run)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Server) scan(ctx context.Context, dir, commit, root string) ([]builtSkill, []Diagnostic, error) {
	out, e := s.git(ctx, dir, "ls-tree", "-rlz", "--full-tree", commit)
	if e != nil {
		return nil, nil, e
	}
	type entry struct {
		mode, oid string
		size      int64
	}
	entries := map[string]entry{}
	contents := map[string][]byte{}
	diags := []Diagnostic{}
	var total int64
	policy, ok := ctx.Value(ctxKey("validationPolicy")).(ValidationPolicy)
	if !ok {
		policy = defaultPolicy()
	}
	for _, raw := range strings.Split(string(out), "\x00") {
		if raw == "" {
			continue
		}
		parts := strings.SplitN(raw, "\t", 2)
		if len(parts) != 2 {
			return nil, nil, errors.New("invalid tree")
		}
		fields := strings.Fields(parts[0])
		name := parts[1]
		if !protocol.ValidPath(name) {
			return nil, nil, errors.New("unsafe path: " + name)
		}
		if len(fields) != 4 {
			return nil, nil, errors.New("invalid tree entry")
		}
		if fields[0] != "100644" && fields[0] != "100755" {
			diags = append(diags, Diagnostic{"SPECIAL_INODE", "blocker", name, 0, "Symlinks and submodules are forbidden"})
			continue
		}
		size, _ := strconv.ParseInt(fields[3], 10, 64)
		total += size
		if size > policy.MaxFileBytes || total > policy.MaxTotalBytes || len(entries) >= policy.MaxFiles || strings.Count(name, "/") > 32 {
			return nil, nil, errors.New("tree resource limits exceeded")
		}
		entries[name] = entry{fields[0], fields[2], size}
	}
	for name, en := range entries {
		b, e := s.git(ctx, dir, "cat-file", "blob", en.oid)
		if e != nil {
			return nil, nil, e
		}
		contents[name] = b
	}
	skills := []builtSkill{}
	names := []string{}
	for name := range entries {
		if path.Base(name) == "SKILL.md" && (name == "SKILL.md" || root == "" || strings.HasPrefix(name, root+"/")) {
			names = append(names, name)
		}
	}
	for _, name := range names {
		b := contents[name]
		parts := regexp.MustCompile(`(?s)\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)`).FindStringSubmatch(string(b))
		var meta struct {
			Name        string `yaml:"name"`
			Description string `yaml:"description"`
		}
		if len(parts) != 2 || yaml.Unmarshal([]byte(parts[1]), &meta) != nil || !regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`).MatchString(meta.Name) || len(meta.Name) > 64 || meta.Description == "" {
			diags = append(diags, Diagnostic{"SKILL_METADATA", "blocker", name, 1, "SKILL.md requires YAML name (lowercase slug) and description"})
			continue
		}
		base := path.Dir(name)
		sk := builtSkill{Name: meta.Name, Description: meta.Description, Root: base, Files: []protocol.File{}, Diagnostics: []Diagnostic{}}
		for file, en := range entries {
			if base != "." && !strings.HasPrefix(file, base+"/") {
				continue
			}
			nested := false
			for _, other := range names {
				if other != name && strings.HasPrefix(other, func() string {
					if base == "." {
						return ""
					}
					return base + "/"
				}()) && strings.HasPrefix(file, path.Dir(other)+"/") {
					nested = true
				}
			}
			if nested {
				continue
			}
			body := contents[file]
			rel := file
			if base != "." {
				rel = strings.TrimPrefix(file, base+"/")
			}
			if strings.HasPrefix(string(body), "version https://git-lfs.github.com/spec/") {
				diags = append(diags, Diagnostic{"LFS_POINTER", "blocker", file, 1, "LFS objects must be materialized before publication"})
			}
			if bytesSecret(body) {
				diags = append(diags, Diagnostic{"SECRET_DETECTED", "blocker", file, 1, "Potential private key or credential"})
			}
			if en.mode == "100755" || strings.HasSuffix(file, ".sh") || strings.HasSuffix(file, ".py") || strings.HasPrefix(string(body), "#!") || regexp.MustCompile(`\.(js|ts|rb|pl|ps1|bat|cmd|exe|com)$`).MatchString(file) {
				severity := "warning"
				if policy.BlockScripts {
					severity = "blocker"
				}
				d := Diagnostic{"EXECUTABLE_CONTENT", severity, file, 1, "Script is distributed read-only; never executed during CI"}
				diags = append(diags, d)
				sk.Diagnostics = append(sk.Diagnostics, d)
			}
			if strings.HasSuffix(file, ".md") {
				for _, m := range regexp.MustCompile(`\]\(([^)]+)\)`).FindAllStringSubmatch(string(body), -1) {
					target := strings.Split(strings.Trim(m[1], "<>"), "#")[0]
					if policy.BlockExternalLinks && (strings.HasPrefix(target, "https://") || strings.HasPrefix(target, "http://")) {
						diags = append(diags, Diagnostic{"EXTERNAL_LINK", "blocker", file, 1, "External links prohibited by organization policy"})
					}
					if target == "" || strings.HasPrefix(target, "https://") || strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "mailto:") {
						continue
					}
					resolved := path.Join(path.Dir(file), target)
					if strings.HasPrefix(target, "/") || !protocol.ValidPath(resolved) || (base != "." && !strings.HasPrefix(resolved, base+"/")) {
						diags = append(diags, Diagnostic{"REFERENCE_ESCAPE", "blocker", file, 1, "Reference escapes Skill directory: " + target})
					} else if _, ok := contents[resolved]; !ok {
						diags = append(diags, Diagnostic{"REFERENCE_MISSING", "blocker", file, 1, "Referenced file not found: " + target})
					}
				}
			}
			digest, e := s.put(body)
			if e != nil {
				return nil, nil, e
			}
			sk.Files = append(sk.Files, protocol.File{Path: rel, Type: "file", Size: int64(len(body)), Digest: digest, Mode: 0444})
		}
		canonical, e := protocol.Canonical(sk.Files)
		if e != nil {
			return nil, nil, e
		}
		sk.Digest = protocol.Digest(canonical)
		skills = append(skills, sk)
	}
	if len(skills) == 0 {
		diags = append(diags, Diagnostic{"NO_SKILLS", "blocker", root, 0, "No valid SKILL.md discovered"})
	}
	return skills, diags, nil
}
func bytesSecret(b []byte) bool {
	s := string(b)
	return strings.Contains(s, "PRIVATE KEY-----") || regexp.MustCompile(`AKIA[0-9A-Z]{16}`).Match(b) || regexp.MustCompile(`gh[pousr]_[A-Za-z0-9]{30,}`).Match(b)
}
func (s *Server) pipelines(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',p.id,'repositoryId',p.repository_id,'repositoryName',r.name,'commitSha',p.commit_sha,'status',p.status,'attempt',p.attempt,'createdAt',p.created_at,'errorSummary',p.error_summary) FROM pipeline_runs p JOIN repositories r ON r.id=p.repository_id WHERE r.org_id=$1 AND ($2='' OR p.status=$2) AND ($3='' OR r.id::text=$3) ORDER BY p.created_at DESC`, who(r).Org, r.URL.Query().Get("status"), r.URL.Query().Get("repoId"))
}
func (s *Server) pipeline(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, `SELECT jsonb_build_object('id',p.id,'repositoryId',p.repository_id,'commitSha',p.commit_sha,'status',p.status,'attempt',p.attempt,'validatorVersion',p.validator_version,'errorSummary',p.error_summary,'steps',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',step_key,'status',status,'diagnostics',diagnostics,'startedAt',started_at,'endedAt',ended_at)) FROM pipeline_steps WHERE pipeline_id=p.id),'[]')) FROM pipeline_runs p JOIN repositories r ON r.id=p.repository_id WHERE r.org_id=$1 AND p.id=$2`, who(r).Org, chi.URLParam(r, "id"))
}
func (s *Server) retry(w http.ResponseWriter, r *http.Request) {
	var repo, sha string
	e := s.DB.QueryRow(r.Context(), `SELECT p.repository_id,p.commit_sha FROM pipeline_runs p JOIN repositories r ON r.id=p.repository_id WHERE p.id=$1 AND r.org_id=$2 AND p.status='failed'`, chi.URLParam(r, "id"), who(r).Org).Scan(&repo, &sha)
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	id := ID()
	_, e = s.DB.Exec(r.Context(), "INSERT INTO job_queue(id,kind,payload) VALUES($1,'sync',$2)", id, tracedPayload(r.Context(), map[string]string{"repositoryId": repo, "commitSha": sha}))
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	jsonOut(w, 202, map[string]string{"jobId": id})
}

var _ = fmt.Sprintf
