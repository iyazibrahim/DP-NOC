#!/bin/sh
set -eu

# 6h OOO: site Alloy WAL replay after CF tunnel downtime can lag >30m; still bounded.
BASE_FLAGS="--config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus --web.enable-lifecycle --web.enable-remote-write-receiver --storage.tsdb.out_of_order_time_window=6h"

EXTRA=""
FLAGS_FILE="/etc/prometheus/runtime/prometheus-retention.flags"
if [ -f "$FLAGS_FILE" ]; then
  EXTRA="$(grep -v '^#' "$FLAGS_FILE" | tr '\n' ' ')"
else
  EXTRA="--storage.tsdb.retention.time=30d --storage.tsdb.retention.size=10GB --storage.tsdb.wal-compression"
fi

# shellcheck disable=SC2086
exec /bin/prometheus $BASE_FLAGS $EXTRA "$@"
