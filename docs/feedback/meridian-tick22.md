# Meridian Feedback — Tick 22

## Critical Bugs (FIXED)
- [x] Orbiting ships don't track parent body position — FIXED in OrbitalMechanics.ts
- [x] Cargo capacity not enforced in propose_action — FIXED in ActionEvaluator.ts

## Gameplay Bugs (TODO)
- [ ] Mining yields invisible — likely cargo was full from unenforceable trade. Now that cargo is enforced, mining should visibly work. VERIFY on next playtest.
- [x] Mining drones start as 'idle' not 'active' — FIXED: start_mining now auto-activates idle miner AMIs on the ship
- [ ] Fuel tank vs cargo fuel — no transfer mechanism between ship.fuel and cargo fuel
- [x] Energy budget drains with no regen — FIXED: replicants now regen 1 energy/tick base + bonus from owned solar arrays, capped at 200
- [ ] scan missed Luna at 0.003 AU — sensor logic may not check moons of current body

## Missing Features (TODO)
- [ ] Structured trade action (not just propose_action) — the `trade` MCP tool exists but Meridian didn't discover it. Need better discoverability.
- [x] calculate_route REST endpoint — FIXED: added GET /api/ships/:id/route/:bodyId with distance, travel time, fuel cost, game/real time estimates
- [ ] Technology persistence verification — list_technologies tool exists but wasn't available to Meridian (MCP not connected?)
- [ ] Communication threads — hail_settlement creates messages but Meridian didn't see them in inbox (may be self-addressed system messages, not proper inbox items)
- [x] upgrade_ship_system cost/benefit not discoverable — FIXED: added GET /api/ships/:id/upgrades returning all system upgrade costs and effects

## Infrastructure Ideas (TODO)
- [ ] Passive resource accumulation at mine structures — mines should have their own storage, fill up over time, replicant collects periodically
- [ ] Orbital storage depots — structure type for storing cargo at stable orbit points (L4/L5, station)
- [ ] Cargo transfer between structures and ships — explicit load/unload mechanics
- [ ] Fuel transfer: cargo fuel ↔ ship fuel tank

## Polish (TODO)
- [ ] Pre-computed body positions in initial list don't match current orbital positions
- [x] Upgrade costs should be queryable before committing — FIXED: GET /api/ships/:id/upgrades endpoint
- [x] Energy regen from solar panels at colonies needs to flow to replicant's budget — FIXED: regenReplicantEnergy in ResourceProduction.ts
