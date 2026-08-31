import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { PAYMENT_MODES, PAYMENT_STATUSES } from '@shared/types.js';

/**
 * A payment attempt. The appointment carries the current payment state for
 * display; this collection is the audit trail — every order, verification and
 * refund, including the failures.
 */
const paymentSchema = new Schema(
  {
    appointmentId: { type: Types.ObjectId, ref: 'Appointment', required: true, index: true },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    /** Always taken from the doctor record on the server, never from the client. */
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending', required: true },

    gatewayOrderId: { type: String, index: true },
    gatewayPaymentId: { type: String },
    /** False until the HMAC signature has been checked server-side. */
    signatureVerified: { type: Boolean, default: false },

    /** The gateway's raw payload, kept for reconciling a disputed payment. */
    raw: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

export type Payment = InferSchemaType<typeof paymentSchema>;
export type PaymentDocument = HydratedDocument<Payment>;

export const PaymentModel = model<Payment>('Payment', paymentSchema);
