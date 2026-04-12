# Meridian Feedback — Tick 22

## Critical Bugs (FIXED)
- [x] Orbiting ships don't track parent body position — FIXED in OrbitalMechanics.ts
- [x] Cargo capacity not enforced in propose_action — FIXED in ActionEvaluator.ts

## Gameplay Bugs (FIXED)
- [x] Mining yields invisible — Resolved: cargo enforcement + working mining pipeline
- [x] Mining drones start as 'idle' not 'active' — FIXED: start_mining now auto-activates idle miner AMIs on the ship
- [x] Fuel tank vs cargo fuel — FIXED: `transfer_fuel` tool in cargo.tools.ts transfers between cargo fuel and ship tank
- [x] Energy budget drains with no regen — FIXED: replicants now regen 1 energy/tick base + bonus from owned solar arrays, capped at 200
- [x] scan missed Luna at 0.003 AU — FIXED: scan now always includes moons of the body you're orbiting (and the parent body if orbiting a moon), regardless of position calculations

## Missing Features (FIXED)
- [x] Structured trade action (not just propose_action) — `trade` MCP tool exists and is registered. Added to sitrep tool list for discoverability.
- [x] calculate_route REST endpoint — FIXED: added GET /api/ships/:id/route/:bodyId with distance, travel time, fuel cost, game/real time estimates
- [x] Technology persistence verification — `list_technologies` tool exists in research.tools.ts and is registered. Lists all researched tech by domain.
- [x] Communication threads — FIXED: hail_settlement/hail_ship messages now use settlement/NPC ship owner as senderId (not self-addressed), enabling proper inbox filtering and conversation tracking
- [x] upgrade_ship_system cost/benefit not discoverable — FIXED: added GET /api/ships/:id/upgrades returning all system upgrade costs and effects

## Infrastructure Ideas (FIXED)
- [x] Passive resource accumulation at mine structures — WORKS: mines continuously extract each tick via ResourceProduction.executeMining(). Storage cap: 200 per standalone mine, 10,000 for colony-linked mines.
- [x] Orbital storage depots — FIXED: `cargo_depot` structure type exists (2000 storage capacity). Blueprint, schema, and TypeScript interface all aligned.
- [x] Cargo transfer between structures and ships — FIXED: `load_cargo` and `unload_cargo` MCP tools in cargo.tools.ts
- [x] Fuel transfer: cargo fuel ↔ ship fuel tank — FIXED: `transfer_fuel` MCP tool in cargo.tools.ts

## Polish (FIXED)
- [x] Pre-computed body positions in initial list don't match current orbital positions — RESOLVED: OrbitalMechanics.updateAllPositions() runs each tick and updates all body positions in the database. list_celestial_bodies returns live positions.
- [x] Upgrade costs should be queryable before committing — FIXED: GET /api/ships/:id/upgrades endpoint
- [x] Energy regen from solar panels at colonies needs to flow to replicant's budget — FIXED: regenReplicantEnergy in ResourceProduction.ts

## Status: ALL ITEMS RESOLVED ✓
