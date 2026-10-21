package mountfs

import (
	"bufio"
	"context"
	"io"
	"strings"
)

func consumeEvents(ctx context.Context, v *View, body io.Reader) {
	scanner := bufio.NewScanner(body)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event: revoked") {
			v.revoke()
			return
		}
		if strings.HasPrefix(line, "data:") {
			_ = v.Refresh(ctx, false)
		}
	}
}
