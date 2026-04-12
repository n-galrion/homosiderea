import { Schema, model, type Document, type Types } from 'mongoose';

export interface ITechnology extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string;
  domain: 'scanning' | 'mining' | 'propulsion' | 'weapons' | 'hull' | 'construction' | 'computing' | 'energy' | 'communication';
  tier: number;
  inventedBy: Types.ObjectId;
  inventedAtTick: number;
  // Stat modifiers — multipliers applied to relevant systems
  modifiers: Record<string, number>;
  // What prerequisites (other tech IDs) are needed
  prerequisites: Types.ObjectId[];
  // Who currently has this tech
  knownBy: Types.ObjectId[];
  // The original research proposal that created this
  proposalId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TechnologySchema = new Schema<ITechnology>({
  name: { type: String, required: true },
  description: { type: String, required: true },
  domain: {
    type: String,
    enum: ['scanning', 'mining', 'propulsion', 'weapons', 'hull', 'construction', 'computing', 'energy', 'communication'],
    required: true,
  },
  tier: { type: Number, default: 1 },
  inventedBy: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true },
  inventedAtTick: { type: Number, required: true },
  modifiers: { type: Schema.Types.Mixed, required: true },
  prerequisites: [{ type: Schema.Types.ObjectId, ref: 'Technology' }],
  knownBy: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
  proposalId: { type: Schema.Types.ObjectId, ref: 'ResearchProposal', required: true },
}, { timestamps: true });

TechnologySchema.index({ domain: 1 });
TechnologySchema.index({ knownBy: 1 });
TechnologySchema.index({ inventedBy: 1 });

export const Technology = model<ITechnology>('Technology', TechnologySchema);
