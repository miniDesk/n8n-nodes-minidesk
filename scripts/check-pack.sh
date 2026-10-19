#!/usr/bin/env bash
# Fails when the tarball would ship anything but the built nodes and the package
# docs, when a packed file contains a local path, a test URL or a real key, or
# when the build does not point at the production API.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d dist ]; then
	echo "pack check: no dist/ folder, run pnpm run build first" >&2
	exit 1
fi

pnpm pack --dry-run --json | jq -r '.files[].path' | sort > pack-files.txt
cat pack-files.txt

if [ ! -s pack-files.txt ]; then
	echo "pack check: pnpm pack listed no files" >&2
	exit 1
fi

# grep exits 0 on a match, 1 on none and 2 when it cannot read a file.
allowed='^(dist/.+\.(js|d\.ts|json|svg)|package\.json|README\.md|LICENSE\.md|CHANGELOG\.md)$'
status=0
unexpected=$(grep -vE "$allowed" pack-files.txt) || status=$?
if [ "$status" -eq 0 ]; then
	echo "pack check: these files must not ship:" >&2
	echo "$unexpected" >&2
	exit 1
fi
if [ "$status" -ne 1 ]; then
	echo "pack check: could not read pack-files.txt" >&2
	exit 1
fi

files=()
while IFS= read -r file; do
	files+=("$file")
done < pack-files.txt

leak='/Volumes/|/Users/|localhost|127\.0\.0\.1|host\.docker\.internal|trycloudflare|mdsk_[a-z]+_[A-Za-z0-9_-]{20,}'
status=0
leaks=$(grep -lE "$leak" -- "${files[@]}") || status=$?
if [ "$status" -eq 0 ]; then
	echo "pack check: local paths, test URLs or keys found in:" >&2
	echo "$leaks" >&2
	exit 1
fi
if [ "$status" -ne 1 ]; then
	echo "pack check: could not read every packed file" >&2
	exit 1
fi

constants=dist/nodes/MiniDesk/shared/constants.js
if ! grep -qE "[\"']https://api\.minidesk\.ai/v1[\"']" "$constants"; then
	echo "pack check: $constants does not point at https://api.minidesk.ai/v1" >&2
	exit 1
fi

echo "pack ok: $(wc -l < pack-files.txt | tr -d ' ') files"
