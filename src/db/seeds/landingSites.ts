import { CelestialBody, LandingSite } from '../models/index.js';

interface LandingSiteSeed {
  bodyName: string;
  name: string;
  terrain: 'plains' | 'crater' | 'mountain' | 'polar' | 'volcanic' | 'oceanic' | 'underground';
  surfacePosition: { lat: number; lon: number };
  maxStructures: number;
  resourceAccess: Array<{ resourceType: string; modifier: number }>;
  conditions: { temperature: number; radiation: number; stability: number };
}

const sites: LandingSiteSeed[] = [
  // ── Earth (~8 sites) ──────────────────────────────────────────────
  {
    bodyName: 'Earth',
    name: 'Cape Canaveral Launch Complex',
    terrain: 'plains',
    surfacePosition: { lat: 28.396, lon: -80.605 },
    maxStructures: 15,
    resourceAccess: [
      { resourceType: 'metals', modifier: 0.8 },
      { resourceType: 'silicates', modifier: 0.9 },
      { resourceType: 'organics', modifier: 1.0 },
    ],
    conditions: { temperature: 297, radiation: 2, stability: 0.9 },
  },
  {
    bodyName: 'Earth',
    name: 'Sahara Solar Fields',
    terrain: 'plains',
    surfacePosition: { lat: 24.0, lon: 8.0 },
    maxStructures: 12,
    resourceAccess: [
      { resourceType: 'silicates', modifier: 1.5 },
      { resourceType: 'metals', modifier: 0.7 },
      { resourceType: 'ice', modifier: 0.3 },
    ],
    conditions: { temperature: 320, radiation: 3, stability: 0.85 },
  },
  {
    bodyName: 'Earth',
    name: 'Antarctic Research Station',
    terrain: 'polar',
    surfacePosition: { lat: -82.0, lon: 45.0 },
    maxStructures: 8,
    resourceAccess: [
      { resourceType: 'ice', modifier: 2.0 },
      { resourceType: 'metals', modifier: 0.5 },
      { resourceType: 'organics', modifier: 0.6 },
    ],
    conditions: { temperature: 220, radiation: 1, stability: 0.8 },
  },
  {
    bodyName: 'Earth',
    name: 'Mariana Deep Mining',
    terrain: 'underground',
    surfacePosition: { lat: 11.35, lon: 142.2 },
    maxStructures: 6,
    resourceAccess: [
      { resourceType: 'metals', modifier: 1.8 },
      { resourceType: 'rareEarths', modifier: 1.5 },
      { resourceType: 'silicates', modifier: 1.2 },
    ],
    conditions: { temperature: 275, radiation: 0.5, stability: 0.6 },
  },
  {
    bodyName: 'Earth',
    name: 'Atacama Highlands',
    terrain: 'mountain',
    surfacePosition: { lat: -23.5, lon: -68.0 },
    maxStructures: 10,
    resourceAccess: [
      { resourceType: 'metals', modifier: 1.2 },
      { resourceType: 'silicates', modifier: 1.3 },
      { resourceType: 'rareEarths', modifier: 1.0 },
    ],
    conditions: { temperature: 285, radiation: 2, stability: 0.88 },
  },
  {
    bodyName: 'Earth',
    name: 'Gobi Steppe Industrial Zone',
    terrain: 'plains',
    surfacePosition: { lat: 43.5, lon: 105.0 },
    maxStructures: 14,
    resourceAccess: [
      { resourceType: 'metals', modifier: 1.0 },
      { resourceType: 'silicates', modifier: 1.0 },
      { resourceType: 'carbon', modifier: 1.0 },
      { resourceType: 'rareEarths', modifier: 0.9 },
    ],
    conditions: { temperature: 275, radiation: 2, stability: 0.85 },
  },
  {
    bodyName: 'Earth',
    name: 'Svalbard Polar Station',
    terrain: 'polar',
    surfacePosition: { lat: 78.2, lon: 15.6 },
    maxStructures: 7,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.8 },
      { resourceType: 'metals', modifier: 0.6 },
      { resourceType: 'organics', modifier: 0.5 },
    ],
    conditions: { temperature: 245, radiation: 1.5, stability: 0.78 },
  },
  {
    bodyName: 'Earth',
    name: 'Singapore Orbital Port',
    terrain: 'plains',
    surfacePosition: { lat: 1.35, lon: 103.82 },
    maxStructures: 20,
    resourceAccess: [
      { resourceType: 'metals', modifier: 0.7 },
      { resourceType: 'organics', modifier: 1.2 },
      { resourceType: 'silicates', modifier: 0.8 },
    ],
    conditions: { temperature: 302, radiation: 2, stability: 0.92 },
  },

  // ── Luna (~6 sites) ──────────────────────────────────────────────
  {
    bodyName: 'Luna',
    name: 'Shackleton Crater',
    terrain: 'polar',
    surfacePosition: { lat: -89.9, lon: 0.0 },
    maxStructures: 10,
    resourceAccess: [
      { resourceType: 'ice', modifier: 2.0 },
      { resourceType: 'silicates', modifier: 1.0 },
      { resourceType: 'helium3', modifier: 0.8 },
    ],
    conditions: { temperature: 90, radiation: 3, stability: 0.85 },
  },
  {
    bodyName: 'Luna',
    name: 'Mare Tranquillitatis',
    terrain: 'plains',
    surfacePosition: { lat: 8.5, lon: 31.4 },
    maxStructures: 12,
    resourceAccess: [
      { resourceType: 'silicates', modifier: 1.2 },
      { resourceType: 'metals', modifier: 1.0 },
      { resourceType: 'helium3', modifier: 1.0 },
    ],
    conditions: { temperature: 220, radiation: 4, stability: 0.9 },
  },
  {
    bodyName: 'Luna',
    name: 'Tycho Crater Rim',
    terrain: 'crater',
    surfacePosition: { lat: -43.3, lon: -11.2 },
    maxStructures: 8,
    resourceAccess: [
      { resourceType: 'metals', modifier: 1.5 },
      { resourceType: 'silicates', modifier: 1.2 },
      { resourceType: 'rareEarths', modifier: 1.0 },
    ],
    conditions: { temperature: 200, radiation: 4, stability: 0.82 },
  },
  {
    bodyName: 'Luna',
    name: 'Copernicus Basin',
    terrain: 'crater',
    surfacePosition: { lat: 9.62, lon: -20.08 },
    maxStructures: 10,
    resourceAccess: [
      { resourceType: 'helium3', modifier: 1.5 },
      { resourceType: 'metals', modifier: 1.3 },
      { resourceType: 'silicates', modifier: 1.0 },
    ],
    conditions: { temperature: 210, radiation: 4, stability: 0.84 },
  },
  {
    bodyName: 'Luna',
    name: 'South Pole-Aitken Basin',
    terrain: 'crater',
    surfacePosition: { lat: -53.0, lon: 169.0 },
    maxStructures: 8,
    resourceAccess: [
      { resourceType: 'metals', modifier: 1.8 },
      { resourceType: 'rareEarths', modifier: 1.3 },
      { resourceType: 'silicates', modifier: 1.1 },
    ],
    conditions: { temperature: 150, radiation: 3.5, stability: 0.8 },
  },
  {
    bodyName: 'Luna',
    name: 'Aristarchus Plateau',
    terrain: 'mountain',
    surfacePosition: { lat: 23.7, lon: -47.4 },
    maxStructures: 7,
    resourceAccess: [
      { resourceType: 'rareEarths', modifier: 1.6 },
      { resourceType: 'silicates', modifier: 1.3 },
      { resourceType: 'metals', modifier: 1.1 },
    ],
    conditions: { temperature: 230, radiation: 4.5, stability: 0.75 },
  },

  // ── Mars (~6 sites) ──────────────────────────────────────────────
  {
    bodyName: 'Mars',
    name: 'Olympus Mons Base',
    terrain: 'mountain',
    surfacePosition: { lat: 18.65, lon: -133.8 },
    maxStructures: 8,
    resourceAccess: [
      { resourceType: 'silicates', modifier: 1.3 },
      { resourceType: 'metals', modifier: 1.0 },
      { resourceType: 'ice', modifier: 0.5 },
    ],
    conditions: { temperature: 190, radiation: 5, stability: 0.78 },
  },
  {
    bodyName: 'Mars',
    name: 'Valles Marineris Station',
    terrain: 'underground',
    surfacePosition: { lat: -14.0, lon: -59.2 },
    maxStructures: 12,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.5 },
      { resourceType: 'silicates', modifier: 1.2 },
      { resourceType: 'metals', modifier: 1.1 },
    ],
    conditions: { temperature: 210, radiation: 2, stability: 0.88 },
  },
  {
    bodyName: 'Mars',
    name: 'Utopia Planitia',
    terrain: 'plains',
    surfacePosition: { lat: 46.7, lon: 110.0 },
    maxStructures: 16,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.3 },
      { resourceType: 'silicates', modifier: 1.0 },
      { resourceType: 'metals', modifier: 0.9 },
    ],
    conditions: { temperature: 200, radiation: 4, stability: 0.92 },
  },
  {
    bodyName: 'Mars',
    name: 'Jezero Crater',
    terrain: 'crater',
    surfacePosition: { lat: 18.38, lon: 77.58 },
    maxStructures: 10,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.6 },
      { resourceType: 'organics', modifier: 1.2 },
      { resourceType: 'silicates', modifier: 1.0 },
    ],
    conditions: { temperature: 208, radiation: 4, stability: 0.85 },
  },
  {
    bodyName: 'Mars',
    name: 'Hellas Basin',
    terrain: 'crater',
    surfacePosition: { lat: -42.7, lon: 70.0 },
    maxStructures: 10,
    resourceAccess: [
      { resourceType: 'carbon', modifier: 1.5 },
      { resourceType: 'silicates', modifier: 1.1 },
      { resourceType: 'metals', modifier: 0.9 },
    ],
    conditions: { temperature: 215, radiation: 3.5, stability: 0.82 },
  },
  {
    bodyName: 'Mars',
    name: 'Elysium Fields',
    terrain: 'plains',
    surfacePosition: { lat: 24.8, lon: 146.9 },
    maxStructures: 12,
    resourceAccess: [
      { resourceType: 'silicates', modifier: 1.2 },
      { resourceType: 'metals', modifier: 1.0 },
      { resourceType: 'carbon', modifier: 0.8 },
    ],
    conditions: { temperature: 198, radiation: 4, stability: 0.86 },
  },

  // ── Europa (~4 sites) ────────────────────────────────────────────
  {
    bodyName: 'Europa',
    name: 'Conamara Chaos',
    terrain: 'plains',
    surfacePosition: { lat: -9.0, lon: -274.0 },
    maxStructures: 8,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.8 },
      { resourceType: 'organics', modifier: 1.4 },
      { resourceType: 'silicates', modifier: 0.7 },
    ],
    conditions: { temperature: 100, radiation: 6, stability: 0.65 },
  },
  {
    bodyName: 'Europa',
    name: 'Thera Macula',
    terrain: 'volcanic',
    surfacePosition: { lat: -47.0, lon: -181.0 },
    maxStructures: 6,
    resourceAccess: [
      { resourceType: 'ice', modifier: 2.0 },
      { resourceType: 'organics', modifier: 1.5 },
      { resourceType: 'metals', modifier: 0.8 },
    ],
    conditions: { temperature: 110, radiation: 6.5, stability: 0.55 },
  },
  {
    bodyName: 'Europa',
    name: 'Pwyll Crater',
    terrain: 'crater',
    surfacePosition: { lat: -25.3, lon: -271.4 },
    maxStructures: 7,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.9 },
      { resourceType: 'silicates', modifier: 1.0 },
      { resourceType: 'metals', modifier: 0.6 },
    ],
    conditions: { temperature: 95, radiation: 6, stability: 0.7 },
  },
  {
    bodyName: 'Europa',
    name: 'Equatorial Ridge Station',
    terrain: 'mountain',
    surfacePosition: { lat: 0.5, lon: -220.0 },
    maxStructures: 8,
    resourceAccess: [
      { resourceType: 'metals', modifier: 1.3 },
      { resourceType: 'ice', modifier: 1.2 },
      { resourceType: 'silicates', modifier: 1.0 },
    ],
    conditions: { temperature: 102, radiation: 5.5, stability: 0.75 },
  },

  // ── Titan (~3 sites) ─────────────────────────────────────────────
  {
    bodyName: 'Titan',
    name: 'Kraken Mare Shore',
    terrain: 'oceanic',
    surfacePosition: { lat: 68.0, lon: -70.0 },
    maxStructures: 10,
    resourceAccess: [
      { resourceType: 'organics', modifier: 2.0 },
      { resourceType: 'hydrogen', modifier: 1.5 },
      { resourceType: 'carbon', modifier: 1.3 },
    ],
    conditions: { temperature: 94, radiation: 0.5, stability: 0.7 },
  },
  {
    bodyName: 'Titan',
    name: 'Xanadu Highlands',
    terrain: 'mountain',
    surfacePosition: { lat: -10.0, lon: 100.0 },
    maxStructures: 8,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.4 },
      { resourceType: 'organics', modifier: 1.3 },
      { resourceType: 'carbon', modifier: 1.0 },
    ],
    conditions: { temperature: 92, radiation: 0.5, stability: 0.8 },
  },
  {
    bodyName: 'Titan',
    name: 'Shangri-La Dunes',
    terrain: 'plains',
    surfacePosition: { lat: -5.0, lon: 160.0 },
    maxStructures: 12,
    resourceAccess: [
      { resourceType: 'organics', modifier: 1.6 },
      { resourceType: 'carbon', modifier: 1.5 },
      { resourceType: 'ice', modifier: 0.8 },
    ],
    conditions: { temperature: 94, radiation: 0.5, stability: 0.85 },
  },

  // ── Ceres (~3 sites) ─────────────────────────────────────────────
  {
    bodyName: 'Ceres',
    name: 'Occator Crater',
    terrain: 'crater',
    surfacePosition: { lat: 19.82, lon: 239.33 },
    maxStructures: 8,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.8 },
      { resourceType: 'organics', modifier: 1.3 },
      { resourceType: 'silicates', modifier: 1.0 },
    ],
    conditions: { temperature: 150, radiation: 3, stability: 0.82 },
  },
  {
    bodyName: 'Ceres',
    name: 'Hanami Planum',
    terrain: 'plains',
    surfacePosition: { lat: 0.0, lon: 120.0 },
    maxStructures: 10,
    resourceAccess: [
      { resourceType: 'silicates', modifier: 1.5 },
      { resourceType: 'metals', modifier: 1.0 },
      { resourceType: 'carbon', modifier: 0.9 },
    ],
    conditions: { temperature: 155, radiation: 3, stability: 0.88 },
  },
  {
    bodyName: 'Ceres',
    name: 'Ahuna Mons',
    terrain: 'mountain',
    surfacePosition: { lat: -10.48, lon: 316.2 },
    maxStructures: 6,
    resourceAccess: [
      { resourceType: 'ice', modifier: 1.4 },
      { resourceType: 'metals', modifier: 1.2 },
      { resourceType: 'silicates', modifier: 1.1 },
    ],
    conditions: { temperature: 145, radiation: 3, stability: 0.75 },
  },
];

export async function seedLandingSites(): Promise<void> {
  console.log('Seeding landing sites...');

  // Clear existing data
  await LandingSite.deleteMany({});

  // Build a name->id lookup for all celestial bodies
  const allBodies = await CelestialBody.find({}, { name: 1 }).lean();
  const nameToId = new Map(allBodies.map((b) => [b.name, b._id]));

  let insertedCount = 0;

  for (const site of sites) {
    const bodyId = nameToId.get(site.bodyName);
    if (!bodyId) {
      console.warn(`  Warning: body "${site.bodyName}" not found, skipping site "${site.name}"`);
      continue;
    }

    await LandingSite.create({
      name: site.name,
      bodyId,
      terrain: site.terrain,
      surfacePosition: site.surfacePosition,
      maxStructures: site.maxStructures,
      resourceAccess: site.resourceAccess,
      conditions: site.conditions,
      claimedBy: null,
      discoveredBy: null,
      discoveredAtTick: null,
      discovered: true,
    });
    insertedCount++;
  }

  console.log(`  Inserted ${insertedCount} landing sites.`);
}
