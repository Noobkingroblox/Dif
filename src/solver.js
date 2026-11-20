/**
 * 3D Drift-Diffusion (Smoluchowski / Advection-Diffusion) Finite Volume Solver
 *
 * Governing PDE:
 *   dc/dt = D * laplacian(c) - div(v_d * c)
 *   v_d = (0, -v_g, 0),  v_g = mobility * g
 *
 * Spatial discretization:
 *   Conservative 3D Finite Volume Method (FVM) with Scharfetter-Gummel
 *   exponentially-fitted fluxes along the vertical (gravity) axis and
 *   central diffusive fluxes along horizontal axes.
 *
 * Boundary conditions:
 *   Zero total flux (J . n = 0) on all 6 faces of [0, L]^3.
 *
 * Properties:
 *   - Exact discrete mass conservation (to floating-point precision)
 *   - Strictly positivity-preserving for all Peclet numbers
 *   - Reproduces exact analytical Boltzmann steady state c(y) ~ exp(-y/H)
 *     where scale height H = D / v_g.
 */

export function bernoulli(x) {
  const ax = Math.abs(x);
  if (ax < 1e-4) {
    // Taylor series: x / (e^x - 1) = 1 - x/2 + x^2/12 - x^4/720
    return 1 - 0.5 * x + (x * x) / 12 - (x * x * x * x) / 720;
  }
  if (x > 700) return 0;
  if (x < -700) return -x;
  return x / Math.expm1(x);
}

export class Diffusion3DSolver {
  constructor(options = {}) {
    this.N = options.N || 22; // Grid cells per axis (22^3 = 10,648 voxels)
    this.L = options.L || 1.0; // Domain size in meters [0, L]^3
    this.D = options.D ?? 0.015; // Diffusion coefficient (m^2/s)
    this.g = options.g ?? 9.81; // Gravitational acceleration (m/s^2)
    this.mobility = options.mobility ?? 0.012; // Settling mobility beta = m_eff / gamma (s)

    const total = this.N * this.N * this.N;
    this.c = new Float64Array(total);
    this.cNext = new Float64Array(total);

    this.time = 0;
    this.stepCount = 0;
    this.lastDt = 0;
    this.lastSubsteps = 0;
    this.initialMass = 0;
    this.preset = 'top-drop';

    this.reset(this.preset);
  }

  idx(i, j, k) {
    return i + this.N * (j + this.N * k);
  }

  get dx() {
    return this.L / this.N;
  }

  /** Terminal gravitational drift speed v_g = mobility * g (m/s, downward) */
  get driftSpeed() {
    return this.mobility * this.g;
  }

  /** Barometric / sedimentation scale height H = D / v_g (m) */
  get scaleHeight() {
    const vg = this.driftSpeed;
    if (Math.abs(vg) < 1e-12) return Infinity;
    return this.D / Math.abs(vg);
  }

  /** Global Peclet number Pe = v_g * L / D = L / H */
  get pecletNumber() {
    if (this.D < 1e-12) return Infinity;
    return (Math.abs(this.driftSpeed) * this.L) / this.D;
  }

  /** Characteristic diffusion timescale tau_D = L^2 / (2D) */
  get diffusionTime() {
    if (this.D < 1e-12) return Infinity;
    return (this.L * this.L) / (2 * this.D);
  }

  /** Characteristic settling timescale tau_g = L / v_g */
  get settlingTime() {
    const vg = Math.abs(this.driftSpeed);
    if (vg < 1e-12) return Infinity;
    return this.L / vg;
  }

  /** Compute stable explicit timestep based on Scharfetter-Gummel diagonal bound */
  computeStableDt() {
    const h = this.dx;
    const h2 = h * h;
    const D = Math.max(this.D, 1e-9);
    const vg = this.driftSpeed;
    const P = (vg * h) / D;
    const verticalRate = (D / h2) * (bernoulli(P) + bernoulli(-P));
    const horizontalRate = (4 * D) / h2;
    const maxRate = horizontalRate + verticalRate;
    if (maxRate <= 1e-12) return 0.05;
    // Safety factor 0.45 ensures strict positivity (M-matrix condition)
    return 0.45 / maxRate;
  }

  /** Reset field to a named initial condition preset */
  reset(preset = this.preset) {
    this.preset = preset;
    this.c.fill(0);
    this.time = 0;
    this.stepCount = 0;
    this.lastSubsteps = 0;

    if (preset === 'top-drop') {
      this.addGaussian(0.5, 0.78, 0.5, 0.11, 10.0);
    } else if (preset === 'dual-plumes') {
      this.addGaussian(0.32, 0.78, 0.35, 0.095, 9.0);
      this.addGaussian(0.68, 0.52, 0.65, 0.095, 9.0);
    } else if (preset === 'uniform') {
      this.c.fill(1.0);
    } else if (preset === 'bottom-layer') {
      const N = this.N;
      const h = this.dx;
      for (let k = 0; k < N; k++) {
        for (let j = 0; j < N; j++) {
          const yNorm = (j + 0.5) / N;
          const val = yNorm < 0.22 ? 4.5 : 0.0;
          for (let i = 0; i < N; i++) {
            this.c[this.idx(i, j, k)] = val;
          }
        }
      }
      void h;
    } else if (preset === 'point-source') {
      this.addGaussian(0.5, 0.5, 0.5, 0.065, 18.0);
    } else {
      this.addGaussian(0.5, 0.78, 0.5, 0.11, 10.0);
    }

    this.initialMass = this.computeTotalMass();
  }

  /**
   * Inject a 3D Gaussian concentration packet at normalized coordinates (nx, ny, nz) in [0, 1]^3
   */
  addGaussian(nx, ny, nz, sigmaNorm = 0.1, peak = 8.0) {
    const N = this.N;
    const inv2s2 = 1 / (2 * sigmaNorm * sigmaNorm);
    for (let k = 0; k < N; k++) {
      const z = (k + 0.5) / N;
      const dz = z - nz;
      for (let j = 0; j < N; j++) {
        const y = (j + 0.5) / N;
        const dy = y - ny;
        for (let i = 0; i < N; i++) {
          const x = (i + 0.5) / N;
          const dx = x - nx;
          const r2 = dx * dx + dy * dy + dz * dz;
          const val = peak * Math.exp(-r2 * inv2s2);
          if (val > 1e-6) {
            this.c[this.idx(i, j, k)] += val;
          }
        }
      }
    }
    this.initialMass = this.computeTotalMass();
  }

  computeTotalMass() {
    const dV = this.dx * this.dx * this.dx;
    let sum = 0;
    const c = this.c;
    for (let n = 0; n < c.length; n++) sum += c[n];
    return sum * dV;
  }

  /** Advance simulation by targetDt seconds using automatic stable substepping */
  advance(targetDt, maxSubsteps = 40) {
    if (targetDt <= 0) return;
    const stableDt = this.computeStableDt();
    const substeps = Math.min(maxSubsteps, Math.max(1, Math.ceil(targetDt / stableDt)));
    const dt = Math.min(stableDt, targetDt / substeps);

    for (let s = 0; s < substeps; s++) {
      this.step(dt);
    }
    this.lastDt = dt;
    this.lastSubsteps = substeps;
  }

  /** Perform one explicit conservative FVM Scharfetter-Gummel step */
  step(dt) {
    const N = this.N;
    const h = this.dx;
    const h2 = h * h;
    const D = Math.max(this.D, 1e-9);
    const vg = this.driftSpeed;

    // Horizontal diffusion factor
    const rx = (D * dt) / h2;
    const rz = rx;

    // Vertical Scharfetter-Gummel coefficients
    // Flux J_{j+1/2} = -(D/h) * [ B(-P)*c_{j+1} - B(P)*c_j ], P = vg * h / D
    // Update: c_j^{n+1} = c_j + (D*dt/h^2) * [ B(-P)*c_{j+1} - (B(P)+B(-P))*c_j + B(P)*c_{j-1} ]
    const P = (vg * h) / D;
    const bPos = bernoulli(P); // flux weight from below (j-1 -> j)
    const bNeg = bernoulli(-P); // flux weight from above (j+1 -> j)
    const ryPos = ((D * dt) / h2) * bPos;
    const ryNeg = ((D * dt) / h2) * bNeg;

    const c = this.c;
    const out = this.cNext;
    const strideY = N;
    const strideZ = N * N;

    for (let k = 0; k < N; k++) {
      const kOff = k * strideZ;
      const hasZm = k > 0;
      const hasZp = k < N - 1;
      for (let j = 0; j < N; j++) {
        const jOff = kOff + j * strideY;
        const hasYm = j > 0;
        const hasYp = j < N - 1;
        for (let i = 0; i < N; i++) {
          const idx = jOff + i;
          const center = c[idx];
          let delta = 0;

          // X-axis zero-flux boundaries
          if (i > 0) delta += rx * (c[idx - 1] - center);
          if (i < N - 1) delta += rx * (c[idx + 1] - center);

          // Z-axis zero-flux boundaries
          if (hasZm) delta += rz * (c[idx - strideZ] - center);
          if (hasZp) delta += rz * (c[idx + strideZ] - center);

          // Y-axis Scharfetter-Gummel zero-total-flux boundaries
          if (hasYp) {
            // Flux across top face (j + 1/2): +ryNeg * c_{j+1} - ryPos * c_j
            delta += ryNeg * c[idx + strideY] - ryPos * center;
          }
          if (hasYm) {
            // Flux across bottom face (j - 1/2): +ryPos * c_{j-1} - ryNeg * c_j
            delta += ryPos * c[idx - strideY] - ryNeg * center;
          }

          const val = center + delta;
          out[idx] = val > 0 ? val : 0;
        }
      }
    }

    // Swap buffers
    this.c = out;
    this.cNext = c;
    this.time += dt;
    this.stepCount += 1;
  }

  /**
   * Exact discrete analytical Boltzmann equilibrium concentration at height layer j
   * matching the current total mass M.
   */
  computeEquilibriumProfile() {
    const N = this.N;
    const h = this.dx;
    const D = Math.max(this.D, 1e-9);
    const vg = this.driftSpeed;
    const P = (vg * h) / D;

    const totalMass = this.computeTotalMass();
    const meanC = totalMass / (this.L * this.L * this.L);
    const profile = new Float64Array(N);

    if (Math.abs(P) < 1e-7) {
      profile.fill(meanC);
      return profile;
    }

    // Shift exponent to prevent overflow for large |P|
    const maxExp = P > 0 ? 0 : -P * (N - 1);
    let weightSum = 0;
    for (let j = 0; j < N; j++) {
      const w = Math.exp(-P * j - maxExp);
      profile[j] = w;
      weightSum += w;
    }
    const scale = (meanC * N) / weightSum;
    for (let j = 0; j < N; j++) {
      profile[j] *= scale;
    }
    return profile;
  }

  /**
   * Compute comprehensive physics diagnostics and vertical profile
   */
  computeDiagnostics() {
    const N = this.N;
    const h = this.dx;
    const dV = h * h * h;
    const c = this.c;

    let sumC = 0;
    let maxC = 0;
    let maxI = 0, maxJ = 0, maxK = 0;
    let sumX = 0, sumY = 0, sumZ = 0;

    const verticalAvg = new Float64Array(N);
    const layerCells = N * N;

    for (let k = 0; k < N; k++) {
      const z = (k + 0.5) * h;
      const kOff = k * N * N;
      for (let j = 0; j < N; j++) {
        const y = (j + 0.5) * h;
        const jOff = kOff + j * N;
        let rowSum = 0;
        for (let i = 0; i < N; i++) {
          const val = c[jOff + i];
          rowSum += val;
          sumX += val * (i + 0.5) * h;
          if (val > maxC) {
            maxC = val;
            maxI = i;
            maxJ = j;
            maxK = k;
          }
        }
        verticalAvg[j] += rowSum;
        sumC += rowSum;
        sumY += rowSum * y;
        sumZ += rowSum * z;
      }
    }

    for (let j = 0; j < N; j++) {
      verticalAvg[j] /= layerCells;
    }

    const totalMass = sumC * dV;
    const meanC = sumC / (N * N * N);
    const com = sumC > 1e-12
      ? { x: sumX / sumC, y: sumY / sumC, z: sumZ / sumC }
      : { x: this.L * 0.5, y: this.L * 0.5, z: this.L * 0.5 };

    // Shannon spatial entropy normalized to [0, 1]
    let entropy = 0;
    if (sumC > 1e-12) {
      for (let n = 0; n < c.length; n++) {
        const p = c[n] / sumC;
        if (p > 1e-12) entropy -= p * Math.log(p);
      }
    }
    const maxEntropy = Math.log(N * N * N);
    const mixingIndex = maxEntropy > 0 ? entropy / maxEntropy : 0;

    // L2 distance from exact analytical Boltzmann equilibrium
    const eqProfile = this.computeEquilibriumProfile();
    let errSq = 0;
    let eqSq = 0;
    for (let k = 0; k < N; k++) {
      const kOff = k * N * N;
      for (let j = 0; j < N; j++) {
        const eqVal = eqProfile[j];
        const jOff = kOff + j * N;
        for (let i = 0; i < N; i++) {
          const diff = c[jOff + i] - eqVal;
          errSq += diff * diff;
          eqSq += eqVal * eqVal;
        }
      }
    }
    const eqError = eqSq > 1e-12 ? Math.sqrt(errSq / eqSq) : 0;

    // Mass conservation relative error
    const massError = this.initialMass > 1e-12
      ? (totalMass - this.initialMass) / this.initialMass
      : 0;

    // Theoretical equilibrium COM height
    let eqComY = 0;
    let eqSum = 0;
    for (let j = 0; j < N; j++) {
      eqComY += eqProfile[j] * (j + 0.5) * h;
      eqSum += eqProfile[j];
    }
    eqComY = eqSum > 1e-12 ? eqComY / eqSum : this.L * 0.5;

    return {
      time: this.time,
      dt: this.lastDt || this.computeStableDt(),
      substeps: this.lastSubsteps,
      stepCount: this.stepCount,
      totalMass,
      massError,
      meanC,
      maxC,
      maxPos: {
        x: (maxI + 0.5) * h,
        y: (maxJ + 0.5) * h,
        z: (maxK + 0.5) * h,
      },
      com,
      eqComY,
      mixingIndex,
      eqError,
      peclet: this.pecletNumber,
      scaleHeight: this.scaleHeight,
      driftSpeed: this.driftSpeed,
      diffusionTime: this.diffusionTime,
      settlingTime: this.settlingTime,
      verticalAvg,
      eqProfile,
    };
  }

  /**
   * Inspect local concentration, gradient, and fluxes at voxel (i, j, k)
   */
  inspectVoxel(i, j, k) {
    const N = this.N;
    const h = this.dx;
    const ci = Math.max(0, Math.min(N - 1, i));
    const cj = Math.max(0, Math.min(N - 1, j));
    const ck = Math.max(0, Math.min(N - 1, k));

    const val = this.c[this.idx(ci, cj, ck)];

    // Central differences (one-sided at boundaries)
    const dcdx = ci === 0
      ? (this.c[this.idx(1, cj, ck)] - val) / h
      : ci === N - 1
        ? (val - this.c[this.idx(N - 2, cj, ck)]) / h
        : (this.c[this.idx(ci + 1, cj, ck)] - this.c[this.idx(ci - 1, cj, ck)]) / (2 * h);

    const dcdy = cj === 0
      ? (this.c[this.idx(ci, 1, ck)] - val) / h
      : cj === N - 1
        ? (val - this.c[this.idx(ci, N - 2, ck)]) / h
        : (this.c[this.idx(ci, cj + 1, ck)] - this.c[this.idx(ci, cj - 1, ck)]) / (2 * h);

    const dcdz = ck === 0
      ? (this.c[this.idx(ci, cj, 1)] - val) / h
      : ck === N - 1
        ? (val - this.c[this.idx(ci, cj, N - 2)]) / h
        : (this.c[this.idx(ci, cj, ck + 1)] - this.c[this.idx(ci, cj, ck - 1)]) / (2 * h);

    const gradMag = Math.hypot(dcdx, dcdy, dcdz);

    // Diffusive flux J_diff = -D * grad(c)
    const jDiff = {
      x: -this.D * dcdx,
      y: -this.D * dcdy,
      z: -this.D * dcdz,
    };
    // Gravitational drift flux J_grav = (0, -v_g * c, 0)
    const jGravY = -this.driftSpeed * val;
    // Net flux J_net = J_diff + J_grav
    const jNet = {
      x: jDiff.x,
      y: jDiff.y + jGravY,
      z: jDiff.z,
    };

    return {
      i: ci, j: cj, k: ck,
      x: (ci + 0.5) * h,
      y: (cj + 0.5) * h,
      z: (ck + 0.5) * h,
      c: val,
      grad: { x: dcdx, y: dcdy, z: dcdz, mag: gradMag },
      jDiff,
      jGravY,
      jNet,
      jNetMag: Math.hypot(jNet.x, jNet.y, jNet.z),
    };
  }
}
