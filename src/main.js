import { Diffusion3DSolver } from './solver.js';
import { Renderer3D } from './renderer3d.js';
import { drawVerticalProfileChart, drawTimeSeriesChart } from './charts.js';

const solver = new Diffusion3DSolver({
  N: 22,
  L: 1.0,
  D: 0.015,
  g: 9.81,
  mobility: 0.012,
});

const viewportCanvas = document.getElementById('viewport3d');
const profileCanvas = document.getElementById('profileChart');
const seriesCanvas = document.getElementById('seriesChart');
const renderer = new Renderer3D(viewportCanvas);

let running = true;
let simSpeed = 1.0;
const history = [];
const MAX_HISTORY = 240;

const probeCoords = {
  i: Math.floor(solver.N / 2),
  j: Math.floor(solver.N / 2),
  k: Math.floor(solver.N / 2),
};

// DOM elements
const els = {
  btnPlay: document.getElementById('btnPlay'),
  btnStep: document.getElementById('btnStep'),
  btnReset: document.getElementById('btnReset'),
  btnInject: document.getElementById('btnInject'),
  presetSelect: document.getElementById('presetSelect'),
  viewModeSelect: document.getElementById('viewModeSelect'),
  colormapSelect: document.getElementById('colormapSelect'),
  toggleFlux: document.getElementById('toggleFlux'),
  toggleOverlays: document.getElementById('toggleOverlays'),

  sliderD: document.getElementById('sliderD'),
  sliderG: document.getElementById('sliderG'),
  sliderMob: document.getElementById('sliderMob'),
  sliderSpeed: document.getElementById('sliderSpeed'),
  sliderProbeX: document.getElementById('sliderProbeX'),
  sliderProbeY: document.getElementById('sliderProbeY'),
  sliderProbeZ: document.getElementById('sliderProbeZ'),

  valD: document.getElementById('valD'),
  valG: document.getElementById('valG'),
  valMob: document.getElementById('valMob'),
  valSpeed: document.getElementById('valSpeed'),
  valProbePos: document.getElementById('valProbePos'),

  // Telemetry readouts
  numTime: document.getElementById('numTime'),
  numDt: document.getElementById('numDt'),
  numMass: document.getElementById('numMass'),
  numMassErr: document.getElementById('numMassErr'),
  numMaxC: document.getElementById('numMaxC'),
  numComY: document.getElementById('numComY'),
  numPeclet: document.getElementById('numPeclet'),
  numScaleH: document.getElementById('numScaleH'),
  numDrift: document.getElementById('numDrift'),
  numEqErr: document.getElementById('numEqErr'),
  numMixing: document.getElementById('numMixing'),
  numRegime: document.getElementById('numRegime'),

  // Probe readouts
  probeC: document.getElementById('probeC'),
  probeGrad: document.getElementById('probeGrad'),
  probeJDiff: document.getElementById('probeJDiff'),
  probeJGrav: document.getElementById('probeJGrav'),
  probeJNet: document.getElementById('probeJNet'),
};

function fmtNum(v, digits = 3) {
  if (!Number.isFinite(v)) return '∞';
  if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3)) {
    return v.toExponential(2);
  }
  return v.toFixed(digits);
}

function updateParamLabels() {
  els.valD.textContent = `${solver.D.toFixed(4)} m²/s`;
  els.valG.textContent = `${solver.g.toFixed(2)} m/s²`;
  els.valMob.textContent = `${solver.mobility.toFixed(3)} s`;
  els.valSpeed.textContent = `${simSpeed.toFixed(2)}×`;

  const h = solver.dx;
  const px = ((probeCoords.i + 0.5) * h).toFixed(2);
  const py = ((probeCoords.j + 0.5) * h).toFixed(2);
  const pz = ((probeCoords.k + 0.5) * h).toFixed(2);
  els.valProbePos.textContent = `(${px}, ${py}, ${pz}) m`;
}

function recordHistory(diag) {
  if (history.length === 0 || diag.time - history[history.length - 1].t >= 0.04) {
    history.push({
      t: diag.time,
      comY: diag.com.y,
      eqError: diag.eqError,
    });
    if (history.length > MAX_HISTORY) history.shift();
  }
}

function updateReadouts(diag, probe) {
  els.numTime.textContent = `${diag.time.toFixed(2)} s`;
  els.numDt.textContent = `${(diag.dt * 1000).toFixed(2)} ms (${diag.substeps}×)`;
  els.numMass.textContent = `${diag.totalMass.toFixed(5)} mol`;
  els.numMassErr.textContent = `${(diag.massError * 100).toExponential(1)}%`;
  els.numMaxC.textContent = `${diag.maxC.toFixed(3)} mol/m³`;
  els.numComY.textContent = `${diag.com.y.toFixed(3)} m (eq ${diag.eqComY.toFixed(3)})`;
  els.numPeclet.textContent = fmtNum(diag.peclet, 2);
  els.numScaleH.textContent = Number.isFinite(diag.scaleHeight) ? `${fmtNum(diag.scaleHeight, 3)} m` : '∞ (0-G)';
  els.numDrift.textContent = `${diag.driftSpeed.toFixed(4)} m/s`;
  els.numEqErr.textContent = `${(diag.eqError * 100).toFixed(2)}%`;
  els.numMixing.textContent = `${(diag.mixingIndex * 100).toFixed(1)}%`;

  if (diag.peclet < 0.25) {
    els.numRegime.textContent = 'Diffusion-Dominated (Pe ≪ 1)';
  } else if (diag.peclet > 4.0) {
    els.numRegime.textContent = 'Gravity-Dominated (Pe ≫ 1)';
  } else {
    els.numRegime.textContent = 'Balanced Drift-Diffusion (Pe ~ 1)';
  }

  // Probe voxel exact telemetry
  els.probeC.textContent = `${probe.c.toFixed(4)} mol/m³`;
  els.probeGrad.textContent = `${probe.grad.mag.toFixed(3)} mol/m⁴`;
  els.probeJDiff.textContent = `${probe.jDiff.y.toFixed(4)} mol/(m²·s)`;
  els.probeJGrav.textContent = `${probe.jGravY.toFixed(4)} mol/(m²·s)`;
  els.probeJNet.textContent = `${probe.jNet.y.toFixed(4)} mol/(m²·s)`;
}

function resetSimulation() {
  solver.reset(els.presetSelect.value);
  history.length = 0;
  const diag = solver.computeDiagnostics();
  recordHistory(diag);
  renderFrame(diag);
}

function renderFrame(existingDiag = null) {
  const diag = existingDiag || solver.computeDiagnostics();
  const probe = solver.inspectVoxel(probeCoords.i, probeCoords.j, probeCoords.k);
  renderer.render(solver, diag, probe);
  drawVerticalProfileChart(profileCanvas, solver, diag);
  drawTimeSeriesChart(seriesCanvas, history, solver.L, diag.eqComY);
  updateReadouts(diag, probe);
}

// Bind controls
els.btnPlay.addEventListener('click', () => {
  running = !running;
  els.btnPlay.textContent = running ? 'Pause' : 'Play';
  els.btnPlay.classList.toggle('is-paused', !running);
});

els.btnStep.addEventListener('click', () => {
  running = false;
  els.btnPlay.textContent = 'Play';
  solver.advance(0.05 * simSpeed);
  const diag = solver.computeDiagnostics();
  recordHistory(diag);
  renderFrame(diag);
});

els.btnReset.addEventListener('click', resetSimulation);
els.presetSelect.addEventListener('change', resetSimulation);

els.btnInject.addEventListener('click', () => {
  const nx = (probeCoords.i + 0.5) / solver.N;
  const ny = (probeCoords.j + 0.5) / solver.N;
  const nz = (probeCoords.k + 0.5) / solver.N;
  solver.addGaussian(nx, ny, nz, 0.09, 8.0);
  renderFrame();
});

els.viewModeSelect.addEventListener('change', (e) => {
  renderer.viewMode = e.target.value;
});
els.colormapSelect.addEventListener('change', (e) => {
  renderer.colormap = e.target.value;
});
els.toggleFlux.addEventListener('change', (e) => {
  renderer.showFluxVectors = e.target.checked;
});
els.toggleOverlays.addEventListener('change', (e) => {
  renderer.showOverlays = e.target.checked;
});

els.sliderD.addEventListener('input', (e) => {
  solver.D = parseFloat(e.target.value);
  updateParamLabels();
});
els.sliderG.addEventListener('input', (e) => {
  solver.g = parseFloat(e.target.value);
  updateParamLabels();
});
els.sliderMob.addEventListener('input', (e) => {
  solver.mobility = parseFloat(e.target.value);
  updateParamLabels();
});
els.sliderSpeed.addEventListener('input', (e) => {
  simSpeed = parseFloat(e.target.value);
  updateParamLabels();
});

const updateProbeSliders = () => {
  probeCoords.i = parseInt(els.sliderProbeX.value, 10);
  probeCoords.j = parseInt(els.sliderProbeY.value, 10);
  probeCoords.k = parseInt(els.sliderProbeZ.value, 10);
  updateParamLabels();
};
els.sliderProbeX.addEventListener('input', updateProbeSliders);
els.sliderProbeY.addEventListener('input', updateProbeSliders);
els.sliderProbeZ.addEventListener('input', updateProbeSliders);

// Planet gravity preset buttons
document.querySelectorAll('[data-gravity]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const gVal = parseFloat(btn.dataset.gravity);
    solver.g = gVal;
    els.sliderG.value = gVal;
    updateParamLabels();
  });
});

// Initialize slider bounds for grid resolution
[els.sliderProbeX, els.sliderProbeY, els.sliderProbeZ].forEach((s) => {
  s.max = String(solver.N - 1);
  s.value = String(Math.floor(solver.N / 2));
});
updateParamLabels();

// Main animation loop
let lastTs = performance.now();
function loop(now) {
  const realDt = Math.min(0.05, (now - lastTs) / 1000);
  lastTs = now;

  if (running) {
    solver.advance(realDt * simSpeed * 1.4);
    const diag = solver.computeDiagnostics();
    recordHistory(diag);
    renderFrame(diag);
  } else {
    renderFrame();
  }
  requestAnimationFrame(loop);
}

const initDiag = solver.computeDiagnostics();
recordHistory(initDiag);
renderFrame(initDiag);
requestAnimationFrame(loop);
