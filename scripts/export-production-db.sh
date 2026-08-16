#!/usr/bin/env bash
# ABOUTME: Streams a reconstructable production Supabase export into compressed private archives.
# ABOUTME: Keeps credentials and uncompressed database contents out of persistent files.

set -euo pipefail

readonly RESERVE_KIB=$((10 * 1024 * 1024))
readonly REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEFAULT_OUTPUT_ROOT="$REPOSITORY_ROOT/private-data/production-db-exports"

usage() {
  printf 'Usage: %s [output-directory]\n' "$0"
  printf '\n'
  printf 'Exports production roles, schema, and data into a timestamped directory.\n'
  printf 'The destination must have at least 10 GiB free after the largest archive is written.\n'
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command not found: %s\n' "$1" >&2
    exit 1
  fi
}

available_kib() {
  df -Pk "$1" | awk 'NR == 2 { print $4 }'
}

extract_dump_script() {
  local dry_run_output=$1
  local generated_script=$2

  awk '
    /^#!\/usr\/bin\/env bash$/ { in_script = 1 }
    in_script && /^Dumped (schema|roles) to / { exit }
    in_script { print }
  ' "$dry_run_output" > "$generated_script"

  if ! rg -q '^export PGPASSWORD=' "$generated_script"; then
    printf 'Supabase did not provide an ephemeral database login.\n' >&2
    exit 1
  fi

  chmod 600 "$generated_script"
}

write_archive() {
  local name=$1
  shift
  local archive="$export_directory/$name.sql.zst"
  local partial_archive="$archive.partial"
  local dry_run_output="$temporary_directory/$name-dry-run.txt"
  local generated_script="$temporary_directory/$name-dump.sh"
  local free_kib
  local maximum_file_blocks

  free_kib=$(available_kib "$export_directory")
  if (( free_kib <= RESERVE_KIB )); then
    printf 'Not enough free space to preserve the 10 GiB safety reserve.\n' >&2
    exit 1
  fi
  maximum_file_blocks=$(( (free_kib - RESERVE_KIB) * 2 ))

  printf 'Preparing %s export...\n' "$name"
  bunx supabase db dump --linked --dry-run --file "$name.sql" "$@" > "$dry_run_output" 2>&1
  extract_dump_script "$dry_run_output" "$generated_script"

  printf 'Streaming %s.sql.zst...\n' "$name"
  (
    ulimit -f "$maximum_file_blocks"
    bash "$generated_script" | zstd --quiet -T0 -9 -o "$partial_archive"
  )

  if [[ ! -s "$partial_archive" ]]; then
    printf 'Archive is empty: %s\n' "$partial_archive" >&2
    exit 1
  fi

  zstd --test "$partial_archive"
  mv "$partial_archive" "$archive"
  chmod 600 "$archive"
}

write_manifest() {
  local manifest="$export_directory/manifest.txt"
  local project_ref
  local created_at

  project_ref=$(<"$REPOSITORY_ROOT/supabase/.temp/project-ref")
  created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  {
    printf 'PlayHTML production database export\n'
    printf 'Created: %s\n' "$created_at"
    printf 'Project ref: %s\n' "$project_ref"
    printf 'Format: zstd-compressed PostgreSQL plain SQL\n'
    printf 'Contents: Supabase-managed role export, application schema export, and all application data included by Supabase CLI\n'
    printf 'Privacy: contains raw production data and persistent participant identifiers; not anonymized\n'
    printf 'Supabase CLI: %s\n' "$(bunx supabase --version)"
    printf 'Zstandard: %s\n' "$(zstd --version | head -1)"
    printf '\nFiles:\n'
    ls -lh "$export_directory"/*.sql.zst
  } > "$manifest"
  chmod 600 "$manifest"

  (
    cd "$export_directory"
    shasum -a 256 ./*.sql.zst > SHA256SUMS
    chmod 600 SHA256SUMS
  )
}

if [[ ${1:-} == "--help" || ${1:-} == "-h" ]]; then
  usage
  exit 0
fi

if (( $# > 1 )); then
  usage >&2
  exit 1
fi

require_command awk
require_command bunx
require_command df
require_command rg
require_command shasum
require_command zstd

output_root=${1:-$DEFAULT_OUTPUT_ROOT}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
export_directory="$output_root/playhtml-production-$timestamp"
umask 077
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/playhtml-production-export.XXXXXX")

cleanup() {
  rm -rf "$temporary_directory"
  find "$export_directory" -maxdepth 1 -name '*.partial' -delete 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p "$export_directory"
chmod 700 "$export_directory"

if [[ ! -f "$REPOSITORY_ROOT/supabase/.temp/project-ref" ]]; then
  printf 'Supabase project is not linked. Run `bunx supabase link` first.\n' >&2
  exit 1
fi

write_archive roles --role-only
write_archive schema
write_archive data --data-only --use-copy
write_manifest

printf '\nExport complete: %s\n' "$export_directory"
printf 'Verify checksums with: (cd %q && shasum -a 256 -c SHA256SUMS)\n' "$export_directory"
