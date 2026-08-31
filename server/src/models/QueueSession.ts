import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * A doctor's queue for one day: which token is being seen, how many are done,
 * and the running average consult time behind the wait estimate.
 *
 * `date` is the day at midnight UTC, so one document per doctor per day.
 */
const queueSessionSchema = new Schema(
  {
    doctorId: { type: Types.ObjectId, ref: 'Doctor', required: true },
    date: { type: Date, required: true },

    /** Token being seen now. 0 means the day has not started. */
    currentToken: { type: Number, default: 0, min: 0 },
    /** Highest token handed out today; the allocator increments this. */
    lastIssuedToken: { type: Number, default: 0, min: 0 },
    lastCalledAt: { type: Date },
    servedCount: { type: Number, default: 0, min: 0 },
    avgConsultMins: { type: Number, min: 1 },
  },
  { timestamps: true },
);

// One session per doctor per day, and the lookup the socket room does on connect.
queueSessionSchema.index({ doctorId: 1, date: 1 }, { unique: true });

export type QueueSession = InferSchemaType<typeof queueSessionSchema>;
export type QueueSessionDocument = HydratedDocument<QueueSession>;

export const QueueSessionModel = model<QueueSession>('QueueSession', queueSessionSchema);
