//go:build linux

package mountfs

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLinuxFUSERealMount(t *testing.T) {
	if os.Getenv("ESDP_TEST_FUSE") != "1" {
		t.Skip("ESDP_TEST_FUSE=1 and /dev/fuse required")
	}
	v, g, _, close := fixture(t, "dynamic", "allow_cached")
	defer close()
	mountpoint := filepath.Join(t.TempDir(), "mount")
	os.Mkdir(mountpoint, 0755)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Mount(ctx, v, mountpoint) }()
	file := filepath.Join(mountpoint, "skill", "SKILL.md")
	var b []byte
	var e error
	for i := 0; i < 100; i++ {
		b, e = os.ReadFile(file)
		if e == nil {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("mount failed: %v", err)
		default:
		}
		time.Sleep(50 * time.Millisecond)
	}
	if e != nil || string(b) != "old" {
		t.Fatalf("initial read: %q %v", b, e)
	}
	old, e := os.Open(file)
	if e != nil {
		t.Fatal(e)
	}
	defer old.Close()
	g.Store(2)
	if e = v.Refresh(ctx, false); e != nil {
		t.Fatal(e)
	}
	b, e = os.ReadFile(file)
	if e != nil || string(b) != "new" {
		t.Fatalf("new open: %q %v", b, e)
	}
	b, e = io.ReadAll(old)
	if e != nil || string(b) != "old" {
		t.Fatalf("old open: %q %v", b, e)
	}
	if e = os.WriteFile(file, []byte("tamper"), 0644); e == nil {
		t.Fatal("read-only filesystem accepted write")
	}
	entries, e := os.ReadDir(filepath.Dir(file))
	if e != nil || len(entries) != 1 {
		t.Fatal("directory failed", e)
	}
	old.Close()
	cancel()
	select {
	case e := <-done:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("unmount timed out")
	}
}
