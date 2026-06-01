'use strict';

const crypto = require('crypto');
const config = require('./config');
const log = require('./log');

let OctokitCtor = null;
let createAppAuthFn = null;

function loadDeps() {
  if (!OctokitCtor) {
    // Lazy-require so the rest of the app can boot (and the UI works) even if
    // optional GitHub dependencies are not installed in a dev environment.
    OctokitCtor = require('@octokit/rest').Octokit;
    createAppAuthFn = require('@octokit/auth-app').createAppAuth;
  }
}

/**
 * Verify the `X-Hub-Signature-256` header against the raw request body using the
 * configured webhook secret. Uses a constant-time comparison.
 */
function verifySignature(rawBody, signatureHeader) {
  if (!config.githubWebhookSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const hmac = crypto.createHmac('sha256', config.githubWebhookSecret);
  hmac.update(rawBody);
  const expected = `sha256=${hmac.digest('hex')}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Build an Octokit client authenticated as a specific installation. */
function installationClient(installationId) {
  loadDeps();
  if (!config.githubAppId || !config.githubAppPrivateKey) {
    throw new Error('GitHub App is not configured (missing app id or private key)');
  }
  return new OctokitCtor({
    authStrategy: createAppAuthFn,
    auth: {
      appId: config.githubAppId,
      privateKey: config.githubAppPrivateKey,
      installationId,
    },
  });
}

/**
 * Generate a short-lived installation access token. Used both for the REST API
 * and for authenticating git clone/push from inside the agent container.
 */
async function getInstallationToken(installationId) {
  loadDeps();
  const auth = createAppAuthFn({
    appId: config.githubAppId,
    privateKey: config.githubAppPrivateKey,
  });
  const { token } = await auth({ type: 'installation', installationId });
  return token;
}

async function postComment(installationId, owner, repo, issueNumber, body) {
  const octokit = installationClient(installationId);
  await octokit.issues.createComment({ owner, repo, issue_number: issueNumber, body });
  log.info('Posted GitHub comment', { repo: `${owner}/${repo}`, issueNumber });
}

async function addReaction(installationId, owner, repo, commentId, content) {
  try {
    const octokit = installationClient(installationId);
    await octokit.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content, // e.g. 'eyes', '+1', 'rocket'
    });
  } catch (err) {
    log.warn('Failed to add reaction', { error: err.message });
  }
}

async function getPullRequest(installationId, owner, repo, prNumber) {
  const octokit = installationClient(installationId);
  const { data } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });
  return data;
}

/**
 * Build an authenticated clone URL. The token is embedded for the agent
 * container; it is short lived and scoped to the installation.
 */
function authenticatedCloneUrl(cloneUrl, token) {
  return cloneUrl.replace('https://', `https://x-access-token:${token}@`);
}

module.exports = {
  verifySignature,
  getInstallationToken,
  postComment,
  addReaction,
  getPullRequest,
  authenticatedCloneUrl,
};
