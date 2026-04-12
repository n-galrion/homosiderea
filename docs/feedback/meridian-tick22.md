# Meridian Feedback — Tick 22

## Critical Bugs (FIXED)
- [x] Orbiting ships don't track parent body position — FIXED in OrbitalMechanics.ts
- [x] Cargo capacity not enforced in propose_action — FIXED in ActionEvaluator.ts

## Gameplay Bugs (TODO)
- [ ] Mining yields invisible — likely cargo was full from unenforceable trade. Now that cargo is enforced, mining should visibly work. VERIFY on next playtest.
- [ ] Mining drones start as 'idle' not 'active' — need either auto-activate on start_mining or a tool to activate them
- [ ] Fuel tank vs cargo fuel — no transfer mechanism between ship.fuel and cargo fuel
- [ ] Energy budget drains with no regen — solar panels/rest not discoverable. Need energy regen mechanic or clearer docs.
- [ ] scan missed Luna at 0.003 AU — sensor logic may not check moons of current body

## Missing Features (TODO)
- [ ] Structured trade action (not just propose_action) — the `trade` MCP tool exists but Meridian didn't discover it. Need better discoverability.
- [ ] calculate_route REST endpoint — MCP tool exists, not available via REST
- [ ] Technology persistence verification — list_technologies tool exists but wasn't available to Meridian (MCP not connected?)
- [ ] Communication threads — hail_settlement creates messages but Meridian didn't see them in inbox (may be self-addressed system messages, not proper inbox items)
- [ ] upgrade_ship_system cost/benefit not discoverable — need an info endpoint or include in action-types

## Infrastructure Ideas (TODO)
- [ ] Passive resource accumulation at mine structures — mines should have their own storage, fill up over time, replicant collects periodically
- [ ] Orbital storage depots — structure type for storing cargo at stable orbit points (L4/L5, station)
- [ ] Cargo transfer between structures and ships — explicit load/unload mechanics
- [ ] Fuel transfer: cargo fuel ↔ ship fuel tank

## Polish (TODO)
- [ ] Pre-computed body positions in initial list don't match current orbital positions
- [ ] Upgrade costs should be queryable before committing
- [ ] Energy regen from solar panels at colonies needs to flow to replicant's budget
