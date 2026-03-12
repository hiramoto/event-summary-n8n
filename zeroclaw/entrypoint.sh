#!/bin/sh
set -e

# Fix ownership of volume-mounted directories
chown zeroclaw:zeroclaw /workspace

exec gosu zeroclaw "$@"
