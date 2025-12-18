/**
 * GitHub Version Tag Finder
 *
 * Maps npm package versions to git tags using GitHub GraphQL API.
 * Handles various tag naming conventions and provides commit SHA lookup.
 *
 * @module test/discovery/lib/find-version-tags
 */

/**
 * @typedef {Object} TagInfo
 * @property {string} name - Tag name (e.g., "v1.0.0")
 * @property {string} oid - Commit SHA
 * @property {string} committedDate - ISO date string
 */

/**
 * @typedef {Object} RateLimitState
 * @property {number} remaining - Remaining requests
 * @property {number} resetAt - Unix timestamp when limit resets
 * @property {number} lastRequest - Unix timestamp of last request
 */

/**
 * @typedef {Object} GitHubClientOptions
 * @property {string} [token] - GitHub token (defaults to GITHUB_TOKEN env)
 * @property {number} [minDelay] - Minimum delay between requests in ms (default: 100)
 * @property {number} [maxRetries] - Maximum retry attempts (default: 3)
 * @property {number} [retryDelay] - Base delay for retries in ms (default: 1000)
 */

const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

/**
 * Shared rate limit state across all instances.
 * @type {RateLimitState}
 */
const rateLimitState = {
  remaining: 5000,
  resetAt: 0,
  lastRequest: 0
};

/**
 * GraphQL query to find git tags matching a pattern.
 */
const GET_VERSION_TAG_QUERY = `
query GetVersionTag($owner: String!, $name: String!, $tagPattern: String!) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/tags/", query: $tagPattern, first: 5) {
      nodes {
        name
        target {
          ... on Commit {
            oid
            committedDate
          }
          ... on Tag {
            target {
              ... on Commit {
                oid
                committedDate
              }
            }
          }
        }
      }
    }
  }
  rateLimit {
    remaining
    resetAt
  }
}
`;

/**
 * GraphQL query to fetch lockfiles at a specific commit.
 */
const GET_HISTORICAL_LOCKFILES_QUERY = `
query GetHistoricalLockfiles($owner: String!, $name: String!, $commitSha: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $commitSha) {
      ... on Commit {
        oid
        committedDate
        message
        packageLock: file(path: "package-lock.json") {
          object { ... on Blob { text isBinary byteSize } }
        }
        pnpmLock: file(path: "pnpm-lock.yaml") {
          object { ... on Blob { text isBinary byteSize } }
        }
        yarnLock: file(path: "yarn.lock") {
          object { ... on Blob { text isBinary byteSize } }
        }
        yarnrcYml: file(path: ".yarnrc.yml") {
          object { ... on Blob { text isBinary byteSize } }
        }
        packageJson: file(path: "package.json") {
          object { ... on Blob { text isBinary byteSize } }
        }
      }
    }
  }
  rateLimit {
    remaining
    resetAt
  }
}
`;

/**
 * Sleep for a given duration.
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a GitHub GraphQL query with rate limiting and retries.
 *
 * @param {string} query - GraphQL query
 * @param {Object} variables - Query variables
 * @param {GitHubClientOptions} [options] - Client options
 * @returns {Promise<Object>} Query result
 */
export async function executeGraphQL(query, variables, options = {}) {
  const token = options.token || process.env.GITHUB_TOKEN;
  const minDelay = options.minDelay ?? 100;
  const maxRetries = options.maxRetries ?? 3;
  const retryDelay = options.retryDelay ?? 1000;

  if (!token) {
    throw new Error('GitHub token required. Set GITHUB_TOKEN environment variable.');
  }

  // Rate limiting: ensure minimum delay between requests
  const now = Date.now();
  const timeSinceLastRequest = now - rateLimitState.lastRequest;
  if (timeSinceLastRequest < minDelay) {
    await sleep(minDelay - timeSinceLastRequest);
  }

  // Check if we're rate limited
  if (rateLimitState.remaining <= 10 && rateLimitState.resetAt > Date.now()) {
    const waitTime = rateLimitState.resetAt - Date.now() + 1000;
    console.warn(`Rate limited. Waiting ${Math.round(waitTime / 1000)}s...`);
    await sleep(waitTime);
  }

  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      rateLimitState.lastRequest = Date.now();

      const response = await fetch(GITHUB_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'flatlock-discovery/1.0'
        },
        body: JSON.stringify({ query, variables })
      });

      // Handle rate limit headers
      const remaining = response.headers.get('x-ratelimit-remaining');
      const resetAt = response.headers.get('x-ratelimit-reset');
      if (remaining) rateLimitState.remaining = parseInt(remaining, 10);
      if (resetAt) rateLimitState.resetAt = parseInt(resetAt, 10) * 1000;

      if (!response.ok) {
        const errorText = await response.text();

        // Rate limited - wait and retry
        if (response.status === 403 || response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const waitTime = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : retryDelay * Math.pow(2, attempt);
          console.warn(`Rate limited (${response.status}). Retrying in ${Math.round(waitTime / 1000)}s...`);
          await sleep(waitTime);
          continue;
        }

        throw new Error(`GitHub API error ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      // Update rate limit from response
      if (result.data?.rateLimit) {
        rateLimitState.remaining = result.data.rateLimit.remaining;
        rateLimitState.resetAt = new Date(result.data.rateLimit.resetAt).getTime();
      }

      // Check for GraphQL errors - but ignore "Could not resolve file for path" errors
      // Those are expected when querying for lockfiles that don't exist
      if (result.errors) {
        const realErrors = result.errors.filter(e =>
          !e.message.includes('Could not resolve file for path')
        );
        if (realErrors.length > 0) {
          const errorMessages = realErrors.map(e => e.message).join(', ');
          throw new Error(`GraphQL error: ${errorMessages}`);
        }
        // File-not-found errors are fine - data is still valid
      }

      return result.data;
    } catch (error) {
      lastError = error;

      // Retry on network errors
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.message.includes('fetch')) {
        const waitTime = retryDelay * Math.pow(2, attempt);
        console.warn(`Network error: ${error.message}. Retrying in ${Math.round(waitTime / 1000)}s...`);
        await sleep(waitTime);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

/**
 * Generate tag patterns to search for a given version.
 * Different projects use different tag naming conventions.
 *
 * @param {string} version - Package version (e.g., "1.0.0")
 * @param {string} [packageName] - Package name for scoped tag patterns
 * @returns {string[]} Array of tag patterns to try
 */
export function generateTagPatterns(version, packageName = null) {
  const patterns = [
    `v${version}`,      // v1.0.0 (most common)
    version,            // 1.0.0
    `V${version}`,      // V1.0.0
    `release-${version}`, // release-1.0.0
    `release/v${version}` // release/v1.0.0
  ];

  // For scoped packages, try @scope/package@version pattern
  if (packageName) {
    if (packageName.startsWith('@')) {
      patterns.push(`${packageName}@${version}`);
    } else {
      patterns.push(`${packageName}@${version}`);
      patterns.push(`${packageName}-v${version}`);
    }
  }

  return patterns;
}

/**
 * Extract commit info from a tag target.
 * Handles both lightweight tags (direct commit) and annotated tags (Tag -> Commit).
 *
 * @param {Object} target - Tag target from GraphQL response
 * @returns {{oid: string, committedDate: string}|null}
 */
function extractCommitFromTarget(target) {
  if (!target) return null;

  // Lightweight tag - target is directly a commit
  if (target.oid && target.committedDate) {
    return { oid: target.oid, committedDate: target.committedDate };
  }

  // Annotated tag - target is a Tag object with nested commit
  if (target.target?.oid && target.target?.committedDate) {
    return { oid: target.target.oid, committedDate: target.target.committedDate };
  }

  return null;
}

/**
 * Find a git tag for a specific version.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} version - Package version
 * @param {Object} [options] - Options
 * @param {string} [options.packageName] - Package name for scoped patterns
 * @param {GitHubClientOptions} [options.client] - GitHub client options
 * @returns {Promise<TagInfo|null>} Tag info or null if not found
 */
export async function findVersionTag(owner, repo, version, options = {}) {
  const patterns = generateTagPatterns(version, options.packageName);

  for (const pattern of patterns) {
    try {
      const data = await executeGraphQL(GET_VERSION_TAG_QUERY, {
        owner,
        name: repo,
        tagPattern: pattern
      }, options.client);

      const refs = data.repository?.refs?.nodes || [];

      // Find exact match first
      const exactMatch = refs.find(ref => {
        const tagVersion = ref.name.replace(/^v/i, '').replace(/^release[-/]v?/i, '');
        return tagVersion === version || ref.name === pattern;
      });

      if (exactMatch) {
        const commit = extractCommitFromTarget(exactMatch.target);
        if (commit) {
          return {
            name: exactMatch.name,
            oid: commit.oid,
            committedDate: commit.committedDate
          };
        }
      }

      // If no exact match, check if any returned tag matches
      for (const ref of refs) {
        const commit = extractCommitFromTarget(ref.target);
        if (commit) {
          const tagVersion = ref.name.replace(/^v/i, '').replace(/^release[-/]v?/i, '');
          if (tagVersion === version) {
            return {
              name: ref.name,
              oid: commit.oid,
              committedDate: commit.committedDate
            };
          }
        }
      }
    } catch (error) {
      // Repository might not exist or other errors - continue to next pattern
      if (error.message.includes('Could not resolve to a Repository')) {
        throw error; // Don't retry if repo doesn't exist
      }
      console.warn(`Tag search failed for pattern "${pattern}": ${error.message}`);
    }
  }

  return null;
}

/**
 * Find multiple version tags for a package.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string[]} versions - Array of versions to find
 * @param {Object} [options] - Options
 * @returns {Promise<Map<string, TagInfo>>} Map of version to tag info
 */
export async function findVersionTags(owner, repo, versions, options = {}) {
  const results = new Map();

  for (const version of versions) {
    const tag = await findVersionTag(owner, repo, version, options);
    if (tag) {
      results.set(version, tag);
    }
  }

  return results;
}

/**
 * Fetch lockfiles at a historical commit.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} commitSha - Commit SHA or ref
 * @param {GitHubClientOptions} [options] - Client options
 * @returns {Promise<Object>} Lockfile contents and metadata
 */
export async function fetchHistoricalLockfiles(owner, repo, commitSha, options = {}) {
  const data = await executeGraphQL(GET_HISTORICAL_LOCKFILES_QUERY, {
    owner,
    name: repo,
    commitSha
  }, options);

  const commit = data.repository?.object;
  if (!commit) {
    throw new Error(`Commit ${commitSha} not found in ${owner}/${repo}`);
  }

  /**
   * Extract file content from GraphQL response.
   * @param {Object} file - File object from query
   * @returns {{content: string|null, size: number, binary: boolean}}
   */
  function extractFile(file) {
    if (!file?.object) {
      return { content: null, size: 0, binary: false };
    }
    return {
      content: file.object.isBinary ? null : file.object.text,
      size: file.object.byteSize || 0,
      binary: file.object.isBinary || false
    };
  }

  return {
    commit: {
      oid: commit.oid,
      committedDate: commit.committedDate,
      message: commit.message
    },
    files: {
      packageLock: extractFile(commit.packageLock),
      pnpmLock: extractFile(commit.pnpmLock),
      yarnLock: extractFile(commit.yarnLock),
      yarnrcYml: extractFile(commit.yarnrcYml),
      packageJson: extractFile(commit.packageJson)
    }
  };
}

/**
 * Get current rate limit state.
 *
 * @returns {RateLimitState}
 */
export function getRateLimitState() {
  return { ...rateLimitState };
}

/**
 * Parse a repository URL or "owner/repo" string.
 *
 * @param {string} repoUrl - Repository URL or "owner/repo" string
 * @returns {{owner: string, repo: string}|null}
 */
export function parseRepoUrl(repoUrl) {
  // Handle "owner/repo" format
  if (!repoUrl.includes('://') && repoUrl.includes('/')) {
    const [owner, repo] = repoUrl.split('/');
    return { owner, repo: repo.replace(/\.git$/, '') };
  }

  // Handle GitHub URLs
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (match) {
    return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
  }

  return null;
}
