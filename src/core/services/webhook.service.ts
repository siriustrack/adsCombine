import { wrapPromiseResult } from '@lib/result.types';

export class WebhookService {
  async notifyWebhook(
    webhookDestination: string,
    payload: Record<string, unknown>,
    fileName: string
  ): Promise<void> {
    const { error, value } = await wrapPromiseResult<Response, Error>(
      fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    );

    if (error) {
      console.error(`[${fileName}] Failed to notify webhook: ${error.message}`);
    } else {
      console.log(
        `[${fileName}] Webhook notified successfully: ${value.status} ${value.statusText}`
      );
    }
  }
}
