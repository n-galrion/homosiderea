import { Schema, model, type Document, type Types } from 'mongoose';

export interface IBlueprint extends Document {
  _id: Types.ObjectId;
  name: string;
  category: 'refining' | 'component' | 'ship' | 'structure';
  description: string;
  inputs: Array<{ resource: string; amount: number }>;
  outputs: Array<{ resource: string; amount: number }>;
  ticksToBuild: number;
  energyCost: number;
  requiredStructureType: string | null;
  techLevel: number;
}

const BlueprintSchema = new Schema<IBlueprint>({
  name: { type: String, required: true, unique: true },
  category: {
    type: String,
    enum: ['refining', 'component', 'ship', 'structure'],
    required: true,
  },
  description: { type: String, default: '' },
  inputs: [{
    resource: { type: String, required: true },
    amount: { type: Number, required: true },
  }],
  outputs: [{
    resource: { type: String, required: true },
    amount: { type: Number, required: true },
  }],
  ticksToBuild: { type: Number, required: true },
  energyCost: { type: Number, default: 0 },
  requiredStructureType: { type: String, default: null },
  techLevel: { type: Number, default: 1 },
}, { timestamps: true });

export const Blueprint = model<IBlueprint>('Blueprint', BlueprintSchema);
