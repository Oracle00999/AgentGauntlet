#!/bin/sh
set -eu
if [ -d .toolchains/cargo ]; then
  export CARGO_HOME="$PWD/.toolchains/cargo"
  export RUSTUP_HOME="$PWD/.toolchains/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
fi
exec cargo "$@"
