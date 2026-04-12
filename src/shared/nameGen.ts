/**
 * Procedural name generator for ships, pirates, settlements, etc.
 * Combines prefixes, cores, and suffixes for variety.
 */

const PIRATE_PREFIXES = [
  'Void', 'Dark', 'Shadow', 'Iron', 'Black', 'Red', 'Dead', 'Rust',
  'Burnt', 'Slag', 'Cold', 'Drift', 'Ghost', 'Pale', 'Grim', 'Lost',
  'Blind', 'Silent', 'Broken', 'Hollow',
];

const PIRATE_CORES = [
  'Reaper', 'Runner', 'Fang', 'Claw', 'Maw', 'Thorn', 'Blade',
  'Nail', 'Shard', 'Splinter', 'Edge', 'Point', 'Tooth', 'Barb',
  'Spike', 'Hook', 'Lance', 'Bolt', 'Sting', 'Bite',
];

const PIRATE_SUFFIXES = [
  '', '', '', '', // empty = no suffix, most common
  'of Ceres', 'of the Belt', 'of Vesta', 'of the Void',
  'of Mars', 'of the Deep', 'of Nothing', 'of Dust',
];

const SHIP_PREFIXES = [
  'HSS', 'CSV', 'MV', 'ISV', 'RSV', 'DSV', 'ESV',
];

const SHIP_NAMES = [
  'Wanderer', 'Horizon', 'Prospect', 'Venture', 'Pioneer',
  'Endeavour', 'Resolve', 'Fortitude', 'Discovery', 'Pathfinder',
  'Surveyor', 'Ranger', 'Explorer', 'Valiant', 'Dauntless',
  'Steadfast', 'Intrepid', 'Resilient', 'Stalwart', 'Reliant',
  'Endurance', 'Tenacity', 'Perseverance', 'Clarity', 'Meridian',
];

const SETTLEMENT_ADJECTIVES = [
  'New', 'Port', 'Fort', 'Camp', 'Station', 'Outpost', 'Haven',
  'Point', 'Base', 'Hub', 'Gate', 'Landing', 'Depot', 'Anchor',
];

const SETTLEMENT_NAMES = [
  'Armstrong', 'Gagarin', 'Aldrin', 'Shepard', 'Glenn',
  'Tereshkova', 'Ride', 'Jemison', 'Korolev', 'Von Braun',
  'Tsiolkovsky', 'Goddard', 'Oberth', 'Clarke', 'Asimov',
  'Sagan', 'Hawking', 'Curie', 'Kepler', 'Copernicus',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generatePirateName(): string {
  const prefix = pick(PIRATE_PREFIXES);
  const core = pick(PIRATE_CORES);
  const suffix = pick(PIRATE_SUFFIXES);
  return `${prefix} ${core}${suffix ? ' ' + suffix : ''}`;
}

export function generateShipName(): string {
  return `${pick(SHIP_PREFIXES)} ${pick(SHIP_NAMES)}`;
}

export function generateSettlementName(): string {
  return `${pick(SETTLEMENT_ADJECTIVES)} ${pick(SETTLEMENT_NAMES)}`;
}

export function generateFreighterName(nation: string): string {
  const registries: Record<string, string[]> = {
    'China': ['Tiānmǎ', 'Lóng Chuán', 'Fènghuáng', 'Míng Yuè', 'Jīn Xīng'],
    'United States': ['Liberty Belle', 'Manifest Destiny', 'Golden Gate', 'Lone Star', 'Eagle Eye'],
    'Japan': ['Hayabusa', 'Kaguyahime', 'Tsukuyomi', 'Amaterasu', 'Raijin'],
    'India': ['Pushpak', 'Garuda', 'Chandrayan', 'Agni', 'Vayu'],
    'Germany': ['Götterdämmerung', 'Wanderstern', 'Bergwerk', 'Eisenvogel', 'Nordlicht'],
    'Brazil': ['Bandeirante', 'Cruzeiro', 'Ipiranga', 'Araguaia', 'Tupi'],
    'International': ['Concordia', 'Unity', 'Harmony', 'Nexus', 'Bridge'],
  };
  const names = registries[nation] || registries['International'];
  return pick(names);
}
