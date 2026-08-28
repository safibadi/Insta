#!/usr/bin/env bash
#
# Stages the publishable site into _site/.
#
# Cloudflare Pages is pointed at this script (build command `./build.sh`,
# output directory `_site`) rather than served straight from the repository
# root, so the test harness, the fixture generator and the CI config are not
# published alongside the app. The repository is private; the deployed site is
# not, and only what lands in _site/ is deployed.
#
# There is no compile step - the site is plain HTML, CSS and ES modules. This
# is a copy, and that is deliberate: it keeps "zero third-party code" something
# you can verify by reading the files rather than by trusting a bundler.
set -euo pipefail

cd "$(dirname "$0")"

rm -rf _site
mkdir -p _site

cp index.html _site/
cp -r assets _site/
cp README.md LICENSE _site/

echo "Staged $(find _site -type f | wc -l) files into _site/"
