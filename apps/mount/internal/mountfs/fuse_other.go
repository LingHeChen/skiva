//go:build !linux

package mountfs

import (
	"context"
	"errors"
)

func Mount(ctx context.Context, v *View, path string) error {
	return errors.New("Native mounting is supported only on Linux with FUSE; macOS/Windows are not validated")
}
