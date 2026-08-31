import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { ROLES } from '@shared/types.js';

/**
 * Who changed what. Written for every state-changing admin or doctor action, so
 * "who cancelled this appointment" has an answer that outlives the appointment.
 */
const auditLogSchema = new Schema(
  {
    actorId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    actorRole: { type: String, enum: ROLES, required: true },
    /** Dotted verb, e.g. "appointment.cancel" or "doctor.create". */
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: Types.ObjectId },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDocument = HydratedDocument<AuditLog>;

export const AuditLogModel = model<AuditLog>('AuditLog', auditLogSchema);
