import { Schema, model, type InferSchemaType, type HydratedDocument, type Model } from 'mongoose';
import { ROLES } from '@shared/types.js';

/**
 * One account per person, whatever their role. Doctors get a `User` for
 * authentication and a `Doctor` for their professional profile, so login and
 * guards work the same way for all three roles.
 */

/** Failed logins allowed before the account locks. */
export const MAX_FAILED_LOGINS = 6;
/** How long the account stays locked once the limit is hit. */
export const LOCK_DURATION_MS = 15 * 60 * 1000;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Never returned unless explicitly selected, so it cannot leak through a
    // forgotten `.select()` or a spread into a response body.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },

    phone: { type: String, trim: true },
    dob: { type: Date },
    gender: { type: String, enum: ['male', 'female', 'other', 'prefer_not_to_say'] },
    image: { type: String },

    /** Soft delete. Deactivated accounts keep their history but cannot log in. */
    isActive: { type: Boolean, default: true, index: true },

    failedLogins: { type: Number, default: 0 },
    lockUntil: { type: Date },
  },
  { timestamps: true },
);

/** True while the account is locked out after too many failed logins. */
userSchema.methods.isLocked = function isLocked(this: UserDocument): boolean {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

/** Age in whole years, or undefined if no date of birth is on file. */
userSchema.methods.age = function age(this: UserDocument): number | undefined {
  if (!this.dob) return undefined;
  const diff = Date.now() - this.dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
};

/**
 * Declared separately so query results carry the methods — without this,
 * `findById(...)` returns a document the compiler thinks has no `isLocked()`.
 */
export interface UserMethods {
  /** True while the account is locked out after too many failed logins. */
  isLocked(): boolean;
  /** Age in whole years, or undefined if no date of birth is on file. */
  age(): number | undefined;
}

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User, UserMethods>;
type UserModelType = Model<User, object, UserMethods>;

export const UserModel = model<User, UserModelType>('User', userSchema);
