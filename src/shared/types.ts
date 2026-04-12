import type { Types } from 'mongoose';
import type {
  RAW_RESOURCES, PROCESSED_RESOURCES, COMPONENT_RESOURCES,
  ALL_RESOURCES, SHIP_TYPES, STRUCTURE_TYPES, AMI_TYPES,
  CELESTIAL_BODY_TYPES, ACTION_TYPES,
} from './constants.js';

// Utility types from const arrays
export type RawResource = typeof RAW_RESOURCES[number];
export type ProcessedResource = typeof PROCESSED_RESOURCES[number];
export type ComponentResource = typeof COMPONENT_RESOURCES[number];
export type AnyResource = typeof ALL_RESOURCES[number];
export type ShipType = typeof SHIP_TYPES[number];
export type StructureType = typeof STRUCTURE_TYPES[number];
export type AMIType = typeof AMI_TYPES[number];
export type CelestialBodyType = typeof CELESTIAL_BODY_TYPES[number];
export type ActionType = typeof ACTION_TYPES[number];

// Geometric
export interface Position {
  x: number;
  y: number;
  z: number;
}

// Polymorphic reference
export interface EntityRef {
  kind: 'Ship' | 'Structure' | 'CelestialBody';
  item: Types.ObjectId;
}

// AMI scripting
export interface AMIRule {
  condition: string;
  action: string;
  priority: number;
}

export interface AMIScriptDef {
  type: 'builtin' | 'custom';
  builtinName?: string;
  customRules?: AMIRule[];
}

// AMI execution context (available to script conditions)
export interface AMIContext {
  cargo: Record<string, number>;
  cargoUsed: number;
  cargoCapacity: number;
  cargoFull: boolean;
  cargoEmpty: boolean;
  location: {
    bodyId: string | null;
    bodyName: string | null;
    bodyType: string | null;
    inTransit: boolean;
  };
  status: string;
  hullPercent: number;
  fuelPercent: number;
  nearbyHostiles: number;
  nearbyAllies: number;
  tick: number;
  scriptState: Record<string, unknown>;
}

// Action params (varies by type)
export interface ActionParams {
  [key: string]: unknown;
}

// Tick result summary
export interface TickResult {
  tickNumber: number;
  durationMs: number;
  actionsProcessed: number;
  amisExecuted: number;
  messagesDelivered: number;
  errors: string[];
}
