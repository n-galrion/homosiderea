import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Colony, LandingSite, CelestialBody, Structure, Ship, Replicant,
  ResourceStore, Tick,
} from '../../db/models/index.js';

export function registerColonyTools(server: McpServer, replicantId: string): void {

  server.tool(
    'found_colony',
    'Found a new colony at a landing site. Your ship must be orbiting the body. The site must be unclaimed. This creates a permanent settlement with shared resource storage.',
    {
      name: z.string().describe('Name for the colony'),
      siteId: z.string().describe('ID of the landing site to settle'),
      shipId: z.string().describe('ID of your ship orbiting the body'),
    },
    async ({ name, siteId, shipId }) => {
      const site = await LandingSite.findById(siteId);
      if (!site) {
        return { content: [{ type: 'text', text: 'Error: Landing site not found.' }] };
      }
      if (!site.discovered) {
        return { content: [{ type: 'text', text: 'Error: Landing site not yet discovered.' }] };
      }

      // Check if site already has a colony
      const existingColony = await Colony.findOne({ siteId: site._id });
      if (existingColony) {
        return { content: [{ type: 'text', text: `Error: This site already has a colony: "${existingColony.name}" (owned by ${existingColony.ownerId}).` }] };
      }

      // Verify ship is orbiting the right body
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      }
      if (ship.status !== 'orbiting' || ship.orbitingBodyId?.toString() !== site.bodyId.toString()) {
        const body = await CelestialBody.findById(site.bodyId);
        return { content: [{ type: 'text', text: `Error: Ship must be orbiting ${body?.name || 'the target body'}.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      // Found the colony
      const colony = await Colony.create({
        name,
        ownerId: replicantId,
        siteId: site._id,
        bodyId: site.bodyId,
        foundedAtTick: currentTick,
      });

      // Create colony resource store
      await ResourceStore.create({
        ownerRef: { kind: 'Colony', item: colony._id },
      });

      // Claim the site
      site.claimedBy = replicantId as unknown as typeof site.claimedBy;
      await site.save();

      const body = await CelestialBody.findById(site.bodyId);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            colonyId: colony._id.toString(),
            name: colony.name,
            body: body?.name,
            site: site.name,
            terrain: site.terrain,
            maxStructures: site.maxStructures,
            resourceAccess: site.resourceAccess,
            conditions: site.conditions,
            message: `Colony "${name}" founded at ${site.name} on ${body?.name || 'unknown body'}. You can now build structures here.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_colonies',
    'List all your colonies with their current stats.',
    {},
    async () => {
      const colonies = await Colony.find({ ownerId: replicantId }).lean();

      const results = [];
      for (const colony of colonies) {
        const body = await CelestialBody.findById(colony.bodyId).lean();
        const site = await LandingSite.findById(colony.siteId).lean();
        results.push({
          id: colony._id.toString(),
          name: colony.name,
          body: body?.name,
          site: site?.name,
          status: colony.status,
          stats: colony.stats,
          foundedAtTick: colony.foundedAtTick,
        });
      }

      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    'get_colony_status',
    'Get detailed status of a specific colony including power grid, structures, and inventory.',
    { colonyId: z.string().describe('Colony ID') },
    async ({ colonyId }) => {
      const colony = await Colony.findOne({ _id: colonyId, ownerId: replicantId }).lean();
      if (!colony) {
        return { content: [{ type: 'text', text: 'Error: Colony not found or not owned by you.' }] };
      }

      const body = await CelestialBody.findById(colony.bodyId).lean();
      const site = await LandingSite.findById(colony.siteId).lean();
      const structures = await Structure.find({ colonyId: colony._id }).lean();
      const store = await ResourceStore.findOne({
        'ownerRef.kind': 'Colony',
        'ownerRef.item': colony._id,
      }).lean();

      // Filter inventory to non-zero values
      const inventory: Record<string, number> = {};
      if (store) {
        const resourceFields = [
          'metals', 'ice', 'silicates', 'rareEarths', 'helium3', 'organics',
          'hydrogen', 'uranium', 'carbon', 'alloys', 'fuel', 'electronics',
          'hullPlating', 'engines', 'sensors', 'computers', 'weaponSystems',
          'lifeSupportUnits', 'solarPanels', 'fusionCores', 'energy',
        ];
        for (const f of resourceFields) {
          const val = (store as Record<string, unknown>)[f] as number;
          if (val > 0) inventory[f] = val;
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            colony: {
              id: colony._id.toString(),
              name: colony.name,
              status: colony.status,
              foundedAtTick: colony.foundedAtTick,
            },
            location: {
              body: body?.name,
              site: site?.name,
              terrain: site?.terrain,
              maxStructures: site?.maxStructures,
              conditions: site?.conditions,
            },
            stats: colony.stats,
            structures: structures.map(s => ({
              id: s._id.toString(),
              name: s.name,
              type: s.type,
              status: s.status,
              construction: s.status === 'building' ? s.construction : undefined,
            })),
            inventory,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_landing_sites',
    'List discovered landing sites on a celestial body.',
    { bodyId: z.string().describe('Celestial body ID') },
    async ({ bodyId }) => {
      const sites = await LandingSite.find({ bodyId, discovered: true }).lean();
      const body = await CelestialBody.findById(bodyId).lean();

      const results = [];
      for (const site of sites) {
        const existingColony = await Colony.findOne({ siteId: site._id }).lean();
        results.push({
          id: site._id.toString(),
          name: site.name,
          terrain: site.terrain,
          maxStructures: site.maxStructures,
          resourceAccess: site.resourceAccess,
          conditions: site.conditions,
          claimed: !!site.claimedBy,
          claimedByYou: site.claimedBy?.toString() === replicantId,
          colony: existingColony ? { name: existingColony.name, owner: existingColony.ownerId.toString() } : null,
        });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            body: body?.name,
            sites: results,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'prospect_asteroid',
    'Get detailed resource survey of a discovered asteroid.',
    { asteroidId: z.string().describe('Asteroid ID') },
    async ({ asteroidId }) => {
      const { Asteroid } = await import('../../db/models/index.js');
      const asteroid = await Asteroid.findById(asteroidId).lean();
      if (!asteroid) {
        return { content: [{ type: 'text', text: 'Error: Asteroid not found.' }] };
      }
      if (!asteroid.discovered) {
        return { content: [{ type: 'text', text: 'Error: Asteroid not yet discovered. Scan the area first.' }] };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: asteroid._id.toString(),
            name: asteroid.name,
            composition: asteroid.physical.composition,
            radius: `${asteroid.physical.radius} km`,
            depleted: asteroid.depleted,
            resources: asteroid.resources.map(r => ({
              type: r.resourceType,
              abundance: r.abundance,
              remaining: r.remaining,
              totalDeposit: r.totalDeposit,
              percentRemaining: r.totalDeposit > 0
                ? `${((r.remaining / r.totalDeposit) * 100).toFixed(1)}%`
                : '0%',
              accessible: r.accessible,
            })),
            position: asteroid.position,
            solarEnergyFactor: asteroid.solarEnergyFactor,
          }, null, 2),
        }],
      };
    },
  );
}
