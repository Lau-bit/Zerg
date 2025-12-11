// core.js - Optimized
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let width, height;

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}
resize();

// Creep configuration
const creepColor = { r: 89, g: 39, b: 104 };
const creepHighlight = { r: 139, g: 58, b: 156 };
const creepDark = { r: 45, g: 15, b: 55 };
const veinColor = { r: 160, g: 80, b: 180 };

// StarCraft-like rocky world palette
// 0: low dirt, 1: mid dirt, 2: high plateau, 3: cliff wall, 4: water
const terrainColors = [
    { r: 44, g: 34, b: 30 },   // 0 low ground dirt
    { r: 70, g: 52, b: 42 },   // 1 mid ground
    { r: 96, g: 78, b: 66 },   // 2 high plateau
    { r: 24, g: 18, b: 16 },   // 3 cliff face
    { r: 25, g: 65, b: 120 }   // 4 water - brighter blue
];

// Resource configuration (StarCraft-like: blue minerals, green gas)
const mineralColor = { r: 90, g: 150, b: 255 };
const vespeneColor = { r: 60, g: 190, b: 80 };

// Grid-based simulation
const cellSize = 8;
let cols, rows;
let creepGrid, creepAge;
let terrainHeight, terrainType;
let minerals = [];
let vespene = [];
let buildings = [];
let startCorner = { x: 0, y: 0, dirX: 1, dirY: 1 };

// Ripple system
let ripples = [];

// Pre-computed noise textures
let noiseTexture1, noiseTexture2, noiseTexture3, veinTexture;
let heightNoise1, heightNoise2, heightNoise3, biomeNoise;

// Saturation tracking
let totalVisibleCells = 0;
let isSaturated = false;
let creepCount = 0;
let resourceBoost = 1.0;

// Resource "gathered" tracking for extra hatcheries
let mineralsGathered = 0;
let vespeneGathered = 0;
const HATCHERY_MINERAL_COST = 2;
const HATCHERY_VESPENE_COST = 1;
const HATCHERY_SPAWN_CHANCE = 0.55;

// Active edge cells
let activeEdges = new Set();

// Terrain spread modifiers
const terrainSpreadMods = [1.0, 0.9, 0.75, 0.2, 0.15];

// Seeded random for consistent noise
function seededRandom(seed) {
    const x = Math.sin(seed) * 43758.5453;
    return x - Math.floor(x);
}

function generateNoiseTexture(scale, seed, cols, rows) {
    const tex = new Float32Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) {
        const x = i % cols;
        const y = Math.floor(i / cols);
        tex[i] = seededRandom(x * scale * 12.9898 + y * scale * 78.233 + seed);
    }
    return tex;
}

function initGrid() {
    cols = Math.ceil(width / cellSize);
    rows = Math.ceil(height / cellSize);
    const size = cols * rows;

    totalVisibleCells = size;
    isSaturated = false;
    creepCount = 0;
    resourceBoost = 1.0;
    mineralsGathered = 0;
    vespeneGathered = 0;

    creepGrid = new Uint8Array(size);
    creepAge = new Float32Array(size);
    terrainHeight = new Float32Array(size);
    terrainType = new Uint8Array(size);
    ripples = [];
    minerals = [];
    vespene = [];
    buildings = [];
    activeEdges = new Set();

    // Heightmap octaves
    heightNoise1 = generateNoiseTexture(0.0035, 300, cols, rows);
    heightNoise2 = generateNoiseTexture(0.008, 400, cols, rows);
    heightNoise3 = generateNoiseTexture(0.018, 500, cols, rows);
    biomeNoise = generateNoiseTexture(0.01, 600, cols, rows);

    // Base height from octave mix
    for (let i = 0; i < size; i++) {
        terrainHeight[i] = heightNoise1[i] * 0.7 + heightNoise2[i] * 0.2 + heightNoise3[i] * 0.1;
    }

    // Smoothing pass
    const smoothed = new Float32Array(size);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let sum = 0, count = 0;
            for (let oy = -1; oy <= 1; oy++) {
                const ny = y + oy;
                if (ny < 0 || ny >= rows) continue;
                for (let ox = -1; ox <= 1; ox++) {
                    const nx = x + ox;
                    if (nx < 0 || nx >= cols) continue;
                    sum += terrainHeight[ny * cols + nx];
                    count++;
                }
            }
            smoothed[y * cols + x] = sum / count;
        }
    }
    terrainHeight = smoothed;

    // Generate 0-5 water bodies
    const numBodies = Math.floor(Math.random() * 6);
    const waterMask = new Uint8Array(size);
    for (let b = 0; b < numBodies; b++) {
        let cx, cy;
        let attempts = 0;
        let foundCenter = false;
        while (attempts < 100 && !foundCenter) {
            cx = Math.floor(Math.random() * cols);
            cy = Math.floor(Math.random() * rows);
            if (terrainHeight[cy * cols + cx] <= 0.45) {
                foundCenter = true;
            }
            attempts++;
        }
        if (!foundCenter) continue;

        // Random size
        const radius = 8 + Math.random() * 15; // 8-23 cells radius

        // Flood the area with simple circle and height check
        for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy++) {
            for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > radius) continue;

                // Simple boundary variation with noise
                const boundaryNoise = (seededRandom((nx + ny) * 0.1) - 0.5) * 2;
                const effectiveDist = dist + boundaryNoise * 2;

                if (effectiveDist < radius && terrainHeight[ny * cols + nx] < 0.50) {
                    waterMask[ny * cols + nx] = 1;
                }
            }
        }
    }

    // Expand water pools slightly for more visible bodies
    const expandedWater = new Uint8Array(size);
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const idx = y * cols + x;
            if (waterMask[idx]) {
                expandedWater[idx] = 1;
                // Expand to neighbors if they're low enough
                for (let oy = -1; oy <= 1; oy++) {
                    const ny = y + oy;
                    if (ny < 0 || ny >= rows) continue;
                    for (let ox = -1; ox <= 1; ox++) {
                        const nx = x + ox;
                        if (nx < 0 || nx >= cols) continue;
                        const nidx = ny * cols + nx;
                        if (terrainHeight[nidx] < 0.48) {
                            expandedWater[nidx] = 1;
                        }
                    }
                }
            }
        }
    }

    // Assign terrain types
    for (let i = 0; i < size; i++) {
        const h = terrainHeight[i];
        if (expandedWater[i]) {
            terrainType[i] = 4; // water
        } else if (h < 0.32) {
            terrainType[i] = 0; // low ground
        } else if (h < 0.6) {
            terrainType[i] = 1; // mid ground
        } else {
            terrainType[i] = 2; // high plateau
        }
    }

    // Detect cliff edges
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const idx = y * cols + x;
            if (terrainType[idx] === 4) continue;

            const h = terrainHeight[idx];
            let maxDiff = 0;

            if (x > 0) maxDiff = Math.max(maxDiff, Math.abs(h - terrainHeight[idx - 1]));
            if (x < cols - 1) maxDiff = Math.max(maxDiff, Math.abs(h - terrainHeight[idx + 1]));
            if (y > 0) maxDiff = Math.max(maxDiff, Math.abs(h - terrainHeight[idx - cols]));
            if (y < rows - 1) maxDiff = Math.max(maxDiff, Math.abs(h - terrainHeight[idx + cols]));

            if (maxDiff > 0.08) {
                terrainType[idx] = 3;
            }
        }
    }

    // Pre-compute creep detail noise
    noiseTexture1 = generateNoiseTexture(0.3, 0, cols, rows);
    noiseTexture2 = generateNoiseTexture(0.12, 100, cols, rows);
    noiseTexture3 = generateNoiseTexture(0.6, 200, cols, rows);
    veinTexture = generateNoiseTexture(0.2, 50, cols, rows);

    // Random start corner
    const corner = Math.floor(Math.random() * 4);
    switch (corner) {
        case 0: startCorner = { x: 0, y: 0, dirX: 1, dirY: 1 }; break;
        case 1: startCorner = { x: cols - 1, y: 0, dirX: -1, dirY: 1 }; break;
        case 2: startCorner = { x: 0, y: rows - 1, dirX: 1, dirY: -1 }; break;
        case 3: startCorner = { x: cols - 1, y: rows - 1, dirX: -1, dirY: -1 }; break;
    }

    // Find valid starting position (not water or cliff)
    let seedX = startCorner.x, seedY = startCorner.y;
    const margin = Math.floor(cols * 0.1);
    const searchRangeX = startCorner.dirX === 1 ? [0, margin] : [cols - margin, cols];
    const searchRangeY = startCorner.dirY === 1 ? [0, margin] : [rows - margin, rows];

    let found = false;
    for (let sy = searchRangeY[0]; sy < searchRangeY[1] && !found; sy++) {
        for (let sx = searchRangeX[0]; sx < searchRangeX[1] && !found; sx++) {
            const sidx = sy * cols + sx;
            if (terrainType[sidx] <= 2) {
                seedX = sx;
                seedY = sy;
                found = true;
            }
        }
    }

    // Place initial hatchery and seed creep
    buildings.push({ x: seedX, y: seedY, type: 'hatchery', pulse: 0 });
    const seedIdx = seedY * cols + seedX;
    creepGrid[seedIdx] = 1;
    creepAge[seedIdx] = 50;
    activeEdges.add(seedIdx);
    creepCount++;

    // Spawn resources (not on water/cliffs)
    const numMinerals = Math.max(15, Math.floor(cols * rows * 0.0006));
    const numVespene = Math.max(8, Math.floor(cols * rows * 0.0003));

    for (let i = 0; i < numMinerals; i++) {
        let cx, cy, attempts = 0;
        do {
            cx = Math.floor(Math.random() * cols);
            cy = Math.floor(Math.random() * rows);
            attempts++;
        } while ((terrainType[cy * cols + cx] > 2 || creepGrid[cy * cols + cx]) && attempts < 100);
        if (attempts < 100) {
            minerals.push({ x: cx, y: cy, radius: 2 + Math.random() * 3, depleted: false });
        }
    }

    for (let i = 0; i < numVespene; i++) {
        let cx, cy, attempts = 0;
        do {
            cx = Math.floor(Math.random() * cols);
            cy = Math.floor(Math.random() * rows);
            attempts++;
        } while ((terrainType[cy * cols + cx] > 2 || creepGrid[cy * cols + cx]) && attempts < 100);
        if (attempts < 100) {
            vespene.push({ x: cx, y: cy, radius: 3 + Math.random() * 2, depleted: false });
        }
    }

    // Initial ripple
    ripples.push({
        x: seedX * cellSize,
        y: seedY * cellSize,
        radius: 0,
        maxRadius: 150,
        speed: 0.3,
        strength: 1
    });
}

function maybeSpawnHatcheryNear(tileX, tileY) {
    if (mineralsGathered < HATCHERY_MINERAL_COST || vespeneGathered < HATCHERY_VESPENE_COST) return;
    if (Math.random() > HATCHERY_SPAWN_CHANCE) return;

    const candidates = [];
    const radius = 4;

    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const x = tileX + dx;
            const y = tileY + dy;
            if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
            const idx = y * cols + x;

            if (terrainType[idx] <= 2 && creepGrid[idx]) {
                candidates.push({ x, y });
            }
        }
    }

    if (candidates.length === 0) return;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    buildings.push({ x: chosen.x, y: chosen.y, type: 'hatchery', pulse: 0 });

    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const x = chosen.x + dx;
            const y = chosen.y + dy;
            if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
            const idx = y * cols + x;
            if (terrainType[idx] <= 2) {
                if (!creepGrid[idx]) {
                    creepGrid[idx] = 1;
                    creepAge[idx] = 20;
                    activeEdges.add(idx);
                    creepCount++;
                } else {
                    creepAge[idx] = Math.max(creepAge[idx], 20);
                }
            }
        }
    }

    mineralsGathered -= HATCHERY_MINERAL_COST;
    vespeneGathered -= HATCHERY_VESPENE_COST;
}

function checkResource(idx, x, y) {
    const mineralRadiusSq = 25;
    const vespeneRadiusSq = 36;

    for (let min of minerals) {
        if (!min.depleted) {
            const dx = x - min.x;
            const dy = y - min.y;
            if (dx * dx + dy * dy < mineralRadiusSq) {
                min.depleted = true;
                resourceBoost = Math.min(3.0, resourceBoost + 0.5);
                mineralsGathered += 1;
                buildings.push({ x: min.x, y: min.y, type: 'mineralpatch', pulse: 0 });
                maybeSpawnHatcheryNear(min.x, min.y);
                return { type: 'mineral', boost: 2.0 };
            }
        }
    }
    for (let ves of vespene) {
        if (!ves.depleted) {
            const dx = x - ves.x;
            const dy = y - ves.y;
            if (dx * dx + dy * dy < vespeneRadiusSq) {
                ves.depleted = true;
                resourceBoost = Math.min(3.0, resourceBoost + 1.0);
                vespeneGathered += 1;
                buildings.push({ x: ves.x, y: ves.y, type: 'extractor', pulse: 0 });
                maybeSpawnHatcheryNear(ves.x, ves.y);
                return { type: 'vespene', boost: 3.0 };
            }
        }
    }
    return null;
}

function spawnRipple() {
    if (ripples.length >= 8 || buildings.length === 0) return;

    const building = buildings[Math.floor(Math.random() * buildings.length)];
    ripples.push({
        x: building.x * cellSize,
        y: building.y * cellSize,
        radius: 0,
        maxRadius: 100 + Math.random() * 100,
        speed: 0.2 + Math.random() * 0.2,
        strength: 0.8 + Math.random() * 0.2
    });
}

function updateRipples() {
    for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].radius += ripples[i].speed;
        if (ripples[i].radius > ripples[i].maxRadius) {
            ripples.splice(i, 1);
        }
    }
    for (let b of buildings) {
        b.pulse += 0.05;
    }
}

function spreadCreep() {
    if (isSaturated) return;

    const newEdges = new Set();
    const toRemove = [];
    const currentBoost = resourceBoost;

    for (const idx of activeEdges) {
        const x = idx % cols;
        const y = Math.floor(idx / cols);

        let hasEmptyNeighbor = false;

        const neighbors = [
            { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
            { dx: -1, dy: 0 },                      { dx: 1, dy: 0 },
            { dx: -1, dy: 1 },  { dx: 0, dy: 1 },   { dx: 1, dy: 1 }
        ];

        for (const { dx, dy } of neighbors) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;

            const nidx = ny * cols + nx;

            if (creepGrid[nidx] === 0) {
                hasEmptyNeighbor = true;

                const typeMod = terrainSpreadMods[terrainType[nidx]] || 0;
                const height = terrainHeight[nidx];
                const heightMod = 1 - height * 0.5;

                const awayX = dx === startCorner.dirX;
                const awayY = dy === startCorner.dirY;
                let dirMod = 1;
                if (awayX && awayY) dirMod = 4;
                else if (awayX || awayY) dirMod = 2.5;

                const res = checkResource(nidx, nx, ny);
                const resMod = res ? res.boost : 1;

                const noiseVal = noiseTexture1[nidx];
                const noiseMod = noiseVal > 0.75 ? 1.5 : 1;

                const spreadChance = 0.002 * currentBoost * heightMod * typeMod * dirMod * resMod * noiseMod;

                if (Math.random() < spreadChance) {
                    creepGrid[nidx] = 1;
                    creepAge[nidx] = 1;
                    newEdges.add(nidx);
                    creepCount++;
                }
            }
        }

        creepAge[idx] = Math.min(100, creepAge[idx] + 0.2);

        if (!hasEmptyNeighbor) {
            toRemove.push(idx);
        }
    }

    for (const idx of toRemove) {
        activeEdges.delete(idx);
    }
    for (const idx of newEdges) {
        activeEdges.add(idx);
    }

    if (creepCount >= totalVisibleCells * 0.98) {
        isSaturated = true;
    }
}