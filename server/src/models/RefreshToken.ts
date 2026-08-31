import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * One row per issued refresh token. Tokens are opaque random values; only their
 * hash is stored, so a database leak does not hand out sessions.
 *
 * Every token issued from one login shares a `family`. Rotation replaces a token
 * within its family; presenting a token that was already replaced means it was
 * stolen, and the whole family is revoked.
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },

    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    /** Hash of the token that replaced this one, so a replay is identifiable. */
    replacedBy: { type: String },

    ip: { type: String },
    ua: { type: String },
  },
  { timestamps: true },
);

// Mongo removes expired rows on its own, so the collection cannot grow forever.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof refreshTokenSchema>;
export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

export const RefreshTokenModel = model<RefreshToken>('RefreshToken', refreshTokenSchema);
