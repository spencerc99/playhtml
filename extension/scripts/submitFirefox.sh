#!/bin/bash
# ABOUTME: Submits Firefox extension zips without exposing Chrome store inputs.
# ABOUTME: Keeps WXT store detection focused on Firefox during release automation.

set -euo pipefail

unset CHROME_ZIP
unset CHROME_EXTENSION_ID
unset CHROME_CLIENT_ID
unset CHROME_CLIENT_SECRET
unset CHROME_REFRESH_TOKEN
unset CHROME_PUBLISH_TARGET
unset CHROME_DEPLOY_PERCENTAGE
unset CHROME_REVIEW_EXEMPTION
unset CHROME_SKIP_SUBMIT_REVIEW

exec bunx wxt submit "$@"
