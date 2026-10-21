package mountfs

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// CollectCache retains the current tree and every open file handle, then evicts oldest unused objects.
func (v *View) CollectCache(maxBytes int64) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	keep := map[string]bool{}
	if idx := v.Current(); idx != nil {
		for _, f := range idx.Manifest.Files {
			keep[f.Digest] = true
		}
	}
	for digest, n := range v.refs {
		if n > 0 {
			keep[digest] = true
		}
	}
	entries, e := os.ReadDir(filepath.Join(v.Cache, "objects"))
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	files := []os.FileInfo{}
	var total int64
	for _, en := range entries {
		info, e := en.Info()
		if e != nil || info.IsDir() {
			continue
		}
		total += info.Size()
		files = append(files, info)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].ModTime().Before(files[j].ModTime()) })
	for _, f := range files {
		if total <= maxBytes {
			break
		}
		if !keep["sha256:"+f.Name()] && !strings.HasPrefix(f.Name(), ".") {
			if e = os.Remove(filepath.Join(v.Cache, "objects", f.Name())); e != nil {
				return e
			}
			total -= f.Size()
		}
	}
	return nil
}
