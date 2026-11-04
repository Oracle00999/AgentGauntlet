#!/bin/sh
set -eu
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=Darwin-arm64 ;;
  Linux-x86_64) platform=Linux-x86_64 ;;
  *) echo "Unsupported Sandbox platform" >&2; exit 1 ;;
esac
mkdir -p .toolchains/sandbox
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
curl --fail --location --max-time 120 "https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/$platform/2.14.0/near-sandbox.tar.gz" -o "$archive"
tar -xzf "$archive" -C .toolchains/sandbox --strip-components=1
.toolchains/sandbox/near-sandbox --version
