package protocol

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestPaths(t *testing.T) {
	for _, p := range []string{"../secret", "/etc/passwd", "a/../../x", "a\\x", "a//b", "a/./b", ".", "a\x00b", "e\u0301/file"} {
		if ValidPath(p) {
			t.Errorf("accepted unsafe path %q", p)
		}
	}
	for _, p := range []string{"sql-query/SKILL.md", "references/指南.md"} {
		if !ValidPath(p) {
			t.Errorf("rejected safe path %q", p)
		}
	}
}
func TestCanonical(t *testing.T) {
	a := File{"a/SKILL.md", "file", 1, Digest([]byte("a")), 0444}
	b := File{"b/SKILL.md", "file", 1, Digest([]byte("b")), 0444}
	x, _ := Canonical([]File{a, b})
	y, _ := Canonical([]File{b, a})
	if string(x) != string(y) {
		t.Fatal("order changes digest")
	}
	m := Manifest{SchemaVersion: 1, ManifestDigest: Digest(x), Files: []File{a, b}}
	if e := m.Validate(); e != nil {
		t.Fatal(e)
	}
	m.Files[0].Size++
	if m.Validate() == nil {
		t.Fatal("tampering accepted")
	}
	if _, e := Canonical([]File{a, a}); e == nil {
		t.Fatal("duplicates accepted")
	}
}
func BenchmarkManifest1000(b *testing.B) {
	files := []File{}
	for i := 0; i < 1000; i++ {
		n, _ := json.Marshal(i)
		files = append(files, File{string(n) + "/SKILL.md", "file", 1, Digest([]byte("a")), 0444})
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Canonical(files)
	}
}
func TestManifestDirectoryFileConflict(t *testing.T) {
	files := []File{{"skill/a", "file", 1, Digest([]byte("a")), 0444}, {"skill/a/b", "file", 1, Digest([]byte("b")), 0444}}
	if _, e := Canonical(files); e == nil {
		t.Fatal("file ancestor accepted")
	}
}
func BenchmarkManifestSizes(b *testing.B) {
	for _, n := range []int{1, 100, 1000} {
		b.Run(fmt.Sprint(n, "-skills"), func(b *testing.B) {
			files := []File{}
			for i := 0; i < n; i++ {
				files = append(files, File{fmt.Sprintf("skill-%04d/SKILL.md", i), "file", 1, Digest([]byte("x")), 0444})
			}
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				Canonical(files)
			}
		})
	}
}

func TestGoldenManifest(t *testing.T) {
	data, e := os.ReadFile("../schemas/fixtures/manifest-v1.json")
	if e != nil {
		t.Fatal(e)
	}
	var m Manifest
	if e = json.Unmarshal(data, &m); e != nil {
		t.Fatal(e)
	}
	if e = m.Validate(); e != nil {
		t.Fatal(e)
	}
	golden, e := os.ReadFile("../schemas/fixtures/manifest-v1.canonical.json")
	if e != nil {
		t.Fatal(e)
	}
	actual, e := Canonical(m.Files)
	if e != nil || string(actual) != string(golden) {
		t.Fatal("wire canonicalization changed", e)
	}
}
