#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export GOTOOLCHAIN=go1.26.10
arch="${1:-arm64}"
GOOS=linux GOARCH="$arch" CGO_ENABLED=0 go test -c -o "bin/mountfs-linux-$arch.test" ./apps/mount/internal/mountfs
# This controlled test container alone gets the FUSE device and SYS_ADMIN mount capability.
docker run --rm --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor=unconfined \
  -e ESDP_TEST_FUSE=1 -v "$PWD/bin:/tests:ro" postgres:17 \
  sh -c 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fuse3 >/dev/null && exec "$1" -test.v' \
  sh "/tests/mountfs-linux-$arch.test"
