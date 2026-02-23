import { MAP_SIZE } from './constants.js';

/** Water surface Y level — terrain below this is submerged */
export const WATER_LEVEL = -0.3;

/** Maximum terrain height for normalization */
const MAX_HEIGHT = 3.0;

// --- Flat zone definitions ---
interface FlatZone {
  cx: number;
  cz: number;
  radius: number;
  height: number;
}

const FLAT_ZONES: FlatZone[] = [
  // Village center
  { cx: 48, cz: 48, radius: 8, height: 0.5 },
  // Dungeon
  { cx: 82, cz: 82, radius: 9, height: 0.3 },
  // Farm
  { cx: 57, cz: 62, radius: 6, height: 0.5 },
  // Stone mine (elevated)
  { cx: 15, cz: 15, radius: 6, height: 1.2 },
  // Goblin camp
  { cx: 21, cz: 73, radius: 7, height: 0.4 },
  // Buildings near village
  { cx: 43, cz: 52, radius: 4, height: 0.5 },
  { cx: 56, cz: 49, radius: 4, height: 0.5 },
  { cx: 47, cz: 40, radius: 4, height: 0.5 },
  { cx: 40, cz: 46, radius: 4, height: 0.5 },
];

// Building footprints — hard clamp to exact height (vertex bounds include +1 for corners)
const BUILDING_RECTS: { bx: number; bz: number; w: number; h: number; height: number }[] = [
  { bx: 40, bz: 50, w: 6, h: 5, height: 0.5 },
  { bx: 54, bz: 46, w: 5, h: 6, height: 0.5 },
  { bx: 44, bz: 38, w: 6, h: 5, height: 0.5 },
  { bx: 38, bz: 44, w: 5, h: 5, height: 0.5 },
];

// Lake center for depression
const LAKE_CX = 65;
const LAKE_CZ = 47;
const LAKE_RADIUS = 10;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Raw terrain height from layered sine waves (4 octaves).
 * Returns a value normalized to [0, MAX_HEIGHT].
 */
function rawHeight(x: number, z: number): number {
  const nx = x / MAP_SIZE;
  const nz = z / MAP_SIZE;

  const h =
    Math.sin(nx * 2.1 * Math.PI + 0.3) * Math.cos(nz * 1.7 * Math.PI + 0.7) * 1.0 +
    Math.sin(nx * 4.3 * Math.PI + 1.2) * Math.cos(nz * 3.9 * Math.PI + 2.1) * 0.5 +
    Math.sin(nx * 8.7 * Math.PI + 3.1) * Math.cos(nz * 7.3 * Math.PI + 1.4) * 0.2 +
    Math.sin(nx * 17.1 * Math.PI + 0.8) * Math.cos(nz * 15.7 * Math.PI + 4.2) * 0.08;

  // Raw range is roughly [-1.78, 1.78], normalize to [0, MAX_HEIGHT]
  return ((h + 1.78) / 3.56) * MAX_HEIGHT;
}

/**
 * Get terrain height at integer tile coordinates.
 * Applies flat zone masking and lake depression.
 */
export function getTerrainHeight(x: number, z: number): number {
  let h = rawHeight(x, z);

  // Flat zone masking — smoothstep blend to target height
  for (const zone of FLAT_ZONES) {
    const dx = x - zone.cx;
    const dz = z - zone.cz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    // Fully flat inside radius*0.6, blend out to radius
    const blend = 1 - smoothstep(zone.radius * 0.6, zone.radius, dist);
    if (blend > 0) {
      h = h * (1 - blend) + zone.height * blend;
    }
  }

  // Lake depression — blend terrain down to create a basin
  {
    const dx = x - LAKE_CX;
    const dz = z - LAKE_CZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    // Fully depressed inside radius*0.5, blend out to radius*1.3
    const blend = 1 - smoothstep(LAKE_RADIUS * 0.5, LAKE_RADIUS * 1.3, dist);
    if (blend > 0) {
      const lakeBottom = -0.8;
      h = h * (1 - blend) + lakeBottom * blend;
    }
  }

  // Building footprints — hard clamp to exact flat height
  for (const rect of BUILDING_RECTS) {
    if (x >= rect.bx && x <= rect.bx + rect.w &&
        z >= rect.bz && z <= rect.bz + rect.h) {
      return rect.height;
    }
  }

  return h;
}

/**
 * Bilinear interpolation of terrain height at fractional world coordinates.
 * Samples the 4 surrounding tile corners and lerps for smooth entity positioning.
 */
export function getInterpolatedHeight(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const z1 = z0 + 1;

  const fx = x - x0;
  const fz = z - z0;

  const h00 = getTerrainHeight(x0, z0);
  const h10 = getTerrainHeight(x1, z0);
  const h01 = getTerrainHeight(x0, z1);
  const h11 = getTerrainHeight(x1, z1);

  const h0 = h00 * (1 - fx) + h10 * fx;
  const h1 = h01 * (1 - fx) + h11 * fx;

  return h0 * (1 - fz) + h1 * fz;
}
