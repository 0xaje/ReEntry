export interface TaskCreationParams {
  title: string;
  description?: string;
  dueDate?: string;
  sourceMessageId?: string;
  sourceUrl?: string;
  channelName?: string;
  authorName?: string;
}

export interface CreatedTask {
  id: string;
  provider: 'github' | 'linear';
  externalId: string;
  externalUrl: string;
  title: string;
  description?: string;
  createdAt: string;
}

export interface TaskCreationResult {
  success: boolean;
  task?: CreatedTask;
  error?: string;
}
