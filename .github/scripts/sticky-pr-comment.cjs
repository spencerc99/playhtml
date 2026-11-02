// ABOUTME: Creates or updates one bot comment on a pull request, found by a hidden marker.
// ABOUTME: Called from actions/github-script so each report keeps a single comment per PR.
const fs = require("node:fs");

module.exports = async function stickyPrComment({
  github,
  context,
  marker,
  bodyPath,
}) {
  if (!fs.existsSync(bodyPath)) return;
  const body = fs.readFileSync(bodyPath, "utf8");
  const { owner, repo } = context.repo;
  const issue_number = context.payload.pull_request.number;
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number,
    per_page: 100,
  });
  const existing = comments.find(
    (comment) => comment.user?.type === "Bot" && comment.body?.includes(marker),
  );
  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number, body });
  }
};
