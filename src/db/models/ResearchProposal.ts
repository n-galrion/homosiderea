import { Schema, model, type Document, type Types } from 'mongoose';

export interface IResearchProposal extends Document {
  _id: Types.ObjectId;
  replicantId: Types.ObjectId;
  domain: string;
  title: string;
  description: string;
  approach: string;
  // What existing techs the replicant is building on
  buildingOn: Types.ObjectId[];
  // Master Controller evaluation
  status: 'pending' | 'evaluating' | 'success' | 'partial' | 'failure';
  evaluation: {
    plausibility: number;
    novelty: number;
    difficulty: number;
    reasoning: string;
    resultDescription: string;
  } | null;
  // If successful, the resulting technology
  resultTechId: Types.ObjectId | null;
  // Costs
  computeCost: number;
  energyCost: number;
  ticksRequired: number;
  startedAtTick: number;
  completedAtTick: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const ResearchProposalSchema = new Schema<IResearchProposal>({
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, index: true },
  domain: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  approach: { type: String, required: true },
  buildingOn: [{ type: Schema.Types.ObjectId, ref: 'Technology' }],
  status: {
    type: String,
    enum: ['pending', 'evaluating', 'success', 'partial', 'failure'],
    default: 'pending',
  },
  evaluation: {
    type: {
      plausibility: { type: Number },
      novelty: { type: Number },
      difficulty: { type: Number },
      reasoning: { type: String },
      resultDescription: { type: String },
    },
    default: null,
  },
  resultTechId: { type: Schema.Types.ObjectId, ref: 'Technology', default: null },
  computeCost: { type: Number, default: 100 },
  energyCost: { type: Number, default: 50 },
  ticksRequired: { type: Number, default: 5 },
  startedAtTick: { type: Number, required: true },
  completedAtTick: { type: Number, default: null },
}, { timestamps: true });

export const ResearchProposal = model<IResearchProposal>('ResearchProposal', ResearchProposalSchema);
