import { config } from '../config.js';
import { storeTask } from '../db.js';
import { createGitHubIssue } from './github.js';
import { createLinearIssue } from './linear.js';
import type { TaskCreationParams, TaskCreationResult, CreatedTask } from './types.js';

export * from './types.js';
export { createGitHubIssue } from './github.js';
export { createLinearIssue } from './linear.js';

/**
 * Routes task creation to the configured external task backend (GitHub Issues or Linear).
 *
 * Adheres strictly to honesty guidelines:
 * If an external backend is configured, it creates real tickets on GitHub / Linear and returns real URLs.
 * If no external backend is configured, it fails honestly with instructions on how to connect one.
 */
export async function executeCreateTask(
  params: TaskCreationParams,
  userId: string = 'system'
): Promise<TaskCreationResult> {
  // 1. Check Linear configuration
  if (config.tasks.linearApiKey && config.tasks.linearTeamId) {
    const result = await createLinearIssue(params, {
      apiKey: config.tasks.linearApiKey,
      teamId: config.tasks.linearTeamId,
    });

    if (result.success && result.task) {
      storeTask({
        id: result.task.id,
        userId,
        provider: 'linear',
        externalId: result.task.externalId,
        externalUrl: result.task.externalUrl,
        title: result.task.title,
        description: result.task.description,
        dueDate: params.dueDate,
        status: 'open',
        sourceMessageId: params.sourceMessageId,
      });
    }

    return result;
  }

  // 2. Check GitHub configuration
  if (config.tasks.githubToken && config.tasks.githubRepo) {
    const result = await createGitHubIssue(params, {
      token: config.tasks.githubToken,
      repo: config.tasks.githubRepo,
    });

    if (result.success && result.task) {
      storeTask({
        id: result.task.id,
        userId,
        provider: 'github',
        externalId: result.task.externalId,
        externalUrl: result.task.externalUrl,
        title: result.task.title,
        description: result.task.description,
        dueDate: params.dueDate,
        status: 'open',
        sourceMessageId: params.sourceMessageId,
      });
    }

    return result;
  }

  // 3. No real backend is configured — fail honestly
  return {
    success: false,
    error: `Task creation is not available: an external task provider (GitHub Issues or Linear) has not been connected to this workspace. To enable real task creation, set GITHUB_TOKEN & GITHUB_REPO or LINEAR_API_KEY & LINEAR_TEAM_ID. The task "${params.title || 'Untitled'}" was not created.`,
  };
}
