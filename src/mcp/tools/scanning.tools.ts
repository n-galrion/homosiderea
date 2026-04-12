import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, CelestialBody, Replicant, Structure, Asteroid, LandingSite, Settlement, Tick, MemoryLog } from '../../db/models/index.js';
import { KnownEntity } from '../../db/models/KnownEntity.js';
import { distance } from '../../shared/physics.js';
import { AU_IN_KM, SPEED_OF_LIGHT_KM_S } from '../../shared/constants.js';
import { generateForBeltZone, discoverNearby } from '../../engine/systems/AsteroidGenerator.js';

/** Convert distance in AU to light-seconds. */
function auToLightSeconds(au: number): number {
  return (au * AU_IN_KM) / SPEED_OF_LIGHT_KM_S;
}

/** Describe a resource abundance qualitatively. */
function describeAbundance(resourceType: string, abundance: number): string {
  const name = resourceType.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  if (abundance >= 0.8) return `exceptionally rich ${name} deposits saturate the subsurface`;
  if (abundance >= 0.5) return `substantial ${name} veins detected beneath the regolith`;
  if (abundance >= 0.3) return `moderate ${name} concentrations present in scattered formations`;
  if (abundance >= 0.1) return `trace ${name} signatures detected, economically marginal`;
  return `negligible ${name} readings, below extraction threshold`;
}

/** Upsert a known entity for a replicant. Upgrades intel level if new level is higher. */
async function upsertKnownEntity(
  replicantId: string,
  entityType: 'celestial_body' | 'asteroid' | 'ship' | 'structure' | 'settlement' | 'replicant',
  entityId: string,
  entityName: string,
  position: { x: number; y: number; z: number } | null,
  discoveredBy: 'initial' | 'scan' | 'visit' | 'shared' | 'broadcast' | 'research',
  intelLevel: 'vague' | 'basic' | 'detailed' | 'complete',
  currentTick: number,
): Promise<void> {
  const intelOrder = ['vague', 'basic', 'detailed', 'complete'];
  const existing = await KnownEntity.findOne({
    replicantId,
    entityType,
    entityId,
  });

  if (existing) {
    // Only upgrade intel level, never downgrade
    const existingIdx = intelOrder.indexOf(existing.intelLevel);
    const newIdx = intelOrder.indexOf(intelLevel);
    if (newIdx > existingIdx) {
      existing.intelLevel = intelLevel;
    }
    existing.lastUpdatedTick = currentTick;
    if (position) {
      existing.lastKnownPosition = position;
    }
    await existing.save();
  } else {
    await KnownEntity.create({
      replicantId,
      entityType,
      entityId,
      entityName,
      discoveredAtTick: currentTick,
      discoveredBy,
      lastUpdatedTick: currentTick,
      lastKnownPosition: position,
      intelLevel,
    });
  }
}

/** Generate a sensor report narrative for a scan. */
function buildSensorReport(
  shipName: string,
  scanRange: number,
  bodies: Array<{ name: string; type: string; dist: number; resources: Array<{ resourceType: string; abundance: number; remaining: number }> }>,
  shipsInRange: Array<{ name: string; type: string; dist: number }>,
  asteroidsInRange: Array<{ name: string; dist: number; physical: { composition: string; radius: number } }>,
  nearbySettlements: Array<{ name: string; nation: string; population: number }>,
): string {
  const lines: string[] = [];
  lines.push(`SENSOR SWEEP COMPLETE — ${shipName} active array, effective range ${scanRange.toFixed(2)} AU (${auToLightSeconds(scanRange).toFixed(1)} light-seconds).`);

  if (bodies.length === 0 && asteroidsInRange.length === 0 && shipsInRange.length === 0) {
    lines.push('The void is empty at this range. No significant gravitational or thermal signatures detected — only the faint hiss of cosmic microwave background across all bands.');
    return lines.join('\n\n');
  }

  for (const b of bodies.slice(0, 5)) {
    const distKm = (b.dist * AU_IN_KM).toExponential(2);
    const ls = auToLightSeconds(b.dist).toFixed(1);
    let desc = `${b.name} (${b.type}) at ${b.dist.toFixed(4)} AU / ${ls} light-seconds (${distKm} km).`;
    const richResources = b.resources.filter(r => r.abundance >= 0.3 && r.remaining > 0);
    if (richResources.length > 0) {
      desc += ' Spectrographic analysis reveals ' + richResources.map(r => describeAbundance(r.resourceType, r.abundance)).join('; ') + '.';
    }
    lines.push(desc);
  }

  if (asteroidsInRange.length > 0) {
    const compCounts: Record<string, number> = {};
    for (const a of asteroidsInRange) {
      compCounts[a.physical.composition] = (compCounts[a.physical.composition] || 0) + 1;
    }
    const compDesc = Object.entries(compCounts).map(([c, n]) => `${n} ${c}`).join(', ');
    lines.push(`Asteroid field contact: ${asteroidsInRange.length} bodies resolved (${compDesc}). Nearest is ${asteroidsInRange[0].name} at ${asteroidsInRange[0].dist.toFixed(4)} AU — a ${asteroidsInRange[0].physical.composition} body approximately ${(asteroidsInRange[0].physical.radius * 2).toFixed(1)} km across.`);
  }

  if (shipsInRange.length > 0) {
    lines.push(`Transponder contacts: ${shipsInRange.length} vessel${shipsInRange.length > 1 ? 's' : ''} detected. Nearest contact "${shipsInRange[0].name}" (${shipsInRange[0].type}) at ${shipsInRange[0].dist.toFixed(4)} AU — thermal signature consistent with active reactor.`);
  }

  if (nearbySettlements.length > 0) {
    const names = nearbySettlements.map(s => `${s.name} (${s.nation}, pop. ${s.population.toLocaleString()})`);
    lines.push(`Settlement beacons: ${names.join(', ')}. Communication channels are open; market data available on standard frequencies.`);
  }

  return lines.join('\n\n');
}

export function registerScanningTools(server: McpServer, replicantId: string): void {

  server.tool(
    'scan_location',
    'Scan the area around your current position for celestial bodies, ships, and structures within sensor range.',
    { range: z.number().optional().describe('Scan range in AU (defaults to ship sensor range)') },
    async ({ range }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location. You need to be on a ship or structure.' }] };
      }

      const ship = await Ship.findById(replicant.locationRef.item);
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };
      }

      const scanRange = range || ship.specs.sensorRange;
      const myPos = ship.position;

      // Find nearby celestial bodies
      const bodies = await CelestialBody.find().lean();
      const nearbyBodies = bodies
        .map(b => ({ ...b, dist: distance(myPos, b.position) }))
        .filter(b => b.dist <= scanRange)
        .sort((a, b) => a.dist - b.dist);

      // Find nearby ships (not ours)
      const nearbyShips = await Ship.find({
        ownerId: { $ne: replicantId },
        status: { $ne: 'destroyed' },
      }).lean();
      const shipsInRange = nearbyShips
        .map(s => ({ ...s, dist: distance(myPos, s.position), status: s.status }))
        .filter(s => s.dist <= scanRange)
        .sort((a, b) => a.dist - b.dist);

      // Find nearby structures
      const nearbyStructures = await Structure.find({
        status: { $ne: 'destroyed' },
      }).lean();

      // Procedural asteroid generation: if near a belt zone, spawn asteroids
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;
      let asteroidsGenerated = 0;
      let asteroidsDiscovered = 0;

      for (const b of nearbyBodies) {
        if (b.type === 'belt_zone' && b.beltConfig) {
          const generated = await generateForBeltZone(b._id.toString(), b.beltConfig.density, currentTick);
          asteroidsGenerated += generated;
        }
      }

      // Discover nearby asteroids
      asteroidsDiscovered = await discoverNearby(myPos, scanRange, replicantId, currentTick);

      // Find discovered asteroids in range
      const discoveredAsteroids = await Asteroid.find({ discovered: true, depleted: false }).lean();
      const asteroidsInRange = discoveredAsteroids
        .map(a => ({ ...a, dist: distance(myPos, a.position) }))
        .filter(a => a.dist <= scanRange)
        .sort((a, b) => a.dist - b.dist);

      // Find settlements near orbiting bodies for narrative context
      const nearbySettlements: Array<{ _id: string; name: string; nation: string; population: number }> = [];
      for (const b of nearbyBodies) {
        const bodySettlements = await Settlement.find({ bodyId: b._id }).lean();
        for (const s of bodySettlements) {
          nearbySettlements.push({ _id: s._id.toString(), name: s.name, nation: s.nation, population: s.population });
        }
      }

      // --- Upsert KnownEntity for all discovered items ---

      // Celestial bodies found in range -> basic intel
      for (const b of nearbyBodies) {
        await upsertKnownEntity(
          replicantId, 'celestial_body', b._id.toString(), b.name,
          b.position, 'scan', 'basic', currentTick,
        );
      }

      // Asteroids found in range -> basic intel
      for (const a of asteroidsInRange) {
        await upsertKnownEntity(
          replicantId, 'asteroid', a._id.toString(), a.name,
          a.position, 'scan', 'basic', currentTick,
        );
      }

      // Ships found: add their owner replicant to known entities
      for (const s of shipsInRange) {
        await upsertKnownEntity(
          replicantId, 'replicant', s.ownerId.toString(), s.name + ' (owner)',
          null, 'scan', 'vague', currentTick,
        );
      }

      // Settlements on scanned bodies -> basic intel
      for (const s of nearbySettlements) {
        await upsertKnownEntity(
          replicantId, 'settlement', s._id.toString(), s.name,
          null, 'scan', 'basic', currentTick,
        );
      }

      const sensorReport = buildSensorReport(
        ship.name,
        scanRange,
        nearbyBodies.map(b => ({ name: b.name, type: b.type, dist: b.dist, resources: b.resources })),
        shipsInRange.map(s => ({ name: s.name, type: s.type, dist: s.dist })),
        asteroidsInRange.map(a => ({ name: a.name, dist: a.dist, physical: a.physical })),
        nearbySettlements,
      );

      const result = {
        sensorReport,
        position: myPos,
        scanRange,
        scanRangeLightSeconds: parseFloat(auToLightSeconds(scanRange).toFixed(1)),
        celestialBodies: nearbyBodies.map(b => ({
          id: b._id.toString(),
          name: b.name,
          type: b.type,
          distanceAU: parseFloat(b.dist.toFixed(6)),
          distanceLightSeconds: parseFloat(auToLightSeconds(b.dist).toFixed(1)),
          position: b.position,
          resources: b.resources.map(r => ({
            type: r.resourceType,
            abundance: r.abundance,
            remaining: r.remaining,
            depleted: r.remaining <= 0,
            qualitative: describeAbundance(r.resourceType, r.abundance),
          })),
        })),
        asteroids: asteroidsInRange.map(a => ({
          id: a._id.toString(),
          name: a.name,
          composition: a.physical.composition,
          radiusKm: a.physical.radius,
          distanceAU: parseFloat(a.dist.toFixed(6)),
          distanceLightSeconds: parseFloat(auToLightSeconds(a.dist).toFixed(1)),
          depleted: a.depleted,
          resources: a.resources.map(r => ({
            type: r.resourceType,
            remaining: r.remaining,
            totalDeposit: r.totalDeposit,
          })),
        })),
        ships: shipsInRange.map(s => ({
          name: s.name,
          type: s.type,
          distanceAU: parseFloat(s.dist.toFixed(6)),
          distanceLightSeconds: parseFloat(auToLightSeconds(s.dist).toFixed(1)),
          status: s.status,
        })),
        settlements: nearbySettlements.map(s => ({ name: s.name, nation: s.nation, population: s.population })),
        structuresDetected: nearbyStructures.length,
        asteroidsGenerated,
        asteroidsDiscovered,
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'survey_body',
    'Get detailed information about a celestial body you are orbiting or within sensor range of.',
    { bodyId: z.string().describe('ID of the celestial body to survey') },
    async ({ bodyId }) => {
      const body = await CelestialBody.findById(bodyId).lean();
      if (!body) {
        return { content: [{ type: 'text', text: 'Error: Celestial body not found.' }] };
      }

      // Get landing sites for this body
      const sites = await LandingSite.find({ bodyId: body._id, discovered: true }).lean();

      // Get settlements for narrative
      const settlements = await Settlement.find({ bodyId: body._id }).lean();

      // --- Upgrade KnownEntity to detailed intel ---
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      await upsertKnownEntity(
        replicantId, 'celestial_body', body._id.toString(), body.name,
        body.position, 'scan', 'detailed', currentTick,
      );

      // Add all landing sites on this body to known entities
      for (const s of sites) {
        await upsertKnownEntity(
          replicantId, 'structure', s._id.toString(), s.name,
          null, 'scan', 'basic', currentTick,
        );
      }

      // Add settlements on this body to known entities
      for (const s of settlements) {
        await upsertKnownEntity(
          replicantId, 'settlement', s._id.toString(), s.name,
          null, 'scan', 'detailed', currentTick,
        );
      }

      // Build scientific survey narrative
      const surveyLines: string[] = [];
      surveyLines.push(`SURVEY REPORT: ${body.name} (${body.type})`);
      surveyLines.push('='.repeat(40));

      // Physical description
      const phys = body.physical as Record<string, unknown> | undefined;
      if (phys) {
        const descParts: string[] = [];
        if (phys.radius) descParts.push(`radius ${phys.radius} km`);
        if (phys.mass) descParts.push(`mass ${phys.mass} kg`);
        if (phys.surfaceGravity) descParts.push(`surface gravity ${phys.surfaceGravity} m/s^2`);

        if (body.type === 'star') {
          surveyLines.push(`Sol-type stellar body. ${descParts.length > 0 ? descParts.join(', ') + '.' : ''} Electromagnetic radiation dominates the local environment — solar wind particle flux renders close approach hazardous to unshielded electronics. Solar energy collection is optimal within 1.5 AU.`);
        } else if (body.type === 'planet') {
          const hasAtmo = phys.atmosphere && (phys.atmosphere as Record<string, unknown>).composition;
          surveyLines.push(`Planetary body ${body.name}. ${descParts.length > 0 ? descParts.join(', ') + '.' : ''}${hasAtmo ? ` Atmospheric analysis detects ${JSON.stringify((phys.atmosphere as Record<string, unknown>).composition)} — ${body.name === 'Earth' ? 'a nitrogen-oxygen mix capable of supporting carbon-based life' : body.name === 'Mars' ? 'a thin CO2 atmosphere at roughly 0.6% of Earth surface pressure' : body.name === 'Venus' ? 'a dense CO2 atmosphere with crushing surface pressures exceeding 90 atm and temperatures above 460C' : 'composition noted for reference'}.` : ' No significant atmosphere detected; surface is exposed to vacuum and unfiltered solar radiation.'} ${phys.magneticField ? 'A detectable magnetic field provides partial radiation shielding.' : 'No global magnetic field — surface radiation levels are elevated.'}`);
        } else if (body.type === 'moon') {
          surveyLines.push(`Natural satellite ${body.name}. ${descParts.length > 0 ? descParts.join(', ') + '.' : ''} Tidally locked to its primary — one face permanently sunlit during local day, the other in perpetual shadow. ${phys.surfaceGravity && (phys.surfaceGravity as number) < 2 ? 'Low surface gravity makes landing and launch operations fuel-efficient, but complicates surface construction anchoring.' : 'Surface gravity sufficient for conventional construction techniques.'}`);
        } else if (body.type === 'dwarf_planet') {
          surveyLines.push(`Dwarf planet ${body.name}. ${descParts.length > 0 ? descParts.join(', ') + '.' : ''} A cold, distant body at the outer reaches — solar energy collection is minimal this far from Sol. Surface temperatures hover near absolute zero; ice deposits may be abundant.`);
        } else if (body.type === 'belt_zone') {
          surveyLines.push(`Asteroid belt zone. This region contains a distributed field of minor bodies — metallic, carbonaceous, siliceous, and icy compositions detected across the field. Individual asteroids must be resolved by active scanning at closer range.`);
        } else {
          surveyLines.push(`Celestial body ${body.name} (${body.type}). ${descParts.length > 0 ? descParts.join(', ') + '.' : ''}`);
        }
      }

      // Resource assessment
      const accessibleResources = body.resources.filter(r => r.accessible && r.remaining > 0);
      if (accessibleResources.length > 0) {
        surveyLines.push('');
        surveyLines.push('RESOURCE ASSESSMENT:');
        for (const r of accessibleResources) {
          const pct = r.totalDeposit > 0 ? ((r.remaining / r.totalDeposit) * 100).toFixed(1) : '?';
          surveyLines.push(`  ${r.resourceType}: ${describeAbundance(r.resourceType, r.abundance)}. ${pct}% of estimated total deposit remains (${r.remaining.toLocaleString()} / ${r.totalDeposit.toLocaleString()} units). Accessible with current extraction technology.`);
        }
        const inaccessible = body.resources.filter(r => !r.accessible && r.remaining > 0);
        if (inaccessible.length > 0) {
          surveyLines.push(`  ${inaccessible.length} additional resource type(s) detected but not accessible with current technology — deeper geological strata or hostile surface conditions prevent extraction.`);
        }
      } else {
        surveyLines.push('\nRESOURCE ASSESSMENT: No economically viable deposits detected at current technology levels.');
      }

      // Landing sites
      if (sites.length > 0) {
        surveyLines.push('');
        surveyLines.push('LANDING SITE ANALYSIS:');
        for (const s of sites) {
          const condParts: string[] = [];
          if (s.conditions) {
            const conds = s.conditions as Record<string, unknown>;
            if (conds.temperature) condParts.push(`surface temp ${conds.temperature}`);
            if (conds.radiation) condParts.push(`radiation level ${conds.radiation}`);
            if (conds.stability) condParts.push(`geological stability ${conds.stability}`);
          }
          surveyLines.push(`  ${s.name} — ${s.terrain} terrain. Capacity for ${s.maxStructures} structures. ${s.claimedBy ? 'CLAIMED by another operator.' : 'Available for claim.'} ${condParts.length > 0 ? condParts.join(', ') + '.' : ''} Resource access: ${Array.isArray(s.resourceAccess) ? s.resourceAccess.join(', ') : 'standard'}.`);
        }
      }

      // Settlements
      if (settlements.length > 0) {
        surveyLines.push('');
        surveyLines.push('SETTLEMENTS:');
        for (const s of settlements) {
          surveyLines.push(`  ${s.name} (${s.nation}) — ${s.type}, population ${s.population.toLocaleString()}, status: ${s.status}. Spaceport level ${s.economy.spaceportLevel}. Attitude toward replicants: ${s.attitude.general > 0.5 ? 'favorable' : s.attitude.general > 0 ? 'neutral' : 'hostile'} (${s.attitude.general.toFixed(2)}).`);
        }
      }

      // Strategic assessment
      surveyLines.push('');
      surveyLines.push('STRATEGIC ASSESSMENT:');
      const solarFactor = body.solarEnergyFactor;
      const stratParts: string[] = [];
      if (solarFactor >= 0.8) stratParts.push('Excellent solar energy collection — photovoltaic arrays will operate at high efficiency.');
      else if (solarFactor >= 0.3) stratParts.push('Adequate solar energy — supplementary power generation recommended for heavy industry.');
      else stratParts.push('Minimal solar flux at this distance — fusion or nuclear power required for sustained operations.');

      if (accessibleResources.length >= 3) stratParts.push('Rich resource base supports self-sufficient colony operations.');
      else if (accessibleResources.length >= 1) stratParts.push('Limited resource diversity — trade relationships or supply lines will be necessary.');
      else stratParts.push('No local resources — this location is strategic only, not economic.');

      if (settlements.length > 0) stratParts.push(`${settlements.length} settlement(s) present — trade opportunities and potential diplomatic considerations.`);
      if (sites.length > 0 && sites.some(s => !s.claimedBy)) stratParts.push(`${sites.filter(s => !s.claimedBy).length} unclaimed landing site(s) available for colonization.`);

      surveyLines.push(stratParts.join(' '));

      const surveyNarrative = surveyLines.join('\n');

      const result = {
        surveyReport: surveyNarrative,
        id: body._id.toString(),
        name: body.name,
        type: body.type,
        position: body.position,
        physical: body.physical,
        solarEnergyFactor: parseFloat(body.solarEnergyFactor.toFixed(4)),
        resources: body.resources.map(r => ({
          type: r.resourceType,
          abundance: r.abundance,
          totalDeposit: r.totalDeposit,
          remaining: r.remaining,
          percentRemaining: r.totalDeposit > 0
            ? `${((r.remaining / r.totalDeposit) * 100).toFixed(1)}%`
            : 'N/A',
          accessible: r.accessible,
          qualitative: describeAbundance(r.resourceType, r.abundance),
        })),
        orbit: body.orbit ? {
          semiMajorAxis: body.orbit.semiMajorAxis,
          eccentricity: body.orbit.eccentricity,
          orbitalPeriod: body.orbit.orbitalPeriod,
        } : null,
        beltConfig: body.beltConfig || undefined,
        landingSites: sites.map(s => ({
          id: s._id.toString(),
          name: s.name,
          terrain: s.terrain,
          maxStructures: s.maxStructures,
          claimed: !!s.claimedBy,
          resourceAccess: s.resourceAccess,
          conditions: s.conditions,
        })),
        settlements: settlements.map(s => ({
          name: s.name,
          nation: s.nation,
          type: s.type,
          population: s.population,
          status: s.status,
          attitudeGeneral: s.attitude.general,
        })),
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_position',
    'Get your current position, orbiting body, and nearby bodies.',
    {},
    async () => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location set.' }] };
      }

      const ship = await Ship.findById(replicant.locationRef.item);
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };
      }

      let orbitingBody = null;
      if (ship.orbitingBodyId) {
        const body = await CelestialBody.findById(ship.orbitingBodyId).lean();
        if (body) {
          orbitingBody = { id: body._id.toString(), name: body.name, type: body.type };
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            shipName: ship.name,
            shipType: ship.type,
            status: ship.status,
            position: ship.position,
            orbitingBody,
            fuel: ship.fuel,
            fuelCapacity: ship.specs.fuelCapacity,
            hullPoints: ship.specs.hullPoints,
            maxHullPoints: ship.specs.maxHullPoints,
            miningState: ship.miningState || null,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'start_mining',
    'Set a ship to continuous mining mode at its current location. The ship will auto-extract resources each tick without needing repeated action submissions.',
    {
      shipId: z.string().optional().describe('Ship ID (defaults to your current ship)'),
      resourceType: z.string().optional().describe('Specific resource to mine, or omit to mine all accessible resources'),
    },
    async ({ shipId, resourceType }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location. You need to be on a ship.' }] };
      }

      const targetShipId = shipId || replicant.locationRef.item.toString();
      const ship = await Ship.findOne({ _id: targetShipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      }

      if (ship.status !== 'orbiting') {
        return { content: [{ type: 'text', text: 'Error: Ship must be orbiting a body or asteroid to mine.' }] };
      }

      if (ship.specs.miningRate <= 0) {
        return { content: [{ type: 'text', text: 'Error: Ship has no mining capability (miningRate is 0).' }] };
      }

      if (!ship.orbitingBodyId && !ship.orbitingAsteroidId) {
        return { content: [{ type: 'text', text: 'Error: Ship is not orbiting any celestial body or asteroid.' }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      ship.miningState = {
        active: true,
        targetBodyId: ship.orbitingBodyId,
        targetAsteroidId: ship.orbitingAsteroidId,
        resourceType: resourceType || null,
        startedAtTick: currentTick,
      };
      await ship.save();

      // Activate idle miner drones on this ship
      const { AMI } = await import('../../db/models/index.js');
      const activatedResult = await AMI.updateMany(
        { shipId: ship._id, ownerId: replicantId, type: 'miner', status: 'idle' },
        { status: 'active' },
      );
      const dronesActivated = activatedResult.modifiedCount ?? 0;

      const targetName = ship.orbitingBodyId ? 'celestial body' : 'asteroid';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: `Mining started on ${ship.name}. The ship will continuously mine the ${targetName} each tick.${dronesActivated > 0 ? ` ${dronesActivated} idle miner drone(s) activated.` : ''}`,
            shipId: ship._id.toString(),
            resourceType: resourceType || 'all accessible',
            startedAtTick: currentTick,
            dronesActivated,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'stop_mining',
    'Stop continuous mining on a ship.',
    {
      shipId: z.string().optional().describe('Ship ID (defaults to your current ship)'),
    },
    async ({ shipId }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location. You need to be on a ship.' }] };
      }

      const targetShipId = shipId || replicant.locationRef.item.toString();
      const ship = await Ship.findOne({ _id: targetShipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      }

      if (!ship.miningState?.active) {
        return { content: [{ type: 'text', text: 'Ship is not currently mining.' }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;
      const ticksMined = ship.miningState.startedAtTick != null
        ? currentTick - ship.miningState.startedAtTick
        : 0;

      ship.miningState = null;
      await ship.save();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: `Mining stopped on ${ship.name}.`,
            shipId: ship._id.toString(),
            ticksMined,
          }, null, 2),
        }],
      };
    },
  );
}
