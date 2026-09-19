import type { TaskCreationParams, CreatedTask, TaskCreationResult } from './types.js';

export interface LinearConfig {
  apiKey: string;
  teamId: string; // Team ID or UUID
}

/**
 * Creates a real issue in Linear via the Linear GraphQL API.
 */
export async function createLinearIssue(
  params: TaskCreationParams,
  config: LinearConfig
): Promise<TaskCreationResult> {
  const { apiKey, teamId } = config;

  if (!apiKey || !teamId) {
    return {
      success: false,
      error: 'Linear integration requires both LINEAR_API_KEY and LINEAR_TEAM_ID.',
    };
  }

  const endpoint = 'https://api.linear.app/graphql';

  let description = params.description || '';
  if (params.channelName) {
    description += `\n**Channel:** #${params.channelName}`;
  }
  if (params.sourceUrl) {
    description += `\n**Source Discord Message:** [Jump to Message](${params.sourceUrl})`;
  }
  description += '\n\n---\n*Created automatically via Project Re-entry Voice Agent*';

  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
          createdAt
        }
      }
    }
  `;

  const input: Record<string, any> = {
    title: params.title,
    description: description.trim(),
    teamId: teamId,
  };

  if (params.dueDate) {
    input.dueDate = params.dueDate;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: mutation,
        variables: { input },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return {
        success: false,
        error: `Linear API error (${response.status}): ${errorText}`,
      };
    }

    const resJson = (await response.json()) as any;

    if (resJson.errors && resJson.errors.length > 0) {
      const msg = resJson.errors.map((e: any) => e.message).join('; ');
      return {
        success: false,
        error: `Linear GraphQL error: ${msg}`,
      };
    }

    const payload = resJson.data?.issueCreate;
    if (!payload?.success || !payload?.issue) {
      return {
        success: false,
        error: 'Linear issue creation did not return a successful issue payload.',
      };
    }

    const issue = payload.issue;
    const created: CreatedTask = {
      id: `linear_${issue.id}`,
      provider: 'linear',
      externalId: issue.identifier,
      externalUrl: issue.url,
      title: issue.title,
      description: description.trim(),
      createdAt: issue.createdAt || new Date().toISOString(),
    };

    return {
      success: true,
      task: created,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Network error connecting to Linear API: ${err.message || 'Unknown error'}`,
    };
  }
}
