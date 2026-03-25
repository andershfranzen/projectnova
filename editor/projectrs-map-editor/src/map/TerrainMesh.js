import * as THREE from 'three'

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function sampleNoise(x, z, scaleA = 1, scaleB = 1) {
  return (
    Math.sin(x * scaleA + z * scaleB) +
    Math.cos(x * (scaleB * 0.73) - z * (scaleA * 0.81))
  ) * 0.5
}

function groundColor(type, shade) {
  if (type === 'dirt') {
    return new THREE.Color(0.45 * shade, 0.31 * shade, 0.14 * shade)
  }

  if (type === 'sand') {
    return new THREE.Color(0.72 * shade, 0.60 * shade, 0.24 * shade)
  }

  if (type === 'path') {
    return new THREE.Color(0.42 * shade, 0.30 * shade, 0.13 * shade)
  }

  if (type === 'road') {
    return new THREE.Color(0.47 * shade, 0.46 * shade, 0.43 * shade)
  }

  if (type === 'water') {
    return new THREE.Color(0.40 * shade, 0.47 * shade, 0.66 * shade)
  }

  if (type === 'dungeon-floor') {
    return new THREE.Color(0.22 * shade, 0.17 * shade, 0.11 * shade)
  }

  if (type === 'dungeon-rock') {
    return new THREE.Color(0.28 * shade, 0.20 * shade, 0.12 * shade)
  }

  return new THREE.Color(0.13 * shade, 0.43 * shade, 0.07 * shade)
}

function pushVertex(vertices, colors, uvs, x, y, z, color, u, v) {
  vertices.push(x, y, z)
  colors.push(color.r, color.g, color.b)
  uvs.push(u, v)
}

function getSlopeShade(h) {
  const dx = ((h.tr + h.br) - (h.tl + h.bl)) * 0.5
  const dz = ((h.bl + h.br) - (h.tl + h.tr)) * 0.5
  const steepness = Math.abs(dx) + Math.abs(dz)

  let shade = 1.0 - steepness * 0.22
  const directional = (-dx * 0.18) + (-dz * 0.12)
  shade += directional

  return clamp(shade, 0.46, 1.04)
}

function getTileAverageHeight(h) {
  return (h.tl + h.tr + h.bl + h.br) / 4
}

function countAdjacentGround(map, x, z, groundType) {
  let count = 0
  const neighbors = [
    [x - 1, z],
    [x + 1, z],
    [x, z - 1],
    [x, z + 1]
  ]

  for (const [nx, nz] of neighbors) {
    if (map.getBaseGroundType(nx, nz) === groundType) count++
  }

  return count
}

function shouldRenderWater(map, x, z) {
  if (typeof map.shouldRenderWaterTile === 'function') {
    return map.shouldRenderWaterTile(x, z)
  }
  return map.isWaterTile(x, z)
}

// Returns 0-1: how close vertex (vx,vz) is to the nearest water tile.
// 5x5 window (25 lookups) gives a ~2.5-tile gradient without heavy cost.
function getVertexWaterProximity(map, vx, vz) {
  let maxProx = 0
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const tx = vx + dx
      const tz = vz + dz
      if (!shouldRenderWater(map, tx, tz)) continue
      const cx = clamp(vx, tx, tx + 1)
      const cz = clamp(vz, tz, tz + 1)
      const dist = Math.sqrt((vx - cx) * (vx - cx) + (vz - cz) * (vz - cz))
      const prox = Math.max(0, 1 - dist / 2.5)
      if (prox > maxProx) maxProx = prox
    }
  }
  return maxProx
}


// Returns 0-1: how strongly this vertex is near a height cliff.
// Checks all 8 surrounding vertices for the largest height difference.
function getVertexCliffStrength(map, vx, vz) {
  const h = map.getVertexHeight(vx, vz)
  let maxDiff = 0
  for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const nx = vx + dx, nz = vz + dz
    if (nx < 0 || nx > map.width || nz < 0 || nz > map.height) continue
    const diff = Math.abs(h - map.getVertexHeight(nx, nz))
    if (diff > maxDiff) maxDiff = diff
  }
  return clamp((maxDiff - 0.9) / 1.1, 0, 1)
}

function getNoiseExtra(type, vx, vz) {
  if (type === 'grass') {
    const bigPatch = sampleNoise(vx * 0.18, vz * 0.18, 1.0, 1.2) * 0.10
    const midPatch = sampleNoise(vx * 0.42, vz * 0.42, 0.8, 1.0) * 0.038
    const tinyDither = sampleNoise(vx * 2.4, vz * 2.4, 1.5, 1.9) * 0.014
    return bigPatch + midPatch + tinyDither
  } else if (type === 'path') {
    const bigPatch = sampleNoise(vx * 0.22, vz * 0.22, 1.0, 1.1) * 0.04
    const tinyDither = sampleNoise(vx * 1.8, vz * 1.8, 1.3, 1.7) * 0.012
    return bigPatch + tinyDither
  } else if (type === 'road') {
    const smallVar = sampleNoise(vx * 1.2, vz * 1.2, 1.5, 0.9) * 0.025
    const tiny = sampleNoise(vx * 3.0, vz * 3.0, 2.0, 1.5) * 0.01
    return smallVar + tiny
  } else if (type === 'dirt' || type === 'sand') {
    return sampleNoise(vx * 0.5, vz * 0.5, 0.8, 1.1) * 0.02
  }
  return 0
}

// Average the slope shades of all tiles sharing this vertex for smooth lighting transitions
function getVertexSlopeShade(map, vx, vz) {
  const sharingTiles = [
    [vx - 1, vz - 1],
    [vx,     vz - 1],
    [vx - 1, vz    ],
    [vx,     vz    ]
  ]

  let total = 0
  let count = 0
  for (const [tx, tz] of sharingTiles) {
    if (!map.getTile(tx, tz)) continue
    total += getSlopeShade(map.getTileCornerHeights(tx, tz))
    count++
  }

  return count > 0 ? total / count : 1.0
}

// Darken vertices that sit lower than their neighbours (valley ambient occlusion)
function getVertexAO(map, vx, vz) {
  const h = map.getVertexHeight(vx, vz)
  let sum = 0, count = 0
  for (const [dx, dz] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const nx = vx + dx, nz = vz + dz
    if (nx < 0 || nx > map.width || nz < 0 || nz > map.height) continue
    sum += map.getVertexHeight(nx, nz)
    count++
  }
  if (count === 0) return 1.0
  const depression = (sum / count) - h  // positive = vertex is lower than neighbours
  return 1.0 - clamp(depression * 0.16, 0, 0.40)
}

function getCornerBlendedColor(map, cornerX, cornerZ, shade) {
  // Average the ground colors of all tiles sharing this corner.
  // Noise is also blended here using the same weights so that both tiles
  // sharing a vertex always produce the same output color — no seams.
  const sharingTiles = [
    [cornerX - 1, cornerZ - 1],
    [cornerX,     cornerZ - 1],
    [cornerX - 1, cornerZ    ],
    [cornerX,     cornerZ    ]
  ]

  let r = 0, g = 0, b = 0, noise = 0, totalWeight = 0
  for (const [nx, nz] of sharingTiles) {
    if (!map.getTile(nx, nz)) continue
    const type = map.getBaseGroundType(nx, nz)
    if (type === 'road') continue  // road doesn't bleed into neighbours
    const w = 1.0
    const c = groundColor(type, 1.0)
    r += c.r * w; g += c.g * w; b += c.b * w
    noise += getNoiseExtra(type, cornerX, cornerZ) * w
    totalWeight += w
  }

  if (totalWeight === 0) return groundColor('grass', shade)
  const s = shade + noise / totalWeight
  return new THREE.Color((r / totalWeight) * s, (g / totalWeight) * s, (b / totalWeight) * s)
}

function avgColor(a, b, c) {
  return new THREE.Color((a.r + b.r + c.r) / 3, (a.g + b.g + c.g) / 3, (a.b + b.b + c.b) / 3)
}

// --- Per-rebuild vertex cache ---
// Interior vertices are shared by up to 4 tiles; caching avoids recomputing each one 4×.
// Sentinel value -1 means "not yet computed". Initialized at the start of buildTerrainMeshes.
let _vcCols = 0
let _vcWaterProx  = null
let _vcCliffStr   = null
let _vcAO         = null
let _vcSlopeShade = null

function _initVertexCache(map) {
  const size = (map.width + 1) * (map.height + 1)
  _vcCols       = map.width + 1
  _vcWaterProx  = new Float32Array(size).fill(-1)
  _vcCliffStr   = new Float32Array(size).fill(-1)
  _vcAO         = new Float32Array(size).fill(-1)
  _vcSlopeShade = new Float32Array(size).fill(-1)
}

function _cvWaterProx(map, vx, vz) {
  const i = vz * _vcCols + vx
  if (_vcWaterProx[i] < 0) _vcWaterProx[i] = getVertexWaterProximity(map, vx, vz)
  return _vcWaterProx[i]
}
function _cvCliffStr(map, vx, vz) {
  const i = vz * _vcCols + vx
  if (_vcCliffStr[i] < 0) _vcCliffStr[i] = getVertexCliffStrength(map, vx, vz)
  return _vcCliffStr[i]
}
function _cvAO(map, vx, vz) {
  const i = vz * _vcCols + vx
  if (_vcAO[i] < 0) _vcAO[i] = getVertexAO(map, vx, vz)
  return _vcAO[i]
}
function _cvSlopeShade(map, vx, vz) {
  const i = vz * _vcCols + vx
  if (_vcSlopeShade[i] < 0) _vcSlopeShade[i] = getVertexSlopeShade(map, vx, vz)
  return _vcSlopeShade[i]
}

// --- Persistent land geometry for partial height-only updates ---
let _landGeo = null
let _landPosBuf = null   // Float32Array backing position attribute
let _landColBuf = null   // Float32Array backing color attribute
let _landTileOff = null  // Int32Array: [z * width + x] = first vertex index for this tile
let _landMapW = 0
let _landMapH = 0

function addTileGeometry(vertices, colors, uvs, indices, base, tileType, h, x, z, map, shadowInf) {
  const shadeTL = _cvSlopeShade(map, x,     z    )
  const shadeTR = _cvSlopeShade(map, x + 1, z    )
  const shadeBL = _cvSlopeShade(map, x,     z + 1)
  const shadeBR = _cvSlopeShade(map, x + 1, z + 1)
  const slopeShade = (shadeTL + shadeTR + shadeBL + shadeBR) / 4

  const tile = map.getTile(x, z)
  const groundBType = tile?.groundB || null
  const splitDir = tile?.split || 'forward'

  let cTL, cTR, cBL, cBR
  if (tileType === 'road') {
    const noise = getNoiseExtra('road', x + 0.5, z + 0.5)
    cTL = groundColor('road', Math.max(shadeTL + noise, 0.5))
    cTR = groundColor('road', Math.max(shadeTR + noise, 0.5))
    cBL = groundColor('road', Math.max(shadeBL + noise, 0.5))
    cBR = groundColor('road', Math.max(shadeBR + noise, 0.5))
  } else {
    cTL = getCornerBlendedColor(map, x,     z,     shadeTL)
    cTR = getCornerBlendedColor(map, x + 1, z,     shadeTR)
    cBL = getCornerBlendedColor(map, x,     z + 1, shadeBL)
    cBR = getCornerBlendedColor(map, x + 1, z + 1, shadeBR)
  }

  if (tileType !== 'water') {
    const wLevel = map.getTileWaterLevel(x, z)

    const proxTL = _cvWaterProx(map, x,     z    )
    const proxTR = _cvWaterProx(map, x + 1, z    )
    const proxBL = _cvWaterProx(map, x,     z + 1)
    const proxBR = _cvWaterProx(map, x + 1, z + 1)

    // Mud tint — horizontal gradient toward water
    const applyMud = (c, t) => {
      if (t <= 0) return
      c.r *= 1 + t * 0.18
      c.g *= 1 - t * 0.22
      c.b *= 1 - t * 0.28
    }
    applyMud(cTL, proxTL)
    applyMud(cTR, proxTR)
    applyMud(cBL, proxBL)
    applyMud(cBR, proxBR)

    // Underwater darkening — vertices below water level fade toward a deep murky colour
    const applyDepth = (c, vertH) => {
      const depth = clamp((wLevel - vertH) / 2.5, 0, 1)
      if (depth <= 0) return
      c.r *= 1 - depth * 0.60
      c.g *= 1 - depth * 0.45
      c.b *= 1 - depth * 0.20
    }
    applyDepth(cTL, h.tl)
    applyDepth(cTR, h.tr)
    applyDepth(cBL, h.bl)
    applyDepth(cBR, h.br)
  }

  if (tileType !== 'water') {
    const applyCliffTint = (c, t) => {
      if (t <= 0) return
      c.r *= 1 + t * 0.04
      c.g *= 1 - t * 0.08
      c.b *= 1 - t * 0.16
    }
    applyCliffTint(cTL, _cvCliffStr(map, x,     z    ))
    applyCliffTint(cTR, _cvCliffStr(map, x + 1, z    ))
    applyCliffTint(cBL, _cvCliffStr(map, x,     z + 1))
    applyCliffTint(cBR, _cvCliffStr(map, x + 1, z + 1))
  }


  // Valley ambient occlusion — darken vertices lower than their surroundings
  if (tileType !== 'water') {
    cTL.multiplyScalar(_cvAO(map, x,     z    ))
    cTR.multiplyScalar(_cvAO(map, x + 1, z    ))
    cBL.multiplyScalar(_cvAO(map, x,     z + 1))
    cBR.multiplyScalar(_cvAO(map, x + 1, z + 1))
  }

  // Object proximity shadow — darken terrain near placed assets (RS2 style)
  const shadowableType = tileType === 'grass' || tileType === 'dirt' || tileType === 'path'
  if (shadowableType && shadowInf) {
    cTL.multiplyScalar(shadowInf[z    ][x    ])
    cTR.multiplyScalar(shadowInf[z    ][x + 1])
    cBL.multiplyScalar(shadowInf[z + 1][x    ])
    cBR.multiplyScalar(shadowInf[z + 1][x + 1])
  }

  if (groundBType && groundBType !== tileType) {
    // Split tile: flat solid color per triangle, no corner blending
    const noiseA = getNoiseExtra(tileType, x + 0.25, z + 0.25)
    const noiseB = getNoiseExtra(groundBType, x + 0.75, z + 0.75)
    const cA = groundColor(tileType, Math.max(slopeShade + noiseA, 0.5))
    const cB = groundColor(groundBType, Math.max(slopeShade + noiseB, 0.5))
    const avgAO = (_cvAO(map, x, z) + _cvAO(map, x+1, z) + _cvAO(map, x, z+1) + _cvAO(map, x+1, z+1)) / 4
    const shadowableA = tileType === 'grass' || tileType === 'dirt' || tileType === 'path'
    const shadowableB = groundBType === 'grass' || groundBType === 'dirt' || groundBType === 'path'
    const avgShadow = shadowInf
      ? (shadowInf[z][x] + shadowInf[z][x+1] + shadowInf[z+1][x] + shadowInf[z+1][x+1]) / 4
      : 1.0
    cA.multiplyScalar(avgAO * (shadowableA && shadowInf ? avgShadow : 1.0))
    cB.multiplyScalar(avgAO * (shadowableB && shadowInf ? avgShadow : 1.0))

    if (splitDir === 'forward') {
      // Triangle A (tileType): TL, BL, TR
      pushVertex(vertices, colors, uvs, x,     h.tl, z,     cA, 0, 0)
      pushVertex(vertices, colors, uvs, x,     h.bl, z + 1, cA, 0, 1)
      pushVertex(vertices, colors, uvs, x + 1, h.tr, z,     cA, 1, 0)
      // Triangle B (groundBType): BL, BR, TR
      pushVertex(vertices, colors, uvs, x,     h.bl, z + 1, cB, 0, 1)
      pushVertex(vertices, colors, uvs, x + 1, h.br, z + 1, cB, 1, 1)
      pushVertex(vertices, colors, uvs, x + 1, h.tr, z,     cB, 1, 0)
    } else {
      // Triangle A (tileType): TL, BL, BR
      pushVertex(vertices, colors, uvs, x,     h.tl, z,     cA, 0, 0)
      pushVertex(vertices, colors, uvs, x,     h.bl, z + 1, cA, 0, 1)
      pushVertex(vertices, colors, uvs, x + 1, h.br, z + 1, cA, 1, 1)
      // Triangle B (groundBType): TL, BR, TR
      pushVertex(vertices, colors, uvs, x,     h.tl, z,     cB, 0, 0)
      pushVertex(vertices, colors, uvs, x + 1, h.br, z + 1, cB, 1, 1)
      pushVertex(vertices, colors, uvs, x + 1, h.tr, z,     cB, 1, 0)
    }

    indices.push(base + 0, base + 1, base + 2, base + 3, base + 4, base + 5)
    return 6
  }

  pushVertex(vertices, colors, uvs, x,     h.tl, z,     cTL, 0, 0)
  pushVertex(vertices, colors, uvs, x + 1, h.tr, z,     cTR, 1, 0)
  pushVertex(vertices, colors, uvs, x,     h.bl, z + 1, cBL, 0, 1)
  pushVertex(vertices, colors, uvs, x + 1, h.br, z + 1, cBR, 1, 1)

  if (splitDir === 'forward') {
    indices.push(base + 0, base + 2, base + 1, base + 2, base + 3, base + 1)
  } else {
    indices.push(base + 0, base + 2, base + 3, base + 0, base + 3, base + 1)
  }
  return 4
}

export function buildTerrainMeshes(map, waterTexture, shadowInf = null) {
  _initVertexCache(map)

  const landVertices = []
  const landColors = []
  const landUVs = []
  const landIndices = []

  const waterVertices = []
  const waterColors = []
  const waterUVs = []
  const waterIndices = []

  let landBase = 0
  let waterBase = 0

  const newTileOff = new Int32Array(map.width * map.height)

  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      newTileOff[z * map.width + x] = landBase
      const h = map.getTileCornerHeights(x, z)
      const landType = map.getBaseGroundType(x, z)

      landBase += addTileGeometry(
        landVertices,
        landColors,
        landUVs,
        landIndices,
        landBase,
        landType,
        h,
        x,
        z,
        map,
        shadowInf
      )

      if (shouldRenderWater(map, x, z)) {
        const wY = map.getTileWaterLevel(x, z) + 0.02
        // World-space UVs so texture flows seamlessly across tile boundaries
        const WATER_UV_SCALE = 5
        const u0 = x / WATER_UV_SCALE
        const u1 = (x + 1) / WATER_UV_SCALE
        const v0 = z / WATER_UV_SCALE
        const v1 = (z + 1) / WATER_UV_SCALE
        const wc = groundColor('water', 1.0)
        waterVertices.push(x, wY, z,  x+1, wY, z,  x, wY, z+1,  x+1, wY, z+1)
        waterColors.push(wc.r, wc.g, wc.b, wc.r, wc.g, wc.b, wc.r, wc.g, wc.b, wc.r, wc.g, wc.b)
        waterUVs.push(u0, v0,  u1, v0,  u0, v1,  u1, v1)
        waterIndices.push(waterBase, waterBase+2, waterBase+1, waterBase+2, waterBase+3, waterBase+1)
        waterBase += 4
      }
    }
  }

  // Surface water pass — thin film at terrain height (rice paddies, flooded fields)
  const swVertices = []
  const swColors = []
  const swUVs = []
  const swIndices = []
  let swBase = 0

  const _swColor = new THREE.Color(0.55, 0.72, 0.78)
  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.getTile(x, z)
      if (!tile?.waterSurface) continue

      const h = map.getTileCornerHeights(x, z)
      const LIFT = 0.05
      const WATER_UV_SCALE = 5
      const u0 = x / WATER_UV_SCALE
      const u1 = (x + 1) / WATER_UV_SCALE
      const v0 = z / WATER_UV_SCALE
      const v1 = (z + 1) / WATER_UV_SCALE
      const wc = _swColor
      swVertices.push(
        x,     h.tl + LIFT, z,
        x + 1, h.tr + LIFT, z,
        x,     h.bl + LIFT, z + 1,
        x + 1, h.br + LIFT, z + 1
      )
      swColors.push(wc.r, wc.g, wc.b, wc.r, wc.g, wc.b, wc.r, wc.g, wc.b, wc.r, wc.g, wc.b)
      swUVs.push(u0, v0,  u1, v0,  u0, v1,  u1, v1)
      swIndices.push(swBase, swBase + 2, swBase + 1, swBase + 2, swBase + 3, swBase + 1)
      swBase += 4
    }
  }

  const group = new THREE.Group()
  group.name = 'terrain-group'

  // Store persistent land geometry for partial height-only updates
  _landTileOff = newTileOff
  _landMapW    = map.width
  _landMapH    = map.height
  _landPosBuf  = new Float32Array(landVertices)
  _landColBuf  = new Float32Array(landColors)

  if (landVertices.length > 0) {
    _landGeo = new THREE.BufferGeometry()
    _landGeo.setAttribute('position', new THREE.BufferAttribute(_landPosBuf, 3))
    _landGeo.setAttribute('color',    new THREE.BufferAttribute(_landColBuf, 3))
    _landGeo.setAttribute('uv',       new THREE.Float32BufferAttribute(landUVs, 2))
    _landGeo.setIndex(landIndices)
    _landGeo.computeVertexNormals()

    const landMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide
    })

    const landMesh = new THREE.Mesh(_landGeo, landMaterial)
    landMesh.name = 'terrain-land'
    landMesh.receiveShadow = true
    group.add(landMesh)
  }

  if (waterVertices.length > 0) {
    const waterGeometry = new THREE.BufferGeometry()
    waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(waterVertices, 3))
    waterGeometry.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3))
    waterGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(waterUVs, 2))
    waterGeometry.setIndex(waterIndices)
    waterGeometry.computeVertexNormals()

    if (waterTexture) {
      waterTexture.wrapS = THREE.RepeatWrapping
      waterTexture.wrapT = THREE.RepeatWrapping
      waterTexture.colorSpace = THREE.SRGBColorSpace
    }

    const waterMaterial = new THREE.MeshLambertMaterial({
      map: waterTexture || null,
      color: waterTexture ? 0xd4e8ff : 0x6b84b4,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    })

    const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial)
    waterMesh.name = 'terrain-water'
    waterMesh.receiveShadow = true
    group.add(waterMesh)
  }

  if (swVertices.length > 0) {
    const swGeometry = new THREE.BufferGeometry()
    swGeometry.setAttribute('position', new THREE.Float32BufferAttribute(swVertices, 3))
    swGeometry.setAttribute('color', new THREE.Float32BufferAttribute(swColors, 3))
    swGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(swUVs, 2))
    swGeometry.setIndex(swIndices)
    swGeometry.computeVertexNormals()

    let swTexture = null
    if (waterTexture) {
      swTexture = waterTexture.clone()
      swTexture.image = waterTexture.image
      swTexture.wrapS = THREE.RepeatWrapping
      swTexture.wrapT = THREE.RepeatWrapping
      swTexture.colorSpace = THREE.SRGBColorSpace
      swTexture.offset.set(0, 0)
      if (swTexture.image) swTexture.needsUpdate = true
    }

    const swMaterial = new THREE.MeshLambertMaterial({
      map: swTexture || null,
      color: swTexture ? 0xe0f4f8 : 0x8ac8d8,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })

    const swMesh = new THREE.Mesh(swGeometry, swMaterial)
    swMesh.name = 'terrain-surface-water'
    group.add(swMesh)
  }

  return group
}

// Rebuild only the water + surface-water meshes (used in the heights-only fast path).
// Returns a Group containing just those meshes so the caller can swap them out of terrainGroup.
export function buildWaterMeshes(map, waterTexture) {
  const group = new THREE.Group()
  group.name = 'terrain-water-group'

  const waterVertices = []
  const waterColors   = []
  const waterUVs      = []
  const waterIndices  = []
  let waterBase = 0

  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      if (!shouldRenderWater(map, x, z)) continue
      const wY = map.getTileWaterLevel(x, z) + 0.02
      const WATER_UV_SCALE = 5
      const u0 = x / WATER_UV_SCALE, u1 = (x + 1) / WATER_UV_SCALE
      const v0 = z / WATER_UV_SCALE, v1 = (z + 1) / WATER_UV_SCALE
      const wc = groundColor('water', 1.0)
      waterVertices.push(x, wY, z,  x+1, wY, z,  x, wY, z+1,  x+1, wY, z+1)
      waterColors.push(wc.r, wc.g, wc.b, wc.r, wc.g, wc.b, wc.r, wc.g, wc.b, wc.r, wc.g, wc.b)
      waterUVs.push(u0, v0,  u1, v0,  u0, v1,  u1, v1)
      waterIndices.push(waterBase, waterBase+2, waterBase+1, waterBase+2, waterBase+3, waterBase+1)
      waterBase += 4
    }
  }

  if (waterVertices.length > 0) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(waterVertices, 3))
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(waterColors, 3))
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(waterUVs, 2))
    geo.setIndex(waterIndices)
    geo.computeVertexNormals()
    if (waterTexture) {
      waterTexture.wrapS = THREE.RepeatWrapping
      waterTexture.wrapT = THREE.RepeatWrapping
      waterTexture.colorSpace = THREE.SRGBColorSpace
    }
    const mat = new THREE.MeshLambertMaterial({
      map: waterTexture || null,
      color: waterTexture ? 0xd4e8ff : 0x6b84b4,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.88,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'terrain-water'
    mesh.receiveShadow = true
    group.add(mesh)
  }

  const swVertices = [], swColors = [], swUVs = [], swIndices = []
  let swBase = 0
  const _swColor = new THREE.Color(0.55, 0.72, 0.78)
  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.getTile(x, z)
      if (!tile?.waterSurface) continue
      const h = map.getTileCornerHeights(x, z)
      const LIFT = 0.05, WATER_UV_SCALE = 5
      const u0 = x / WATER_UV_SCALE, u1 = (x + 1) / WATER_UV_SCALE
      const v0 = z / WATER_UV_SCALE, v1 = (z + 1) / WATER_UV_SCALE
      const wc = _swColor
      swVertices.push(x, h.tl+LIFT, z,  x+1, h.tr+LIFT, z,  x, h.bl+LIFT, z+1,  x+1, h.br+LIFT, z+1)
      swColors.push(wc.r, wc.g, wc.b, wc.r, wc.g, wc.b, wc.r, wc.g, wc.b, wc.r, wc.g, wc.b)
      swUVs.push(u0, v0,  u1, v0,  u0, v1,  u1, v1)
      swIndices.push(swBase, swBase+2, swBase+1, swBase+2, swBase+3, swBase+1)
      swBase += 4
    }
  }

  if (swVertices.length > 0) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(swVertices, 3))
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(swColors, 3))
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(swUVs, 2))
    geo.setIndex(swIndices)
    geo.computeVertexNormals()
    let swTex = null
    if (waterTexture) {
      swTex = waterTexture.clone()
      swTex.image = waterTexture.image
      swTex.wrapS = THREE.RepeatWrapping
      swTex.wrapT = THREE.RepeatWrapping
      swTex.colorSpace = THREE.SRGBColorSpace
      if (swTex.image) swTex.needsUpdate = true
    }
    const mat = new THREE.MeshLambertMaterial({
      map: swTex || null,
      color: swTex ? 0xe0f4f8 : 0x8ac8d8,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = 'terrain-surface-water'
    group.add(mesh)
  }

  return group
}

export function buildCliffMeshes(map) {
  const vertices = []
  const indices = []
  const colors = []
  let base = 0

  function cliffColor(topY, bottomY) {
    const drop = Math.max(0, topY - bottomY)
    const shade = clamp(0.92 - drop * 0.12, 0.42, 0.92)
    return new THREE.Color(0.37 * shade, 0.29 * shade, 0.12 * shade)
  }

  function pushColoredQuad(a, b, c, d, color) {
    vertices.push(...a, ...b, ...c, ...d)
    for (let i = 0; i < 4; i++) {
      colors.push(color.r, color.g, color.b)
    }
    indices.push(
      base + 0, base + 2, base + 1,
      base + 2, base + 3, base + 1
    )
    base += 4
  }

  function addVerticalFace(x1, z1, top1, top2, bottom1, bottom2, isXAxisFace) {
    const eps = 0.01
    const color = cliffColor((top1 + top2) * 0.5, (bottom1 + bottom2) * 0.5)

    if (isXAxisFace) {
      pushColoredQuad(
        [x1, top1, z1],
        [x1, top2, z1 + 1],
        [x1, bottom1 + eps, z1],
        [x1, bottom2 + eps, z1 + 1],
        color
      )
    } else {
      pushColoredQuad(
        [x1, top1, z1],
        [x1 + 1, top2, z1],
        [x1, bottom1 + eps, z1],
        [x1 + 1, bottom2 + eps, z1],
        color
      )
    }
  }

  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const h = map.getTileCornerHeights(x, z)

      const wLevel = map.getTileWaterLevel(x, z)

      const rightTile = map.getTile(x + 1, z)
      if (rightTile) {
        const rh = map.getTileCornerHeights(x + 1, z)

        const aTop1 = h.tr
        const aTop2 = h.br
        const bTop1 = rh.tl
        const bTop2 = rh.bl

        const avgA = (aTop1 + aTop2) * 0.5
        const avgB = (bTop1 + bTop2) * 0.5

        // Skip cliff if the taller side is submerged — wall would be hidden under water and creates visible squares
        if (Math.abs(avgA - avgB) > 0.01 && Math.max(avgA, avgB) > wLevel) {
          if (avgA > avgB) {
            addVerticalFace(x + 1, z, aTop1, aTop2, bTop1, bTop2, true)
          } else {
            addVerticalFace(x + 1, z, bTop1, bTop2, aTop1, aTop2, true)
          }
        }
      }

      const downTile = map.getTile(x, z + 1)
      if (downTile) {
        const dh = map.getTileCornerHeights(x, z + 1)

        const aTop1 = h.bl
        const aTop2 = h.br
        const bTop1 = dh.tl
        const bTop2 = dh.tr

        const avgA = (aTop1 + aTop2) * 0.5
        const avgB = (bTop1 + bTop2) * 0.5

        if (Math.abs(avgA - avgB) > 0.01 && Math.max(avgA, avgB) > wLevel) {
          if (avgA > avgB) {
            addVerticalFace(x, z + 1, aTop1, aTop2, bTop1, bTop2, false)
          } else {
            addVerticalFace(x, z + 1, bTop1, bTop2, aTop1, aTop2, false)
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'cliffs'
  return mesh
}

function rotateUV(u, v, rotation) {
  const cx = 0.5
  const cy = 0.5
  const x = u - cx
  const y = v - cy

  const r = rotation % 4
  if (r === 1) return [-y + cx, x + cy]
  if (r === 2) return [-x + cx, -y + cy]
  if (r === 3) return [y + cx, -x + cy]
  return [u, v]
}

function scaledRotatedUVs(rotation, scale) {
  const s = Math.max(0.1, scale)
  const base = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ]

  return base.map(([u, v]) => {
    const su = (u - 0.5) / s + 0.5
    const sv = (v - 0.5) / s + 0.5
    return rotateUV(su, sv, rotation)
  })
}

// Partially update the land mesh's positions and colors for tiles in the given region.
// Only valid when tile ground types (and thus vertex counts) haven't changed — i.e. terrain-tool height edits.
// Returns true if the update was applied, false if a full rebuild is needed instead.
export function updateTerrainLandHeights(map, shadowInf, x1, z1, x2, z2) {
  if (!_landGeo || !_landTileOff || _landMapW !== map.width || _landMapH !== map.height) return false

  _initVertexCache(map)

  // Expand region to cover neighbor-sampling ranges:
  // getVertexWaterProximity looks 2 tiles out, getCornerBlendedColor/slopeShade look 1 tile out.
  const margin = 3
  const rx1 = Math.max(0, x1 - margin)
  const rz1 = Math.max(0, z1 - margin)
  const rx2 = Math.min(map.width - 1, x2 + margin)
  const rz2 = Math.min(map.height - 1, z2 + margin)

  const tmpV = [], tmpC = [], tmpU = [], tmpI = []

  for (let z = rz1; z <= rz2; z++) {
    for (let x = rx1; x <= rx2; x++) {
      const off = _landTileOff[z * map.width + x]
      const h = map.getTileCornerHeights(x, z)
      const landType = map.getBaseGroundType(x, z)

      tmpV.length = 0; tmpC.length = 0; tmpU.length = 0; tmpI.length = 0
      const vertCount = addTileGeometry(tmpV, tmpC, tmpU, tmpI, 0, landType, h, x, z, map, shadowInf)

      const base = off * 3
      for (let i = 0; i < vertCount * 3; i++) {
        _landPosBuf[base + i] = tmpV[i]
        _landColBuf[base + i] = tmpC[i]
      }
    }
  }

  _landGeo.attributes.position.needsUpdate = true
  _landGeo.attributes.color.needsUpdate = true
  return true
}

export function buildTextureOverlays(map, textureRegistry, textureCache) {
  const group = new THREE.Group()
  group.name = 'texture-overlays'

  for (let z = 0; z < map.height; z++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.getTile(x, z)
      if (!tile || (!tile.textureId && !tile.textureIdB)) continue
      // textureHalfMode with both null means fully erased half-painted tile — skip

      const h = map.getTileCornerHeights(x, z)
      const overlayOffset = 0.008

      const positions = [
        x,     h.tl + overlayOffset, z,
        x + 1, h.tr + overlayOffset, z,
        x,     h.bl + overlayOffset, z + 1,
        x + 1, h.br + overlayOffset, z + 1
      ]

      const fwd = tile.split === 'forward'
      const firstIndices  = fwd ? [0, 2, 1]       : [0, 2, 3]
      const secondIndices = fwd ? [2, 3, 1]       : [0, 3, 1]
      const fullIndices   = fwd ? [0, 2, 1, 2, 3, 1] : [0, 2, 3, 0, 3, 1]

      const makeUVs = (rotation, scale, worldUV) => {
        if (worldUV) {
          const s = Math.max(0.1, scale)
          return [x/s, z/s, (x+1)/s, z/s, x/s, (z+1)/s, (x+1)/s, (z+1)/s]
        }
        const uv = scaledRotatedUVs(rotation, scale)
        return [uv[0][0], uv[0][1], uv[1][0], uv[1][1], uv[2][0], uv[2][1], uv[3][0], uv[3][1]]
      }

      const addMesh = (textureId, rotation, scale, worldUV, indices) => {
        const textureInfo = textureRegistry.find((t) => t.id === textureId)
        if (!textureInfo) return
        const texture = textureCache.get(textureInfo.id)
        if (!texture) return

        texture.wrapS = THREE.RepeatWrapping
        texture.wrapT = THREE.RepeatWrapping
        texture.colorSpace = THREE.SRGBColorSpace

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(makeUVs(rotation, scale, worldUV), 2))
        geometry.setIndex(indices)
        geometry.computeVertexNormals()

        group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          color: new THREE.Color(0.82, 0.82, 0.82),
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2
        })))
      }

      if (tile.textureHalfMode) {
        if (tile.textureId) addMesh(tile.textureId, tile.textureRotation, tile.textureScale, tile.textureWorldUV, firstIndices)
        if (tile.textureIdB) addMesh(tile.textureIdB, tile.textureRotationB, tile.textureScaleB, false, secondIndices)
      } else if (tile.textureId) {
        addMesh(tile.textureId, tile.textureRotation, tile.textureScale, tile.textureWorldUV, fullIndices)
      }
    }
  }

  return group
}

export function buildTexturePlanes(map, textureRegistry, textureCache) {
  const group = new THREE.Group()
  group.name = 'texture-planes'

  for (const plane of map.texturePlanes) {
    const textureInfo = textureRegistry.find((t) => t.id === plane.textureId)
    if (!textureInfo) continue

    const textureSrc = textureCache.get(textureInfo.id)
    if (!textureSrc) continue

    const texture = textureSrc.clone()
    texture.image = textureSrc.image
    const scale = plane.uvRepeat || 1

    const sx = plane.scale?.x ?? 1
    const sy = plane.scale?.y ?? 1
    const width = Math.max(0.01, plane.width || 1)
    const height = Math.max(0.01, plane.height || 1)
    const actualW = width * sx
    const actualH = height * sy

    const px = plane.position?.x ?? 0
    const py = plane.position?.y ?? 0
    const pz = plane.position?.z ?? 0
    const ry = plane.rotation?.y ?? 0

    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(scale, scale)
    texture.offset.set(0, 0)
    texture.colorSpace = THREE.SRGBColorSpace
    if (texture.image) texture.needsUpdate = true

    const geometry = new THREE.PlaneGeometry(width, height)
    const isSelected = map.selectedTexturePlaneId === plane.id

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      color: isSelected ? new THREE.Color(0xeaf4ff) : new THREE.Color(0.82, 0.82, 0.82)
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.layers.set(1)

    const rx = plane.rotation?.x ?? 0
    const rz = plane.rotation?.z ?? 0
    const sz = plane.scale?.z ?? 1

    mesh.position.set(px, py, pz)
    mesh.rotation.set(rx, ry, rz)
    mesh.scale.set(sx, sy, sz)
    mesh.renderOrder = 10
    mesh.userData.texturePlane = plane

    group.add(mesh)
  }

  return group
}