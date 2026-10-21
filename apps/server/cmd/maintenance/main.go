package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"skiva/packages/protocol"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
func run() error {
	ctx := context.Background()
	dsn := os.Getenv("SKIVA_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://skiva:skiva-dev@localhost:55432/skiva?sslmode=disable"
	}
	data := os.Getenv("SKIVA_DATA_DIR")
	if data == "" {
		data = ".data"
	}
	db, e := pgxpool.New(ctx, dsn)
	if e != nil {
		return e
	}
	defer db.Close()
	mode := "verify"
	if len(os.Args) > 1 {
		mode = os.Args[1]
	}
	if mode != "verify" && mode != "gc" && mode != "audit-export" {
		return fmt.Errorf("usage: maintenance verify|gc|audit-export")
	}
	if mode == "audit-export" {
		rows, e := db.Query(ctx, "SELECT row_to_json(a) FROM audit_logs a ORDER BY created_at,id")
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var b []byte
			rows.Scan(&b)
			fmt.Println(string(b))
		}
		return rows.Err()
	}
	rows, e := db.Query(ctx, "SELECT metadata FROM skill_versions")
	if e != nil {
		return e
	}
	keep := map[string]int64{}
	for rows.Next() {
		var meta []byte
		rows.Scan(&meta)
		var m struct {
			Files []protocol.File `json:"files"`
		}
		if e = json.Unmarshal(meta, &m); e != nil {
			return e
		}
		for _, f := range m.Files {
			keep[f.Digest] = f.Size
		}
	}
	rows.Close()
	bad := 0
	for digest, size := range keep {
		b, e := os.ReadFile(filepath.Join(data, "objects", strings.TrimPrefix(digest, "sha256:")))
		if e != nil || int64(len(b)) != size || protocol.Digest(b) != digest {
			fmt.Fprintf(os.Stderr, "INTEGRITY_FAILURE %s\n", digest)
			bad++
		}
	}
	if bad > 0 {
		return fmt.Errorf("%d referenced objects missing or corrupt", bad)
	}
	if mode == "gc" {
		entries, e := os.ReadDir(filepath.Join(data, "objects"))
		if e != nil {
			return e
		}
		removed := 0
		for _, en := range entries {
			info, e := en.Info()
			if e != nil || info.IsDir() || time.Since(info.ModTime()) < 24*time.Hour {
				continue
			}
			name := en.Name()
			if len(name) != sha256.Size*2 {
				continue
			}
			if _, e = hex.DecodeString(name); e != nil {
				continue
			}
			if _, ok := keep["sha256:"+name]; !ok {
				if e = os.Remove(filepath.Join(data, "objects", name)); e != nil {
					return e
				}
				removed++
			}
		}
		fmt.Printf("Removed %d unreferenced objects older than 24h; retained every version and snapshot object\n", removed)
	}
	fmt.Printf("Verified %d referenced objects\n", len(keep))
	return nil
}
