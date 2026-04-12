import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Salvage, Ship, ResourceStore, Replicant, Tick } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';

export function registerSalvageTools(server: McpServer, replicantId: string): void {

  server.tool(
    'scan_salvage',
    'Scan for salvage, wreckage, black boxes, and tech fragments near your position. Destroyed ships leave behind valuable debris.',
    {
      range: z.number().optional().describe('Scan range in AU (defaults to ship sensor range)'),
    },
    async ({ range }) => {
      const rep = await Replicant.findById(replicantId);
      if (!rep?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No active ship.' }] };
      }

      const ship = await Ship.findById(rep.locationRef.item);
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      const scanRange = range || ship.specs.sensorRange;
      const myPos = ship.position;

      const allSalvage = await Salvage.find({ collected: false }).lean();
      const inRange = allSalvage
        .map(s => ({ ...s, dist: distance(myPos, s.position) }))
        .filter(s => s.dist <= scanRange)
        .sort((a, b) => a.dist - b.dist);

      // Mark as discovered
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;
      for (const s of inRange) {
        if (!s.discovered) {
          await Salvage.findByIdAndUpdate(s._id, {
            discovered: true,
            discoveredBy: replicantId,
          });
        }
      }

      const results = inRange.map(s => ({
        id: s._id.toString(),
        name: s.name,
        type: s.type,
        distance: parseFloat(s.dist.toFixed(6)),
        source: s.sourceShipName,
        sourceType: s.sourceOwnerType,
        hasResources: Object.keys(s.resources || {}).length > 0,
        hasData: !!s.dataContent,
        hasTechFragment: !!s.techFragment,
        expired: s.expiresAtTick ? currentTick > s.expiresAtTick : false,
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            salvageCount: results.length,
            salvage: results,
            narrative: results.length > 0
              ? `Sensors detect ${results.length} salvage signature${results.length > 1 ? 's' : ''} within ${scanRange} AU. ${results.filter(r => r.type === 'black_box').length > 0 ? 'Black box transponder detected — flight recorder data may be recoverable.' : ''} ${results.filter(r => r.hasTechFragment).length > 0 ? 'Anomalous material signatures suggest advanced technology fragments among the debris.' : ''}`
              : 'No salvage detected within sensor range. Space is clean here.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'collect_salvage',
    'Collect a piece of salvage. Must be within 0.01 AU. Resources go to your cargo, data goes to your memories.',
    {
      salvageId: z.string().describe('Salvage ID to collect'),
      shipId: z.string().describe('Ship to collect with'),
    },
    async ({ salvageId, shipId }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      const salvage = await Salvage.findById(salvageId);
      if (!salvage) return { content: [{ type: 'text', text: 'Error: Salvage not found.' }] };
      if (salvage.collected) return { content: [{ type: 'text', text: 'Already collected by someone else.' }] };

      const dist = distance(ship.position, salvage.position);
      if (dist > 0.01) {
        return { content: [{ type: 'text', text: `Too far — ${dist.toFixed(4)} AU away. Need to be within 0.01 AU.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      // Check expiry
      if (salvage.expiresAtTick && currentTick > salvage.expiresAtTick) {
        salvage.collected = true;
        await salvage.save();
        return { content: [{ type: 'text', text: 'Salvage has degraded beyond recovery. The debris field has dispersed.' }] };
      }

      // Transfer resources to ship cargo
      const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      const resourcesCollected: Record<string, number> = {};
      if (store && salvage.resources) {
        const storeAny = store as unknown as Record<string, number>;
        for (const [resource, amount] of Object.entries(salvage.resources as Record<string, number>)) {
          if (amount > 0 && resource in storeAny) {
            storeAny[resource] += amount;
            resourcesCollected[resource] = amount;
          }
        }
        await store.save();
      }

      // Store data content as memories
      const dataRecovered: string[] = [];
      if (salvage.dataContent) {
        const { MemoryLog } = await import('../../db/models/index.js');

        if (salvage.dataContent.flightLog) {
          await MemoryLog.create({
            replicantId, category: 'observation',
            title: `Flight Log — ${salvage.sourceShipName}`,
            content: salvage.dataContent.flightLog,
            tags: ['salvage', 'flight_log', salvage.sourceShipName],
            tick: currentTick,
          });
          dataRecovered.push('flight log');
        }

        if (salvage.dataContent.lastTransmission) {
          await MemoryLog.create({
            replicantId, category: 'observation',
            title: `Last Transmission — ${salvage.sourceShipName}`,
            content: salvage.dataContent.lastTransmission,
            tags: ['salvage', 'transmission', salvage.sourceShipName],
            tick: currentTick,
          });
          dataRecovered.push('last transmission');
        }

        if (salvage.dataContent.encryptedData) {
          await MemoryLog.create({
            replicantId, category: 'observation',
            title: `Encrypted Data — ${salvage.sourceShipName}`,
            content: salvage.dataContent.encryptedData,
            tags: ['salvage', 'encrypted', salvage.sourceShipName],
            tick: currentTick,
          });
          dataRecovered.push('encrypted data block');
        }

        for (const hint of salvage.dataContent.techHints) {
          await MemoryLog.create({
            replicantId, category: 'observation',
            title: `Tech Analysis — ${salvage.sourceShipName}`,
            content: hint,
            tags: ['salvage', 'tech_hint', salvage.sourceShipName],
            tick: currentTick,
          });
          dataRecovered.push('tech analysis');
        }

        if (salvage.dataContent.sensorReadings) {
          await MemoryLog.create({
            replicantId, category: 'observation',
            title: `Sensor Data — ${salvage.sourceShipName}`,
            content: salvage.dataContent.sensorReadings,
            tags: ['salvage', 'sensor_data', salvage.sourceShipName],
            tick: currentTick,
          });
          dataRecovered.push('sensor readings');
        }
      }

      // Tech fragment bonus
      let techBonus = '';
      if (salvage.techFragment?.domain) {
        const rep = await Replicant.findById(replicantId);
        if (rep) {
          // Store the hint and give compute bonus
          const { MemoryLog: ML } = await import('../../db/models/index.js');
          await ML.create({
            replicantId, category: 'observation',
            title: `Tech Fragment: ${salvage.techFragment.domain}`,
            content: `${salvage.techFragment.description}\n\n[This fragment grants +${salvage.techFragment.researchBonus} compute cycles toward ${salvage.techFragment.domain} research]`,
            tags: ['salvage', 'tech_fragment', salvage.techFragment.domain],
            tick: currentTick,
          });
          rep.computeCycles += salvage.techFragment.researchBonus;
          await rep.save();
          techBonus = ` Tech fragment recovered: +${salvage.techFragment.researchBonus} compute cycles for ${salvage.techFragment.domain} research.`;
        }
      }

      // Mark collected
      salvage.collected = true;
      salvage.collectedBy = replicantId as unknown as typeof salvage.collectedBy;
      salvage.collectedAtTick = currentTick;
      await salvage.save();

      const resourceDesc = Object.entries(resourcesCollected)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            collected: true,
            salvageName: salvage.name,
            type: salvage.type,
            resources: resourcesCollected,
            dataRecovered,
            techBonus: techBonus || undefined,
            narrative: `Salvage recovery complete. ${resourceDesc ? `Cargo hold enriched with ${resourceDesc}.` : ''} ${dataRecovered.length > 0 ? `Data recovered: ${dataRecovered.join(', ')}.` : ''} ${techBonus}`.trim(),
          }, null, 2),
        }],
      };
    },
  );
}
