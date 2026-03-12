#!/bin/sh
set -e

# Fix ownership of volume-mounted directories
chown -R zeroclaw:zeroclaw /workspace /home/zeroclaw/.zeroclaw

exec gosu zeroclaw "$@"
