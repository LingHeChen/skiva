package protocol

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"golang.org/x/text/unicode/norm"
	"path"
	"sort"
	"strings"
	"unicode/utf8"
)

type File struct {
	Path   string `json:"path"`
	Type   string `json:"type"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
	Mode   uint32 `json:"mode"`
}
type Manifest struct {
	SchemaVersion  int    `json:"schemaVersion"`
	SnapshotID     string `json:"snapshotId"`
	ManifestDigest string `json:"manifestDigest"`
	Generation     int64  `json:"generation"`
	ProfileID      string `json:"profileId"`
	Files          []File `json:"files"`
}

func Digest(b []byte) string { h := sha256.Sum256(b); return "sha256:" + hex.EncodeToString(h[:]) }
func ValidDigest(s string) bool {
	if !strings.HasPrefix(s, "sha256:") || len(s) != 71 {
		return false
	}
	_, e := hex.DecodeString(s[7:])
	return e == nil && strings.ToLower(s) == s
}
func ValidPath(p string) bool {
	return p != "" && utf8.ValidString(p) && norm.NFC.IsNormalString(p) && !strings.ContainsAny(p, "\\\x00\r\n") && !strings.HasPrefix(p, "/") && path.Clean(p) == p && p != "." && p != ".." && !strings.HasPrefix(p, "../") && len(p) <= 4096
}
func Canonical(files []File) ([]byte, error) {
	f := append([]File{}, files...)
	sort.Slice(f, func(i, j int) bool { return f[i].Path < f[j].Path })
	seen := map[string]bool{}
	for i, v := range f {
		for parent := path.Dir(v.Path); parent != "."; parent = path.Dir(parent) {
			if seen[parent] {
				return nil, errors.New("file path conflicts with directory")
			}
		}
		seen[v.Path] = true
		if !ValidPath(v.Path) || !ValidDigest(v.Digest) || v.Size < 0 || v.Type != "file" || (v.Mode != 0444 && v.Mode != 0555) || (i > 0 && f[i-1].Path == v.Path) {
			return nil, errors.New("invalid manifest entry")
		}
	}
	return json.Marshal(f)
}
func (m Manifest) Validate() error {
	if m.SchemaVersion != 1 {
		return errors.New("unsupported manifest schema")
	}
	b, e := Canonical(m.Files)
	if e != nil {
		return e
	}
	if Digest(b) != m.ManifestDigest {
		return errors.New("manifest digest mismatch")
	}
	return nil
}
