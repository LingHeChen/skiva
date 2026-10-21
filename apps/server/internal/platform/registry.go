package platform

import (
	"encoding/json"
	"skiva/packages/protocol"
	"github.com/go-chi/chi/v5"
	"net/http"
	"strings"
)

func (s *Server) skills(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',sk.id,'name',sk.canonical_name,'description',sk.description,'repositoryId',sk.repository_id,'repositoryName',r.name,'relativePath',sk.relative_path,'latestVersionId',(SELECT id FROM skill_versions WHERE skill_id=sk.id ORDER BY created_at DESC LIMIT 1)) FROM skills sk JOIN repositories r ON r.id=sk.repository_id WHERE sk.org_id=$1 AND ($2='' OR sk.canonical_name ILIKE '%'||$2||'%') AND ($3='' OR sk.repository_id::text=$3) ORDER BY sk.canonical_name,sk.id`, who(r).Org, r.URL.Query().Get("query"), r.URL.Query().Get("repoId"))
}
func (s *Server) skill(w http.ResponseWriter, r *http.Request) {
	s.one(w, r, `SELECT jsonb_build_object('id',id,'name',canonical_name,'description',description,'repositoryId',repository_id,'relativePath',relative_path) FROM skills WHERE org_id=$1 AND id=$2`, who(r).Org, chi.URLParam(r, "id"))
}
func (s *Server) versions(w http.ResponseWriter, r *http.Request) {
	s.list(w, r, `SELECT jsonb_build_object('id',v.id,'commitSha',v.commit_sha,'contentDigest',v.content_digest,'createdAt',v.created_at,'metadata',jsonb_set(v.metadata,'{diagnostics}',COALESCE(NULLIF(v.metadata->'diagnostics','null'::jsonb),'[]'::jsonb)),'pipelineId',v.pipeline_id) FROM skill_versions v JOIN skills s ON s.id=v.skill_id WHERE s.org_id=$1 AND s.id=$2 ORDER BY v.created_at DESC`, who(r).Org, chi.URLParam(r, "id"))
}
func (s *Server) versionFiles(r *http.Request, id string) ([]protocol.File, error) {
	var meta []byte
	e := s.DB.QueryRow(r.Context(), "SELECT v.metadata FROM skill_versions v JOIN skills s ON s.id=v.skill_id WHERE v.id=$1 AND s.org_id=$2", id, who(r).Org).Scan(&meta)
	if e != nil {
		return nil, e
	}
	var m struct {
		Files []protocol.File `json:"files"`
	}
	e = json.Unmarshal(meta, &m)
	return m.Files, e
}
func (s *Server) version(w http.ResponseWriter, r *http.Request) {
	files, e := s.versionFiles(r, chi.URLParam(r, "id"))
	if e != nil {
		s.dbError(w, r, e)
		return
	}
	switch pathAction(r) {
	case "tree":
		jsonOut(w, 200, map[string]any{"items": files, "nextCursor": nil})
	case "file":
		name := r.URL.Query().Get("path")
		if !protocol.ValidPath(name) {
			fail(w, r, 400, "INVALID_PATH", "Invalid relative file path")
			return
		}
		for _, f := range files {
			if f.Path == name {
				b, e := s.get(f.Digest)
				if e != nil {
					fail(w, r, 503, "OBJECT_UNAVAILABLE", "Artifact missing or damaged")
					return
				}
				jsonOut(w, 200, map[string]any{"path": name, "content": string(b), "digest": f.Digest})
				return
			}
		}
		fail(w, r, 404, "NOT_FOUND", "File not found")
	case "diff":
		old, e := s.versionFiles(r, r.URL.Query().Get("against"))
		if e != nil {
			s.dbError(w, r, e)
			return
		}
		before := map[string]protocol.File{}
		for _, f := range old {
			before[f.Path] = f
		}
		diff := []map[string]any{}
		for _, f := range files {
			prior, ok := before[f.Path]
			if !ok || prior.Digest != f.Digest {
				b, _ := s.get(f.Digest)
				a := []byte{}
				kind := "added"
				if ok {
					a, _ = s.get(prior.Digest)
					kind = "changed"
				}
				diff = append(diff, map[string]any{"path": f.Path, "status": kind, "before": string(a), "after": string(b)})
			}
			delete(before, f.Path)
		}
		for _, f := range before {
			a, _ := s.get(f.Digest)
			diff = append(diff, map[string]any{"path": f.Path, "status": "removed", "before": string(a), "after": ""})
		}
		jsonOut(w, 200, map[string]any{"items": diff})
	}
}

var _ = strings.Compare
