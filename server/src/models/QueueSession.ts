import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * A doctor's queue for one day: which token is being seen, when it was called,
 * and how many people have been through.
 *
 * `date` is the day at midnight UTC, so one document per doctor per day, created
 * the first time anyone looks at or acts on that day's queue.
 *
 * There is deliberately **no token counter here**. Tokens are a slot's position
 * in the doctor's day, worked out from the working hours at booking time — see
 * `tokenFor` in the appointment service for why. A counter in this document
 * would number patients by who clicked "book" first, which is not the order
 * anyone is seen in, and it would need a lock that positions do not.
 */
const queueSessionSchema = new Schema(
  {
    doctorId: { type: Types.ObjectId, ref: 'Doctor', required: true },
    date: { type: Date, required: true },

    /** Token being seen now. 0 means the day has not started. */
    currentToken: { type: Number, default: 0, min: 0 },
    lastCalledAt: { type: Date },
    servedCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// One session per doctor per day, and the lookup the socket room does on connect.
queueSessionSchema.index({ doctorId: 1, date: 1 }, { unique: true });

export type QueueSession = InferSchemaType<typeof queueSessionSchema>;
export type QueueSessionDocument = HydratedDocument<QueueSession>;

export const QueueSessionModel = model<QueueSession>('QueueSession', queueSessionSchema);
