import {
  confirmMockPayment,
  createPaymentOrder,
  verifyPayment,
  type PaymentOrder,
} from './patient';

/**
 * Paying for an appointment, whichever provider is configured.
 *
 * One function so the screens never branch on the provider themselves. With no
 * gateway keys set the server settles the order on request; with Razorpay
 * configured this opens their checkout and hands the answer back to be verified.
 * Either way the caller awaits one promise and the appointment comes back paid.
 */

/** Razorpay's widget, loaded from their own domain — it cannot be bundled. */
const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  handler: (response: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

/** Loads the widget once, on demand. Nothing is fetched until someone pays. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load the payment window.')));
      return;
    }

    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the payment window.'));
    document.body.append(script);
  });
}

/** Thrown when the patient closes the checkout without paying. */
export class PaymentAbandoned extends Error {
  constructor() {
    super('The payment window was closed.');
    this.name = 'PaymentAbandoned';
  }
}

/**
 * Takes payment for an appointment that was booked to be paid online.
 *
 * Resolves once the server has confirmed the money — never merely once the
 * widget said so. The widget's word is checked against an HMAC on the server
 * before anything is marked paid.
 */
export async function payForAppointment(
  appointmentId: string,
  doctorName: string,
): Promise<void> {
  const order = await createPaymentOrder(appointmentId);

  if (order.autoSettled) {
    // No gateway configured. The server settles it, and refuses to do so the
    // moment real keys exist.
    await confirmMockPayment(appointmentId);
    return;
  }

  await openGateway(order, doctorName);
}

function openGateway(order: PaymentOrder, doctorName: string): Promise<void> {
  return loadCheckout().then(
    () =>
      new Promise<void>((resolve, reject) => {
        const Razorpay = window.Razorpay;
        if (!Razorpay || !order.keyId) {
          reject(new Error('The payment window is unavailable.'));
          return;
        }

        const checkout = new Razorpay({
          key: order.keyId,
          amount: order.amountMinor,
          currency: order.currency,
          order_id: order.orderId,
          name: 'MediHelp',
          description: `Consultation with ${doctorName}`,
          handler: (response) => {
            // Straight to the server. Nothing the widget said is believed until
            // the signature over it has been recomputed there.
            verifyPayment({
              appointmentId: order.appointmentId,
              orderId: response.razorpay_order_id,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            }).then(resolve, reject);
          },
          modal: { ondismiss: () => reject(new PaymentAbandoned()) },
        });

        checkout.open();
      }),
  );
}
