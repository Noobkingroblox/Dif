# 3D Diffusion with Gravity — Calculation Sandbox

An interactive 3D finite-volume simulation of the **3D Drift-Diffusion (Smoluchowski / Advection-Diffusion) Equation** under gravity, featuring real-time volumetric & tri-planar slice rendering, 3D flux vectors, an interactive voxel probe, and exact analytical Boltzmann equilibrium comparison.

## Governing Physics

The concentration field $c(x, y, z, t)$ in a closed cubic domain $[0, L]^3$ evolves according to:

$$\frac{\partial c}{\partial t} = D \nabla^2 c - \nabla \cdot (\mathbf{v}_d \, c), \qquad \mathbf{v}_d = (0, -v_g, 0), \quad v_g = \beta g$$

with zero-total-flux boundary conditions on all 6 walls:

$$\mathbf{J} \cdot \mathbf{n} = \left(-D \nabla c + \mathbf{v}_d c\right) \cdot \mathbf{n} = 0$$

### Key Dimensionless & Analytical Quantities
- **Barometric / Sedimentation Scale Height**: $H = D / v_g$
- **Global Péclet Number**: $\text{Pe} = v_g L / D = L / H$
- **Exact Steady-State Boltzmann Distribution**: $c_{\text{eq}}(y) \propto e^{-y/H}$

## Numerical Method
- **Conservative 3D Finite Volume Method (FVM)** on a $22 \times 22 \times 22$ grid (`Float64Array`).
- **Scharfetter–Gummel exponentially-fitted vertical fluxes** using the Bernoulli function $B(x) = x / (e^x - 1)$:
  - Strictly positivity-preserving for any Péclet number
  - Oscillation-free even in strongly gravity-dominated regimes ($\text{Pe} \gg 1$)
  - Machine-precision discrete mass conservation ($\Delta M / M_0 \sim 10^{-14}$)
  - Exact convergence to the discrete Boltzmann equilibrium

## Running Locally

Serve the repository directory with any static HTTP server (needed for ES modules):

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.
