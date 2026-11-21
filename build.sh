#!/bin/sh
# Rebuilds csv.wasm from core/ (Rust, no_std): needs the wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown).
set -e
cd "$(dirname "$0")/core"
cargo build --release
cp target/wasm32-unknown-unknown/release/csvcore.wasm ../csv.wasm
