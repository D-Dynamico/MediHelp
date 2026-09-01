import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentOrder, PaymentProof, PaymentProvider } from './index.js';

/**
 * A gateway that is not one.
 *
 * The default, so the whole payment flow demos with no account anywhere. It is
 * deliberately *not* a rubber stamp: it signs its orders with a per-process
 * secret and checks that signature the same way the real provider does, using
 * the same HMAC and the same constant-time comparison.
 *
 * That matters because the verification path is the part worth exercising. A
 * mock that returned `true` from `verifySignature` would let every check in the
 * suite pass while the real failure — accepting a payment nobody made — went
 * untested. Here a forged proof is rejected by the mock too.
 */

/**
 * Regenerated on each boot, and never written down. It is not protecting money;
 * it is making the local flow behave like the real one.
 */
const SECRET = randomUUID();

/** Razorpay's payload shape, so the two providers verify identically. */
function digestFor(orderId: string, paymentId: string, secret: string): string {
  return createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
}

export function mockSignatureFor(orderId: string, paymentId: string): string {
  return digestFor(orderId, paymentId, SECRET);
}

/**
 * Constant-time comparison. Length is checked first because `timingSafeEqual`
 * throws on a mismatch rather than returning false.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const mockPayments: PaymentProvider = {
  name: 'mock',

  createOrder({ amount }): Promise<PaymentOrder> {
    return Promise.resolve({
      orderId: `order_mock_${randomUUID().replaceAll('-', '').slice(0, 14)}`,
      amountMinor: amount * 100,
      currency: 'INR',
      // No key id: there is no checkout widget to open, and the client uses this
      // flag to know it should confirm the payment itself instead.
      autoSettled: true,
    });
  },

  verifySignature({ orderId, paymentId, signature }: PaymentProof): boolean {
    return safeEqual(signature, digestFor(orderId, paymentId, SECRET));
  },

  refund({ paymentId }): Promise<{ refundId: string }> {
    return Promise.resolve({ refundId: `rfnd_mock_${paymentId.slice(-8)}` });
  },
};
