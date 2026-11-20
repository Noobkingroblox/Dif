/**
 * Zero-dependency 3D Interactive Volumetric & Slice Renderer
 * Renders the 3D [0, L]^3 diffusion chamber, volumetric concentration cloud,
 * orthogonal slice planes, flux vectors, Center of Mass, and 3D numeric probe.
 */

// Perceptually uniform scientific colormaps (RGB 0..255)
const COLORMAPS = {
  thermal: [
    [13, 18, 43],
    [32, 68, 128],
    [34, 148, 168],
    [120, 206, 134],
    [245, 214, 72],
    [252, 118, 48],
    [255, 244, 214],
  ],
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
  ocean: [
    [12, 34, 64],
    [20, 92, 142],
    [36, 168, 198],
    [126, 224, 222],
    [240, 250, 255],
  ],
};

export function sampleColormap(t, name = 'thermal') {
  const stops = COLORMAPS[name] || COLORMAPS.thermal;
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = stops[idx];
  const b = stops[idx + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * frac),
    Math.round(a[1] + (b[1] - a[1]) * frac),
    Math.round(a[2] + (b[2] - a[2]) * frac),
  ];
}

export class Renderer3D {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Camera spherical coordinates around box center (0, 0, 0)
    this.yaw = options.yaw ?? 0.68;
    this.pitch = options.pitch ?? 0.36;
    this.distance = options.distance ?? 3.15;

    // Display options
    this.viewMode = 'hybrid'; // 'volume' | 'slices' | 'hybrid'
    this.colormap = 'thermal';
    this.showFluxVectors = true;
    this.showOverlays = true;
    this.threshold = 0.04;
    this.opacityScale = 1.0;

    // Interaction state
    this._dragging = false;
    this._lastX = 0;
    this._lastY = 0;

    // Reusable depth-sort buffer for voxels
    this._drawList = [];

    this._bindEvents();
  }

  _bindEvents() {
    const c = this.canvas;
    c.style.cursor = 'grab';
    c.style.touchAction = 'none';
    const activePointers = new Map();
    let lastPinchDist = null;

    c.addEventListener('pointerdown', (e) => {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture(e.pointerId);
      if (activePointers.size === 1) {
        this._dragging = true;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        c.style.cursor = 'grabbing';
      } else {
        this._dragging = false;
        lastPinchDist = null;
      }
    });

    c.addEventListener('pointermove', (e) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (lastPinchDist !== null && dist > 5) {
          const factor = lastPinchDist / dist;
          this.distance = Math.max(1.8, Math.min(6.5, this.distance * factor));
        }
        lastPinchDist = dist;
        return;
      }

      if (!this._dragging) return;
      const dx = e.clientX - this._lastX;
      const dy = e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      this.yaw -= dx * 0.008;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dy * 0.008));
    });

    const endDrag = (e) => {
      activePointers.delete(e.pointerId);
      lastPinchDist = null;
      if (activePointers.size === 0) {
        this._dragging = false;
        c.style.cursor = 'grab';
      }
    };
    c.addEventListener('pointerup', endDrag);
    c.addEventListener('pointercancel', endDrag);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.08 : 0.92;
      this.distance = Math.max(1.8, Math.min(6.5, this.distance * factor));
    }, { passive: false });

    c.addEventListener('dblclick', () => {
      this.yaw = 0.68;
      this.pitch = 0.36;
      this.distance = 3.15;
    });
  }

  /** Project 3D normalized coordinates in [-0.5, 0.5]^3 to 2D canvas space */
  project(x, y, z, width, height) {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);

    // Rotate around Y (yaw)
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    // Rotate around X (pitch)
    const y2 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;

    const camZ = z2 + this.distance;
    const fov = Math.min(width, height) * 1.18;
    const scale = fov / Math.max(0.25, camZ);
    return {
      sx: width * 0.48 + x1 * scale,
      sy: height * 0.52 - y2 * scale,
      depth: camZ,
      scale,
    };
  }

  _getThemeColors() {
    const isLight = document.documentElement.classList.contains('light');
    return isLight
      ? {
          bg: '#f6f8fb',
          grid: 'rgba(15, 23, 42, 0.10)',
          boxBack: 'rgba(15, 23, 42, 0.18)',
          boxFront: 'rgba(15, 23, 42, 0.42)',
          text: '#0f172a',
          muted: '#475569',
          pillBg: 'rgba(255, 255, 255, 0.90)',
          pillBorder: 'rgba(15, 23, 42, 0.18)',
          comColor: '#0284c7',
          probeColor: '#d97706',
          gravColor: '#dc2626',
          fluxColor: 'rgba(15, 23, 42, 0.48)',
        }
      : {
          bg: '#0b111b',
          grid: 'rgba(148, 163, 184, 0.11)',
          boxBack: 'rgba(148, 163, 184, 0.20)',
          boxFront: 'rgba(226, 232, 240, 0.44)',
          text: '#e2e8f0',
          muted: '#94a3b8',
          pillBg: 'rgba(15, 23, 42, 0.86)',
          pillBorder: 'rgba(148, 163, 184, 0.28)',
          comColor: '#38bdf8',
          probeColor: '#fbbf24',
          gravColor: '#f87171',
          fluxColor: 'rgba(226, 232, 240, 0.55)',
        };
  }

  render(solver, diag, probe) {
    const canvas = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width));
    const height = Math.max(260, Math.floor(rect.height));

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);

    const theme = this._getThemeColors();
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, width, height);

    // Subtle radial lab vignette
    const grad = ctx.createRadialGradient(
      width * 0.48, height * 0.5, 20,
      width * 0.48, height * 0.5, Math.max(width, height) * 0.65
    );
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.04)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    const refMax = Math.max(diag.maxC, diag.meanC * 2.5, 0.25);

    // 1. Draw floor grid & back edges of chamber
    this._drawChamber(ctx, solver, width, height, theme, 'back');

    // 2. Render concentration field
    if (this.viewMode === 'slices') {
      this._drawSlices(ctx, solver, probe, refMax, width, height);
    } else if (this.viewMode === 'volume') {
      this._drawVolume(ctx, solver, refMax, width, height, 1.0);
    } else {
      // Hybrid: translucent slices at probe + volumetric cloud
      this._drawSlices(ctx, solver, probe, refMax, width, height, 0.42);
      this._drawVolume(ctx, solver, refMax, width, height, 0.85);
    }

    // 3. Optional 3D flux vector field arrows
    if (this.showFluxVectors) {
      this._drawFluxVectors(ctx, solver, refMax, width, height, theme);
    }

    // 4. Front chamber edges & metric axis labels
    this._drawChamber(ctx, solver, width, height, theme, 'front');

    // 5. Informative 3D Overlays: COM, Probe, Gravity Vector, Colorbar
    if (this.showOverlays) {
      this._drawCenterOfMass(ctx, solver, diag, width, height, theme);
      this._drawProbeMarker(ctx, solver, probe, width, height, theme);
      this._drawGravityVector(ctx, solver, width, height, theme);
    }
    this._drawColorbar(ctx, refMax, width, height, theme);

    ctx.restore();
  }

  _drawChamber(ctx, solver, width, height, theme, pass) {
    const corners = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5],
      [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5],
      [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
      [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ];
    const proj = corners.map(([x, y, z]) => this.project(x, y, z, width, height));

    if (pass === 'back') {
      // Floor grid (y = -0.5)
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      const steps = 4;
      for (let s = 1; s < steps; s++) {
        const t = -0.5 + s / steps;
        const a = this.project(t, -0.5, -0.5, width, height);
        const b = this.project(t, -0.5, 0.5, width, height);
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();

        const c = this.project(-0.5, -0.5, t, width, height);
        const d = this.project(0.5, -0.5, t, width, height);
        ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
      }

      // Back edges
      ctx.strokeStyle = theme.boxBack;
      ctx.lineWidth = 1;
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      for (const [u, v] of edges) {
        ctx.beginPath();
        ctx.moveTo(proj[u].sx, proj[u].sy);
        ctx.lineTo(proj[v].sx, proj[v].sy);
        ctx.stroke();
      }
      return;
    }

    // Front pass: highlight origin axes & metric labels
    const L = solver.L;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';

    // X axis label
    const xEnd = this.project(0.58, -0.5, -0.5, width, height);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.fillText(`X (${L.toFixed(1)}m)`, xEnd.sx, xEnd.sy);

    // Y axis (height) label + mid tick
    const yTop = this.project(-0.58, 0.5, -0.5, width, height);
    const yMid = this.project(-0.58, 0.0, -0.5, width, height);
    const yBot = this.project(-0.58, -0.5, -0.5, width, height);
    ctx.textAlign = 'right';
    ctx.fillText(`Y ${L.toFixed(1)}m`, yTop.sx, yTop.sy);
    ctx.fillText(`${(L * 0.5).toFixed(2)}m`, yMid.sx, yMid.sy);
    ctx.fillText(`0.0m`, yBot.sx, yBot.sy);

    // Z axis label
    const zEnd = this.project(-0.5, -0.5, 0.60, width, height);
    ctx.textAlign = 'center';
    ctx.fillText(`Z (${L.toFixed(1)}m)`, zEnd.sx, zEnd.sy);
  }

  _drawVolume(ctx, solver, refMax, width, height, alphaMult) {
    const N = solver.N;
    const c = solver.c;
    const invN = 1 / N;
    const thresh = this.threshold;
    const list = this._drawList;
    list.length = 0;

    for (let k = 0; k < N; k++) {
      const nz = (k + 0.5) * invN - 0.5;
      const kOff = k * N * N;
      for (let j = 0; j < N; j++) {
        const ny = (j + 0.5) * invN - 0.5;
        const jOff = kOff + j * N;
        for (let i = 0; i < N; i++) {
          const val = c[jOff + i];
          const norm = val / refMax;
          if (norm < thresh) continue;
          const nx = (i + 0.5) * invN - 0.5;
          const p = this.project(nx, ny, nz, width, height);
          list.push({ sx: p.sx, sy: p.sy, depth: p.depth, scale: p.scale, norm });
        }
      }
    }

    // Back-to-front painter's sort
    list.sort((a, b) => b.depth - a.depth);

    const cellWorld = invN;
    for (let m = 0; m < list.length; m++) {
      const item = list[m];
      const t = Math.pow(Math.min(1, item.norm), 0.72);
      const [r, g, b] = sampleColormap(t, this.colormap);
      const alpha = Math.min(0.88, (0.08 + 0.68 * Math.pow(t, 1.35)) * this.opacityScale * alphaMult);
      const radius = Math.max(1.8, item.scale * cellWorld * (0.62 + 0.36 * t));

      ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(item.sx, item.sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawSlices(ctx, solver, probe, refMax, width, height, opacity = 0.85) {
    const N = solver.N;
    const invN = 1 / N;
    const quads = [];

    const addCellQuad = (pts3d, val) => {
      const norm = val / refMax;
      if (norm < 0.015) return;
      const p0 = this.project(pts3d[0][0], pts3d[0][1], pts3d[0][2], width, height);
      const p1 = this.project(pts3d[1][0], pts3d[1][1], pts3d[1][2], width, height);
      const p2 = this.project(pts3d[2][0], pts3d[2][1], pts3d[2][2], width, height);
      const p3 = this.project(pts3d[3][0], pts3d[3][1], pts3d[3][2], width, height);
      const depth = (p0.depth + p1.depth + p2.depth + p3.depth) * 0.25;
      quads.push({ p0, p1, p2, p3, depth, norm });
    };

    // XY slice at k = probe.k
    const zk = (probe.k + 0.5) * invN - 0.5;
    for (let j = 0; j < N; j++) {
      const y0 = j * invN - 0.5, y1 = (j + 1) * invN - 0.5;
      for (let i = 0; i < N; i++) {
        const x0 = i * invN - 0.5, x1 = (i + 1) * invN - 0.5;
        addCellQuad([[x0, y0, zk], [x1, y0, zk], [x1, y1, zk], [x0, y1, zk]], solver.c[solver.idx(i, j, probe.k)]);
      }
    }

    // XZ horizontal slice at j = probe.j
    const yj = (probe.j + 0.5) * invN - 0.5;
    for (let k = 0; k < N; k++) {
      const z0 = k * invN - 0.5, z1 = (k + 1) * invN - 0.5;
      for (let i = 0; i < N; i++) {
        const x0 = i * invN - 0.5, x1 = (i + 1) * invN - 0.5;
        addCellQuad([[x0, yj, z0], [x1, yj, z0], [x1, yj, z1], [x0, yj, z1]], solver.c[solver.idx(i, probe.j, k)]);
      }
    }

    quads.sort((a, b) => b.depth - a.depth);
    for (let q = 0; q < quads.length; q++) {
      const { p0, p1, p2, p3, norm } = quads[q];
      const t = Math.pow(Math.min(1, norm), 0.72);
      const [r, g, b] = sampleColormap(t, this.colormap);
      const a = Math.min(0.92, (0.18 + 0.75 * t) * opacity);
      ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(p0.sx, p0.sy);
      ctx.lineTo(p1.sx, p1.sy);
      ctx.lineTo(p2.sx, p2.sy);
      ctx.lineTo(p3.sx, p3.sy);
      ctx.closePath();
      ctx.fill();
    }
  }

  _drawFluxVectors(ctx, solver, refMax, width, height, theme) {
    const N = solver.N;
    const stride = Math.max(3, Math.floor(N / 4));
    ctx.strokeStyle = theme.fluxColor;
    ctx.fillStyle = theme.fluxColor;
    ctx.lineWidth = 1.15;

    for (let k = 2; k < N - 1; k += stride) {
      for (let j = 2; j < N - 1; j += stride) {
        for (let i = 2; i < N - 1; i += stride) {
          const info = solver.inspectVoxel(i, j, k);
          if (info.c < refMax * 0.06 || info.jNetMag < 1e-6) continue;

          const nx = (i + 0.5) / N - 0.5;
          const ny = (j + 0.5) / N - 0.5;
          const nz = (k + 0.5) / N - 0.5;

          // Normalize length smoothly using log/tanh scaling
          const len = 0.085 * Math.tanh(info.jNetMag / (refMax * Math.max(solver.driftSpeed, solver.D * 4, 0.05)));
          if (len < 0.015) continue;

          const ux = (info.jNet.x / info.jNetMag) * len;
          const uy = (info.jNet.y / info.jNetMag) * len;
          const uz = (info.jNet.z / info.jNetMag) * len;

          const p0 = this.project(nx, ny, nz, width, height);
          const p1 = this.project(nx + ux, ny + uy, nz + uz, width, height);

          ctx.beginPath();
          ctx.moveTo(p0.sx, p0.sy);
          ctx.lineTo(p1.sx, p1.sy);
          ctx.stroke();

          // Arrowhead
          const angle = Math.atan2(p1.sy - p0.sy, p1.sx - p0.sx);
          const ah = 4.5;
          ctx.beginPath();
          ctx.moveTo(p1.sx, p1.sy);
          ctx.lineTo(p1.sx - ah * Math.cos(angle - 0.5), p1.sy - ah * Math.sin(angle - 0.5));
          ctx.lineTo(p1.sx - ah * Math.cos(angle + 0.5), p1.sy - ah * Math.sin(angle + 0.5));
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  _drawCenterOfMass(ctx, solver, diag, width, height, theme) {
    const L = solver.L;
    const nx = diag.com.x / L - 0.5;
    const ny = diag.com.y / L - 0.5;
    const nz = diag.com.z / L - 0.5;

    const pCom = this.project(nx, ny, nz, width, height);
    const pFloor = this.project(nx, -0.5, nz, width, height);

    // Vertical drop line to floor
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = theme.comColor;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(pCom.sx, pCom.sy);
    ctx.lineTo(pFloor.sx, pFloor.sy);
    ctx.stroke();
    ctx.restore();

    // COM marker diamond
    ctx.fillStyle = theme.comColor;
    ctx.beginPath();
    ctx.arc(pCom.sx, pCom.sy, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Numeric pill
    this._drawPill(
      ctx,
      pCom.sx + 10,
      pCom.sy - 12,
      `COM y=${diag.com.y.toFixed(3)}m`,
      theme.comColor,
      theme
    );
  }

  _drawProbeMarker(ctx, solver, probe, width, height, theme) {
    const L = solver.L;
    const nx = probe.x / L - 0.5;
    const ny = probe.y / L - 0.5;
    const nz = probe.z / L - 0.5;

    const p = this.project(nx, ny, nz, width, height);
    const px = this.project(-0.5, ny, nz, width, height);
    const py = this.project(nx, -0.5, nz, width, height);

    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = theme.probeColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.sx, p.sy); ctx.lineTo(px.sx, px.sy);
    ctx.moveTo(p.sx, p.sy); ctx.lineTo(py.sx, py.sy);
    ctx.stroke();
    ctx.restore();

    // Crosshair ring
    ctx.strokeStyle = theme.probeColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 6, 0, Math.PI * 2);
    ctx.stroke();

    this._drawPill(
      ctx,
      p.sx + 10,
      p.sy + 14,
      `Probe c=${probe.c.toFixed(3)}`,
      theme.probeColor,
      theme
    );
  }

  _drawGravityVector(ctx, solver, width, height, theme) {
    const g = solver.g;
    const x = 34;
    const yCenter = 68;
    const maxLen = 34;
    const len = Math.min(maxLen, Math.abs(g) * 2.2);
    const dir = g >= 0 ? 1 : -1;

    ctx.save();
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'left';
    ctx.fillText('GRAVITY', 14, 22);

    ctx.fillStyle = theme.gravColor;
    ctx.fillText(`g = ${g.toFixed(2)} m/s²`, 14, 38);

    if (Math.abs(g) < 0.01) {
      ctx.fillStyle = theme.muted;
      ctx.fillText('Microgravity (0-G)', 14, 56);
      ctx.restore();
      return;
    }

    const yStart = yCenter - (dir * len) * 0.5;
    const yEnd = yCenter + (dir * len) * 0.5;

    ctx.strokeStyle = theme.gravColor;
    ctx.fillStyle = theme.gravColor;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, yStart);
    ctx.lineTo(x, yEnd);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(x, yEnd + dir * 5);
    ctx.lineTo(x - 5, yEnd - dir * 3);
    ctx.lineTo(x + 5, yEnd - dir * 3);
    ctx.closePath();
    ctx.fill();

    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = theme.muted;
    ctx.fillText(`v_g = ${solver.driftSpeed.toFixed(3)} m/s`, 48, yCenter + 4);
    ctx.restore();
  }

  _drawColorbar(ctx, refMax, width, height, theme) {
    const barW = 12;
    const barH = Math.min(180, height * 0.44);
    const x = width - 64;
    const y = (height - barH) * 0.5;

    // Draw gradient bar
    for (let py = 0; py < barH; py++) {
      const t = 1 - py / (barH - 1);
      const [r, g, b] = sampleColormap(t, this.colormap);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y + py, barW, 1.5);
    }

    ctx.strokeStyle = theme.pillBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, barW, barH);

    // Numeric ticks
    ctx.font = '10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const ticks = [1.0, 0.75, 0.5, 0.25, 0.0];
    for (const frac of ticks) {
      const ty = y + (1 - frac) * barH;
      const val = refMax * frac;
      ctx.fillText(val >= 10 ? val.toFixed(1) : val.toFixed(2), x + barW + 6, ty);
    }

    ctx.textAlign = 'center';
    ctx.fillText('mol/m³', x + barW * 0.5, y - 12);
  }

  _drawPill(ctx, x, y, text, accentColor, theme) {
    ctx.save();
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const w = ctx.measureText(text).width + 14;
    const h = 20;
    const px = Math.min(x, this.canvas.getBoundingClientRect().width - w - 8);
    const py = Math.max(8, y - h * 0.5);

    ctx.fillStyle = theme.pillBg;
    ctx.strokeStyle = theme.pillBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px, py, w, h, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.fillRect(px + 3, py + 4, 2.5, h - 8);

    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + 9, py + h * 0.5 + 0.5);
    ctx.restore();
  }
}
