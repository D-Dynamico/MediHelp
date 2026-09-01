import { getSettings } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { mockPayments } from './mock.js';
import { razorpayPayments } from './razorpay.js';

/**
 * Where a card payment goes.
 *
 * The mock is the default and needs no account at all, so the whole booking and
 * payment flow runs from a fresh clone with only `MONGODB_URI` set. Razorpay
 * takes over when the provider is chosen *and* every key is present.
 *
 * Adding a provider must never change a caller. Both sides take an amount in
 * rupees and hand back an order; nothing above here knows which one ran, and
 * nothing above here ever sees a key.
 */

/** An order the client is asked to pay against. */
export interface PaymentOrder {
  /** The gateway's id for this attempt. Stored on the appointment. */
  orderId: string;
  /**
   * Paise, not rupees. Razorpay counts in the smallest unit, and the checkout
   * widget needs the same number the order was created with or it refuses.
   */
  amountMinor: number;
  currency: 'INR';
  /** Present only when a real gateway is in play; the client needs it to open checkout. */
  keyId?: string;
  /**
   * True when the provider settles the payment itself the moment it is asked —
   * which is what the mock does, so a demo with no keys still reaches "paid".
   */
  autoSettled: boolean;
}

/** What the client sends back after paying, for the server to check. */
export interface PaymentProof {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface PaymentProvider {
  readonly name: 'mock' | 'razorpay';
  createOrder(input: { amount: number; receipt: string }): Promise<PaymentOrder>;
  /**
   * Whether this proof really came from the gateway.
   *
   * The whole point of the payment flow: a client can say anything, and only an
   * HMAC computed with a secret it does not have can tell the difference.
   */
  verifySignature(proof: PaymentProof): boolean;
  /** Refunds a captured payment. Returns the gateway's refund id, when there is one. */
  refund(input: { paymentId: string; amount: number }): Promise<{ refundId: string }>;
}

let cached: PaymentProvider | null = null;

/** The provider chosen from the environment, decided once at first use. */
export function payments(): PaymentProvider {
  if (cached) return cached;

  const { useRazorpay, PAYMENT_PROVIDER } = getSettings();

  if (PAYMENT_PROVIDER === 'razorpay' && !useRazorpay) {
    // Falling back quietly would take real bookings and mark them paid without
    // any money moving. Say so loudly, at startup, while someone is watching.
    logger.warn(
      'PAYMENT_PROVIDER is razorpay but the keys are incomplete — falling back to the mock. ' +
        'Payments will be marked paid without any money moving.',
    );
  }

  cached = useRazorpay ? razorpayPayments : mockPayments;
  logger.info(`Payments: ${cached.name}`);
  return cached;
}

/** Forgets the cached choice. For scripts and tests only. */
export function resetPayments(): void {
  cached = null;
}
