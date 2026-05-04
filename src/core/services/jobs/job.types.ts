import type { ProcessMessage } from 'api/controllers/messages.controllers';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'expired';

export type ProcessMessageJobResult = {
  conversationId: string;
  processedFiles: string[];
  failedFiles: Array<{ fileId: string; error: string }>;
  filename: string;
  downloadUrl: string;
};

export type ProcessMessageJobRecord = {
  id: string;
  type: 'process-message';
  status: JobStatus;
  request: ProcessMessage;
  host: string;
  protocol: string;
  result?: ProcessMessageJobResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type CreateProcessMessageJobInput = {
  messages: ProcessMessage;
  host: string;
  protocol: string;
};
