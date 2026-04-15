/**
 * physics.js — Realistic Billiard Physics Engine
 *
 * Multi-phase physics model for pool/billiards simulation:
 *   Phase 1: Cue strike → initial velocity + spin
 *   Phase 2: Ball-to-ball collision with throw (CIT + SIT)
 *   Phase 3: Post-collision trajectory (rolling/sliding + swerve)
 *   Phase 4: Cushion rebound with spin effects
 *
 * References:
 *   - Dr. Dave Alciatore, Colorado State University (billiards.colostate.edu)
 *   - "The Physics of Pocket Billiards" — AIP / AAPT papers
 *   - Ball-to-ball μ ≈ 0.06 (Dr. Dave measured)
 *
 * All internal calculations use table-inches as the unit system
 * (consistent with app.js: TW=100", TH=50", BR=1.125").
 */
const BilliardPhysics = (function () {
  "use strict";

  // ================================================================
  //  PHYSICAL CONSTANTS
  // ================================================================
  const CONST = {
    // ---- Ball ----
    BALL_RADIUS: 1.125,          // inches (Aramith 57.2mm)
    BALL_MASS: 6.0,              // oz (~170g)
    BALL_DIAMETER: 2.25,         // inches

    // ---- Friction coefficients ----
    MU_BALL: 0.06,               // ball-to-ball sliding friction (Dr. Dave)
    MU_CLOTH_SLIDE: 0.20,        // ball-to-cloth sliding friction (Simonis 860)
    MU_CLOTH_ROLL: 0.010,        // ball-to-cloth rolling resistance
    MU_CUSHION: 0.14,            // ball-to-cushion friction

    // ---- Coefficients of restitution ----
    COR_BALL: 0.95,              // ball-to-ball (measured, AIP)
    COR_CUSHION: 0.75,           // ball-to-cushion (K-66 profile, typical)

    // ---- Squirt (cue ball deflection from English) ----
    // Low-deflection shaft: ~0.5° per full tip offset
    // Standard shaft: ~1.0-1.5° per full tip offset
    SQUIRT_FACTOR_LD: 0.5,       // degrees per tip-width of offset (low-deflection)
    SQUIRT_FACTOR_STD: 1.2,      // degrees per tip-width (standard shaft)

    // ---- Swerve ----
    // Gravitational acceleration in inches/s² (for friction force → deceleration)
    GRAVITY_IN: 386.09,          // 9.81 m/s² = 386.09 in/s²

    // ---- Speed model ----
    // Typical cue ball speeds (inches/second)
    SPEED_SOFT: 30,              // ~0.75 m/s — soft touch
    SPEED_MEDIUM: 80,            // ~2.0 m/s — normal shot
    SPEED_HARD: 200,             // ~5.0 m/s — power shot
    SPEED_BREAK: 350,            // ~9.0 m/s — break shot

    // ---- Table (passed in but defaults here) ----
    TABLE_W: 100,
    TABLE_H: 50,
  };

  // ================================================================
  //  UTILITY
  // ================================================================
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function vecLen(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y);
  }
  function vecNorm(v) {
    const d = vecLen(v);
    return d < 1e-12 ? { x: 0, y: 0 } : { x: v.x / d, y: v.y / d };
  }
  function vecDot(a, b) {
    return a.x * b.x + a.y * b.y;
  }
  function vecCross2D(a, b) {
    return a.x * b.y - a.y * b.x;
  }
  function vecScale(v, s) {
    return { x: v.x * s, y: v.y * s };
  }
  function vecAdd(a, b) {
    return { x: a.x + b.x, y: a.y + b.y };
  }
  function vecSub(a, b) {
    return { x: a.x - b.x, y: a.y - b.y };
  }
  function vecRot(v, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  }
  function degToRad(d) {
    return (d * Math.PI) / 180;
  }
  function radToDeg(r) {
    return (r * 180) / Math.PI;
  }

  // ================================================================
  //  PHASE 1: CUE STRIKE → INITIAL CONDITIONS
  // ================================================================
  /**
   * Calculate the squirt angle (cue ball deflection from aim line)
   * caused by an off-center tip hit (English).
   *
   * @param {number} tipSide - Normalized side offset: -1 (full left) to +1 (full right)
   * @param {string} shaftType - 'ld' (low-deflection) or 'std' (standard)
   * @returns {number} Squirt angle in radians (positive = deflects right of aim)
   */
  function calcSquirtAngle(tipSide, shaftType) {
    const factor =
      shaftType === "std" ? CONST.SQUIRT_FACTOR_STD : CONST.SQUIRT_FACTOR_LD;
    // Squirt deflects OPPOSITE to the English direction:
    // Left English (tipSide < 0) → CB squirts RIGHT (+)
    // Right English (tipSide > 0) → CB squirts LEFT (-)
    return degToRad(-tipSide * factor);
  }

  /**
   * Calculate the cue ball's initial angular velocity (spin) from the tip offset.
   *
   * The tip contact at offset (tipSide, tipHeight) from center creates:
   *   - tipHeight > 0 → topspin (ωy > 0 in our 2D model: forward roll)
   *   - tipHeight < 0 → backspin (ωy < 0: backward roll / draw)
   *   - tipSide  > 0 → right English (ωz > 0: clockwise when viewed from above)
   *   - tipSide  < 0 → left English (ωz < 0: counter-clockwise)
   *
   * Simplified: ω ∝ tipOffset × v / R  (from friction impulse)
   *
   * @param {number} tipSide - -1 to +1
   * @param {number} tipHeight - -1 (draw) to +1 (follow)
   * @param {number} speed - Linear speed of CB (in/s)
   * @returns {{ sidespin: number, topspin: number }} Angular velocity components
   */
  function calcInitialSpin(tipSide, tipHeight, speed) {
    // Maximum spin at full offset: ω_max ≈ 2.5 × v / R
    // (This is a well-known approximation — at max offset the spin/speed ratio
    //  is limited by the tip-ball friction coefficient, typically μ_tip ≈ 0.6-0.7)
    const spinFactor = 2.0; // conservative factor
    const R = CONST.BALL_RADIUS;
    return {
      sidespin: tipSide * spinFactor * speed / R,    // rad/s
      topspin: tipHeight * spinFactor * speed / R,    // rad/s
    };
  }

  /**
   * Map a normalized speed (0-1) to physical speed (in/s).
   * @param {number} speedNorm - 0 (soft) to 1 (hard)
   * @returns {number} Speed in inches/second
   */
  function normToSpeed(speedNorm) {
    // Exponential interpolation for more natural feel
    // 0.0 → SOFT, 0.5 → MEDIUM, 1.0 → HARD
    const lo = CONST.SPEED_SOFT;
    const hi = CONST.SPEED_HARD;
    return lo * Math.pow(hi / lo, clamp(speedNorm, 0, 1));
  }

  // ================================================================
  //  PHASE 2: BALL-TO-BALL COLLISION — THROW
  // ================================================================
  /**
   * Calculate Cut-Induced Throw (CIT).
   *
   * When the CB strikes the OB at a cut angle, friction at the contact point
   * produces a lateral force that "throws" the OB off its expected line.
   *
   * Formula: throwAngle ≈ arctan(μ × sin(cutAngle) / (1 + cos(cutAngle)))
   *   Simplified for small μ: ≈ μ × sin(cutAngle) / (1 + cos(cutAngle))
   *   This peaks near cutAngle ≈ 33° with max throw ≈ μ/2 ≈ 1.7°
   *
   * Speed dependency: faster shots → less throw (contact time shorter,
   *   but also friction → rolling during contact reduces throw).
   *   Approximation: throw × (SPEED_MEDIUM / speed)^0.3
   *
   * @param {number} cutAngle - Cut angle in radians
   * @param {number} speed - CB speed in in/s
   * @returns {number} CIT throw angle in radians (always positive, direction
   *   depends on cut side which is handled by the caller)
   */
  function calcCutInducedThrow(cutAngle, speed) {
    if (cutAngle < 0.005) return 0; // straight shot → no throw
    if (cutAngle > Math.PI * 0.48) return 0; // near-miss → negligible contact

    const mu = CONST.MU_BALL;
    const sinC = Math.sin(cutAngle);
    const cosC = Math.cos(cutAngle);

    // Base formula: arctan(μ × sin(θ) / (1 + cos(θ)))
    let throwAngle = Math.atan2(mu * sinC, 1 + cosC);

    // Damping at large cut angles: in reality, at thin cuts the contact
    // patch allows rolling to develop, which reduces the sliding friction
    // and thus the throw. This makes CIT peak near ~33° (half-ball hit)
    // rather than increasing monotonically.
    // Model: Gaussian-like envelope centered at peakAngle
    const peakAngle = 33 * Math.PI / 180;  // ~33° optimal
    const sigma = 18 * Math.PI / 180;       // tight enough to peak at 30-35°
    const dampFactor = Math.exp(-0.5 * Math.pow((cutAngle - peakAngle) / sigma, 2));
    throwAngle *= dampFactor;

    // Speed dependency: slower shots have more throw
    // Normalized around medium speed
    const speedFactor = Math.pow(CONST.SPEED_MEDIUM / Math.max(speed, 10), 0.3);
    throwAngle *= clamp(speedFactor, 0.3, 2.0);

    return throwAngle;
  }

  /**
   * Calculate Spin-Induced Throw (SIT).
   *
   * Side spin (English) on the CB creates additional friction at the contact
   * point that throws the OB in the direction OPPOSITE to the English.
   *
   * Left English → OB thrown to the RIGHT
   * Right English → OB thrown to the LEFT
   *
   * Approximation: throwAngle_SIT ≈ μ × R × |ω_side| / v_impact
   * But limited by friction cone: cannot exceed CIT magnitude.
   *
   * @param {number} sidespin - Angular velocity of CB sidespin (rad/s)
   * @param {number} speed - CB impact speed (in/s)
   * @returns {number} SIT throw angle in radians (signed: positive = throw right)
   */
  function calcSpinInducedThrow(sidespin, speed) {
    if (Math.abs(sidespin) < 0.1) return 0;

    const mu = CONST.MU_BALL;
    const R = CONST.BALL_RADIUS;

    // Surface velocity at contact due to sidespin
    const vSurface = Math.abs(sidespin) * R;

    // Throw angle from spin
    let throwAngle = Math.atan2(mu * vSurface, Math.max(speed, 10));

    // Cap at reasonable maximum (~5°)
    throwAngle = Math.min(throwAngle, degToRad(5));

    // Direction: Left English (sidespin < 0) → OB thrown RIGHT (+)
    //            Right English (sidespin > 0) → OB thrown LEFT (-)
    return -Math.sign(sidespin) * throwAngle;
  }

  // ================================================================
  //  PHASE 3: POST-COLLISION TRAJECTORY
  // ================================================================
  /**
   * Calculate the CB deflection direction after collision.
   *
   * This is the core tangent-line model, enhanced with:
   *   - Tip height → angle between tangent line (90°) and follow-through (cutAngle)
   *   - Speed dependency → faster shots deflect closer to tangent line
   *
   * @param {object} dirAim - Unit vector of CB aim direction
   * @param {object} dirPocket - Unit vector from OB to pocket (line of centers)
   * @param {number} cutAngle - Cut angle in radians
   * @param {number} tipHeight - -1 (draw) to +1 (follow)
   * @returns {{ deflDir: object, stunDir: object, deflAngleDeg: number }}
   */
  function calcCBDeflection(dirAim, dirPocket, cutAngle, tipHeight) {
    // Stun direction: perpendicular to line of centers, on the CB's aim side
    const aimDotPocket = vecDot(dirAim, dirPocket);
    const stunRaw = vecSub(dirAim, vecScale(dirPocket, aimDotPocket));
    const stunDir = vecNorm(stunRaw);

    // Deflection angle φ from pocket line:
    //   tipHeight = 0 (stun/center) → φ = 90° (tangent line)
    //   tipHeight = +1 (max follow) → φ = cutAngle (follows through)
    //   tipHeight = -1 (max draw)   → φ = 180° - cutAngle (draws back)
    const phi = Math.PI / 2 - tipHeight * (Math.PI / 2 - cutAngle);

    const deflDir = vecAdd(
      vecScale(dirPocket, Math.cos(phi)),
      vecScale(stunDir, Math.sin(phi))
    );

    return {
      deflDir,
      stunDir,
      deflAngleDeg: radToDeg(phi),
    };
  }

  /**
   * Generate a Bézier curve approximating the CB swerve path.
   *
   * Swerve occurs when:
   *   1. CB has sidespin (English)
   *   2. Cue is elevated (cueElevation > 0)
   *   3. The initial trajectory has a sliding phase
   *
   * The curve starts in the squirt direction and bends back toward
   * the aim direction as the ball transitions from sliding to rolling.
   *
   * @param {object} startPos - Start position {x, y}
   * @param {object} aimDir - Intended aim direction (unit vector, pre-squirt)
   * @param {number} squirtAngle - Squirt angle in radians
   * @param {number} sidespin - Sidespin angular velocity
   * @param {number} cueElevation - Cue elevation in degrees (0 = flat)
   * @param {number} speed - CB speed in in/s
   * @param {number} pathLength - Maximum path length to compute
   * @returns {{ points: Array<{x,y}>, controlPoints: Array<{x,y}>, endDir: {x,y} }}
   */
  function calcSwervePath(startPos, aimDir, squirtAngle, sidespin, cueElevation, speed, pathLength) {
    const elevRad = degToRad(clamp(cueElevation, 0, 45));

    // If no swerve contributors, return straight line
    if (Math.abs(sidespin) < 0.1 || elevRad < degToRad(0.5)) {
      // Just apply squirt (straight line, slightly different angle)
      const squirtDir = vecRot(aimDir, squirtAngle);
      const endPos = vecAdd(startPos, vecScale(squirtDir, pathLength));
      return {
        points: [startPos, endPos],
        controlPoints: [],
        endDir: squirtDir,
        isStraight: true,
      };
    }

    // Swerve magnitude depends on:
    //   - Amount of sidespin
    //   - Cue elevation (higher = more vertical spin component → more swerve)
    //   - Speed (slower = more swerve per unit distance)
    //
    // Lateral acceleration from swerve:
    //   a_swerve = μ_cloth × g × sin(elevation) × (ω_side / |ω|)
    //   Simplified: swerve ∝ μ × g × sin(elev) / v
    const mu = CONST.MU_CLOTH_SLIDE;
    const g = CONST.GRAVITY_IN;
    const swerveFactor = mu * g * Math.sin(elevRad) * Math.sign(sidespin);

    // The swerve radius of curvature: R_curve = v² / a_swerve
    // Swerve distance before transition to rolling:
    //   d_slide ≈ v / (μ_slide × g) (approximate)
    const slideDistance = Math.min(speed / (mu * g) * speed * 0.5, pathLength * 0.6);

    // Build a quadratic Bézier curve:
    //   P0 = start (squirt direction)
    //   P1 = control point (offset by swerve lateral displacement)
    //   P2 = end (back toward aim direction after rolling)

    // Start direction = aim + squirt
    const startDir = vecRot(aimDir, squirtAngle);

    // Maximum lateral displacement at midpoint:
    // Δlateral ≈ 0.5 × (a_swerve / v) × d_slide²
    const aLateral = Math.abs(swerveFactor) / Math.max(speed, 10);
    const maxLateral = 0.5 * aLateral * slideDistance * slideDistance / Math.max(speed, 10);
    const lateralDisp = clamp(maxLateral, 0, pathLength * 0.15);

    // Perpendicular to aim (swerve direction)
    // Swerve goes OPPOSITE to squirt direction
    const perpDir = { x: -aimDir.y, y: aimDir.x };
    const swerveSign = Math.sign(sidespin);  // left spin → curve right, etc.

    // Control point
    const midPoint = vecAdd(startPos, vecScale(startDir, slideDistance * 0.6));
    const controlPt = vecAdd(midPoint, vecScale(perpDir, swerveSign * lateralDisp));

    // End point: after swerve settles, ball goes roughly toward aim direction
    const endDir = aimDir; // after transition to rolling, goes straight
    const endPos = vecAdd(startPos, vecScale(aimDir, pathLength));

    // Generate curve points for rendering
    const numPoints = 30;
    const points = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      // Quadratic Bézier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
      const mt = 1 - t;
      points.push({
        x: mt * mt * startPos.x + 2 * mt * t * controlPt.x + t * t * endPos.x,
        y: mt * mt * startPos.y + 2 * mt * t * controlPt.y + t * t * endPos.y,
      });
    }

    return {
      points,
      controlPoints: [controlPt],
      endDir,
      isStraight: false,
    };
  }

  /**
   * Predict where the CB will stop after the collision.
   *
   * Models two phases:
   *   1. Sliding: high friction (μ_slide), decelerating
   *   2. Rolling: low friction (μ_roll), slow deceleration
   *
   * @param {object} startPos - Position after collision (ghost ball position)
   * @param {object} velocity - Post-collision velocity direction (unit) × speed
   * @param {number} speed - Post-collision speed (in/s)
   * @returns {object} { stopPos: {x,y}, slideDistance: number, totalDistance: number }
   */
  function predictStopPosition(startPos, velocity, speed) {
    const mu_s = CONST.MU_CLOTH_SLIDE;
    const mu_r = CONST.MU_CLOTH_ROLL;
    const g = CONST.GRAVITY_IN;

    // Post-collision CB speed: approximately = v_CB × sin(cutAngle) for stun
    // The actual speed is passed in as parameter

    // Sliding distance: v²/(2×μ_s×g) until rolling transition
    // Actually, the transition happens when surface velocity = 0
    // For a stun shot (no topspin), sliding distance ≈ 2v²/(7×μ_s×g)
    // (the 2/7 comes from the moment of inertia ratio for a solid sphere)
    const slideDistance = (2 * speed * speed) / (7 * mu_s * g);

    // Speed at transition to rolling
    const vRoll = speed * (5 / 7); // theoretical for pure sliding → rolling

    // Rolling distance: v_roll² / (2×μ_r×g)
    const rollDistance = (vRoll * vRoll) / (2 * mu_r * g);

    const totalDistance = slideDistance + rollDistance;
    const dir = vecNorm(velocity);

    const stopPos = vecAdd(startPos, vecScale(dir, totalDistance));

    // Clamp to table
    stopPos.x = clamp(stopPos.x, CONST.BALL_RADIUS, CONST.TABLE_W - CONST.BALL_RADIUS);
    stopPos.y = clamp(stopPos.y, CONST.BALL_RADIUS, CONST.TABLE_H - CONST.BALL_RADIUS);

    return { stopPos, slideDistance, rollDistance, totalDistance };
  }

  // ================================================================
  //  PHASE 4: CUSHION REBOUND
  // ================================================================
  /**
   * Calculate ball trajectory after hitting a cushion (rail).
   *
   * @param {object} hitPos - Point of impact on rail {x, y}
   * @param {object} velocity - Incoming velocity vector
   * @param {number} sidespin - Sidespin angular velocity
   * @returns {{ velocity: {x,y}, sidespin: number }}
   */
  function calcCushionRebound(hitPos, velocity, sidespin) {
    const e = CONST.COR_CUSHION;
    const mu = CONST.MU_CUSHION;
    const TW = CONST.TABLE_W;
    const TH = CONST.TABLE_H;
    const tol = 0.5;

    // Determine which rail was hit → normal direction
    let normal;
    if (hitPos.x <= tol) normal = { x: 1, y: 0 };            // left rail
    else if (hitPos.x >= TW - tol) normal = { x: -1, y: 0 };  // right rail
    else if (hitPos.y <= tol) normal = { x: 0, y: 1 };         // top rail
    else if (hitPos.y >= TH - tol) normal = { x: 0, y: -1 };   // bottom rail
    else return { velocity, sidespin }; // not at a rail — no change

    // Decompose velocity into normal and tangential components
    const vn = vecDot(velocity, normal);
    const vt_vec = vecSub(velocity, vecScale(normal, vn));

    // Normal component: reversed and reduced by COR
    const vnNew = -e * vn;

    // Tangential component: reduced by cushion friction + spin effect
    // Sidespin adds/subtracts from the tangential component (running/reverse English)
    const R = CONST.BALL_RADIUS;
    const spinEffect = sidespin * R * 0.3; // % of spin transferred to tangential velocity
    const vtLen = vecLen(vt_vec);
    const vtDir = vtLen > 0.01 ? vecNorm(vt_vec) : { x: 0, y: 0 };

    // Determine if the cushion's tangent direction aligns with the spin
    const tangent = { x: -normal.y, y: normal.x }; // 90° CW from normal
    const spinAlongTangent = sidespin * R * vecDot(tangent, vtDir);

    // Apply friction + spin modification
    const vtNewLen = Math.max(0, vtLen * (1 - mu * 0.3) + spinAlongTangent * 0.15);
    const vt_new = vecScale(vtDir, vtNewLen);

    // Reconstruct velocity
    const newVelocity = vecAdd(vecScale(normal, vnNew), vt_new);

    // Sidespin is reduced by cushion contact (rubber absorbs ~30-50%)
    const newSidespin = sidespin * 0.6;

    return { velocity: newVelocity, sidespin: newSidespin };
  }

  /**
   * Cast a ray and compute multi-bounce path (up to maxBounces reflections).
   *
   * @param {object} startPos - Starting position
   * @param {object} direction - Direction unit vector
   * @param {number} speed - Current speed (in/s)
   * @param {number} sidespin - Current sidespin
   * @param {number} maxBounces - Max number of cushion bounces
   * @returns {Array<{x,y}>} Array of path points including bounce points
   */
  function calcMultiBouncePath(startPos, direction, speed, sidespin, maxBounces) {
    const TW = CONST.TABLE_W;
    const TH = CONST.TABLE_H;
    const path = [{ x: startPos.x, y: startPos.y }];
    let pos = { x: startPos.x, y: startPos.y };
    let vel = vecScale(direction, speed);
    let spin = sidespin;
    let currentSpeed = speed;

    for (let bounce = 0; bounce < maxBounces; bounce++) {
      // Cast ray to nearest rail
      const dir = vecNorm(vel);
      const railPt = rayToRail(pos.x, pos.y, dir.x, dir.y, TW, TH);
      path.push(railPt);

      // Speed loss from travel + cushion
      const travelDist = vecLen(vecSub(railPt, pos));
      currentSpeed *= Math.max(0.3, 1 - travelDist * 0.002); // approximate deceleration

      if (currentSpeed < 5) break; // ball basically stopped

      // Calculate rebound
      const rebound = calcCushionRebound(railPt, vel, spin);
      vel = rebound.velocity;
      spin = rebound.sidespin;
      pos = railPt;
    }

    return path;
  }

  /** Ray cast to nearest rail — same as app.js but parameterized */
  function rayToRail(ox, oy, dx, dy, tw, th) {
    tw = tw || CONST.TABLE_W;
    th = th || CONST.TABLE_H;
    let tMin = Infinity;
    if (Math.abs(dx) > 1e-9) {
      const t1 = (0 - ox) / dx;
      if (t1 > 0.01 && t1 < tMin) tMin = t1;
      const t2 = (tw - ox) / dx;
      if (t2 > 0.01 && t2 < tMin) tMin = t2;
    }
    if (Math.abs(dy) > 1e-9) {
      const t3 = (0 - oy) / dy;
      if (t3 > 0.01 && t3 < tMin) tMin = t3;
      const t4 = (th - oy) / dy;
      if (t4 > 0.01 && t4 < tMin) tMin = t4;
    }
    if (!isFinite(tMin)) tMin = 50;
    return {
      x: clamp(ox + dx * tMin, 0, tw),
      y: clamp(oy + dy * tMin, 0, th),
    };
  }

  // ================================================================
  //  PUBLIC API: calcFullGeometry()
  // ================================================================
  /**
   * Calculate all geometry + physics for the current shot setup.
   *
   * This is the main entry point — replaces the old calcGeometry() and adds
   * throw, squirt, swerve, predicted stop position, and multi-bounce paths.
   *
   * @param {object} cb - Cue ball position {x, y}
   * @param {object} ob - Object ball position {x, y}
   * @param {object} pocket - Pocket position {x, y}
   * @param {object} config - Shot configuration:
   *   {number} tipHeight  - -1 (draw) to +1 (follow), default 0
   *   {number} tipSide    - -1 (left English) to +1 (right), default 0
   *   {number} shotSpeed  - 0 (soft) to 1 (hard), default 0.5
   *   {number} cueElevation - 0° to 45°, default 0
   *   {string} shaftType  - 'ld' or 'std', default 'ld'
   * @returns {object|null} Full geometry result, or null if degenerate
   */
  function calcFullGeometry(cb, ob, pocket, config) {
    config = config || {};
    const tipHeight = config.tipHeight || 0;
    const tipSide = config.tipSide || 0;
    const shotSpeedNorm = config.shotSpeed != null ? config.shotSpeed : 0.5;
    const cueElevation = config.cueElevation || 0;
    const shaftType = config.shaftType || "ld";

    // ---- Basic geometry ----
    const dpVec = vecSub(pocket, ob);
    const dpLen = vecLen(dpVec);
    if (dpLen < 0.5) return null;
    const dirPocket = vecNorm(dpVec);  // True direction from OB to pocket

    const BR = CONST.BALL_RADIUS;

    // ---- Phase 1: Cue strike ----
    const speed = normToSpeed(shotSpeedNorm);
    const spin = calcInitialSpin(tipSide, tipHeight, speed);
    const squirtAngle = calcSquirtAngle(tipSide, shaftType);
    const squirtAngleDeg = radToDeg(squirtAngle);

    // ---- Phase 2: Throw calculation & compensation ----
    // When throwCompensation is ON, we find the ghost ball such that AFTER throw,
    // OB goes into the pocket. We rotate the line-of-centers backward by the
    // throw angle and iterate twice for accuracy (throw depends on cut angle).
    const useThrowComp = !!config.throwCompensation;

    let dirLoC = dirPocket; // line-of-centers direction (start with ideal)
    let ghostBall, dirAim, daLen, cutAngle, cross;
    let citAngle, sitAngle, totalThrowAngle, citDir;

    // First pass: compute throw using ideal geometry
    ghostBall = {
      x: ob.x - dirLoC.x * 2 * BR,
      y: ob.y - dirLoC.y * 2 * BR,
    };
    let daVec = vecSub(ghostBall, cb);
    daLen = vecLen(daVec);
    if (daLen < 0.5) return null;
    dirAim = vecNorm(daVec);

    let dotVal = vecDot(dirAim, dirLoC);
    cutAngle = Math.acos(clamp(dotVal, -1, 1));
    cross = vecCross2D(dirAim, dirLoC);

    citAngle = calcCutInducedThrow(cutAngle, speed);
    sitAngle = calcSpinInducedThrow(spin.sidespin, speed);
    citDir = cross >= 0 ? -1 : 1;
    totalThrowAngle = citDir * citAngle + sitAngle;

    // Compensation iterations: adjust line-of-centers so throw lands OB in pocket
    if (useThrowComp && Math.abs(totalThrowAngle) > 1e-6) {
      for (let iter = 0; iter < 2; iter++) {
        dirLoC = vecRot(dirPocket, -totalThrowAngle);
        ghostBall = {
          x: ob.x - dirLoC.x * 2 * BR,
          y: ob.y - dirLoC.y * 2 * BR,
        };
        daVec = vecSub(ghostBall, cb);
        daLen = vecLen(daVec);
        if (daLen < 0.5) return null;
        dirAim = vecNorm(daVec);

        dotVal = vecDot(dirAim, dirLoC);
        cutAngle = Math.acos(clamp(dotVal, -1, 1));
        cross = vecCross2D(dirAim, dirLoC);

        citAngle = calcCutInducedThrow(cutAngle, speed);
        sitAngle = calcSpinInducedThrow(spin.sidespin, speed);
        citDir = cross >= 0 ? -1 : 1;
        totalThrowAngle = citDir * citAngle + sitAngle;
      }
    }

    const cutAngleDeg = radToDeg(cutAngle);
    const fraction = clamp(1 - Math.sin(cutAngle), 0, 1);
    const totalThrowAngleDeg = radToDeg(totalThrowAngle);

    // Throw-adjusted OB direction (line-of-centers rotated by throw)
    // With compensation ON:  dirPocketThrown ≈ dirPocket (toward pocket)
    // With compensation OFF: dirPocketThrown deviates away from pocket
    const dirPocketThrown = vecRot(dirLoC, totalThrowAngle);

    // Contact point on the actual line of centers
    const contactPoint = {
      x: ob.x - dirLoC.x * BR,
      y: ob.y - dirLoC.y * BR,
    };

    // Squirt-adjusted aim direction (actual CB path before contact)
    const dirAimSquirted = vecRot(dirAim, squirtAngle);

    // ---- Phase 2b: CB deflection ----
    const { deflDir, stunDir, deflAngleDeg } = calcCBDeflection(
      dirAim, dirLoC, cutAngle, tipHeight
    );

    // ---- Phase 3: Swerve path (CB pre-collision) ----
    const swervePath = calcSwervePath(
      cb, dirAim, squirtAngle, spin.sidespin,
      cueElevation, speed, daLen
    );

    // ---- Phase 3b: Predicted stop positions ----
    // CB post-collision speed: approximately v × sin(cutAngle) for stun
    const cbPostSpeed = speed * Math.sin(cutAngle) * (1 - Math.abs(tipHeight) * 0.3);
    const cbStop = predictStopPosition(ghostBall, deflDir, Math.max(cbPostSpeed, 5));

    // OB post-collision speed: approximately v × cos(cutAngle) × COR
    const obPostSpeed = speed * Math.cos(cutAngle) * CONST.COR_BALL;
    const obStop = predictStopPosition(ob, dirPocketThrown, obPostSpeed);

    // ---- Phase 4: Multi-bounce CB path ----
    const cbBouncePath = calcMultiBouncePath(
      ghostBall, deflDir, cbPostSpeed, spin.sidespin * 0.5, 2
    );

    // ---- Phase 4b: OB path to rail (if it misses the pocket) ----
    const obRailPt = rayToRail(
      ob.x, ob.y,
      dirPocketThrown.x, dirPocketThrown.y
    );

    // ---- Return everything ----
    return {
      // Original fields (backward compatible)
      ghostBall,
      cutAngle,
      cutAngleDeg,
      fraction,
      cross,
      stunDir,
      deflDir,
      deflAngleDeg,
      contactPoint,
      dirPocket,
      dirAim,
      aimDist: daLen,
      pocketDist: dpLen,

      // New: Throw data
      throwAngle: totalThrowAngle,
      throwAngleDeg: totalThrowAngleDeg,
      citAngleDeg: radToDeg(citAngle),
      sitAngleDeg: radToDeg(sitAngle * (sitAngle !== 0 ? 1 : 0)),
      dirPocketThrown,
      dirLineOfCenters: dirLoC,  // actual line-of-centers (= dirPocket when no compensation)

      // New: Squirt data
      squirtAngle,
      squirtAngleDeg,
      dirAimSquirted,

      // New: Spin data
      spin,
      speed,

      // New: Swerve path
      swervePath,

      // New: Predicted positions
      cbStopPos: cbStop.stopPos,
      cbTotalDistance: cbStop.totalDistance,
      obStopPos: obStop.stopPos,
      obRailPoint: obRailPt,

      // New: Multi-bounce path
      cbBouncePath,
    };
  }

  // ================================================================
  //  EXPOSE PUBLIC API
  // ================================================================
  return {
    CONST,
    calcFullGeometry,
    calcSquirtAngle,
    calcInitialSpin,
    calcCutInducedThrow,
    calcSpinInducedThrow,
    calcCBDeflection,
    calcSwervePath,
    predictStopPosition,
    calcCushionRebound,
    calcMultiBouncePath,
    normToSpeed,
    // Utilities exposed for testing
    _util: { clamp, vecLen, vecNorm, vecDot, vecCross2D, vecScale, vecAdd, vecSub, vecRot, degToRad, radToDeg, rayToRail },
  };
})();
