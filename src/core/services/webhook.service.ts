import logger from '@lib/logger';
import { wrapPromiseResult } from '@lib/result.types';
import axios from 'axios';

export class WebhookService {
  async notifyWebhook(
    webhookDestination: string,
    payload: Record<string, unknown>,
    fileName: string
  ): Promise<void> {
    const { error, value } = await wrapPromiseResult<Response, Error>(
      axios.post(webhookDestination, payload)
    );

    if (error) {
      console.error(`[${fileName}] Failed to notify webhook: ${error.message}`);
    } else {
      logger.info(
        `[${fileName}] Webhook notified successfully: ${value.status} ${value.statusText}`
      );
    }
  }
}
