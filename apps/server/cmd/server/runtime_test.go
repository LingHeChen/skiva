package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileSecrets(t *testing.T) {
	for _, key := range []string{"SKIVA_DATABASE_URL", "SKIVA_ADMIN_PASSWORD", "SKIVA_OIDC_CLIENT_SECRET"} {
		t.Setenv(key, "")
		t.Setenv(key+"_FILE", "")
	}
	file := filepath.Join(t.TempDir(), "secret")
	t.Setenv("SKIVA_ADMIN_PASSWORD_FILE", file)
	if err := loadSecrets(); err == nil {
		t.Fatal("missing file accepted")
	}
	for _, value := range []string{"", strings.Repeat("x", 65537)} {
		if err := os.WriteFile(file, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
		if err := loadSecrets(); err == nil {
			t.Fatal("invalid secret accepted")
		}
	}
	if err := os.WriteFile(file, []byte(" secret with spaces \r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := loadSecrets(); err != nil {
		t.Fatal(err)
	}
	if os.Getenv("SKIVA_ADMIN_PASSWORD") != " secret with spaces " {
		t.Fatal("secret changed")
	}
	if err := loadSecrets(); err == nil {
		t.Fatal("conflicting settings accepted")
	}
}
