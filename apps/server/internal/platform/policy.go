package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"skiva/packages/protocol"
	"gopkg.in/yaml.v3"
	"strings"
)

type ValidationPolicy struct {
	MaxFileBytes       int64 `json:"maxFileBytes"`
	MaxTotalBytes      int64 `json:"maxTotalBytes"`
	MaxFiles           int   `json:"maxFiles"`
	BlockScripts       bool  `json:"blockScripts"`
	BlockExternalLinks bool  `json:"blockExternalLinks"`
}

func defaultPolicy() ValidationPolicy {
	return ValidationPolicy{MaxFileBytes: 8 << 20, MaxTotalBytes: 64 << 20, MaxFiles: 10000}
}
func (s *Server) policyFor(ctx context.Context, org string) ValidationPolicy {
	p := defaultPolicy()
	if s.DB != nil {
		var b []byte
		if s.DB.QueryRow(ctx, "SELECT value FROM settings WHERE org_id=$1", org).Scan(&b) == nil {
			json.Unmarshal(b, &p)
		}
	}
	return p
}
func validatePolicy(p ValidationPolicy) error {
	if p.MaxFileBytes < 1024 || p.MaxFileBytes > 32<<20 || p.MaxTotalBytes < p.MaxFileBytes || p.MaxTotalBytes > 256<<20 || p.MaxFiles < 1 || p.MaxFiles > 50000 {
		return errors.New("policy resource limits outside supported range")
	}
	return nil
}

type RepoConfig struct {
	Version int `yaml:"version"`
	Skills  struct {
		Root string `yaml:"root"`
	} `yaml:"skills"`
	Pipeline struct {
		Trigger struct {
			Branches []string `yaml:"branches"`
			Tags     []string `yaml:"tags"`
		} `yaml:"trigger"`
	} `yaml:"pipeline"`
	Validate struct {
		BlockScripts       bool `yaml:"blockScripts"`
		BlockExternalLinks bool `yaml:"blockExternalLinks"`
	} `yaml:"validate"`
}

func (s *Server) repoConfig(ctx context.Context, dir, commit, root, ref string) (string, []byte, ValidationPolicy, error) {
	p, ok := ctx.Value(ctxKey("validationPolicy")).(ValidationPolicy)
	if !ok {
		p = defaultPolicy()
	}
	b, e := s.git(ctx, dir, "show", commit+":.skills-platform.yaml")
	if e != nil {
		return root, nil, p, nil
	}
	if len(b) > 65536 {
		return root, nil, p, errors.New("repository config too large")
	}
	var cfg RepoConfig
	d := yaml.NewDecoder(bytes.NewReader(b))
	d.KnownFields(true)
	if e = d.Decode(&cfg); e != nil {
		return root, b, p, e
	}
	if cfg.Version != 1 {
		return root, b, p, errors.New("unsupported repository config version")
	}
	if cfg.Skills.Root != "" {
		if !protocol.ValidPath(cfg.Skills.Root) {
			return root, b, p, errors.New("unsafe config skill root")
		}
		root = cfg.Skills.Root
	}
	p.BlockScripts = p.BlockScripts || cfg.Validate.BlockScripts
	p.BlockExternalLinks = p.BlockExternalLinks || cfg.Validate.BlockExternalLinks
	allowed := cfg.Pipeline.Trigger.Branches
	prefix := "refs/heads/"
	if strings.HasPrefix(ref, "refs/tags/") {
		allowed = cfg.Pipeline.Trigger.Tags
		prefix = "refs/tags/"
	}
	if len(allowed) > 0 {
		match := false
		for _, v := range allowed {
			match = match || v == strings.TrimPrefix(ref, prefix) || v == ref
		}
		if !match {
			return root, b, p, errors.New("ref excluded by repository trigger policy")
		}
	}
	return root, b, p, nil
}
