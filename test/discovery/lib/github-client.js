/**
 * @fileoverview GitHub GraphQL client with rate limiting
 * Designed for high-throughput repository scanning while respecting API limits
 *
 * Rate limits:
 * - Authenticated: 5000 requests/hour
 * - We use p-limit to control concurrency and avoid burst requests
 */

import pLimit from 'p-limit';
import { retry, progress, delay } from './utils.js';

const GITHUB_GRAPHQL_API = 'https://api.github.com/graphql';

/**
 * @typedef {Object} GitHubClientOptions
 * @property {string} [token] - GitHub personal access token (defaults to GITHUB_TOKEN env)
 * @property {number} [concurrency=5] - Maximum concurrent requests
 * @property {number} [delayBetweenRequests=100] - Delay between requests in ms
 */

/**
 * Create a rate-limited GitHub GraphQL client
 *
 * @param {GitHubClientOptions} [options={}]
 * @returns {GitHubClient}
 */
export function createGitHubClient(options = {}) {
  const {
    token = process.env.GITHUB_TOKEN,
    concurrency = 5,
    delayBetweenRequests = 100,
  } = options;

  if (!token) {
    throw new Error(
      'GitHub token required. Set GITHUB_TOKEN environment variable or pass token option.'
    );
  }

  const limit = pLimit(concurrency);
  let lastRequestTime = 0;
  let remainingRateLimit = 5000;
  let rateLimitReset = 0;

  /**
   * Execute a GraphQL query with rate limiting
   *
   * @param {string} query - GraphQL query
   * @param {Record<string, unknown>} [variables={}] - Query variables
   * @returns {Promise<unknown>}
   */
  async function graphql(query, variables = {}) {
    return limit(async () => {
      // Enforce minimum delay between requests
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;
      if (timeSinceLastRequest < delayBetweenRequests) {
        await delay(delayBetweenRequests - timeSinceLastRequest);
      }

      // Check rate limit
      if (remainingRateLimit < 10 && Date.now() < rateLimitReset * 1000) {
        const waitTime = rateLimitReset * 1000 - Date.now() + 1000;
        progress(`Rate limit nearly exhausted, waiting ${Math.ceil(waitTime / 1000)}s`);
        await delay(waitTime);
      }

      lastRequestTime = Date.now();

      const response = await retry(
        async () => {
          const res = await fetch(GITHUB_GRAPHQL_API, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
              'User-Agent': 'flatlock-discovery/1.0',
            },
            body: JSON.stringify({ query, variables }),
          });

          // Update rate limit info from headers
          const remaining = res.headers.get('x-ratelimit-remaining');
          const reset = res.headers.get('x-ratelimit-reset');
          if (remaining) remainingRateLimit = parseInt(remaining, 10);
          if (reset) rateLimitReset = parseInt(reset, 10);

          if (!res.ok) {
            const error = new Error(`GitHub API error: ${res.status} ${res.statusText}`);
            error.status = res.status;
            throw error;
          }

          return res.json();
        },
        {
          retries: 3,
          minTimeout: 1000,
          shouldRetry: (err) => {
            // Retry on rate limit and server errors
            return err.status === 429 || err.status === 502 || err.status === 503;
          },
        }
      );

      // Check for GraphQL errors
      if (response.errors) {
        const errorMessages = response.errors.map((e) => e.message).join(', ');
        const error = new Error(`GraphQL error: ${errorMessages}`);
        error.graphqlErrors = response.errors;
        throw error;
      }

      return response.data;
    });
  }

  /**
   * Get remaining rate limit
   * @returns {{remaining: number, reset: Date}}
   */
  function getRateLimit() {
    return {
      remaining: remainingRateLimit,
      reset: new Date(rateLimitReset * 1000),
    };
  }

  return {
    graphql,
    getRateLimit,
  };
}

/**
 * @typedef {ReturnType<typeof createGitHubClient>} GitHubClient
 */

/**
 * GraphQL query to fetch all package manager related files from a repository
 */
export const PACKAGE_MANAGER_FILES_QUERY = `
query GetPackageManagerFiles($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    # Root package.json (for workspaces, packageManager field)
    packageJson: object(expression: "HEAD:package.json") {
      ... on Blob { text }
    }

    # npm lockfile
    packageLock: object(expression: "HEAD:package-lock.json") {
      ... on Blob { text }
    }

    # pnpm lockfile and config
    pnpmLock: object(expression: "HEAD:pnpm-lock.yaml") {
      ... on Blob { text }
    }
    pnpmWorkspace: object(expression: "HEAD:pnpm-workspace.yaml") {
      ... on Blob { text }
    }

    # yarn lockfile
    yarnLock: object(expression: "HEAD:yarn.lock") {
      ... on Blob { text }
    }

    # yarn config files
    yarnrcYml: object(expression: "HEAD:.yarnrc.yml") {
      ... on Blob { text }
    }
    yarnrcClassic: object(expression: "HEAD:.yarnrc") {
      ... on Blob { text }
    }

    # npm config
    npmrc: object(expression: "HEAD:.npmrc") {
      ... on Blob { text }
    }

    # Monorepo tool configs
    turboJson: object(expression: "HEAD:turbo.json") {
      ... on Blob { text }
    }
    lernaJson: object(expression: "HEAD:lerna.json") {
      ... on Blob { text }
    }
    nxJson: object(expression: "HEAD:nx.json") {
      ... on Blob { text }
    }

    # Repository metadata
    defaultBranchRef {
      name
    }
    isArchived
    updatedAt
  }
}
`;

/**
 * Fetch package manager files from a repository
 *
 * @param {GitHubClient} client - GitHub client
 * @param {string} owner - Repository owner
 * @param {string} name - Repository name
 * @returns {Promise<RepositoryFiles | null>}
 */
export async function fetchRepositoryFiles(client, owner, name) {
  try {
    const data = await client.graphql(PACKAGE_MANAGER_FILES_QUERY, { owner, name });

    if (!data.repository) {
      return null;
    }

    const repo = data.repository;

    return {
      packageJson: repo.packageJson?.text || null,
      packageLock: repo.packageLock?.text || null,
      pnpmLock: repo.pnpmLock?.text || null,
      pnpmWorkspace: repo.pnpmWorkspace?.text || null,
      yarnLock: repo.yarnLock?.text || null,
      yarnrcYml: repo.yarnrcYml?.text || null,
      yarnrcClassic: repo.yarnrcClassic?.text || null,
      npmrc: repo.npmrc?.text || null,
      turboJson: repo.turboJson?.text || null,
      lernaJson: repo.lernaJson?.text || null,
      nxJson: repo.nxJson?.text || null,
      metadata: {
        defaultBranch: repo.defaultBranchRef?.name || 'main',
        isArchived: repo.isArchived || false,
        updatedAt: repo.updatedAt || null,
      },
    };
  } catch (err) {
    // Handle repository not found or access denied
    if (err.graphqlErrors?.some((e) => e.type === 'NOT_FOUND')) {
      return null;
    }
    throw err;
  }
}

/**
 * @typedef {Object} RepositoryFiles
 * @property {string|null} packageJson
 * @property {string|null} packageLock
 * @property {string|null} pnpmLock
 * @property {string|null} pnpmWorkspace
 * @property {string|null} yarnLock
 * @property {string|null} yarnrcYml
 * @property {string|null} yarnrcClassic
 * @property {string|null} npmrc
 * @property {string|null} turboJson
 * @property {string|null} lernaJson
 * @property {string|null} nxJson
 * @property {Object} metadata
 * @property {string} metadata.defaultBranch
 * @property {boolean} metadata.isArchived
 * @property {string|null} metadata.updatedAt
 */
