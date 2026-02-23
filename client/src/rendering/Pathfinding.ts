import { MAP_SIZE } from '@projectrs/shared';

interface PathNode {
  x: number;
  z: number;
  g: number; // cost from start
  h: number; // heuristic to goal
  f: number; // g + h
  parent: PathNode | null;
}

/**
 * A* pathfinding on a 2D tile grid.
 * isBlocked(x, z) returns true if tile is impassable.
 */
export function findPath(
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  isBlocked: (x: number, z: number) => boolean,
  maxSteps: number = 100
): { x: number; z: number }[] {
  const sx = Math.floor(startX);
  const sz = Math.floor(startZ);
  const gx = Math.floor(goalX);
  const gz = Math.floor(goalZ);

  if (sx === gx && sz === gz) return [];
  if (isBlocked(gx, gz)) {
    // Try to find closest non-blocked neighbor to goal
    const neighbors = getNeighbors(gx, gz, isBlocked);
    let bestNeighbor: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (const n of neighbors) {
      if (!isBlocked(n.x, n.z)) {
        const dist = Math.abs(n.x - sx) + Math.abs(n.z - sz);
        if (dist < bestDist) {
          bestDist = dist;
          bestNeighbor = n;
        }
      }
    }
    if (!bestNeighbor) return [];
    return findPath(startX, startZ, bestNeighbor.x + 0.5, bestNeighbor.z + 0.5, isBlocked, maxSteps);
  }

  const open: PathNode[] = [];
  const closed = new Set<string>();

  const key = (x: number, z: number) => `${x},${z}`;
  // Chebyshev distance — correct heuristic for 8-directional movement
  const heuristic = (x: number, z: number) => {
    const dx = Math.abs(x - gx);
    const dz = Math.abs(z - gz);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };

  const startNode: PathNode = { x: sx, z: sz, g: 0, h: heuristic(sx, sz), f: heuristic(sx, sz), parent: null };
  open.push(startNode);

  let steps = 0;
  while (open.length > 0 && steps < maxSteps) {
    steps++;

    // Find node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];

    if (current.x === gx && current.z === gz) {
      // Reconstruct path
      const path: { x: number; z: number }[] = [];
      let node: PathNode | null = current;
      while (node && !(node.x === sx && node.z === sz)) {
        path.unshift({ x: node.x + 0.5, z: node.z + 0.5 }); // center of tile
        node = node.parent;
      }
      return path;
    }

    closed.add(key(current.x, current.z));

    for (const neighbor of getNeighbors(current.x, current.z, isBlocked)) {
      if (closed.has(key(neighbor.x, neighbor.z))) continue;
      if (neighbor.x < 0 || neighbor.x >= MAP_SIZE || neighbor.z < 0 || neighbor.z >= MAP_SIZE) continue;
      if (isBlocked(neighbor.x, neighbor.z)) continue;

      const isDiagonal = neighbor.x !== current.x && neighbor.z !== current.z;
      const g = current.g + (isDiagonal ? 1.414 : 1);
      const h = heuristic(neighbor.x, neighbor.z);
      const f = g + h;

      const existing = open.find(n => n.x === neighbor.x && n.z === neighbor.z);
      if (existing) {
        if (g < existing.g) {
          existing.g = g;
          existing.f = f;
          existing.parent = current;
        }
        continue;
      }

      open.push({ x: neighbor.x, z: neighbor.z, g, h, f, parent: current });
    }
  }

  return []; // No path found
}

function getNeighbors(x: number, z: number, isBlocked: (x: number, z: number) => boolean): { x: number; z: number }[] {
  const neighbors = [
    { x: x - 1, z },     // west
    { x: x + 1, z },     // east
    { x, z: z - 1 },     // south
    { x, z: z + 1 },     // north
  ];

  // Diagonals — only if both adjacent cardinal tiles are clear (no corner cutting)
  if (!isBlocked(x - 1, z) && !isBlocked(x, z - 1)) neighbors.push({ x: x - 1, z: z - 1 });
  if (!isBlocked(x + 1, z) && !isBlocked(x, z - 1)) neighbors.push({ x: x + 1, z: z - 1 });
  if (!isBlocked(x - 1, z) && !isBlocked(x, z + 1)) neighbors.push({ x: x - 1, z: z + 1 });
  if (!isBlocked(x + 1, z) && !isBlocked(x, z + 1)) neighbors.push({ x: x + 1, z: z + 1 });

  return neighbors;
}
