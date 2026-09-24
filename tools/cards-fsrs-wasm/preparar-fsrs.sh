#!/usr/bin/env bash
# Prepara fsrs-6.6.2-wasm/: o crate OFICIAL fsrs 6.6.2 do crates.io (SHA-256
# fixado) com um único patch — a verificação de saúde
# (evaluate_with_time_series_splits) avalia as divisões em sequência no wasm32,
# onde um job de rayon::spawn nunca executa e a espera pelo canal travava.
set -euo pipefail
cd "$(dirname "$0")"
SHA=89836c0a26b347b585b23824034600b69bfc7f0b0112d0cd656791799eb3a717
TMP=$(mktemp -d)
curl -sSfL https://static.crates.io/crates/fsrs/fsrs-6.6.2.crate -o "$TMP/fsrs.crate"
echo "$SHA  $TMP/fsrs.crate" | sha256sum -c - >/dev/null
rm -rf fsrs-6.6.2-wasm
tar -xzf "$TMP/fsrs.crate" -C "$TMP"
mv "$TMP/fsrs-6.6.2" fsrs-6.6.2-wasm
patch -p1 -d fsrs-6.6.2-wasm < fsrs-6.6.2-wasm-sequencial.patch
rm -rf "$TMP"
