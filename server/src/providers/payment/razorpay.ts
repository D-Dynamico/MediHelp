import { createHmac } from 'node:crypto';
import { getSettings } from '../../config/env.js';
import { ApiError } from '../../utils/apiError.js';
import { logger } from '../../config/logger.js';
import { safeEqual } from './mock.js';
import type { PaymentOrder, PaymentProof, PaymentProvider } from './index.js';

/**
 * Razorpay over its REST API.
 *
 * Written against `fetch` and `crypto` rather than the `razorpay` SDK, for the
 * same reason as the Cloudinary provider: the SDK would be a hard dependency on
 * every machine for a path that only runs where the keys are set. Order creation
 * is one POST and verification is one HMAC.
 *
 * **This has never run against a real Razorpay account.** Both signature
 * functions are pinned by the checks to fixed HMAC values, so a change to the
 * payload format fails loudly, and the request shapes follow the documented API
 * — but the live round trip is untested until someone sets real keys. Same
 * caveat as the Cloudinary provider.
 */

const API_BASE = 'https://api.razorpay.com/v1';

/** Auth is HTTP Basic with the key id as user and the secret as password. */
function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
}

/**
 * Razorpay's checkout signature: HMAC-SHA256 of `order_id|payment_id`, keyed
 * with the API secret.
 */
export function razorpaySignature(orderId: string, paymentId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

/**
 * A webhook is signed differently from a checkout callback: the HMAC is over the
 * whole raw body, keyed with the *webhook* secret rather than the API secret.
 * Using the parsed body would fail the moment JSON.stringify reordered a key,
 * which is why the route keeps the raw bytes.
 */
export function razorpayWebhookSignature(rawBody: string, webhookSecret: string): string {
  return createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
}

export const razorpayPayments: PaymentProvider = {
  name: 'razorpay',

  async createOrder({ amount, receipt }): Promise<PaymentOrder> {
    const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = getSettings();
    const keyId = RAZORPAY_KEY_ID!;
    const keySecret = RAZORPAY_KEY_SECRET!;

    // Paise. Razorpay counts in the smallest unit, and an amount in rupees would
    // silently charge a hundredth of the fee.
    const amountMinor = Math.round(amount * 100);

    const response = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: {
        authorization: authHeader(keyId, keySecret),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amount: amountMinor, currency: 'INR', receipt }),
    });

    if (!response.ok) {
      const detail = await response.text();
      logger.error('Razorpay refused to create an order', { status: response.status, detail });
      // The patient does not need the gateway's words; the log has them.
      throw ApiError.badRequest('Could not start the payment. Try again in a moment.');
    }

    const order = (await response.json()) as { id: string; amount: number };

    return {
      orderId: order.id,
      amountMinor: order.amount,
      currency: 'INR',
      // Public by design — it identifies the merchant to the checkout widget.
      // The secret never leaves this file.
      keyId,
      autoSettled: false,
    };
  },

  verifySignature({ orderId, paymentId, signature }: PaymentProof): boolean {
    const { RAZORPAY_KEY_SECRET } = getSettings();
    return safeEqual(signature, razorpaySignature(orderId, paymentId, RAZORPAY_KEY_SECRET!));
  },

  async refund({ paymentId, amount }): Promise<{ refundId: string }> {
    const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = getSettings();

    const response = await fetch(`${API_BASE}/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: {
        authorization: authHeader(RAZORPAY_KEY_ID!, RAZORPAY_KEY_SECRET!),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amount: Math.round(amount * 100) }),
    });

    if (!response.ok) {
      const detail = await response.text();
      // A refund that fails must not block the cancellation — the appointment is
      // off either way, and a stuck refund is a person's job, not a 500 for the
      // patient who cancelled.
      logger.error('Razorpay refused a refund', { status: response.status, paymentId, detail });
      throw ApiError.badRequest('The refund could not be started. The clinic will sort it out.');
    }

    const refund = (await response.json()) as { id: string };
    return { refundId: refund.id };
  },
};
