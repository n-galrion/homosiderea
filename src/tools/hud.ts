import { Replicant, Ship, Message, MemoryLog, ActionQueue, KnownEntity, Tick, ResourceStore } from '../db/models/index.js';
import { distance } from '../shared/physics.js';
import { senderLabel } from '../shared/messaging.js';

export interface Hud {
  tick: number;
  vitals: {
    credits: number;
    fuelPct: number;
    hullPct: number;
    location: string;
    status: string;
  };
  unreadMessages: { count: number; items: Array<{ from: string; subject: string; tick: number }> };
  recentEvents: Array<{ title: string; tick: number; category: string }>;
  nearbyEntities: Array<{ name: string; kind: string; distanceAU: number }>;
  activeOps: { mining?: string; fabrication?: string };
  completedActions: Array<{ action: string; tick: number }>;
  warnings: string[];
  guidance: string[];
}

export interface McpResult { content: Array<{ type: string; text: string }> }

const RECENT_WINDOW = 3;       // ticks counted as "recent" for events/actions
const FUEL_WARN_PCT = 15;
const HULL_WARN_PCT = 25;
const MAX_ITEMS = 5;
const CARGO_FIELDS = ['metals','ice','silicates','rareEarths','helium3','organics','hydrogen','uranium','carbon','alloys','fuel','electronics','hullPlating','engines','sensors','computers','weaponSystems','lifeSupportUnits','solarPanels','fusionCores'];

async function currentTick(): Promise<number> {
  const t = await Tick.findOne().sort({ tickNumber: -1 }).lean();
  return (t as { tickNumber?: number } | null)?.tickNumber ?? 0;
}

/** Pick the ship the replicant is operating from: locationRef if it's a Ship, else first owned ship. */
async function resolveShip(replicant: { _id: unknown; locationRef?: { kind: string; item: unknown } | null }) {
  if (replicant.locationRef?.kind === 'Ship') {
    const s = await Ship.findById(replicant.locationRef.item);
    if (s) return s;
  }
  return Ship.findOne({ ownerId: replicant._id, status: { $ne: 'destroyed' } });
}

export async function buildHud(replicantId: string): Promise<Hud | null> {
  const replicant = await Replicant.findById(replicantId);
  if (!replicant) return null;

  const tick = await currentTick();
  const ship = await resolveShip(replicant);

  // Vitals
  const fuelPct = ship ? Math.round((ship.fuel / ship.specs.fuelCapacity) * 100) : 0;
  const hullPct = ship ? Math.round((ship.specs.hullPoints / ship.specs.maxHullPoints) * 100) : 0;
  let location = 'unknown';
  if (ship) {
    if (ship.orbitingBodyId) location = `orbiting body ${ship.orbitingBodyId.toString()}`;
    else if (ship.status === 'in_transit') location = 'in transit';
    else location = `(${ship.position.x.toFixed(2)}, ${ship.position.y.toFixed(2)}, ${ship.position.z.toFixed(2)})`;
  }

  // Unread (delivered but not read) messages addressed to this replicant — READ ONLY.
  const unread = await Message.find({ recipientId: replicantId, delivered: true, read: false })
    .sort({ deliverAtTick: -1 }).limit(MAX_ITEMS).lean();
  const unreadCount = await Message.countDocuments({ recipientId: replicantId, delivered: true, read: false });

  const unreadSenderIds = [...new Set(unread.map((m) => m.senderId?.toString()).filter(Boolean))];
  const unreadSenders = await Replicant.find({ _id: { $in: unreadSenderIds } }, 'name').lean();
  const unreadNameById = new Map(unreadSenders.map((s) => [s._id.toString(), s.name]));

  // Recent notable events from memory logs (world events / observations / captain's logs).
  const events = await MemoryLog.find({
    replicantId,
    tick: { $gte: tick - RECENT_WINDOW },
    category: { $in: ['observation', 'log', 'captains_log'] },
  }).sort({ tick: -1 }).limit(MAX_ITEMS).lean();

  // Recently resolved queued actions.
  const completed = await ActionQueue.find({
    replicantId,
    status: { $in: ['completed', 'failed'] },
    resolvedAtTick: { $gte: tick - RECENT_WINDOW },
  }).sort({ resolvedAtTick: -1 }).limit(MAX_ITEMS).lean();

  // Nearby known entities, sorted by distance from the ship.
  const nearbyEntities: Hud['nearbyEntities'] = [];
  if (ship) {
    const known = await KnownEntity.find({ replicantId, lastKnownPosition: { $ne: null } })
      .sort({ lastUpdatedTick: -1 }).limit(100).lean();
    for (const k of known) {
      if (!k.lastKnownPosition) continue;
      const d = distance(ship.position, k.lastKnownPosition);
      nearbyEntities.push({ name: k.entityName, kind: k.entityType, distanceAU: Math.round(d * 1000) / 1000 });
    }
    nearbyEntities.sort((a, b) => a.distanceAU - b.distanceAU);
    nearbyEntities.splice(MAX_ITEMS);
  }

  // Active operations
  const activeOps: Hud['activeOps'] = {};
  if (ship?.miningState?.active) {
    activeOps.mining = ship.miningState.resourceType ?? 'active';
  }

  // Warnings
  const warnings: string[] = [];
  if (ship && fuelPct < FUEL_WARN_PCT) warnings.push(`Fuel low: ${fuelPct}%`);
  if (ship && hullPct < HULL_WARN_PCT) warnings.push(`Hull damaged: ${hullPct}%`);

  // Cargo fullness (single indexed lookup) for guidance.
  let cargoPct = 0;
  if (ship) {
    const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id }).lean();
    if (store) {
      const storeAny = store as unknown as Record<string, number>;
      const used = CARGO_FIELDS.reduce((sum, f) => sum + (storeAny[f] || 0), 0);
      cargoPct = ship.specs.cargoCapacity > 0 ? Math.round((used / ship.specs.cargoCapacity) * 100) : 0;
    }
  }

  // State-driven next-step guidance.
  const guidance: string[] = [];
  if (unreadCount > 0) guidance.push(`You have ${unreadCount} unread message(s). Read them with read_messages, then clear them with mark_messages_read (or read_messages markRead:true).`);
  if (ship && fuelPct < FUEL_WARN_PCT) guidance.push('Fuel is low — refuel with transfer_fuel or dock at a settlement.');
  if (ship && hullPct < HULL_WARN_PCT) guidance.push('Hull is damaged — repair_ship when you have alloys and hull plating.');
  if (!replicant.identity?.chosenName) guidance.push('You have not named yourself yet — use set_identity to choose a name.');
  if (ship && cargoPct >= 90) guidance.push('Cargo hold is nearly full — sell at a market with trade, or unload_cargo.');
  if (ship && !ship.miningState?.active && ship.status !== 'in_transit') guidance.push('You are idle — scan_location, start_mining, or set a destination with move_ship.');

  return {
    tick,
    vitals: { credits: replicant.credits, fuelPct, hullPct, location, status: ship?.status ?? 'none' },
    unreadMessages: {
      count: unreadCount,
      items: unread.map((m) => {
        const sid = m.senderId?.toString();
        return { from: senderLabel(sid, sid ? unreadNameById.get(sid) : null), subject: m.subject, tick: m.sentAtTick };
      }),
    },
    recentEvents: events.map((e) => ({ title: e.title, tick: e.tick, category: e.category })),
    nearbyEntities,
    activeOps,
    completedActions: completed.map((c) => ({ action: c.type, tick: c.resolvedAtTick ?? c.queuedAtTick })),
    warnings,
    guidance,
  };
}

/**
 * Append the HUD as its OWN content block, leaving the tool's original
 * content[0] byte-for-byte intact (no re-serialization, never corrupts the
 * tool's JSON). The block's text is `{"hud": {...}}`. Use extractHud/mergeHud
 * to read it back in flattening consumers (REST route, worker clients).
 */
export async function attachHud(result: McpResult, replicantId: string): Promise<McpResult> {
  try {
    const hud = await buildHud(replicantId);
    if (!hud) return result;
    return {
      ...result,
      content: [...result.content, { type: 'text', text: JSON.stringify({ hud }) }],
    };
  } catch {
    return result; // HUD must never break a tool call
  }
}

/**
 * Pull the original tool text and the HUD back out of a result produced by
 * attachHud. content[0] is the tool's untouched payload; the HUD lives in a
 * later `{"hud": ...}` block.
 */
export function extractHud(result: McpResult): { dataText: string; hud: unknown } {
  const content = result.content || [];
  const dataText = content[0]?.text ?? '';
  let hud: unknown;
  for (let i = content.length - 1; i >= 1; i--) {
    try {
      const parsed = JSON.parse(content[i].text);
      if (parsed && typeof parsed === 'object' && 'hud' in parsed) {
        hud = (parsed as Record<string, unknown>).hud;
        break;
      }
    } catch { /* not the HUD block */ }
  }
  return { dataText, hud };
}

/** Combine parsed tool data with an optional HUD into one clean agent-facing value. */
export function mergeHud(data: unknown, hud: unknown): unknown {
  if (hud === undefined || hud === null) return data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>), hud };
  }
  return { result: data, hud };
}

export function withHud<T extends { tool: (...args: any[]) => void }>(target: T, replicantId: string): T {
  const original = target.tool.bind(target);
  target.tool = (name: string, description: string, schema: unknown, handler: (params: any) => Promise<McpResult>) => {
    const wrapped = async (params: any): Promise<McpResult> => {
      const out = await handler(params);
      return attachHud(out, replicantId);
    };
    return original(name, description, schema, wrapped);
  };
  return target;
}
