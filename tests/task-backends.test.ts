import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeCreateTask,
  createGitHubIssue,
  createLinearIssue,
  storeTask,
  getTasksForUser,
  initDatabase,
  executeVoiceAgentTool,
} from '../src/core/index.js';

describe('Real Task Backend Integration', () => {
  beforeEach(() => {
    initDatabase();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails honestly when no external task backend is configured', async () => {
    // With no env tokens set
    const result = await executeCreateTask(
      { title: 'Update documentation for release' },
      'user_test_1'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Task creation is not available');
    expect(result.error).toContain('GitHub Issues or Linear');
    expect(result.error).toContain('The task "Update documentation for release" was not created');
  });

  it('creates a real GitHub issue when GitHub credentials are provided', async () => {
    const mockGitHubResponse = {
      id: 987654,
      number: 42,
      html_url: 'https://github.com/my-org/my-repo/issues/42',
      title: 'Fix mobile responsiveness in voice agent',
      body: 'Details here',
      created_at: '2026-09-19T00:00:00Z',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => mockGitHubResponse,
    } as any);

    const result = await createGitHubIssue(
      {
        title: 'Fix mobile responsiveness in voice agent',
        description: 'Ensure viewport scaling works on iOS',
        channelName: 'frontend-dev',
        sourceUrl: 'https://discord.com/channels/123/456/789',
      },
      {
        token: 'ghp_mock_token_1234567890',
        repo: 'my-org/my-repo',
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/repos/my-org/my-repo/issues',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_mock_token_1234567890',
          Accept: 'application/vnd.github.v3+json',
        }),
      })
    );

    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task?.externalId).toBe('42');
    expect(result.task?.externalUrl).toBe('https://github.com/my-org/my-repo/issues/42');
    expect(result.task?.provider).toBe('github');
  });

  it('creates a real Linear issue when Linear credentials are provided', async () => {
    const mockLinearResponse = {
      data: {
        issueCreate: {
          success: true,
          issue: {
            id: 'linear-uuid-999',
            identifier: 'ENG-101',
            title: 'Audit voice stream memory consumption',
            url: 'https://linear.app/my-team/issue/ENG-101',
            createdAt: '2026-09-19T00:00:00Z',
          },
        },
      },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockLinearResponse,
    } as any);

    const result = await createLinearIssue(
      {
        title: 'Audit voice stream memory consumption',
        description: 'Check buffer reuse in prism-media decoder',
        channelName: 'engineering',
      },
      {
        apiKey: 'lin_api_mock_key_123',
        teamId: 'team-uuid-456',
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'lin_api_mock_key_123',
        }),
      })
    );

    expect(result.success).toBe(true);
    expect(result.task?.externalId).toBe('ENG-101');
    expect(result.task?.externalUrl).toBe('https://linear.app/my-team/issue/ENG-101');
    expect(result.task?.provider).toBe('linear');
  });

  it('persists tasks to SQLite and retrieves tasks for user', () => {
    const testTaskId = `task_${Date.now()}_${Math.random()}`;
    storeTask({
      id: testTaskId,
      userId: 'user_dev_42',
      provider: 'github',
      externalId: '108',
      externalUrl: 'https://github.com/example/repo/issues/108',
      title: 'Review PR #25',
      description: 'Check WebSocket connection lifecycle',
      status: 'open',
    });

    const userTasks = getTasksForUser('user_dev_42');
    const matched = userTasks.find(t => t.id === testTaskId);

    expect(matched).toBeDefined();
    expect(matched?.title).toBe('Review PR #25');
    expect(matched?.external_id).toBe('108');
    expect(matched?.external_url).toBe('https://github.com/example/repo/issues/108');
  });

  it('integrates with executeVoiceAgentTool create_task', async () => {
    const res = await executeVoiceAgentTool(
      'create_task',
      { title: 'Test voice tool create_task honesty' },
      { userId: 'user-77', channelId: 'ch-88', channelName: 'general' }
    );

    // Default configuration has no task provider set, so must fail honestly
    expect(res.success).toBe(false);
    expect(res.error).toContain('Task creation is not available');
  });
});
