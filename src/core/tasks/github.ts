import type { TaskCreationParams, CreatedTask, TaskCreationResult } from './types.js';

export interface GitHubConfig {
  token: string;
  repo: string; // "owner/repo"
}

/**
 * Creates a real issue in GitHub Issues via the GitHub REST API v3.
 */
export async function createGitHubIssue(
  params: TaskCreationParams,
  config: GitHubConfig
): Promise<TaskCreationResult> {
  const { token, repo } = config;

  if (!token || !repo) {
    return {
      success: false,
      error: 'GitHub integration requires both GITHUB_TOKEN and GITHUB_REPO (owner/repo).',
    };
  }

  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    return {
      success: false,
      error: `Invalid GITHUB_REPO format "${repo}". Expected format: "owner/repo".`,
    };
  }

  const url = `https://api.github.com/repos/${owner}/${repoName}/issues`;

  let bodyMarkdown = params.description || '';
  if (params.dueDate) {
    bodyMarkdown += `\n\n**Due Date:** ${params.dueDate}`;
  }
  if (params.channelName) {
    bodyMarkdown += `\n**Channel:** #${params.channelName}`;
  }
  if (params.sourceUrl) {
    bodyMarkdown += `\n**Source Discord Message:** [Jump to Message](${params.sourceUrl})`;
  }
  bodyMarkdown += '\n\n---\n*Created automatically via Project Re-entry Voice Agent*';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Project-Reentry-Bot',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: params.title,
        body: bodyMarkdown.trim(),
        labels: ['reentry', 'voice-task'],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return {
        success: false,
        error: `GitHub API error (${response.status}): ${errorText}`,
      };
    }

    const data = (await response.json()) as any;

    const created: CreatedTask = {
      id: `gh_${data.id}`,
      provider: 'github',
      externalId: String(data.number),
      externalUrl: data.html_url,
      title: data.title,
      description: data.body,
      createdAt: data.created_at || new Date().toISOString(),
    };

    return {
      success: true,
      task: created,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Network error connecting to GitHub API: ${err.message || 'Unknown error'}`,
    };
  }
}
