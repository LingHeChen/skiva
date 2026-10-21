package mountfs

import (
	"encoding/json"
	"errors"
	"esdp/packages/protocol"
	"os"
	"path/filepath"
	"time"
)

type persisted struct {
	Server           string            `json:"server"`
	CredentialDigest string            `json:"credentialDigest"`
	Profile          string            `json:"profile"`
	Mode             string            `json:"mode"`
	Policy           string            `json:"policy"`
	Lease            int64             `json:"lease"`
	LastAuth         int64             `json:"lastAuth"`
	Manifest         protocol.Manifest `json:"manifest"`
}
type authorizationPolicy struct {
	Offline string
	Lease   time.Duration
}

func (v *View) persist(m protocol.Manifest) error {
	b, e := json.Marshal(persisted{v.Server, protocol.Digest([]byte(v.Token)), v.Profile, v.Mode, v.Policy, int64(v.Lease), v.lastAuth.Load(), m})
	if e != nil {
		return e
	}
	return atomicWrite(filepath.Join(v.Cache, "state.json"), b)
}
func (v *View) LoadVerifiedCache() error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, e := os.Stat(filepath.Join(v.Cache, "revoked")); e == nil {
		return ErrDenied
	}
	b, e := os.ReadFile(filepath.Join(v.Cache, "state.json"))
	if e != nil {
		return e
	}
	var p persisted
	if e = json.Unmarshal(b, &p); e != nil {
		return e
	}
	if p.Server != v.Server || p.CredentialDigest != protocol.Digest([]byte(v.Token)) || p.Profile != v.Profile {
		return ErrDenied
	}
	if e = p.Manifest.Validate(); e != nil {
		return e
	}
	if p.Policy != "allow_cached" && time.Since(time.Unix(0, p.LastAuth)) > time.Duration(p.Lease) {
		return ErrDenied
	}
	idx := &Index{Manifest: p.Manifest, Files: map[string]protocol.File{}}
	for _, f := range p.Manifest.Files {
		data, e := os.ReadFile(filepath.Join(v.Cache, "objects", f.Digest[7:]))
		if e != nil || int64(len(data)) != f.Size || protocol.Digest(data) != f.Digest {
			return errors.New("offline cache is incomplete or corrupt")
		}
		idx.Files[f.Path] = f
	}
	v.Mode = p.Mode
	v.Policy = p.Policy
	v.Lease = time.Duration(p.Lease)
	v.policy.Store(&authorizationPolicy{v.Policy, v.Lease})
	v.lastAuth.Store(p.LastAuth)
	v.authorized.Store(true)
	v.current.Store(idx)
	return nil
}
func (v *View) revoke() {
	v.authorized.Store(false)
	_ = atomicWrite(filepath.Join(v.Cache, "revoked"), []byte("revoked"))
}
