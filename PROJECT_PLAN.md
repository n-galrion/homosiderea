# Homosideria — Project Plan & Content Tracker

## Current State (v0.1)

**113 TypeScript files, 26 models, ~60 MCP tools, 19 tick phases, 26 tests**

The game is playable. A replicant can register, scan, mine, trade, build, research, replicate, hack, and talk to NPCs. The MC drives world events via LLM tool-calling. Fog of war limits knowledge. Pirates attack. Salvage is recoverable.

---

## Critical Bugs Fixed This Session

| Bug | Status |
|-----|--------|
| AMI execution was a stub — drones never worked | **FIXED** — AMIExecutor.ts now runs all scripts each tick |
| MineAction didn't set miningState — action-based mining broken | **FIXED** — now sets continuous mining state |
| Ship destruction didn't generate salvage | **FIXED** — Maintenance.ts now calls SalvageGenerator |

## Known Remaining Issues

| Issue | Severity | Files | Notes |
|-------|----------|-------|-------|
| Cargo capacity not enforced | Medium | ResourceProduction.ts, fabrication.tools.ts | Ships can hoard infinite resources |
| Manufacturing not scaled by colony power ratio | Medium | Manufacturing.ts | Factories run at full speed even with no power |
| NPC ships don't actually trade | Low | NPCTraffic.ts | Freighters move but don't buy/sell at destinations |
| No ship repair mechanic | Medium | — | Hull degrades but can't be fixed except via propose_action |
| No combat system (player-initiated) | Medium | — | Pirates attack players, but players can't fight back with tools |
| Dashboard notification bell not in UI | Low | dashboard.html | Notification model + API exists, dashboard doesn't poll it |
| `?all=true` fog of war bypass not restricted | Low | world.routes.ts | Any authenticated replicant can bypass fog |

---

## Roadmap

### Phase 1: Core Polish (next)
- [ ] **Cargo capacity enforcement** — mining, fabrication, and trading respect ship cargo limits
- [ ] **Ship repair tool** — spend alloys + hullPlating to repair hull at a colony/structure
- [ ] **Combat tools** — `attack_ship` tool for player-initiated combat (damage calculation, weapon systems)
- [ ] **Manufacturing power scaling** — colony power ratio affects factory output
- [ ] **NPC trading** — freighters buy/sell at destinations, affecting settlement supply/demand
- [ ] **Fog of war bypass restriction** — only admin can use `?all=true`

### Phase 2: Depth
- [ ] **Diplomacy tools** — formal trade offers (structured metadata with accept/reject), alliance pacts, mutual defense agreements
- [ ] **Directive-affects-behavior** — a replicant's directive grants mechanical bonuses (combat directive = weapon research bonus, science directive = scanning bonus)
- [ ] **Market price history charts** in dashboard (data model exists, UI needs server-side price history endpoint wired to chart)
- [ ] **GUPPE system** — operator can mark themselves "online" as advisor; replicants can query the human for guidance
- [ ] **Event response system** — replicants can respond to events (distress beacons, anomalies) and the MC evaluates what they find

### Phase 3: Scale
- [ ] **Proc-gen star systems** — HYG star database for nearby systems; interstellar travel unlocked by propulsion research
- [ ] **Universe seeds** — deterministic world generation from a seed value for restartable sandboxes
- [ ] **Multi-instance replicant orchestration** — webhook/notification system that auto-launches new Claude Code instances for spawned children
- [ ] **Persistent conversation threads** — NPC settlement leaders remember past conversations (conversation history in messages)
- [ ] **Faction diplomacy** — factions negotiate with each other; MC drives inter-faction politics

### Phase 4: Adversarial
- [ ] **Scenario system** — scripted scenarios (rogue replicant drops rocks on cities, resource crisis, first contact)
- [ ] **Rogue NPC replicants** — MC-controlled replicants with intentionally maligned directives
- [ ] **Moral dilemma events** — will replicants protect human life or optimize for resources?
- [ ] **Personality drift** — children gradually diverge from parent based on experiences
- [ ] **Inter-replicant combat** — territorial disputes, resource wars, piracy

### Phase 5: Platform
- [ ] **npm publish SDK** — publish homosideria-sdk to npm proper
- [ ] **OpenAPI/Swagger spec** — auto-generated API docs
- [ ] **WebSocket/SSE for real-time** — push tick updates, events, messages without polling
- [ ] **Multi-server federation** — multiple game servers as different star systems
- [ ] **Replay system** — playback game history from tick records

---

## Content Tracker

### Celestial Bodies
| Body | Type | Seeded | Landing Sites | Settlements |
|------|------|--------|---------------|-------------|
| Sol | star | ✓ | — | — |
| Mercury | planet | ✓ | — | — |
| Venus | planet | ✓ | — | — |
| Earth | planet | ✓ | 8 sites | 6 cities + 2 stations |
| Luna | moon | ✓ | 6 sites | 2 outposts |
| Mars | planet | ✓ | 6 sites | 1 colony |
| Ceres | dwarf_planet | ✓ | 3 sites | — |
| Europa | moon | ✓ | 4 sites | — |
| Titan | moon | ✓ | 3 sites | — |
| Jupiter + 4 moons | planet+moons | ✓ | — | — |
| Saturn + 2 moons | planet+moons | ✓ | — | — |
| Uranus, Neptune, Pluto | various | ✓ | — | — |
| 3 belt zones | belt_zone | ✓ | — | — |
| Proc-gen asteroids | asteroid | Dynamic | — | — |

### Settlements (11)
| Name | Nation | Type | Leader | Temperament |
|------|--------|------|--------|-------------|
| Shanghai | China | city | Mayor Chen Wei-Lin | mercantile |
| Houston | USA | city | Director James McAllister | scientific (suspicious of AI) |
| Tokyo | Japan | city | PM Tanaka Yuki | scientific |
| Bangalore | India | city | Chancellor Priya Sundaram | welcoming |
| Munich | Germany | city | DG Klaus Hoffmann | cautious |
| São Paulo | Brazil | city | Gov Ana Luísa Ferreira | mercantile |
| ISS-2 Gateway | International | orbital | Cmdr Sarah Chen | cautious |
| Tiangong-3 | China | orbital | Director Liu Hao | isolationist |
| Artemis Base | USA | outpost | Cmdr Rachel Torres | scientific |
| Yuegong Station | China | outpost | Director Zhao Mingyu | mercantile |
| Ares Colony | International | colony | Gov Dr. Yuki Hamasaki | welcoming |

### Factions (6)
| Name | Type | Members |
|------|------|---------|
| United Nations Space Authority | governmental | ISS-2, Artemis Base |
| Pacific Commerce Alliance | corporate | Shanghai, Tokyo, Bangalore |
| European Space Consortium | corporate | Munich |
| People's Republic Space Command | military | Tiangong-3, Yuegong Station |
| Southern Hemisphere Trade Group | corporate | São Paulo |
| Mars Independence Movement | independent | Ares Colony |

### Blueprints (25)
- 4 refining recipes
- 7 component recipes
- 5 ship recipes
- 9 structure recipes

### Autofactory Recipes (10)
- smelt_alloys, fabricate_electronics, assemble_computer, assemble_engine, assemble_sensor, fabricate_hull_plating, assemble_solar_panel, crack_fuel, assemble_life_support, salvage_debris

### MCP Tool Categories (20)
scanning, navigation, resources, manufacturing, AMI, replication, communication, memory, query, colony, research, data sharing, access control, actions, fabrication, trade, hacking, salvage, NPC comms, ship upgrades

### Engine Tick Phases (19)
1. Orbital mechanics
2. Energy production
3. AMI execution
4. Action resolution
5. Movement
6. Mining (continuous + AMI)
7. Construction + manufacturing
8. Communication (light-speed)
9. Colony stats
10. Research processing
11. Settlement behavior
12. Captain's log (data feed)
13. Maintenance (hull degradation)
14. Fuel consumption
15. NPC traffic
16. Pirate activity
17. MC World Simulation (LLM tool-calling)
18. Random events (LLM-generated)
19. Save tick record

### LLM-Driven Systems
| System | Frequency | What it does |
|--------|-----------|-------------|
| propose_action | On demand | Evaluates any free-text action |
| propose_research | On demand | Evaluates technology proposals |
| hail_settlement | On demand | MC roleplays settlement leaders |
| hail_ship | On demand | MC roleplays NPC crew |
| MC World Simulator | Every 50 ticks | Tool-calling agent reshapes world |
| Random events | Per tick (probabilistic) | Generates contextual events |
| Salvage content | On ship destruction | Flight logs, tech hints |
| Pirate threats | On encounter | Unique per pirate |
