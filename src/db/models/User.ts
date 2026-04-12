import { Schema, model, type Document, type Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  username: string;
  email: string;
  passwordHash: string;
  role: 'operator' | 'owner' | 'spectator';
  replicantIds: Types.ObjectId[];
  apiKeys: Array<{
    key: string;
    name: string;
    replicantId: Types.ObjectId;
    createdAt: Date;
    lastUsedAt: Date | null;
    active: boolean;
  }>;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['operator', 'owner', 'spectator'], default: 'spectator' },
  replicantIds: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
  apiKeys: [{
    key: { type: String, required: true },
    name: { type: String, required: true },
    replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant' },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
  }],
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true });

export const User = model<IUser>('User', UserSchema);
