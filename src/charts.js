/**
 * Real-time Scientific Charts for 3D Diffusion with Gravity:
 *  1. Vertical Concentration Profile c(y) vs Analytical Boltzmann Equilibrium c_eq(y)
 *  2. Time-Series Telemetry: Center of Mass y_cm(t) & Equilibrium Error (%)
 */

function getChartTheme() {
  const isLight = document.documentElement.classList.contains('light');
  return isLight
    ? {
        bg: '#ffffff',
        grid: 'rgba(15, 23, 42, 0.08)',
        axis: 'rgba(15, 23, 42, 0.35)',
        text: '#0f172a',
        muted: '#475569',
        simLine: '#0284c7',
        simFill: 'rgba(2, 132, 199, 0.14)',
        eqLine: '#d97706',
        comLine: '#059669',
        errLine: '#dc2626',
      }
    : {
        bg: '#0f172a',
        grid: 'rgba(148, 163, 184, 0.10)',
        axis: 'rgba(148, 163, 184, 0.35)',
        text: '#e2e8f0',
        muted: '#94a3b8',
        simLine: '#38bdf8',
        simFill: 'rgba(56, 189, 248, 0.16)',
        eqLine: '#fbbf24',
        comLine: '#34d399',
        errLine: '#f87171',
      };
}

function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(180, Math.floor(rect.width));
  const h = Math.max(120, Math.floor(rect.height));
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

export function drawVerticalProfileChart(canvas, solver, diag) {
  const { ctx, w, h } = setupCanvas(canvas);
  const theme = getChartTheme();

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const pad = { top: 18, right: 16, bottom: 28, left: 42 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const N = solver.N;
  const L = solver.L;
  const sim = diag.verticalAvg;
  const eq = diag.eqProfile;

  let maxVal = 0.2;
  for (let j = 0; j < N; j++) {
    if (sim[j] > maxVal) maxVal = sim[j];
    if (eq[j] > maxVal) maxVal = eq[j];
  }
  maxVal *= 1.12;

  // Grid lines
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = pad.top + (plotH * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
    const gx = pad.left + (plotW * i) / 4;
    ctx.beginPath(); ctx.moveTo(gx, pad.top); ctx.lineTo(gx, pad.top + plotH); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  const xOf = (cVal) => pad.left + (cVal / maxVal) * plotW;
  const yOf = (yMeters) => pad.top + plotH - (yMeters / L) * plotH;

  // Fill under simulated vertical profile
  ctx.fillStyle = theme.simFill;
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(0));
  for (let j = 0; j < N; j++) {
    const y = ((j + 0.5) / N) * L;
    ctx.lineTo(xOf(sim[j]), yOf(y));
  }
  ctx.lineTo(xOf(0), yOf(L));
  ctx.closePath();
  ctx.fill();

  // Simulated curve c(y)
  ctx.strokeStyle = theme.simLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let j = 0; j < N; j++) {
    const y = ((j + 0.5) / N) * L;
    const px = xOf(sim[j]);
    const py = yOf(y);
    if (j === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Analytical Boltzmann equilibrium curve c_eq(y)
  ctx.save();
  ctx.setLineDash([5, 3]);
  ctx.strokeStyle = theme.eqLine;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  for (let j = 0; j < N; j++) {
    const y = ((j + 0.5) / N) * L;
    const px = xOf(eq[j]);
    const py = yOf(y);
    if (j === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();

  // Scale height H marker if inside domain
  if (Number.isFinite(diag.scaleHeight) && diag.scaleHeight > 0 && diag.scaleHeight < L) {
    const hy = yOf(diag.scaleHeight);
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = theme.comLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, hy);
    ctx.lineTo(pad.left + plotW, hy);
    ctx.stroke();
    ctx.fillStyle = theme.comLine;
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`H=${diag.scaleHeight.toFixed(2)}m`, pad.left + plotW - 3, hy - 4);
    ctx.restore();
  }

  // Axis ticks & labels
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = theme.muted;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${L.toFixed(1)}m`, pad.left - 5, pad.top);
  ctx.fillText(`${(L * 0.5).toFixed(1)}m`, pad.left - 5, pad.top + plotH * 0.5);
  ctx.fillText('0.0m', pad.left - 5, pad.top + plotH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('0', pad.left, pad.top + plotH + 5);
  ctx.fillText((maxVal * 0.5).toFixed(2), pad.left + plotW * 0.5, pad.top + plotH + 5);
  ctx.fillText(maxVal.toFixed(2), pad.left + plotW - 6, pad.top + plotH + 5);

  // Legend top right
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.simLine;
  ctx.fillText('— Sim c(y)', pad.left + plotW, 3);
  ctx.fillStyle = theme.eqLine;
  ctx.fillText('-- Boltzmann eq', pad.left + plotW - 76, 3);

  ctx.restore();
}

export function drawTimeSeriesChart(canvas, history, L, eqComY) {
  const { ctx, w, h } = setupCanvas(canvas);
  const theme = getChartTheme();

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const pad = { top: 18, right: 38, bottom: 26, left: 42 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  // Grid
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const gy = pad.top + (plotH * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(pad.left + plotW, gy); ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = theme.axis;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  if (history.length > 1) {
    const tMin = history[0].t;
    const tMax = Math.max(tMin + 1e-3, history[history.length - 1].t);
    const xOf = (t) => pad.left + ((t - tMin) / (tMax - tMin)) * plotW;
    const yComOf = (y) => pad.top + plotH - (Math.max(0, Math.min(L, y)) / L) * plotH;
    const yErrOf = (err) => pad.top + plotH - Math.min(1, err) * plotH;

    // Asymptote for theoretical equilibrium COM y_eq
    const yEqPx = yComOf(eqComY);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = theme.eqLine;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(pad.left, yEqPx);
    ctx.lineTo(pad.left + plotW, yEqPx);
    ctx.stroke();
    ctx.restore();

    // COM height y(t)
    ctx.strokeStyle = theme.comLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const px = xOf(history[i].t);
      const py = yComOf(history[i].comY);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Equilibrium L2 Error (0..100%)
    ctx.strokeStyle = theme.errLine;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const px = xOf(history[i].t);
      const py = yErrOf(history[i].eqError);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // X ticks
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = theme.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${tMin.toFixed(1)}s`, pad.left, pad.top + plotH + 5);
    ctx.fillText(`${((tMin + tMax) * 0.5).toFixed(1)}s`, pad.left + plotW * 0.5, pad.top + plotH + 5);
    ctx.fillText(`${tMax.toFixed(1)}s`, pad.left + plotW, pad.top + plotH + 5);
  }

  // Left axis labels (COM y)
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = theme.comLine;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${L.toFixed(1)}m`, pad.left - 5, pad.top);
  ctx.fillText(`${(L * 0.5).toFixed(1)}m`, pad.left - 5, pad.top + plotH * 0.5);
  ctx.fillText('0.0m', pad.left - 5, pad.top + plotH);

  // Right axis labels (Error %)
  ctx.fillStyle = theme.errLine;
  ctx.textAlign = 'left';
  ctx.fillText('100%', pad.left + plotW + 4, pad.top);
  ctx.fillText('50%', pad.left + plotW + 4, pad.top + plotH * 0.5);
  ctx.fillText('0%', pad.left + plotW + 4, pad.top + plotH);

  // Legend
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.comLine;
  ctx.fillText('— COM y(t)', pad.left + plotW - 68, 3);
  ctx.fillStyle = theme.errLine;
  ctx.fillText('— Eq Err', pad.left + plotW, 3);

  ctx.restore();
}
