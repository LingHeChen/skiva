package platform

import (
	"context"
	"skiva/packages/protocol"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRBAC(t *testing.T) {
	if has(actor{Roles: []string{"repo_maintainer"}}, "release_manager") {
		t.Fatal("maintainer can publish")
	}
	if !has(actor{Roles: []string{"org_admin"}}, "agent_manager") {
		t.Fatal("admin denied")
	}
}
func TestSSRF(t *testing.T) {
	s := &Server{}
	for _, u := range []string{"file:///etc/passwd", "https://127.0.0.1/repo", "https://169.254.169.254/latest", "https://[::1]/repo", "ssh://127.0.0.1/repo", "https://user:password@example.com/x"} {
		if s.validateRemote(context.Background(), u) == nil {
			t.Errorf("accepted %s", u)
		}
	}
}
func TestCAS(t *testing.T) {
	s := &Server{Data: t.TempDir()}
	os.MkdirAll(filepath.Join(s.Data, "objects"), 0700)
	d, e := s.put([]byte("bytes"))
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.get(d); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(filepath.Join(s.Data, "objects", d[7:]), []byte("wrong"), 0600)
	if _, e = s.get(d); e == nil {
		t.Fatal("corrupt blob returned")
	}
	if _, e = s.get("../../secret"); e == nil {
		t.Fatal("traversal allowed")
	}
}
func gitTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	c := exec.Command("git", args...)
	c.Dir = dir
	c.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com", "GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com")
	b, e := c.CombinedOutput()
	if e != nil {
		t.Fatalf("git %v: %v %s", args, e, b)
	}
	return strings.TrimSpace(string(b))
}
func TestE01E02E05E17TreeScan(t *testing.T) {
	for _, tt := range []struct {
		name, root, body string
		symlink          bool
		block            bool
	}{{"single", "", "---\nname: sample\ndescription: Safe\n---\n# Skill", false, false}, {"mono", "skills", "---\nname: sample\ndescription: Safe\n---\n# Skill", false, false}, {"missing", "", "---\nname: sample\ndescription: Safe\n---\n[missing](missing.md)", false, true}, {"symlink", "", "---\nname: sample\ndescription: Safe\n---\n# Skill", true, true}} {
		t.Run(tt.name, func(t *testing.T) {
			dir := t.TempDir()
			gitTest(t, dir, "init")
			folder := dir
			if tt.root != "" {
				folder = filepath.Join(dir, tt.root, "sample")
				os.MkdirAll(folder, 0700)
			}
			os.WriteFile(filepath.Join(folder, "SKILL.md"), []byte(tt.body), 0600)
			if tt.symlink {
				os.Symlink("/etc/passwd", filepath.Join(dir, "escape"))
			}
			gitTest(t, dir, "add", ".")
			gitTest(t, dir, "commit", "-m", "fixture")
			sha := gitTest(t, dir, "rev-parse", "HEAD")
			s := &Server{Data: t.TempDir()}
			os.MkdirAll(filepath.Join(s.Data, "objects"), 0700)
			skills, diags, e := s.scan(context.Background(), dir, sha, tt.root)
			if e != nil {
				t.Fatal(e)
			}
			blocked := false
			for _, d := range diags {
				blocked = blocked || d.Severity == "blocker"
			}
			if blocked != tt.block {
				t.Fatalf("unexpected diagnostics: %+v", diags)
			}
			if !blocked && (len(skills) != 1 || !protocol.ValidDigest(skills[0].Digest)) {
				t.Fatal("no valid artifact")
			}
		})
	}
}
func TestPipelineConfigAndLimits(t *testing.T) {
	s := &Server{}
	p := defaultPolicy()
	if validatePolicy(p) != nil {
		t.Fatal("invalid defaults")
	}
	p.MaxFileBytes = 0
	if validatePolicy(p) == nil {
		t.Fatal("unsafe threshold accepted")
	}
	for _, raw := range []string{"---\nname: UpperCase\ndescription: test\n---\ntext", "---\nname: safe\ndescription: test\n---\n[x](../../outside)"} {
		dir := t.TempDir()
		gitTest(t, dir, "init")
		os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(raw), 0600)
		gitTest(t, dir, "add", ".")
		gitTest(t, dir, "commit", "-m", "unsafe")
		sha := gitTest(t, dir, "rev-parse", "HEAD")
		s.Data = t.TempDir()
		os.MkdirAll(filepath.Join(s.Data, "objects"), 0700)
		_, diags, e := s.scan(context.Background(), dir, sha, "")
		if e != nil {
			t.Fatal(e)
		}
		blocked := false
		for _, d := range diags {
			blocked = blocked || d.Severity == "blocker"
		}
		if !blocked {
			t.Fatal("unsafe skill accepted")
		}
	}
}
