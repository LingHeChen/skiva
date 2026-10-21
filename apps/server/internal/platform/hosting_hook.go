package platform

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"skiva/packages/protocol"
	"strconv"
	"strings"
	"time"
)

type RefUpdate struct {
	Ref string `json:"ref"`
	Old string `json:"oldOid"`
	New string `json:"newOid"`
}
type PushEvent struct {
	ID         string      `json:"id"`
	Repository string      `json:"repositoryId"`
	Actor      string      `json:"actor"`
	Org        string      `json:"org"`
	Updates    []RefUpdate `json:"updates"`
}
type HookContext struct {
	Repository string        `json:"repositoryId"`
	Actor      string        `json:"actor"`
	Org        string        `json:"org"`
	Role       string        `json:"role"`
	Policy     HostingPolicy `json:"policy"`
	Spool      string        `json:"spool"`
}

func zeroOID(oid string) bool { return strings.Trim(oid, "0") == "" }
func matchRefs(rules []string, ref string) bool {
	for _, rule := range rules {
		ok, _ := path.Match(rule, ref)
		if ok {
			return true
		}
	}
	return false
}
func hookGit(ctx context.Context, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=never"}, args...)...)
	// receive-pack owns the quarantine environment; preserve it so rejected objects remain quarantined.
	for _, key := range []string{"PATH", "GIT_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH"} {
		if v := os.Getenv(key); v != "" {
			cmd.Env = append(cmd.Env, key+"="+v)
		}
	}
	cmd.Env = append(cmd.Env, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0")
	var b limitedBuffer
	cmd.Stdout = &b
	cmd.Stderr = io.Discard
	e := cmd.Run()
	return b.Bytes(), e
}
func diskBytes(root string) (int64, error) {
	var size int64
	e := filepath.WalkDir(root, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("unexpected storage symlink")
		}
		if !d.IsDir() {
			st, e := d.Info()
			if e != nil {
				return e
			}
			size += st.Size()
		}
		return nil
	})
	return size, e
}

// RunGitHook is called only by server-owned hook shims, before the application opens any DB connection.
func RunGitHook(mode string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	raw, e := os.ReadFile(os.Getenv("SKIVA_HOOK_CONTEXT"))
	if e != nil {
		return e
	}
	var hc HookContext
	if json.Unmarshal(raw, &hc) != nil {
		return errors.New("invalid hook context")
	}
	scan := bufio.NewScanner(io.LimitReader(os.Stdin, 1<<20))
	updates := []RefUpdate{}
	for scan.Scan() {
		f := strings.Fields(scan.Text())
		if len(f) != 3 || !shaPattern.MatchString(f[0]) || !shaPattern.MatchString(f[1]) || len(updates) >= 256 {
			return errors.New("invalid ref update batch")
		}
		updates = append(updates, RefUpdate{f[2], f[0], f[1]})
	}
	if e = scan.Err(); e != nil {
		return e
	}
	if mode == "post-receive" {
		event := PushEvent{ID(), hc.Repository, hc.Actor, hc.Org, updates}
		if e = os.MkdirAll(hc.Spool, 0700); e != nil {
			return e
		}
		f, e := os.CreateTemp(hc.Spool, ".event-")
		if e != nil {
			return e
		}
		defer os.Remove(f.Name())
		if _, e = f.Write(mustJSON(event)); e == nil {
			e = f.Sync()
		}
		f.Close()
		if e != nil {
			return e
		}
		if e = os.Rename(f.Name(), filepath.Join(hc.Spool, event.ID+".json")); e != nil {
			return e
		}
		d, e := os.Open(hc.Spool)
		if e != nil {
			return e
		}
		defer d.Close()
		return d.Sync()
	}
	if mode != "pre-receive" {
		return errors.New("unsupported hook")
	}
	if e = hc.Policy.validate(); e != nil {
		return e
	}
	dir, e := os.Getwd()
	if e != nil {
		return e
	}
	size, e := diskBytes(dir)
	if e != nil {
		return e
	}
	if size > hc.Policy.MaxRepoBytes {
		return errors.New("repository quota exceeded")
	}
	for _, u := range updates {
		if !(strings.HasPrefix(u.Ref, "refs/heads/") || strings.HasPrefix(u.Ref, "refs/tags/")) {
			return errors.New("only branch and tag refs are allowed")
		}
		if _, e = hookGit(ctx, "check-ref-format", u.Ref); e != nil {
			return errors.New("invalid ref")
		}
		protected := matchRefs(hc.Policy.ProtectedBranches, u.Ref)
		if protected && hc.Role != "maintainer" {
			return errors.New("protected branch requires a maintainer")
		}
		if protected && zeroOID(u.New) {
			return errors.New("protected branch deletion denied")
		}
		if strings.HasPrefix(u.Ref, "refs/tags/") && hc.Policy.ProtectTags && (hc.Role != "maintainer" || !zeroOID(u.Old)) {
			return errors.New("protected tag creation requires maintainer; updates/deletions denied")
		}
		if zeroOID(u.New) {
			continue
		}
		if _, e = hookGit(ctx, "cat-file", "-e", u.New+"^{commit}"); e != nil {
			return errors.New("refs must resolve to a commit")
		}
		if hc.Policy.DenyForcePush && !zeroOID(u.Old) && strings.HasPrefix(u.Ref, "refs/heads/") {
			if _, e = hookGit(ctx, "merge-base", "--is-ancestor", u.Old, u.New); e != nil {
				return errors.New("force push denied")
			}
		}
		// Inspect every newly introduced object, including blobs hidden in intermediate commits.
		args := []string{"rev-list", "--objects", u.New, "--not", "--all"}
		objects, e := hookGit(ctx, args...)
		if e != nil {
			return errors.New("object inspection failed")
		}
		objectLines := strings.Split(strings.TrimSpace(string(objects)), "\n")
		if len(objectLines) > hc.Policy.MaxFiles*4 {
			return errors.New("too many incoming objects")
		}
		for _, line := range objectLines {
			f := strings.Fields(line)
			if len(f) == 0 {
				continue
			}
			b, e := hookGit(ctx, "cat-file", "-s", f[0])
			if e != nil {
				return e
			}
			n, _ := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
			if n > hc.Policy.MaxFileBytes {
				return errors.New("incoming object exceeds file limit")
			}
		}
		b, e := hookGit(ctx, "ls-tree", "-rlz", "--full-tree", u.New+"^{commit}")
		if e != nil {
			return errors.New("tree inspection failed")
		}
		count := 0
		hasSkill := false
		for _, line := range strings.Split(string(b), "\x00") {
			if line == "" {
				continue
			}
			count++
			f := strings.SplitN(line, "\t", 2)
			if len(f) != 2 || !protocol.ValidPath(f[1]) {
				return errors.New("unsafe tree path")
			}
			meta := strings.Fields(f[0])
			if len(meta) != 4 || (meta[0] != "100644" && meta[0] != "100755") {
				return errors.New("symlinks and submodules are forbidden")
			}
			name := strings.ToLower(f[1])
			if path.Base(f[1]) == "SKILL.md" {
				hasSkill = true
			}
			for _, part := range strings.Split(name, "/") {
				if part == ".git" || part == ".ssh" || part == ".env" {
					return errors.New("sensitive path denied")
				}
			}
			if strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".dll") || strings.HasSuffix(name, ".so") || strings.HasSuffix(name, ".dylib") || strings.HasSuffix(name, ".pem") || strings.HasSuffix(name, ".key") {
				return errors.New("file type denied")
			}
		}
		if count > hc.Policy.MaxFiles {
			return errors.New("file count exceeded")
		}
		if !hasSkill {
			return errors.New("Skills repository requires SKILL.md")
		}
	}
	return nil
}
func GitHookMain(mode string) int {
	if e := RunGitHook(mode); e != nil {
		fmt.Fprintln(os.Stderr, "Skiva:", e)
		return 1
	}
	return 0
}
