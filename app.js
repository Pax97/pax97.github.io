/**
 * Fractional Aiming - Billiard Visualization
 * Interactive visualization of the fractional aiming system in billiards.
 *
 * Key formula:  fraction = 1 - sin(cutAngle)
 *   Full ball → 0°,  3/4 → 14.5°,  1/2 → 30°,  1/4 → 48.6°,  1/8 → 61°
 *
 * Ghost Ball = position where the cue ball center must be at the moment
 * of contact so that the object ball travels toward the target pocket.
 */
(function () {
  "use strict";

  // ================================================================
  //  CONSTANTS  –  Rasson Competition 9ft  ×  Aramith Tournament Black
  // ================================================================
  // Playing surface: 100" × 50" (WPA regulation, nose-to-nose)
  const TW = 100; // table playing surface width (inches)
  const TH = 50; // table playing surface height
  // Aramith Tournament Black ball: 57.2 mm = 2.25" diameter → 1.125" radius
  const BR = 1.125; // ball radius
  // Rasson OX-style rail width: ~7" from cushion nose to outer edge
  const RAIL = 7;
  // WPA pocket mouth dimensions (from cushion nose tip to tip)
  const PR_CORNER = 2.25; // corner pocket radius ≈ 4.5"/2
  const PR_SIDE = 2.5; // side pocket radius   ≈ 5.0"/2

  const POCKETS = [
    { x: 0, y: 0, name: "Trái trên", type: "corner" },
    { x: TW / 2, y: 0, name: "Giữa trên", type: "side" },
    { x: TW, y: 0, name: "Phải trên", type: "corner" },
    { x: 0, y: TH, name: "Trái dưới", type: "corner" },
    { x: TW / 2, y: TH, name: "Giữa dưới", type: "side" },
    { x: TW, y: TH, name: "Phải dưới", type: "corner" },
  ];

  // Diamond markers on rails (3 between each pair of adjacent pockets)
  const DIAMONDS = [];
  // Top rail
  for (let i = 1; i <= 3; i++) DIAMONDS.push({ x: ((TW / 2) * i) / 4, y: 0 });
  for (let i = 1; i <= 3; i++)
    DIAMONDS.push({ x: TW / 2 + ((TW / 2) * i) / 4, y: 0 });
  // Bottom rail
  for (let i = 1; i <= 3; i++) DIAMONDS.push({ x: ((TW / 2) * i) / 4, y: TH });
  for (let i = 1; i <= 3; i++)
    DIAMONDS.push({ x: TW / 2 + ((TW / 2) * i) / 4, y: TH });
  // Left rail
  for (let i = 1; i <= 3; i++) DIAMONDS.push({ x: 0, y: (TH * i) / 4 });
  // Right rail
  for (let i = 1; i <= 3; i++) DIAMONDS.push({ x: TW, y: (TH * i) / 4 });

  // ---- Rasson + Simonis Tournament Blue color palette ----
  const COLORS = {
    // Simonis 860 Tournament Blue cloth
    felt: "#1e5a9e",
    feltLight: "#2468b0",
    feltDark: "#164882",
    // Rasson dark walnut / mahogany rails
    rail: "#3a2518",
    railLight: "#5c3a28",
    railDark: "#1e110a",
    railAccent: "#7a5540", // inlay / chamfer highlight
    // Visual aid lines
    aimLine: "#00d4ff",
    objectPath: "#ffd700",
    deflectionPath: "#ff4da6",
    ghostBall: "rgba(255,255,255,0.25)",
    ghostBallStroke: "rgba(255,255,255,0.55)",
    cutAngle: "#ff8c00",
    contactPoint: "#ff3333",
    // New physics colors
    throwPath: "#ff6b35", // thrown OB path (orange)
    squirtLine: "#e879f9", // squirt-adjusted aim (purple/pink)
    swervePath: "#a855f7", // swerve curve (purple)
    predictedStop: "#22d3ee", // predicted stop position (cyan)
    bouncePath: "rgba(255,77,166,0.5)", // multi-bounce path
    // Aramith Tournament Black balls
    cueBall: "#fffff5", // ivory white
    cueShadow: "#c8c8b8",
    objectBall: "#ffcc00", // #1 ball – solid yellow
    objShadow: "#b38f00",
    pocketSelected: "#ffd700",
    // Pocket interior
    pocketInner: "#000000",
    pocketOuter: "#1a1a1a",
  };

  const FRACTION_PRESETS = [
    { value: 1.0, label: "Full" },
    { value: 0.75, label: "3/4" },
    { value: 0.5, label: "1/2" },
    { value: 0.25, label: "1/4" },
    { value: 0.125, label: "1/8" },
  ];

  // ================================================================
  //  STATE
  // ================================================================
  const state = {
    cueBall: { x: 25, y: 25 },
    objectBall: { x: 70, y: 18 },
    selectedPocket: 2, // top-right
    show: {
      aimLine: true,
      objectPath: true,
      deflectionPath: true,
      ghostBall: true,
      cutAngle: true,
      contactPoint: false,
      diamondGrid: true,
      throwEffect: true,
      swervePath: true,
      predictedStop: true,
      bouncePath: false,
    },
    tipHeight: 0, // -1 (draw/low) to 0 (stun/center) to +1 (follow/high)
    tipSide: 0, // -1 (left English) to +1 (right English)
    shotSpeed: 0.5, // 0 (soft) to 1 (hard)
    cueElevation: 0, // 0° to 30°
    shaftType: "ld", // 'ld' (low-deflection) or 'std'
    dragging: null, // 'cueBall' | 'objectBall' | null
    animTarget: null, // { x, y } or null
    hoverBall: null, // 'cueBall' | 'objectBall' | null
    // ---- Pinch-to-Zoom + Pan ----
    viewZoom: 1,
    viewPanX: 0,
    viewPanY: 0,
    // ---- Dirty-flag rendering (GPU optimization) ----
    _isDirty: true, // needs re-render?
    _rafId: null, // requestAnimationFrame ID
  };

  /**
   * Mark the scene as needing a re-render.
   * Schedules a single rAF if one isn't already pending.
   * This is the ONLY way rendering should be triggered.
   */
  function markDirty() {
    state._isDirty = true;
    if (!state._rafId) {
      state._rafId = requestAnimationFrame(loop);
    }
  }

  // Pinch / pan gesture tracking (not part of serializable state)
  let pinch = null; // { startDist, startZoom, startPanX, startPanY, centerX, centerY }
  let panTouch = null; // { x, y } last single-finger position for panning
  let lastTapTime = 0; // for double-tap detection

  // ================================================================
  //  DOM REFERENCES
  // ================================================================
  const $tableCanvas = document.getElementById("tableCanvas");
  const $perspCanvas = document.getElementById("perspectiveCanvas");
  const ctxT = $tableCanvas.getContext("2d");
  const ctxP = $perspCanvas.getContext("2d");

  // CSS-pixel dimensions (updated on resize)
  let tw = 0,
    th = 0; // table canvas
  let pw = 0,
    ph = 0; // perspective canvas
  let tScale = 1; // pixels per table-unit
  let tOx = 0,
    tOy = 0; // pixel offset of (0,0) table-origin in canvas

  // ================================================================
  //  UTILITY
  // ================================================================
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }
  function normalize(v) {
    const d = Math.sqrt(v.x * v.x + v.y * v.y);
    return d < 1e-9 ? { x: 0, y: 0 } : { x: v.x / d, y: v.y / d };
  }

  /** Convert a fraction (0-1) to a human-readable label */
  function fractionLabel(f) {
    if (Math.abs(f - 1) < 0.03) return "Full";
    if (Math.abs(f - 0.75) < 0.03) return "3/4";
    if (Math.abs(f - 0.5) < 0.03) return "1/2";
    if (Math.abs(f - 0.25) < 0.03) return "1/4";
    if (Math.abs(f - 0.125) < 0.03) return "1/8";
    return Math.round(f * 100) + "%";
  }

  /**
   * Cast a ray from (ox, oy) in direction (dx, dy) inside the playing
   * surface [0, TW] × [0, TH].  Returns the point where it first hits a rail.
   */
  function rayToRail(ox, oy, dx, dy) {
    let tMin = Infinity;
    // Check each of the 4 rails
    if (Math.abs(dx) > 1e-9) {
      // Left rail (x = 0)
      const t1 = (0 - ox) / dx;
      if (t1 > 0.01 && t1 < tMin) tMin = t1;
      // Right rail (x = TW)
      const t2 = (TW - ox) / dx;
      if (t2 > 0.01 && t2 < tMin) tMin = t2;
    }
    if (Math.abs(dy) > 1e-9) {
      // Top rail (y = 0)
      const t3 = (0 - oy) / dy;
      if (t3 > 0.01 && t3 < tMin) tMin = t3;
      // Bottom rail (y = TH)
      const t4 = (TH - oy) / dy;
      if (t4 > 0.01 && t4 < tMin) tMin = t4;
    }
    if (!isFinite(tMin)) tMin = 50; // fallback
    return {
      x: clamp(ox + dx * tMin, 0, TW),
      y: clamp(oy + dy * tMin, 0, TH),
    };
  }

  // ================================================================
  //  CANVAS SETUP / RESIZE
  // ================================================================
  function resize() {
    const dpr = window.devicePixelRatio || 1;

    // --- Table canvas ---
    const tContainer = document.getElementById("table-container");
    const tRect = tContainer.getBoundingClientRect();
    const totalAspect = (TW + 2 * RAIL) / (TH + 2 * RAIL);

    tw = tRect.width - 16; // subtract padding
    th = tw / totalAspect;
    if (th > tRect.height - 16) {
      th = tRect.height - 16;
      tw = th * totalAspect;
    }
    tw = Math.max(tw, 200);
    th = Math.max(th, 100);

    $tableCanvas.width = Math.round(tw * dpr);
    $tableCanvas.height = Math.round(th * dpr);
    $tableCanvas.style.width = tw + "px";
    $tableCanvas.style.height = th + "px";
    ctxT.setTransform(dpr, 0, 0, dpr, 0, 0);

    tScale = tw / (TW + 2 * RAIL);
    tOx = RAIL * tScale;
    tOy = RAIL * tScale;

    // --- Perspective canvas ---
    const pContainer = document.getElementById("perspective-container");
    const pRect = pContainer.getBoundingClientRect();
    pw = pRect.width - 16;
    ph = pRect.height - 16;
    pw = Math.max(pw, 200);
    ph = Math.max(ph, 120);

    $perspCanvas.width = Math.round(pw * dpr);
    $perspCanvas.height = Math.round(ph * dpr);
    $perspCanvas.style.width = pw + "px";
    $perspCanvas.style.height = ph + "px";
    ctxP.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ================================================================
  //  COORDINATE TRANSFORMS  (with zoom/pan support)
  // ================================================================
  /** Table-units → canvas CSS-pixels (raw, before view transform) */
  function t2c(x, y) {
    return { x: tOx + x * tScale, y: tOy + y * tScale };
  }
  /** Canvas CSS-pixels (from pointer) → table-units. Inverts the view transform first. */
  function c2t(cx, cy) {
    // Undo zoom+pan that renderTable applies
    const rx = (cx - state.viewPanX) / state.viewZoom;
    const ry = (cy - state.viewPanY) / state.viewZoom;
    return { x: (rx - tOx) / tScale, y: (ry - tOy) / tScale };
  }

  // ================================================================
  //  GEOMETRY CALCULATIONS  (delegated to physics.js)
  // ================================================================
  /**
   * Calculate all geometric + physics data for the current state.
   * Delegates to BilliardPhysics.calcFullGeometry() which includes
   * throw, squirt, swerve, predicted stop, and multi-bounce paths.
   * Returns null if geometry is degenerate.
   */
  function calcGeometry() {
    const cb = state.cueBall;
    const ob = state.objectBall;
    const pk = POCKETS[state.selectedPocket];

    return BilliardPhysics.calcFullGeometry(cb, ob, pk, {
      tipHeight: state.tipHeight,
      tipSide: state.tipSide,
      shotSpeed: state.shotSpeed,
      cueElevation: state.cueElevation,
      shaftType: state.shaftType,
      throwCompensation: state.show.throwEffect,
    });
  }

  // ================================================================
  //  TABLE RENDERING
  // ================================================================
  function renderTable() {
    const ctx = ctxT;
    // Clear in un-transformed space
    ctx.clearRect(0, 0, tw * 2, th * 2);

    // Apply zoom + pan view transform
    ctx.save();
    ctx.translate(state.viewPanX, state.viewPanY);
    ctx.scale(state.viewZoom, state.viewZoom);

    const rw = RAIL * tScale; // rail width in px
    const sx = tOx,
      sy = tOy; // playing surface origin
    const sw = TW * tScale; // surface size
    const sh = TH * tScale;

    // ---- Outer rail (Rasson dark walnut / mahogany wood) ----
    // Multi-stop gradient to emulate polished dark wood grain
    const railGrad = ctx.createLinearGradient(0, 0, 0, th);
    railGrad.addColorStop(0, COLORS.railAccent);
    railGrad.addColorStop(0.08, COLORS.railLight);
    railGrad.addColorStop(0.2, COLORS.rail);
    railGrad.addColorStop(0.5, COLORS.railDark);
    railGrad.addColorStop(0.8, COLORS.rail);
    railGrad.addColorStop(0.92, COLORS.railLight);
    railGrad.addColorStop(1, COLORS.railAccent);
    ctx.fillStyle = railGrad;
    roundRect(ctx, 0, 0, tw, th, 10);
    ctx.fill();

    // Subtle horizontal grain lines on rails
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.5;
    for (let gy = 0; gy < th; gy += 3) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(tw, gy);
      ctx.stroke();
    }
    ctx.restore();

    // Outer bevel (polished edge)
    ctx.strokeStyle = COLORS.railAccent;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 1, 1, tw - 2, th - 2, 10);
    ctx.stroke();

    // Inner cushion edge — bright green rubber nose line
    ctx.strokeStyle = "#2a7d4f";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, sw, sh);
    // Dark inner shadow
    ctx.strokeStyle = COLORS.railDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - 1.5, sy - 1.5, sw + 3, sh + 3);

    // ---- Playing surface (Simonis 860 Tournament Blue felt) ----
    const feltGrad = ctx.createRadialGradient(
      sx + sw / 2,
      sy + sh / 2,
      0,
      sx + sw / 2,
      sy + sh / 2,
      sw * 0.72,
    );
    feltGrad.addColorStop(0, COLORS.feltLight);
    feltGrad.addColorStop(1, COLORS.felt);
    ctx.fillStyle = feltGrad;
    ctx.fillRect(sx, sy, sw, sh);

    // Subtle directional nap texture (worsted wool look)
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 0.5;
    for (let i = 0; i < sw; i += 3) {
      ctx.beginPath();
      ctx.moveTo(sx + i, sy);
      ctx.lineTo(sx + i, sy + sh);
      ctx.stroke();
    }
    ctx.restore();

    // ---- Pockets (WPA spec corner vs side) ----
    POCKETS.forEach((pk, idx) => {
      const p = t2c(pk.x, pk.y);
      const isCorner = pk.type === "corner";
      const r = (isCorner ? PR_CORNER : PR_SIDE) * tScale;

      // Pocket cut-out shadow
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = r * 0.4;

      // Pocket hole
      const pGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      pGrad.addColorStop(0, COLORS.pocketInner);
      pGrad.addColorStop(0.55, "#080808");
      pGrad.addColorStop(1, COLORS.pocketOuter);
      ctx.fillStyle = pGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Thin chrome/metal ring around pocket mouth
      ctx.strokeStyle = "rgba(160,150,140,0.35)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 0.5, 0, Math.PI * 2);
      ctx.stroke();

      // Selected highlight glow
      if (idx === state.selectedPocket) {
        ctx.strokeStyle = COLORS.pocketSelected;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = COLORS.pocketSelected;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    });

    // ---- Diamond markers (mother-of-pearl inlays) ----
    DIAMONDS.forEach((d) => {
      const p = t2c(d.x, d.y);
      // Offset into the rail
      let dx = 0,
        dy = 0;
      if (d.y === 0) dy = -rw * 0.42;
      if (d.y === TH) dy = rw * 0.42;
      if (d.x === 0) dx = -rw * 0.42;
      if (d.x === TW) dx = rw * 0.42;

      // Diamond shape (rotated square)
      const dSize = 3;
      const cx = p.x + dx,
        cy = p.y + dy;
      ctx.fillStyle = "rgba(255,245,220,0.85)";
      ctx.beginPath();
      ctx.moveTo(cx, cy - dSize);
      ctx.lineTo(cx + dSize, cy);
      ctx.lineTo(cx, cy + dSize);
      ctx.lineTo(cx - dSize, cy);
      ctx.closePath();
      ctx.fill();
      // Subtle glow
      ctx.strokeStyle = "rgba(255,240,200,0.3)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });

    // ---- Diamond grid (connects diamond markers) ----
    if (state.show.diamondGrid) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
      ctx.lineWidth = 0.7;
      ctx.setLineDash([3, 4]);

      // Vertical lines: each top diamond x → bottom diamond x
      const topXs = DIAMONDS.filter((d) => d.y === 0).map((d) => d.x);
      topXs.forEach((x) => {
        const p1 = t2c(x, 0);
        const p2 = t2c(x, TH);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      });

      // Horizontal lines: each left diamond y → right diamond y
      const leftYs = DIAMONDS.filter((d) => d.x === 0).map((d) => d.y);
      leftYs.forEach((y) => {
        const p1 = t2c(0, y);
        const p2 = t2c(TW, y);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      });

      // Center line (x = TW/2)
      const pc1 = t2c(TW / 2, 0);
      const pc2 = t2c(TW / 2, TH);
      ctx.beginPath();
      ctx.moveTo(pc1.x, pc1.y);
      ctx.lineTo(pc2.x, pc2.y);
      ctx.stroke();

      ctx.setLineDash([]);
    }

    // ---- Table markings ----
    // Foot spot
    const foot = t2c(TW * 0.75, TH / 2);
    ctx.fillStyle = "rgba(255,255,255,0.20)";
    ctx.beginPath();
    ctx.arc(foot.x, foot.y, 3, 0, Math.PI * 2);
    ctx.fill();

    // Head string
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const hs1 = t2c(TW * 0.25, 0);
    const hs2 = t2c(TW * 0.25, TH);
    ctx.beginPath();
    ctx.moveTo(hs1.x, hs1.y);
    ctx.lineTo(hs2.x, hs2.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // ---- Rasson logo text on bottom rail ----
    ctx.save();
    ctx.font = `bold ${Math.max(8, rw * 0.3)}px Inter`;
    ctx.fillStyle = "rgba(255,240,220,0.18)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("RASSON", sx + sw / 2, sy + sh + rw * 0.5);
    ctx.restore();

    // ---- Game elements ----
    const geom = calcGeometry();
    if (geom) {
      drawGameElements(ctx, geom);
    }

    // ---- Balls (always on top) ----
    const cbp = t2c(state.cueBall.x, state.cueBall.y);
    const obp = t2c(state.objectBall.x, state.objectBall.y);
    const br = BR * tScale;

    drawObjectBall(ctx, obp.x, obp.y, br);
    drawCueBall(ctx, cbp.x, cbp.y, br);

    // Drag hint glow
    if (state.hoverBall === "cueBall" || state.dragging === "cueBall") {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cbp.x, cbp.y, br + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (state.hoverBall === "objectBall" || state.dragging === "objectBall") {
      ctx.strokeStyle = "rgba(255,200,0,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(obp.x, obp.y, br + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // End zoom+pan transform
    ctx.restore();

    // ---- Zoom indicator (drawn in un-transformed space) ----
    if (state.viewZoom > 1.05) {
      const zi = `${Math.round(state.viewZoom * 100)}%`;
      ctx.save();
      ctx.font = "bold 11px Inter";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      // Pill background
      const m = ctx.measureText(zi);
      const px = tw - 8,
        py = 8;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(ctx, px - m.width - 12, py - 3, m.width + 18, 20, 6);
      ctx.fill();
      // Icon + text
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(zi, px, py);
      // Reset hint
      ctx.font = "9px Inter";
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillText("double-tap reset", px, py + 18);
      ctx.restore();
    }
  }

  /** Draw all visual aid lines/arcs */
  function drawGameElements(ctx, g) {
    const br = BR * tScale;
    const cbp = t2c(state.cueBall.x, state.cueBall.y);
    const obp = t2c(state.objectBall.x, state.objectBall.y);
    const gbp = t2c(g.ghostBall.x, g.ghostBall.y);
    const cpp = t2c(g.contactPoint.x, g.contactPoint.y);
    const pk = POCKETS[state.selectedPocket];
    const pkp = t2c(pk.x, pk.y);

    // ---- Object ball path ----
    if (state.show.objectPath) {
      const hasThrow =
        state.show.throwEffect &&
        g.dirLineOfCenters &&
        Math.abs(g.throwAngleDeg) > 0.05;

      if (hasThrow) {
        // With throw compensation: OB goes INTO the pocket after throw.
        // Primary path (solid, orange): OB → pocket (throw-compensated trajectory)
        ctx.save();
        ctx.shadowColor = COLORS.throwPath;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = COLORS.throwPath;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(obp.x, obp.y);
        ctx.lineTo(pkp.x, pkp.y);
        ctx.stroke();
        drawArrow(ctx, obp, pkp, COLORS.throwPath);

        // Throw angle label on the primary path
        const throwLabelT = 0.55;
        const throwLx = obp.x + (pkp.x - obp.x) * throwLabelT;
        const throwLy = obp.y + (pkp.y - obp.y) * throwLabelT;
        drawLabel(
          ctx,
          `Throw ${g.throwAngleDeg > 0 ? "+" : ""}${g.throwAngleDeg.toFixed(1)}°`,
          throwLx,
          throwLy,
          {
            font: "bold 10px Inter",
            color: COLORS.throwPath,
            alpha: 0.9,
            align: "center",
          },
        );
        ctx.restore();

        // Reference path (dashed, green): line-of-centers without throw (misses pocket)
        const noThrowRailPt = rayToRail(
          state.objectBall.x, state.objectBall.y,
          g.dirLineOfCenters.x, g.dirLineOfCenters.y
        );
        const noThrowEndP = t2c(noThrowRailPt.x, noThrowRailPt.y);
        ctx.save();
        ctx.strokeStyle = COLORS.objectPath;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.3;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(obp.x, obp.y);
        ctx.lineTo(noThrowEndP.x, noThrowEndP.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else {
        // No significant throw — ideal path is the primary path (solid)
        ctx.save();
        ctx.shadowColor = COLORS.objectPath;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = COLORS.objectPath;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(obp.x, obp.y);
        ctx.lineTo(pkp.x, pkp.y);
        ctx.stroke();
        drawArrow(ctx, obp, pkp, COLORS.objectPath);
        ctx.restore();
      }
    }

    // ---- Aim line (CB → ghost ball) ----
    if (state.show.aimLine) {
      ctx.save();
      ctx.shadowColor = COLORS.aimLine;
      ctx.shadowBlur = 6;

      // Main aim line (ideal, no squirt)
      ctx.strokeStyle = COLORS.aimLine;
      ctx.lineWidth = 2;
      ctx.globalAlpha = Math.abs(state.tipSide) > 0.05 ? 0.4 : 0.85;
      ctx.setLineDash(Math.abs(state.tipSide) > 0.05 ? [4, 4] : []);
      ctx.beginPath();
      ctx.moveTo(cbp.x, cbp.y);
      ctx.lineTo(gbp.x, gbp.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Extended line behind CB (cue direction)
      ctx.globalAlpha = 0.25;
      ctx.setLineDash([6, 6]);
      const ext = 60;
      ctx.beginPath();
      ctx.moveTo(cbp.x, cbp.y);
      ctx.lineTo(cbp.x - g.dirAim.x * ext, cbp.y - g.dirAim.y * ext);
      ctx.stroke();

      // Extended line past ghost ball through OB
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.moveTo(gbp.x, gbp.y);
      ctx.lineTo(gbp.x + g.dirAim.x * ext, gbp.y + g.dirAim.y * ext);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.restore();
    }

    // ---- Squirt-adjusted aim line (actual CB path with English) ----
    if (
      state.show.aimLine &&
      g.dirAimSquirted &&
      Math.abs(g.squirtAngleDeg) > 0.05
    ) {
      ctx.save();
      ctx.shadowColor = COLORS.squirtLine;
      ctx.shadowBlur = 4;
      ctx.strokeStyle = COLORS.squirtLine;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.75;
      const sqExt = g.aimDist * tScale * 1.1;
      ctx.beginPath();
      ctx.moveTo(cbp.x, cbp.y);
      ctx.lineTo(
        cbp.x + g.dirAimSquirted.x * sqExt,
        cbp.y + g.dirAimSquirted.y * sqExt,
      );
      ctx.stroke();

      // Squirt label
      const sqLabelT = 0.3;
      drawLabel(
        ctx,
        `Squirt ${g.squirtAngleDeg > 0 ? "+" : ""}${g.squirtAngleDeg.toFixed(1)}°`,
        cbp.x + g.dirAimSquirted.x * sqExt * sqLabelT,
        cbp.y + g.dirAimSquirted.y * sqExt * sqLabelT,
        {
          font: "bold 9px Inter",
          color: COLORS.squirtLine,
          alpha: 0.85,
          align: "center",
        },
      );
      ctx.restore();
    }

    // ---- Swerve path (curved CB path when English + elevated cue) ----
    if (state.show.swervePath && g.swervePath && !g.swervePath.isStraight) {
      const pts = g.swervePath.points;
      if (pts.length > 2) {
        ctx.save();
        ctx.shadowColor = COLORS.swervePath;
        ctx.shadowBlur = 4;
        ctx.strokeStyle = COLORS.swervePath;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const p0 = t2c(pts[0].x, pts[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length; i++) {
          const p = t2c(pts[i].x, pts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        const midIdx = Math.floor(pts.length * 0.4);
        const midP = t2c(pts[midIdx].x, pts[midIdx].y);
        drawLabel(ctx, "Swerve", midP.x, midP.y - 10, {
          font: "bold 9px Inter",
          color: COLORS.swervePath,
          alpha: 0.75,
          align: "center",
        });
        ctx.restore();
      }
    }

    // ---- CB deflection path (extended to cushion) ----
    if (state.show.deflectionPath && g.cutAngleDeg > 1) {
      // Compute deflection ray length to reach the nearest rail
      const deflRailPt = rayToRail(
        g.ghostBall.x,
        g.ghostBall.y,
        g.deflDir.x,
        g.deflDir.y,
      );
      const deflEndP = t2c(deflRailPt.x, deflRailPt.y);

      // Tangent/stun reference line (dimmed, always 90°)
      if (Math.abs(state.tipHeight) > 0.05) {
        const stunRailPt = rayToRail(
          g.ghostBall.x,
          g.ghostBall.y,
          g.stunDir.x,
          g.stunDir.y,
        );
        const stunEndP = t2c(stunRailPt.x, stunRailPt.y);
        ctx.save();
        ctx.strokeStyle = COLORS.deflectionPath;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(gbp.x, gbp.y);
        ctx.lineTo(stunEndP.x, stunEndP.y);
        ctx.stroke();
        ctx.setLineDash([]);
        // Label near end
        const stunLabelT = 0.7;
        const stunLx = gbp.x + (stunEndP.x - gbp.x) * stunLabelT;
        const stunLy = gbp.y + (stunEndP.y - gbp.y) * stunLabelT;
        drawLabel(ctx, "90° stun", stunLx, stunLy, {
          font: "9px Inter",
          color: COLORS.deflectionPath,
          alpha: 0.5,
          align: "center",
        });
        ctx.restore();
      }

      // Actual deflection path (based on tip height) — extended to cushion
      ctx.save();
      ctx.shadowColor = COLORS.deflectionPath;
      ctx.shadowBlur = 5;
      ctx.strokeStyle = COLORS.deflectionPath;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(gbp.x, gbp.y);
      ctx.lineTo(deflEndP.x, deflEndP.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Deflection angle label near the end
      if (Math.abs(state.tipHeight) > 0.05) {
        const tipLabel = state.tipHeight > 0 ? "Follow" : "Draw";
        const labelT = 0.65;
        const dLx = gbp.x + (deflEndP.x - gbp.x) * labelT;
        const dLy = gbp.y + (deflEndP.y - gbp.y) * labelT;
        drawLabel(ctx, `${g.deflAngleDeg.toFixed(0)}° ${tipLabel}`, dLx, dLy, {
          font: "bold 10px Inter",
          color: COLORS.deflectionPath,
          alpha: 0.85,
          align: "center",
        });
      }
      ctx.restore();
    }

    // ---- Predicted stop positions ----
    if (state.show.predictedStop && g.cutAngleDeg > 1) {
      // CB predicted stop
      if (g.cbStopPos) {
        const cbStopP = t2c(g.cbStopPos.x, g.cbStopPos.y);
        ctx.save();
        ctx.strokeStyle = COLORS.predictedStop;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(cbStopP.x, cbStopP.y, br * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // ×  marker
        const m = br * 0.3;
        ctx.beginPath();
        ctx.moveTo(cbStopP.x - m, cbStopP.y - m);
        ctx.lineTo(cbStopP.x + m, cbStopP.y + m);
        ctx.moveTo(cbStopP.x + m, cbStopP.y - m);
        ctx.lineTo(cbStopP.x - m, cbStopP.y + m);
        ctx.stroke();
        drawLabel(ctx, "CB Stop", cbStopP.x, cbStopP.y - br - 4, {
          font: "8px Inter",
          color: COLORS.predictedStop,
          alpha: 0.65,
          align: "center",
          baseline: "bottom",
        });
        ctx.restore();
      }

      // OB predicted stop
      if (g.obStopPos) {
        const obStopP = t2c(g.obStopPos.x, g.obStopPos.y);
        ctx.save();
        ctx.strokeStyle = COLORS.objectPath;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(obStopP.x, obStopP.y, br * 0.8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const m2 = br * 0.3;
        ctx.beginPath();
        ctx.moveTo(obStopP.x - m2, obStopP.y - m2);
        ctx.lineTo(obStopP.x + m2, obStopP.y + m2);
        ctx.moveTo(obStopP.x + m2, obStopP.y - m2);
        ctx.lineTo(obStopP.x - m2, obStopP.y + m2);
        ctx.stroke();
        drawLabel(ctx, "OB Stop", obStopP.x, obStopP.y - br - 4, {
          font: "8px Inter",
          color: COLORS.objectPath,
          alpha: 0.55,
          align: "center",
          baseline: "bottom",
        });
        ctx.restore();
      }
    }

    // ---- Multi-bounce CB path ----
    if (
      state.show.bouncePath &&
      g.cbBouncePath &&
      g.cbBouncePath.length > 1 &&
      g.cutAngleDeg > 1
    ) {
      ctx.save();
      ctx.strokeStyle = COLORS.bouncePath;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      // Skip first segment (already drawn as deflection path)
      for (let i = 1; i < g.cbBouncePath.length; i++) {
        const p = t2c(g.cbBouncePath[i].x, g.cbBouncePath[i].y);
        if (i === 1) {
          ctx.moveTo(p.x, p.y);
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Bounce markers
      for (let i = 1; i < g.cbBouncePath.length - 1; i++) {
        const bp = t2c(g.cbBouncePath[i].x, g.cbBouncePath[i].y);
        ctx.fillStyle = COLORS.bouncePath;
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- Ghost ball ----
    if (state.show.ghostBall) {
      ctx.save();
      ctx.fillStyle = COLORS.ghostBall;
      ctx.beginPath();
      ctx.arc(gbp.x, gbp.y, br, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COLORS.ghostBallStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      // drawLabel(ctx, "Ghost", gbp.x, gbp.y - br - 6, {
      //   font: `bold ${Math.max(9, br * 0.75)}px Inter`,
      //   color: "#ffffff",
      //   alpha: 0.8,
      //   align: "center",
      //   baseline: "bottom",
      // });
      ctx.restore();
    }

    // ---- Contact point ----
    if (state.show.contactPoint) {
      ctx.save();
      ctx.fillStyle = COLORS.contactPoint;
      ctx.shadowColor = COLORS.contactPoint;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(cpp.x, cpp.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ---- Cut angle arc ----
    // The cut angle = acos(dirAim · dirLineOfCenters).  These two
    // direction vectors meet at the ghost ball (= CB's position at contact).
    // We draw the arc there so the visual matches the computed value.
    //
    // dirAim           = the direction the CB travels (CB → ghost ball)
    // dirLineOfCenters = the actual line-of-centers at contact
    //                    (with throw compensation, this differs from dirPocket)
    //
    // The arc sweeps from dirAim to dirLineOfCenters at the ghost ball.
    if (state.show.cutAngle && g.cutAngleDeg > 0.5) {
      const arcR = Math.max(15, br * 3);

      const aimAngle = Math.atan2(g.dirAim.y, g.dirAim.x);
      const locDir = g.dirLineOfCenters || g.dirPocket;
      const pocketAngle = Math.atan2(locDir.y, locDir.x);

      // Sweep: choose the shorter arc
      let sweep = pocketAngle - aimAngle;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const acw = sweep < 0;

      ctx.save();
      ctx.strokeStyle = COLORS.cutAngle;
      ctx.lineWidth = 1.8;
      ctx.shadowColor = COLORS.cutAngle;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(gbp.x, gbp.y, arcR, aimAngle, pocketAngle, acw);
      ctx.stroke();

      // Angle label at the midpoint of the arc
      const midAngle = aimAngle + sweep / 2;
      const labelR = arcR + 16;
      const angleLx = gbp.x + Math.cos(midAngle) * labelR;
      const angleLy = gbp.y + Math.sin(midAngle) * labelR;
      ctx.shadowBlur = 0;
      drawLabel(ctx, g.cutAngleDeg.toFixed(1) + "°", angleLx, angleLy, {
        font: "bold 12px Inter",
        color: COLORS.cutAngle,
        alpha: 0.95,
        align: "center",
        baseline: "middle",
      });
      ctx.restore();
    }
  }

  /**
   * Draw text with a semi-transparent dark background pill for readability.
   * opts: { font, color, alpha, align, baseline }
   */
  function drawLabel(ctx, text, x, y, opts = {}) {
    ctx.save();
    ctx.font = opts.font || "10px Inter";
    ctx.textAlign = opts.align || "center";
    ctx.textBaseline = opts.baseline || "alphabetic";
    ctx.globalAlpha = opts.alpha || 0.8;

    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const textH = parseInt(opts.font) || 10;
    const padX = 5,
      padY = 3;

    // Compute pill position based on alignment
    let pillX = x - padX;
    if (opts.align === "center") pillX = x - textW / 2 - padX;
    else if (opts.align === "right") pillX = x - textW - padX;

    let pillY = y - textH + 2 - padY;
    if (opts.baseline === "middle") pillY = y - textH / 2 - padY;
    else if (opts.baseline === "bottom") pillY = y - textH - padY;
    else if (opts.baseline === "top") pillY = y - padY;

    // Background pill
    const pillW = textW + padX * 2;
    const pillH = textH + padY * 2;
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(pillX + r, pillY);
    ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + pillH, r);
    ctx.arcTo(pillX + pillW, pillY + pillH, pillX, pillY + pillH, r);
    ctx.arcTo(pillX, pillY + pillH, pillX, pillY, r);
    ctx.arcTo(pillX, pillY, pillX + pillW, pillY, r);
    ctx.closePath();
    ctx.fill();

    // Text
    ctx.fillStyle = opts.color || "#ffffff";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** Draw a ball with 3D-ish shading (generic) */
  function drawBall(ctx, x, y, r, mainColor, shadowColor, label) {
    ctx.save();
    // Shadow
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = r * 0.6;
    ctx.shadowOffsetX = r * 0.15;
    ctx.shadowOffsetY = r * 0.15;

    // Main gradient
    const g = ctx.createRadialGradient(
      x - r * 0.3,
      y - r * 0.35,
      r * 0.05,
      x,
      y,
      r,
    );
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.25, mainColor);
    g.addColorStop(1, shadowColor);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Highlight
    const hl = ctx.createRadialGradient(
      x - r * 0.3,
      y - r * 0.3,
      0,
      x - r * 0.3,
      y - r * 0.3,
      r * 0.55,
    );
    hl.addColorStop(0, "rgba(255,255,255,0.75)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // Label
    if (label) {
      ctx.fillStyle = "#333";
      ctx.font = `bold ${Math.max(8, r * 0.85)}px Inter`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x + r * 0.05, y + r * 0.05);
    }
    ctx.restore();
  }

  /** Aramith Tournament Black – Cue Ball (ivory white with 6 dots) */
  function drawCueBall(ctx, x, y, r) {
    ctx.save();
    // Drop shadow
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = r * 0.7;
    ctx.shadowOffsetX = r * 0.12;
    ctx.shadowOffsetY = r * 0.12;

    // Main body — ivory gradient
    const g = ctx.createRadialGradient(
      x - r * 0.3,
      y - r * 0.35,
      r * 0.05,
      x,
      y,
      r,
    );
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.3, COLORS.cueBall);
    g.addColorStop(1, COLORS.cueShadow);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Specular highlight
    const hl = ctx.createRadialGradient(
      x - r * 0.28,
      y - r * 0.28,
      0,
      x - r * 0.28,
      y - r * 0.28,
      r * 0.5,
    );
    hl.addColorStop(0, "rgba(255,255,255,0.85)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    // 6 Aramith sighting dots (only visible when ball is large enough)
    if (r > 4) {
      ctx.fillStyle = "rgba(40,40,40,0.35)";
      const dotR = Math.max(0.8, r * 0.065);
      const ring = r * 0.38;
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI * 2) / 6 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(
          x + Math.cos(a) * ring,
          y + Math.sin(a) * ring,
          dotR,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /** Aramith Tournament Black – #1 Ball (solid yellow) */
  function drawObjectBall(ctx, x, y, r) {
    ctx.save();
    // Drop shadow
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = r * 0.7;
    ctx.shadowOffsetX = r * 0.12;
    ctx.shadowOffsetY = r * 0.12;

    // Main body — rich yellow
    const g = ctx.createRadialGradient(
      x - r * 0.3,
      y - r * 0.35,
      r * 0.05,
      x,
      y,
      r,
    );
    g.addColorStop(0, "#fff7aa");
    g.addColorStop(0.2, "#ffe033");
    g.addColorStop(0.55, COLORS.objectBall);
    g.addColorStop(1, COLORS.objShadow);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // White number circle
    if (r > 4) {
      const circR = r * 0.36;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x + r * 0.03, y + r * 0.03, circR, 0, Math.PI * 2);
      ctx.fill();

      // Number "1"
      ctx.fillStyle = "#1a1a1a";
      ctx.font = `bold ${Math.max(6, r * 0.48)}px Inter`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("1", x + r * 0.03, y + r * 0.06);
    }

    // Specular highlight
    const hl = ctx.createRadialGradient(
      x - r * 0.28,
      y - r * 0.28,
      0,
      x - r * 0.28,
      y - r * 0.28,
      r * 0.5,
    );
    hl.addColorStop(0, "rgba(255,255,255,0.7)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** Draw a small arrowhead at the end of a line from a→b */
  function drawArrow(ctx, a, b, color) {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return;
    const ux = dx / len,
      uy = dy / len;
    const size = 8;
    const tip = { x: b.x, y: b.y };
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - ux * size + uy * size * 0.4,
      tip.y - uy * size - ux * size * 0.4,
    );
    ctx.lineTo(
      tip.x - ux * size - uy * size * 0.4,
      tip.y - uy * size + ux * size * 0.4,
    );
    ctx.closePath();
    ctx.fill();
  }

  /** Rounded rectangle path */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ================================================================
  //  PERSPECTIVE RENDERING
  // ================================================================
  function renderPerspective() {
    const ctx = ctxP;
    ctx.clearRect(0, 0, pw, ph);

    const geom = calcGeometry();

    // Background with vignette
    const bgGrad = ctx.createRadialGradient(
      pw / 2,
      ph / 2,
      0,
      pw / 2,
      ph / 2,
      pw * 0.75,
    );
    bgGrad.addColorStop(0, "#161c2c");
    bgGrad.addColorStop(1, "#080c14");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, pw, ph);

    if (!geom) {
      ctx.fillStyle = "#5a6278";
      ctx.font = "14px Inter";
      ctx.textAlign = "center";
      ctx.fillText("Di chuyển bi để xem", pw / 2, ph / 2);
      return;
    }

    // Layout: compute available vertical space
    const topMargin = 36; // space for title text
    const bottomMargin = 50; // space for bracket + labels
    const availH = ph - topMargin - bottomMargin;
    const availW = pw * 0.9;

    // Ball radius: fit within available area
    const R = Math.min(availW * 0.22, availH * 0.45);
    const cy = topMargin + availH / 2;

    // Determine cut side: use cross product to place ghost ball
    // on the correct side from the player's perspective
    const sign = geom.cross >= 0 ? -1 : 1;
    const d = 2 * R * Math.sin(geom.cutAngle);

    // Center OB slightly offset so ghost ball has room on either side
    const cx = pw / 2 - sign * R * 0.3;
    const gbx = cx + sign * d;

    // Adaptive font sizes
    const fSmall = Math.max(9, R * 0.18);
    const fMed = Math.max(11, R * 0.22);
    const fLarge = Math.max(14, R * 0.28);

    // ---- Fraction division lines on OB (prominent reference marks) ----
    const refs = [
      { f: 1.0, label: "Full", color: "rgba(255,255,255,0.30)" },
      { f: 0.75, label: "3/4", color: "rgba(255,255,255,0.22)" },
      { f: 0.5, label: "1/2", color: "rgba(255,255,255,0.30)" },
      { f: 0.25, label: "1/4", color: "rgba(255,255,255,0.22)" },
      { f: 0.125, label: "1/8", color: "rgba(255,255,255,0.18)" },
    ];

    // ---- Object ball (Aramith Tournament Black #1 – solid yellow) ----
    const obGrad = ctx.createRadialGradient(
      cx - R * 0.25,
      cy - R * 0.25,
      R * 0.08,
      cx,
      cy,
      R,
    );
    obGrad.addColorStop(0, "#fff7aa");
    obGrad.addColorStop(0.2, "#ffe033");
    obGrad.addColorStop(0.55, COLORS.objectBall);
    obGrad.addColorStop(1, COLORS.objShadow);
    ctx.fillStyle = obGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // White number circle on perspective OB
    if (R > 20) {
      const circR = R * 0.22;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(cx, cy - R * 0.02, circR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a1a";
      ctx.font = `bold ${Math.max(8, R * 0.28)}px Inter`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("1", cx, cy);
    }

    // ---- Draw fraction division lines ON the ball ----
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    refs.forEach((ref) => {
      // Boundary x for this fraction (depends on cut direction)
      const bx = cx + sign * R * (1 - 2 * ref.f);
      const dxFC = bx - cx;

      if (Math.abs(dxFC) < R - 0.5) {
        const halfH = Math.sqrt(R * R - dxFC * dxFC);

        // Division line
        ctx.strokeStyle = ref.color;
        ctx.lineWidth = ref.f === 0.5 ? 2 : 1.2;
        ctx.setLineDash(ref.f === 1.0 ? [] : [4, 3]);
        ctx.beginPath();
        ctx.moveTo(bx, cy - halfH);
        ctx.lineTo(bx, cy + halfH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label at top of line
        ctx.fillStyle = ref.color;
        ctx.font = `bold ${Math.max(8, R * 0.14)}px Inter`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(ref.label, bx, cy - halfH + 14);
      }
    });

    ctx.restore();

    // ---- Overlap region (clipped intersection) ----
    if (d < 2 * R && d > 0.5) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      ctx.fillStyle = "rgba(0, 212, 255, 0.25)";
      ctx.beginPath();
      ctx.arc(gbx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      // Intersection chord line
      const chordDx = d / 2;
      if (chordDx < R) {
        const chordHalf = Math.sqrt(R * R - chordDx * chordDx);
        ctx.strokeStyle = "rgba(0, 212, 255, 0.7)";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx + sign * chordDx, cy - chordHalf);
        ctx.lineTo(cx + sign * chordDx, cy + chordHalf);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.restore();
    }

    // ---- Ghost ball (aim circle) outline ----
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.arc(gbx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ghost ball center crosshair
    const markLen = Math.max(5, R * 0.1);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(gbx - markLen, cy);
    ctx.lineTo(gbx + markLen, cy);
    ctx.moveTo(gbx, cy - markLen);
    ctx.lineTo(gbx, cy + markLen);
    ctx.stroke();

    // ---- Overlap width annotation bracket ----
    if (geom.fraction > 0.02 && geom.fraction < 0.99) {
      // The overlap region is on the side of the ghost ball
      // For sign=+1: from overlapBound to right edge (cx + R)
      // For sign=-1: from left edge (cx - R) to overlapBound
      const overlapBound = cx + sign * R * (1 - 2 * geom.fraction);
      const overlapEdge = cx + sign * R;
      const annotY = cy + R + 16;

      // Ensure left < right for drawing
      const bracketL = Math.min(overlapBound, overlapEdge);
      const bracketR = Math.max(overlapBound, overlapEdge);

      ctx.strokeStyle = "#00d4ff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bracketL, annotY - 4);
      ctx.lineTo(bracketL, annotY + 4);
      ctx.moveTo(bracketL, annotY);
      ctx.lineTo(bracketR, annotY);
      ctx.moveTo(bracketR, annotY - 4);
      ctx.lineTo(bracketR, annotY + 4);
      ctx.stroke();

      ctx.fillStyle = "#00d4ff";
      ctx.font = `bold ${fMed}px Inter`;
      ctx.textAlign = "center";
      ctx.fillText(
        fractionLabel(geom.fraction),
        (bracketL + bracketR) / 2,
        annotY + fMed + 4,
      );
    }

    // ---- Cue ball tip position indicator (bottom-left corner) ----
    {
      const cbR = Math.max(16, R * 0.28); // small cue ball radius
      const cbCx = 8 + cbR + 4;
      const cbCy = ph - 8 - cbR - 4;

      // Cue ball circle (Aramith ivory)
      const cbGrad = ctx.createRadialGradient(
        cbCx - cbR * 0.2,
        cbCy - cbR * 0.2,
        cbR * 0.1,
        cbCx,
        cbCy,
        cbR,
      );
      cbGrad.addColorStop(0, "#ffffff");
      cbGrad.addColorStop(0.4, COLORS.cueBall);
      cbGrad.addColorStop(1, COLORS.cueShadow);
      ctx.fillStyle = cbGrad;
      ctx.beginPath();
      ctx.arc(cbCx, cbCy, cbR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // 6 Aramith sighting dots on perspective cue ball
      if (cbR > 10) {
        ctx.fillStyle = "rgba(40,40,40,0.3)";
        const sdR = Math.max(0.8, cbR * 0.065);
        const sRing = cbR * 0.38;
        for (let si = 0; si < 6; si++) {
          const sa = (si * Math.PI * 2) / 6 - Math.PI / 2;
          ctx.beginPath();
          ctx.arc(
            cbCx + Math.cos(sa) * sRing,
            cbCy + Math.sin(sa) * sRing,
            sdR,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }

      // Crosshair lines (horizontal + vertical)
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cbCx - cbR * 0.7, cbCy);
      ctx.lineTo(cbCx + cbR * 0.7, cbCy);
      ctx.moveTo(cbCx, cbCy - cbR * 0.7);
      ctx.lineTo(cbCx, cbCy + cbR * 0.7);
      ctx.stroke();

      // Tip contact dot — X offset (English) + Y offset (follow/draw)
      const tipDotX = cbCx + state.tipSide * cbR * 0.7;
      const tipDotY = cbCy - state.tipHeight * cbR * 0.7;
      const dotR = Math.max(3, cbR * 0.18);

      // Glow for English indicator
      if (Math.abs(state.tipSide) > 0.05) {
        ctx.save();
        ctx.shadowColor = COLORS.squirtLine;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = COLORS.squirtLine;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(tipDotX, tipDotY, dotR + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.fillStyle = "#ff3333";
      ctx.beginPath();
      ctx.arc(tipDotX, tipDotY, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,0,0,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Labels
      ctx.fillStyle = "#a0a8bc";
      ctx.font = `${Math.max(8, cbR * 0.32)}px Inter`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      let tipLabel = "Stun";
      if (state.tipHeight > 0.05) tipLabel = "Follow";
      else if (state.tipHeight < -0.05) tipLabel = "Draw";
      if (Math.abs(state.tipSide) > 0.05) {
        tipLabel += state.tipSide > 0 ? " + R" : " + L";
      }
      ctx.fillText(tipLabel, cbCx, cbCy + cbR + 4);
      ctx.textBaseline = "alphabetic";
    }

    // ---- Top info ----
    ctx.fillStyle = "#e0e6f0";
    ctx.font = `bold ${fLarge}px Inter`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(
      `Tỷ lệ: ${fractionLabel(geom.fraction)}  •  Góc: ${geom.cutAngleDeg.toFixed(1)}°`,
      pw / 2,
      10,
    );
    ctx.textBaseline = "alphabetic";
  }

  // ================================================================
  //  UI UPDATE
  // ================================================================
  function updateUI(geom) {
    if (!geom) return;

    // Info display
    document.getElementById("info-fraction").textContent = fractionLabel(
      geom.fraction,
    );
    document.getElementById("info-fraction-pct").textContent =
      Math.round(geom.fraction * 100) + "%";
    document.getElementById("info-angle").textContent =
      geom.cutAngleDeg.toFixed(1) + "°";

    // Cut direction
    const dirEl = document.getElementById("info-cut-dir");
    if (geom.cutAngleDeg < 1) {
      dirEl.textContent = "Thẳng";
    } else {
      dirEl.textContent = geom.cross > 0 ? "◀ Cắt trái" : "Cắt phải ▶";
    }

    // Throw info
    const throwEl = document.getElementById("info-throw");
    const throwDetailEl = document.getElementById("info-throw-detail");
    if (throwEl && geom.throwAngleDeg != null) {
      throwEl.textContent =
        Math.abs(geom.throwAngleDeg) < 0.05
          ? "0.0°"
          : (geom.throwAngleDeg > 0 ? "+" : "") +
            geom.throwAngleDeg.toFixed(1) +
            "°";
      const citPart = geom.citAngleDeg ? geom.citAngleDeg.toFixed(1) : "0.0";
      const sitPart = geom.sitAngleDeg
        ? Math.abs(geom.sitAngleDeg).toFixed(1)
        : "0.0";
      throwDetailEl.textContent = `CIT ${citPart}° + SIT ${sitPart}°`;
    }

    // Squirt info
    const squirtEl = document.getElementById("info-squirt");
    const squirtDetailEl = document.getElementById("info-squirt-detail");
    if (squirtEl && geom.squirtAngleDeg != null) {
      squirtEl.textContent =
        Math.abs(geom.squirtAngleDeg) < 0.01
          ? "0.0°"
          : (geom.squirtAngleDeg > 0 ? "+" : "") +
            geom.squirtAngleDeg.toFixed(1) +
            "°";
      squirtDetailEl.textContent =
        state.shaftType === "ld" ? "Low Deflection" : "Standard";
    }

    // Slider
    const slider = document.getElementById("fraction-slider");
    slider.value = Math.round(geom.fraction * 100);

    // Fraction preset buttons
    document.querySelectorAll(".preset-btn[data-fraction]").forEach((btn) => {
      const f = parseFloat(btn.dataset.fraction);
      btn.classList.toggle("active", Math.abs(f - geom.fraction) < 0.03);
    });
  }

  // ================================================================
  //  EVENT HANDLERS
  // ================================================================

  function getTablePos(e) {
    const rect = $tableCanvas.getBoundingClientRect();
    const cx = (e.clientX || e.touches[0].clientX) - rect.left;
    const cy = (e.clientY || e.touches[0].clientY) - rect.top;
    return c2t(cx, cy);
  }

  /** Check if a touch/click is on a ball. Hitbox enlarged on mobile & when zoomed out. */
  function hitTestBall(tablePos, ballPos) {
    const isMobile = "ontouchstart" in window;
    const hitMul = isMobile ? Math.max(3.5, 2.5 / state.viewZoom) : 2.5;
    return dist(tablePos, ballPos) < BR * hitMul;
  }

  function hitTestPocket(tablePos) {
    const isMobile = "ontouchstart" in window;
    const hitMul = isMobile ? 3 : 2;
    for (let i = 0; i < POCKETS.length; i++) {
      const pr = POCKETS[i].type === "corner" ? PR_CORNER : PR_SIDE;
      if (dist(tablePos, POCKETS[i]) < pr * hitMul) return i;
    }
    return -1;
  }

  // Mouse events
  $tableCanvas.addEventListener("mousedown", function (e) {
    const tp = getTablePos(e);

    // Check pocket click
    const pocketIdx = hitTestPocket(tp);
    if (pocketIdx >= 0) {
      state.selectedPocket = pocketIdx;
      markDirty();
      return;
    }

    // Check ball drag
    if (hitTestBall(tp, state.cueBall)) {
      state.dragging = "cueBall";
    } else if (hitTestBall(tp, state.objectBall)) {
      state.dragging = "objectBall";
    }

    if (state.dragging) {
      state.animTarget = null; // cancel any animation
      markDirty();
    }
  });

  $tableCanvas.addEventListener("mousemove", function (e) {
    const tp = getTablePos(e);

    if (state.dragging) {
      const ball =
        state.dragging === "cueBall" ? state.cueBall : state.objectBall;
      ball.x = clamp(tp.x, BR, TW - BR);
      ball.y = clamp(tp.y, BR, TH - BR);
      $tableCanvas.style.cursor = "grabbing";
      markDirty();
      return;
    }

    // Hover detection (no markDirty needed — cosmetic cursor only)
    if (hitTestBall(tp, state.cueBall)) {
      state.hoverBall = "cueBall";
      $tableCanvas.style.cursor = "grab";
    } else if (hitTestBall(tp, state.objectBall)) {
      state.hoverBall = "objectBall";
      $tableCanvas.style.cursor = "grab";
    } else if (hitTestPocket(tp) >= 0) {
      state.hoverBall = null;
      $tableCanvas.style.cursor = "pointer";
    } else {
      state.hoverBall = null;
      $tableCanvas.style.cursor = "default";
    }
  });

  window.addEventListener("mouseup", function () {
    state.dragging = null;
  });

  // ================================================================
  //  TOUCH EVENTS  (Pinch-to-Zoom + Pan + Ball Drag)
  // ================================================================
  function getTouchDist(t) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function getTouchCenter(t, rect) {
    return {
      x: (t[0].clientX + t[1].clientX) / 2 - rect.left,
      y: (t[0].clientY + t[1].clientY) / 2 - rect.top,
    };
  }

  /** Clamp pan so the table stays visible */
  function clampPan() {
    const maxPanX = tw * (state.viewZoom - 1) * 0.6;
    const maxPanY = th * (state.viewZoom - 1) * 0.6;
    state.viewPanX = clamp(state.viewPanX, -maxPanX, maxPanX);
    state.viewPanY = clamp(state.viewPanY, -maxPanY, maxPanY);
  }

  /** Reset zoom to 1× with smooth animation */
  function resetZoom() {
    state.viewZoom = 1;
    state.viewPanX = 0;
    state.viewPanY = 0;
  }

  $tableCanvas.addEventListener(
    "touchstart",
    function (e) {
      e.preventDefault();
      const touches = e.touches;

      // ---- Two-finger: start pinch ----
      if (touches.length === 2) {
        state.dragging = null;
        panTouch = null;
        const rect = $tableCanvas.getBoundingClientRect();
        pinch = {
          startDist: getTouchDist(touches),
          startZoom: state.viewZoom,
          startPanX: state.viewPanX,
          startPanY: state.viewPanY,
          startCenter: getTouchCenter(touches, rect),
        };
        return;
      }

      // ---- Single-finger ----
      pinch = null;

      // Double-tap detection → reset zoom
      const now = Date.now();
      if (now - lastTapTime < 320) {
        resetZoom();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      const tp = getTablePos(e);

      // Pocket hit
      const pocketIdx = hitTestPocket(tp);
      if (pocketIdx >= 0) {
        state.selectedPocket = pocketIdx;
        return;
      }

      // Ball hit → drag
      if (hitTestBall(tp, state.cueBall)) {
        state.dragging = "cueBall";
        state.animTarget = null;
      } else if (hitTestBall(tp, state.objectBall)) {
        state.dragging = "objectBall";
        state.animTarget = null;
      } else if (state.viewZoom > 1.05) {
        // No ball hit + zoomed in → pan mode
        panTouch = { x: touches[0].clientX, y: touches[0].clientY };
      }
    },
    { passive: false },
  );

  $tableCanvas.addEventListener(
    "touchmove",
    function (e) {
      e.preventDefault();
      const touches = e.touches;

      // ---- Pinch-to-zoom ----
      if (touches.length === 2 && pinch) {
        const rect = $tableCanvas.getBoundingClientRect();
        const newDist = getTouchDist(touches);
        const newCenter = getTouchCenter(touches, rect);

        // Zoom ratio
        const zoomRatio = newDist / pinch.startDist;
        const newZoom = clamp(pinch.startZoom * zoomRatio, 1, 5);

        // Pan: keep pinch center stable
        const dx = newCenter.x - pinch.startCenter.x;
        const dy = newCenter.y - pinch.startCenter.y;
        const cx = pinch.startCenter.x;
        const cy = pinch.startCenter.y;

        state.viewZoom = newZoom;
        state.viewPanX =
          pinch.startPanX +
          dx +
          (cx - pinch.startPanX) * (1 - newZoom / pinch.startZoom);
        state.viewPanY =
          pinch.startPanY +
          dy +
          (cy - pinch.startPanY) * (1 - newZoom / pinch.startZoom);
        clampPan();
        markDirty();
        return;
      }

      // ---- Single-finger pan (when zoomed in) ----
      if (panTouch && touches.length === 1) {
        const dx = touches[0].clientX - panTouch.x;
        const dy = touches[0].clientY - panTouch.y;
        state.viewPanX += dx;
        state.viewPanY += dy;
        clampPan();
        panTouch = { x: touches[0].clientX, y: touches[0].clientY };
        markDirty();
        return;
      }

      // ---- Ball drag ----
      if (state.dragging && touches.length === 1) {
        const tp = getTablePos(e);
        const ball =
          state.dragging === "cueBall" ? state.cueBall : state.objectBall;
        ball.x = clamp(tp.x, BR, TW - BR);
        ball.y = clamp(tp.y, BR, TH - BR);
        markDirty();
      }
    },
    { passive: false },
  );

  window.addEventListener("touchend", function (e) {
    if (e.touches.length === 0) {
      pinch = null;
      panTouch = null;
    }
    state.dragging = null;
  });

  // ---- Fraction preset buttons ----
  document.querySelectorAll(".preset-btn[data-fraction]").forEach((btn) => {
    btn.addEventListener("click", function () {
      const targetFraction = parseFloat(this.dataset.fraction);
      placeCueBallForFraction(targetFraction);
      markDirty();
    });
  });

  // ---- Fraction slider ----
  document
    .getElementById("fraction-slider")
    .addEventListener("input", function () {
      const targetFraction = parseInt(this.value) / 100;
      placeCueBallForFraction(targetFraction);
      markDirty();
    });

  // ---- Tip height preset buttons ----
  function setTipHeight(val) {
    state.tipHeight = clamp(val, -1, 1);
    document.getElementById("tip-slider").value = Math.round(val * 100);
    // Update active button
    document.querySelectorAll(".tip-btn").forEach((b) => {
      b.classList.toggle("active", parseFloat(b.dataset.tip) === val);
    });
    markDirty();
  }

  document.querySelectorAll(".tip-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      setTipHeight(parseFloat(this.dataset.tip));
    });
  });

  // ---- Tip height slider ----
  document.getElementById("tip-slider").addEventListener("input", function () {
    const val = parseInt(this.value) / 100;
    state.tipHeight = clamp(val, -1, 1);
    // Deactivate preset buttons if slider is between presets
    document.querySelectorAll(".tip-btn").forEach((b) => {
      b.classList.toggle(
        "active",
        Math.abs(parseFloat(b.dataset.tip) - val) < 0.01,
      );
    });
    markDirty();
  });

  // ---- Toggle switches ----
  [
    "aimLine",
    "objectPath",
    "deflectionPath",
    "ghostBall",
    "cutAngle",
    "contactPoint",
    "diamondGrid",
    "throwEffect",
    "swervePath",
    "predictedStop",
    "bouncePath",
  ].forEach((key) => {
    const el = document.getElementById("toggle-" + key);
    if (el) {
      el.addEventListener("change", function () {
        state.show[key] = this.checked;
        markDirty();
      });
    }
  });

  // ---- English (sidespin) controls ----
  function setEnglish(val) {
    state.tipSide = clamp(val, -1, 1);
    document.getElementById("english-slider").value = Math.round(val * 100);
    document.querySelectorAll(".eng-btn").forEach((b) => {
      b.classList.toggle(
        "active",
        Math.abs(parseFloat(b.dataset.eng) - val) < 0.01,
      );
    });
    markDirty();
  }

  document.querySelectorAll(".eng-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      setEnglish(parseFloat(this.dataset.eng));
    });
  });

  document
    .getElementById("english-slider")
    .addEventListener("input", function () {
      const val = parseInt(this.value) / 100;
      state.tipSide = clamp(val, -1, 1);
      document.querySelectorAll(".eng-btn").forEach((b) => {
        b.classList.toggle(
          "active",
          Math.abs(parseFloat(b.dataset.eng) - val) < 0.01,
        );
      });
      markDirty();
    });

  // ---- Shot speed controls ----
  function setShotSpeed(val) {
    state.shotSpeed = clamp(val, 0, 1);
    document.getElementById("speed-slider").value = Math.round(val * 100);
    document.querySelectorAll(".speed-btn").forEach((b) => {
      b.classList.toggle(
        "active",
        Math.abs(parseFloat(b.dataset.speed) - val) < 0.02,
      );
    });
    markDirty();
  }

  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      setShotSpeed(parseFloat(this.dataset.speed));
    });
  });

  document
    .getElementById("speed-slider")
    .addEventListener("input", function () {
      const val = parseInt(this.value) / 100;
      state.shotSpeed = clamp(val, 0, 1);
      document.querySelectorAll(".speed-btn").forEach((b) => {
        b.classList.toggle(
          "active",
          Math.abs(parseFloat(b.dataset.speed) - val) < 0.02,
        );
      });
      markDirty();
    });

  // ---- Cue elevation slider ----
  document
    .getElementById("elevation-slider")
    .addEventListener("input", function () {
      state.cueElevation = parseInt(this.value);
      markDirty();
    });

  // ---- Shaft type buttons ----
  document.querySelectorAll(".shaft-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      state.shaftType = this.dataset.shaft;
      document.querySelectorAll(".shaft-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.shaft === state.shaftType);
      });
      markDirty();
    });
  });

  // ---- Window resize ----
  window.addEventListener("resize", function () {
    resize();
    markDirty();
  });

  // ================================================================
  //  FRACTION → CUE BALL PLACEMENT
  // ================================================================
  /**
   * Move the cue ball to produce the given fraction, keeping the object
   * ball and selected pocket fixed.
   */
  function placeCueBallForFraction(fraction) {
    fraction = clamp(fraction, 0.01, 1);

    const ob = state.objectBall;
    const pk = POCKETS[state.selectedPocket];

    const dpx = pk.x - ob.x,
      dpy = pk.y - ob.y;
    const dpLen = Math.sqrt(dpx * dpx + dpy * dpy);
    if (dpLen < 1) return;
    const dp = { x: dpx / dpLen, y: dpy / dpLen };

    // Ghost ball
    const gb = { x: ob.x - dp.x * 2 * BR, y: ob.y - dp.y * 2 * BR };

    // Cut angle for this fraction
    const theta = Math.asin(clamp(1 - fraction, 0, 1));

    // Determine which side the CB is currently on
    const cbSide = {
      x: state.cueBall.x - ob.x,
      y: state.cueBall.y - ob.y,
    };
    const cross = cbSide.x * dp.y - cbSide.y * dp.x;
    const sign = cross >= 0 ? 1 : -1;

    // Rotate reverse pocket direction by theta to get aim-from-ghost direction
    const cosT = Math.cos(sign * theta);
    const sinT = Math.sin(sign * theta);
    const revDir = {
      x: -(dp.x * cosT - dp.y * sinT),
      y: -(dp.x * sinT + dp.y * cosT),
    };

    // Place CB at a reasonable distance along this direction
    const aimDist = clamp(dist(state.cueBall, gb), 10, 40);
    const newCB = {
      x: clamp(gb.x + revDir.x * aimDist, BR + 1, TW - BR - 1),
      y: clamp(gb.y + revDir.y * aimDist, BR + 1, TH - BR - 1),
    };

    // Animate to new position
    state.animTarget = newCB;
  }

  // ================================================================
  //  ANIMATION LOOP (dirty-flag architecture)
  // ================================================================
  /**
   * The render loop now uses a dirty-flag pattern:
   *  - Renders ONLY when state._isDirty is true
   *  - Keeps looping while an animation (animTarget) is active
   *  - Goes completely idle when nothing changes → 0% GPU
   */
  function loop() {
    state._rafId = null; // clear the pending rAF reference

    // Animate cue ball toward target
    let animating = false;
    if (state.animTarget) {
      const dx = state.animTarget.x - state.cueBall.x;
      const dy = state.animTarget.y - state.cueBall.y;
      if (dx * dx + dy * dy < 0.005) {
        state.cueBall.x = state.animTarget.x;
        state.cueBall.y = state.animTarget.y;
        state.animTarget = null;
      } else {
        state.cueBall.x += dx * 0.14;
        state.cueBall.y += dy * 0.14;
        animating = true;
      }
      state._isDirty = true; // animation always triggers render
    }

    // Only render if something changed
    if (state._isDirty) {
      renderTable();
      renderPerspective();
      updateUI(calcGeometry());
      state._isDirty = false;
    }

    // Keep looping only while animating; otherwise go idle
    if (animating) {
      state._rafId = requestAnimationFrame(loop);
    }
  }

  // ================================================================
  //  INITIALIZATION
  // ================================================================
  function init() {
    resize();
    markDirty(); // initial render
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
