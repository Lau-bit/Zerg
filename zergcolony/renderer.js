// renderer.js - Optimized with ImageData
let imageData, pixels;

function initImageData() {
    if (width > 0 && height > 0) {
        imageData = ctx.createImageData(width, height);
        pixels = imageData.data;
    }
}

// Call after resize
function ensureImageData() {
    if (!imageData || imageData.width !== width || imageData.height !== height) {
        initImageData();
    }
}

// Pre-computed water animation LUT (avoid sin/cos per pixel)
const WATER_LUT_SIZE = 256;
const waterWaveLUT = new Float32Array(WATER_LUT_SIZE);
for (let i = 0; i < WATER_LUT_SIZE; i++) {
    waterWaveLUT[i] = Math.sin(i * Math.PI * 2 / WATER_LUT_SIZE) * 0.15;
}

function render(time) {
    if (width <= 0 || height <= 0) return;
    ensureImageData();

    // Pre-calculate time-based values once
    const waveTime1 = time * 0.0003;
    const waveTime2 = time * 0.0004;
    const pulseTime = time * 0.0008;

    // Light direction
    const lightDirX = -0.6;
    const lightDirY = -1.0;

    // Pre-calculate ripple data
    const rippleData = ripples.map(r => ({
        x: r.x, y: r.y, radius: r.radius,
        fade: 1 - (r.radius / r.maxRadius),
        strength: r.strength
    }));

    // Render terrain to ImageData
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const idx = cy * cols + cx;
            const type = terrainType[idx];
            const tc = terrainColors[type];

            const h = terrainHeight[idx];
            const b = biomeNoise[idx];

            // Calculate shading
            const hL = cx > 0 ? terrainHeight[idx - 1] : h;
            const hR = cx < cols - 1 ? terrainHeight[idx + 1] : h;
            const hU = cy > 0 ? terrainHeight[idx - cols] : h;
            const hD = cy < rows - 1 ? terrainHeight[idx + cols] : h;

            const dxh = hL - hR;
            const dyh = hU - hD;
            const len = Math.sqrt(dxh * dxh + dyh * dyh) || 1;
            const nx = dxh / len;
            const ny = dyh / len;

            let diffuse = (nx * lightDirX + ny * lightDirY) * 0.8 + 0.8;
            const heightShade = 0.85 + (h - 0.5) * 0.4;
            const micro = 0.95 + (b - 0.5) * 0.1;

            let shade = diffuse * heightShade * micro;

            let r, g, bl;

            if (type === 4) {
                // Water - static
                const depthFactor = 0.8 + h * 0.4; // Shallower = lighter
                shade = depthFactor;
                
                r = Math.min(255, (tc.r * shade) | 0);
                g = Math.min(255, (tc.g * shade) | 0);
                bl = Math.min(255, (tc.b * shade) | 0);
            } else {
                if (type === 3) {
                    shade *= 0.7; // Cliffs darker
                }

                shade = Math.max(0.3, Math.min(1.4, shade));

                r = Math.max(0, Math.min(255, (tc.r * shade) | 0));
                g = Math.max(0, Math.min(255, (tc.g * shade) | 0));
                bl = Math.max(0, Math.min(255, (tc.b * shade) | 0));
            }

            // Fill cell in ImageData
            const startX = cx * cellSize;
            const startY = cy * cellSize;
            const endX = Math.min(startX + cellSize, width);
            const endY = Math.min(startY + cellSize, height);

            for (let py = startY; py < endY; py++) {
                const rowOffset = py * width * 4;
                for (let px = startX; px < endX; px++) {
                    const pi = rowOffset + px * 4;
                    pixels[pi] = r;
                    pixels[pi + 1] = g;
                    pixels[pi + 2] = bl;
                    pixels[pi + 3] = 255;
                }
            }
        }
    }

    // Render creep over terrain
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            const idx = cy * cols + cx;
            if (creepGrid[idx] === 0) continue;

            const age = creepAge[idx];
            const ageFactor = Math.min(1, age / 50);

            const n1 = noiseTexture1[idx];
            const n2 = noiseTexture2[idx];
            const n3 = noiseTexture3[idx];
            const vn = veinTexture[idx];

            const isVein = vn > 0.75 && n3 > 0.4;
            const bumpiness = n1 * 0.4 + n2 * 0.3 + n3 * 0.3;

            // Edge detection
            const up = cy > 0 ? creepGrid[idx - cols] : 0;
            const down = cy < rows - 1 ? creepGrid[idx + cols] : 0;
            const left = cx > 0 ? creepGrid[idx - 1] : 0;
            const right = cx < cols - 1 ? creepGrid[idx + 1] : 0;
            const isEdge = !up || !down || !left || !right;

            const cellCenterX = cx * cellSize + cellSize / 2;
            const cellCenterY = cy * cellSize + cellSize / 2;

            // Ripple effect (simplified)
            let rippleEffect = 0;
            for (const rData of rippleData) {
                const dx = cellCenterX - rData.x;
                const dy = cellCenterY - rData.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const distFromRing = Math.abs(dist - rData.radius);

                if (distFromRing < 25) {
                    const ringStrength = 1 - (distFromRing / 25);
                    rippleEffect += ringStrength * rData.fade * rData.strength * 0.5;
                }
            }

            // Global wave (simplified with LUT)
            const waveIdx = ((cellCenterX * 0.015 + waveTime1) * 40) & (WATER_LUT_SIZE - 1);
            const waveIdx2 = ((cellCenterY * 0.012 + waveTime2) * 40) & (WATER_LUT_SIZE - 1);
            const globalWave = waterWaveLUT[waveIdx] * waterWaveLUT[waveIdx2] * 0.5;
            rippleEffect = Math.min(1, rippleEffect + globalWave);

            const heightMod = 1 - terrainHeight[idx] * 0.3;

            let r, g, bl;

            if (isEdge) {
                const edgeGloss = (n3 > 0.6 ? 1.2 : 0.8) + rippleEffect * 0.4;
                r = (creepDark.r * edgeGloss * heightMod) | 0;
                g = (creepDark.g * edgeGloss * heightMod) | 0;
                bl = (creepDark.b * edgeGloss * heightMod) | 0;
            } else if (isVein) {
                const pulseIdx = ((pulseTime + cellCenterX * 0.1) * 40) & (WATER_LUT_SIZE - 1);
                const pulse = 0.8 + 0.2 * waterWaveLUT[pulseIdx] / 0.15;
                const veinRipple = 1 + rippleEffect * 0.3;
                r = (veinColor.r * pulse * veinRipple * heightMod) | 0;
                g = (veinColor.g * pulse * veinRipple * heightMod) | 0;
                bl = (veinColor.b * pulse * veinRipple * heightMod) | 0;
            } else {
                const blend = bumpiness * ageFactor;
                const rippleHighlight = 1 + rippleEffect * 0.5;

                r = ((creepColor.r + (creepHighlight.r - creepColor.r) * blend) * rippleHighlight * heightMod) | 0;
                g = ((creepColor.g + (creepHighlight.g - creepColor.g) * blend) * rippleHighlight * heightMod) | 0;
                bl = ((creepColor.b + (creepHighlight.b - creepColor.b) * blend) * rippleHighlight * heightMod) | 0;

                if (n1 > 0.7) { r = (r * 1.15) | 0; g = (g * 1.15) | 0; bl = (bl * 1.15) | 0; }
                if (n2 < 0.2) { r = (r * 0.7) | 0; g = (g * 0.7) | 0; bl = (bl * 0.7) | 0; }
            }

            r = Math.max(0, Math.min(255, r));
            g = Math.max(0, Math.min(255, g));
            bl = Math.max(0, Math.min(255, bl));

            // Fill cell
            const startX = cx * cellSize;
            const startY = cy * cellSize;
            const endX = Math.min(startX + cellSize, width);
            const endY = Math.min(startY + cellSize, height);

            for (let py = startY; py < endY; py++) {
                const rowOffset = py * width * 4;
                for (let px = startX; px < endX; px++) {
                    const pi = rowOffset + px * 4;
                    pixels[pi] = r;
                    pixels[pi + 1] = g;
                    pixels[pi + 2] = bl;
                    pixels[pi + 3] = 255;
                }
            }
        }
    }

    // Put ImageData to canvas
    ctx.putImageData(imageData, 0, 0);

    // Draw resources and buildings on top (these are small, so fillRect is fine)
    renderOverlays(time);
}

function renderOverlays(time) {
    // Render resources
    for (const min of minerals) {
        if (min.depleted) continue;
        const centerX = (min.x + 0.5) * cellSize;
        const centerY = (min.y + 0.5) * cellSize;
        const baseSize = min.radius * cellSize * 0.4;

        const shimmer = 0.15 + 0.15 * Math.sin(time * 0.006 + min.x * 0.7 + min.y * 0.3);
        const mr = Math.min(255, mineralColor.r * (1 + shimmer));
        const mg = Math.min(255, mineralColor.g * (1 + shimmer));
        const mb = Math.min(255, mineralColor.b * (1 + shimmer));

        const blocks = [
            { ox: -baseSize * 0.6, oy: -baseSize * 0.2, s: 1.0 },
            { ox: baseSize * 0.1,  oy: -baseSize * 0.4, s: 0.9 },
            { ox: -baseSize * 0.2, oy: baseSize * 0.2,  s: 0.85 },
            { ox: baseSize * 0.4,  oy: baseSize * 0.1,  s: 0.7 }
        ];

        for (const bl of blocks) {
            const shade = 0.85 + bl.s * 0.3;
            ctx.fillStyle = `rgb(${(mr * shade) | 0}, ${(mg * shade) | 0}, ${(mb * shade) | 0})`;
            ctx.fillRect(centerX + bl.ox, centerY + bl.oy, baseSize * bl.s, baseSize * bl.s * 0.85);
        }
    }

    for (const ves of vespene) {
        if (ves.depleted) continue;
        const centerX = (ves.x + 0.5) * cellSize;
        const centerY = (ves.y + 0.5) * cellSize;
        const baseSize = ves.radius * cellSize * 0.35;

        const glow = 0.2 + 0.2 * Math.sin(time * 0.004 + ves.x * 0.4 + ves.y * 0.6);
        const gr = Math.min(255, vespeneColor.r * (1 + glow * 0.6));
        const gg = Math.min(255, vespeneColor.g * (1 + glow));
        const gb = Math.min(255, vespeneColor.b * (1 + glow * 0.4));

        const slats = 3;
        for (let i = 0; i < slats; i++) {
            const t = (i - (slats - 1) / 2);
            const shade = 0.9 + i * 0.1;
            ctx.fillStyle = `rgb(${(gr * shade) | 0}, ${(gg * shade) | 0}, ${(gb * shade) | 0})`;

            const w = baseSize * 0.7;
            const h = baseSize * 1.6;
            const ox = t * (w + baseSize * 0.2);
            ctx.fillRect(centerX + ox - w / 2, centerY - h / 2, w, h);
        }
    }

    // Render buildings
    for (const b of buildings) {
        const centerX = (b.x + 0.5) * cellSize;
        const centerY = (b.y + 0.5) * cellSize;
        const pulse = Math.sin(b.pulse) * 0.2 + 1;

        let baseColor, sizeMultiplier;
        if (b.type === 'hatchery') {
            baseColor = { r: 130, g: 70, b: 130 };
            sizeMultiplier = 2.4;
        } else if (b.type === 'extractor') {
            baseColor = { r: 70, g: 150, b: 190 };
            sizeMultiplier = 1.7;
        } else {
            baseColor = { r: 180, g: 180, b: 130 };
            sizeMultiplier = 1.4;
        }

        const size = cellSize * sizeMultiplier * pulse;
        const half = size / 2;

        ctx.fillStyle = `rgb(${(baseColor.r * 0.7) | 0}, ${(baseColor.g * 0.7) | 0}, ${(baseColor.b * 0.7) | 0})`;
        ctx.fillRect(centerX - half, centerY - half, size, size);

        const innerSize = size * 0.7;
        const innerHalf = innerSize / 2;
        ctx.fillStyle = `rgb(${Math.min(255, (baseColor.r * 1.1) | 0)}, ${Math.min(255, (baseColor.g * 1.1) | 0)}, ${Math.min(255, (baseColor.b * 1.1) | 0)})`;
        ctx.fillRect(centerX - innerHalf, centerY - innerHalf, innerSize, innerSize);

        if (b.type === 'hatchery') {
            const coreSize = innerSize * 0.4;
            const coreHalf = coreSize / 2;
            ctx.fillStyle = `rgb(${Math.min(255, baseColor.r + 40)}, ${Math.min(255, baseColor.g + 20)}, ${Math.min(255, baseColor.b + 60)})`;
            ctx.fillRect(centerX - coreHalf, centerY - coreHalf, coreSize, coreSize);
        }
    }
}

// Animation loop
let lastSpread = 0;
let lastRipple = 0;
const spreadInterval = 120;
const rippleInterval = 1500;
const renderInterval = 33; // Cap at ~30fps for performance

function animate(time) {
    if (!isSaturated) {
        if (time - lastSpread > spreadInterval) {
            spreadCreep();
            lastSpread = time;
        }

        if (time - lastRipple > rippleInterval) {
            spawnRipple();
            lastRipple = time;
        }
    }

    updateRipples();

    if (isSaturated && ripples.length === 0) {
        initGrid();
        initImageData();
    }

    render(time);

    requestAnimationFrame(animate);
}

initGrid();
initImageData();
requestAnimationFrame(animate);

window.addEventListener('resize', () => {
    resize();
    initGrid();
    initImageData();
});