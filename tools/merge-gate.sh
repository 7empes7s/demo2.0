#!/usr/bin/env bash
# Merge every open PR labelled `automerge` that passes the gate. See .github/workflows/merge-gate.yml.
# Needs: gh (GH_TOKEN), jq. Optional: REQUIRE_REVIEW=true, CI_WORKFLOW (default ci.yml),
# CODE_PATHS (regex; empty means every PR needs a green CI run). DRY_RUN=1 prints decisions only.
set -euo pipefail

repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
owner="${repo%/*}"; name="${repo#*/}"
ci_workflow="${CI_WORKFLOW:-ci.yml}"
code_paths="${CODE_PATHS:-}"
default_branch=$(gh api "repos/$repo" -q .default_branch)
gate_job="Merge gate"
merged=0

check_pr() {
  local n="$1" pr sha author files ci runs reviews threads
  # Inside `if check_pr`, set -e is off, so every call checks its own failure.
  pr=$(gh api "repos/$repo/pulls/$n") || { echo "#$n: could not read PR"; return 1; }
  [ "$(jq -r .state <<<"$pr")" = "open" ] || { echo "#$n: not open"; return 1; }
  [ "$(jq -r .draft <<<"$pr")" = "false" ] || { echo "#$n: draft"; return 1; }
  # mergeable is null while GitHub is still computing it; treat that as not ready yet.
  [ "$(jq -r .mergeable <<<"$pr")" = "true" ] || { echo "#$n: not mergeable yet ($(jq -r .mergeable_state <<<"$pr"))"; return 1; }
  sha=$(jq -r .head.sha <<<"$pr")
  author=$(jq -r .user.login <<<"$pr")
  files=$(gh api "repos/$repo/pulls/$n/files?per_page=100" --paginate -q '.[].filename') \
    || { echo "#$n: could not list files"; return 1; }

  # Every check run on the head commit (except this gate) must be finished and not failed.
  runs=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" \
    | jq --arg g "$gate_job" '[.check_runs[] | select(.name != $g)]') || { echo "#$n: could not read checks"; return 1; }
  if jq -e 'any(.[]; .status != "completed")' <<<"$runs" >/dev/null; then echo "#$n: checks still running"; return 1; fi
  if jq -e 'any(.[]; .conclusion as $c | ["success","skipped","neutral"] | index($c) | not)' <<<"$runs" >/dev/null; then
    echo "#$n: a check failed"; return 1
  fi

  # A PR that touches code (every PR, when CODE_PATHS is empty) needs a passing CI run on its head commit.
  if [ -z "$code_paths" ] || grep -Eq "$code_paths" <<<"$files"; then
    ci=$(gh api "repos/$repo/actions/workflows/$ci_workflow/runs?head_sha=$sha&per_page=20" -q '.workflow_runs') \
      || { echo "#$n: could not read $ci_workflow runs"; return 1; }
    jq -e 'any(.[]; .status == "completed" and .conclusion == "success")' <<<"$ci" >/dev/null \
      || { echo "#$n: $ci_workflow has not passed on $sha"; return 1; }
  fi

  # Latest review per reviewer: none may request changes.
  # Only APPROVED, CHANGES_REQUESTED and DISMISSED change a reviewer's verdict; a later comment doesn't clear a change request.
  reviews=$(gh api "repos/$repo/pulls/$n/reviews?per_page=100" \
    | jq --arg a "$author" '[.[] | select(.user.login != $a and (.state == "APPROVED" or .state == "CHANGES_REQUESTED" or .state == "DISMISSED"))] | group_by(.user.login) | map(max_by(.submitted_at))') \
    || { echo "#$n: could not read reviews"; return 1; }
  if jq -e 'any(.[]; .state == "CHANGES_REQUESTED")' <<<"$reviews" >/dev/null; then echo "#$n: changes requested"; return 1; fi
  if [ "${REQUIRE_REVIEW:-}" = "true" ] && ! jq -e 'any(.[]; .state == "APPROVED")' <<<"$reviews" >/dev/null; then
    echo "#$n: waiting for a review"; return 1
  fi

  threads=$(gh api graphql -F owner="$owner" -F name="$name" -F n="$n" -f query='
    query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){pullRequest(number:$n){
      reviewThreads(first:100){nodes{isResolved}}}}}' \
    | jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)] | length') \
    || { echo "#$n: could not read review threads"; return 1; }
  [ "$threads" = "0" ] || { echo "#$n: $threads unresolved review thread(s)"; return 1; }
  return 0
}

# Assign first so a failed listing stops the run (set -e) instead of looping over the error text.
labelled=$(gh api "repos/$repo/issues?labels=automerge&state=open&per_page=100" -q '.[] | select(.pull_request) | .number')
for n in $labelled; do
  if check_pr "$n"; then
    if [ -n "${DRY_RUN:-}" ]; then echo "#$n: ready (dry run)"; continue; fi
    echo "#$n: merging"
    # One failed merge must not stop the others or the CI dispatch below.
    if gh pr merge "$n" -R "$repo" --merge --delete-branch; then
      merged=$((merged + 1))
    else
      echo "#$n: merge failed"
    fi
  fi
done

if [ "$merged" -gt 0 ] && [ -z "${DRY_RUN:-}" ]; then
  # Merges made with GITHUB_TOKEN don't start push workflows, so start CI on the merged commit.
  gh workflow run "$ci_workflow" -R "$repo" --ref "$default_branch"
  echo "Dispatched $ci_workflow on $default_branch after $merged merge(s)."
fi
