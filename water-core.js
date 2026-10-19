// Shared water-ripple engine for Water Ripples.html and the login/sign-up box on main.html.
// RiCapWater.create(canvas, { input, scale, maxCells }) returns { start, stop, resize, drop }.
// The simulation runs on a small grid that CSS scales up smoothly, steps at a fixed 60 Hz
// (so 120 Hz screens don't run it twice as fast), and stops drawing when the water is calm.
// Sa madaling salita: ang "makina" ng gumagalaw na tubig na ginagamit ng login box at Water Ripples.html.
(function () {
  // Night-river colours taken from the site: #0b0c10 base, #a956e0 light, #d4af6a glints.
  var TOP = [30, 22, 52], BOTTOM = [11, 12, 16];
  var LIGHT = [169, 86, 224], GLINT = [255, 226, 170];
  var DAMP = 0.982;
  var STEP_MS = 1000 / 60;
  var CALM = 0.6;

  // Creates one water surface on a canvas.
  function create(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    var input = opts.input || canvas;
    var scale = opts.scale || 0.34;
    var maxCells = opts.maxCells || 90000;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var W = 0, H = 0, cur, prev, bg, imgData, out;
    var running = false, awake = false, rafId = 0, ambientId = 0, lastTime = 0, acc = 0;
    var lastX = null, lastY = null, cssW = 0, cssH = 0;

    // Precomputes the still-water picture (gradient plus light patterns).
    function buildBackground() {
      bg = new Float32Array(W * H * 3);
      var aspect = W / H;
      for (var y = 0; y < H; y++) {
        var t = y / H;
        var r0 = TOP[0] + (BOTTOM[0] - TOP[0]) * t;
        var g0 = TOP[1] + (BOTTOM[1] - TOP[1]) * t;
        var b0 = TOP[2] + (BOTTOM[2] - TOP[2]) * t;
        var v = t * 7;
        for (var x = 0; x < W; x++) {
          var u = x / W * 12 * (aspect > 1 ? 1 : aspect * 1.6);
          var a = Math.sin(u * 1.7 + Math.sin(v * 2.3) * 1.6);
          var b = Math.sin(v * 2.1 + Math.sin(u * 1.9) * 1.6);
          var c = Math.sin((u + v) * 1.3 + Math.sin(u * 0.7 - v * 1.1) * 2.0);
          var r1 = Math.pow((1 - Math.abs(a)) * (1 - Math.abs(b)), 3);
          var r2 = Math.pow(1 - Math.abs(c), 8);
          var light = (0.34 * r1 + 0.2 * r2) * (1 - t * 0.6);
          var i = (y * W + x) * 3;
          bg[i]     = r0 + LIGHT[0] * light;
          bg[i + 1] = g0 + LIGHT[1] * light;
          bg[i + 2] = b0 + LIGHT[2] * light;
        }
      }
    }

    // Draws the still water (used when calm).
    function paintFlat() {
      for (var i = 0, o = 0, n = W * H; i < n; i++, o += 4) {
        out[o] = bg[i * 3]; out[o + 1] = bg[i * 3 + 1]; out[o + 2] = bg[i * 3 + 2];
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // Sizes the simulation grid to the canvas, capped at maxCells.
    function resize() {
      var rect = canvas.getBoundingClientRect();
      cssW = rect.width || window.innerWidth;
      cssH = rect.height || window.innerHeight;
      var s = scale;
      if (cssW * cssH * s * s > maxCells) s = Math.sqrt(maxCells / (cssW * cssH));
      var w = Math.max(48, Math.round(cssW * s));
      var h = Math.max(48, Math.round(cssH * s));
      if (w === W && h === H && bg) return;
      W = w; H = h;
      canvas.width = W;
      canvas.height = H;
      cur = new Float32Array(W * H);
      prev = new Float32Array(W * H);
      buildBackground();
      imgData = ctx.createImageData(W, H);
      out = imgData.data;
      for (var o = 3; o < out.length; o += 4) out[o] = 255;
      paintFlat();
    }

    // Adds a ripple at grid position (cx, cy).
    function drop(cx, cy, radius, strength) {
      if (!W) return;
      var x0 = Math.max(1, Math.floor(cx - radius)), x1 = Math.min(W - 2, Math.ceil(cx + radius));
      var y0 = Math.max(1, Math.floor(cy - radius)), y1 = Math.min(H - 2, Math.ceil(cy + radius));
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var dx = x - cx, dy = y - cy;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < radius) cur[y * W + x] += strength * 0.5 * (1 + Math.cos(Math.PI * d / radius));
        }
      }
      awake = true;
    }

    // One wave step; returns the largest movement so a calm surface can go to sleep.
    function step() {
      var peak = 0;
      for (var y = 1; y < H - 1; y++) {
        var row = y * W;
        for (var x = 1; x < W - 1; x++) {
          var i = row + x;
          var s = ((cur[i - 1] + cur[i + 1] + cur[i - W] + cur[i + W]) * 0.5 - prev[i]) * DAMP;
          prev[i] = s;
          if (s > peak) peak = s; else if (-s > peak) peak = -s;
        }
      }
      var tmp = cur; cur = prev; prev = tmp;
      return peak;
    }

    // Refracts the background by the wave slope. ImageData clamps 0..255 by itself.
    function render() {
      var maxX = W - 1, maxY = H - 1;
      for (var y = 1; y < maxY; y++) {
        var row = y * W;
        for (var x = 1; x < maxX; x++) {
          var i = row + x;
          var dx = cur[i - 1] - cur[i + 1];
          var dy = cur[i - W] - cur[i + W];
          var sx = (x + dx * 0.3) | 0;
          var sy = (y + dy * 0.3) | 0;
          if (sx < 0) sx = 0; else if (sx > maxX) sx = maxX;
          if (sy < 0) sy = 0; else if (sy > maxY) sy = maxY;
          var s = (sy * W + sx) * 3;
          var shade = (dx - dy) * 0.55;
          var slope = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
          var glint = slope > 14 ? (slope - 14) * 0.022 : 0;
          if (glint > 1) glint = 1;
          var o = i * 4;
          out[o]     = bg[s] + shade + GLINT[0] * glint;
          out[o + 1] = bg[s + 1] + shade + GLINT[1] * glint;
          out[o + 2] = bg[s + 2] + shade * 1.15 + GLINT[2] * glint;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // Animation loop: fixed 60 Hz steps, drawing only while the water moves.
    function frame(now) {
      if (!running) return;
      rafId = requestAnimationFrame(frame);
      if (!awake) { lastTime = now; return; }
      acc += Math.min(now - (lastTime || now), 100);
      lastTime = now;
      var stepped = false, energy = 1;
      while (acc >= STEP_MS) {
        energy = step();
        acc -= STEP_MS;
        stepped = true;
        if (acc > STEP_MS * 2) acc = STEP_MS; // drop backlog instead of stuttering
      }
      if (!stepped) return;
      if (energy < CALM) {
        awake = false;
        cur.fill(0); prev.fill(0);
        paintFlat();
      } else {
        render();
      }
    }

    // Pointer position to grid position.
    function toSim(e) {
      var rect = canvas.getBoundingClientRect();
      return [(e.clientX - rect.left) / (rect.width || 1) * W, (e.clientY - rect.top) / (rect.height || 1) * H];
    }

    // Leaves a trail of small ripples along the pointer path.
    function onMove(e) {
      if (!running) return;
      var p = toSim(e);
      if (lastX === null) { lastX = p[0]; lastY = p[1]; }
      var mx = p[0] - lastX, my = p[1] - lastY;
      var dist = Math.sqrt(mx * mx + my * my);
      var steps = Math.min(24, Math.max(1, Math.ceil(dist / 2.5)));
      var strength = Math.min(60, 20 + dist * 5);
      for (var k = 1; k <= steps; k++) {
        var f = k / steps;
        drop(lastX + mx * f, lastY + my * f, 2.6, strength / Math.sqrt(steps));
      }
      lastX = p[0]; lastY = p[1];
    }

    function onLeave() { lastX = null; lastY = null; }

    // A bigger splash where the pointer presses.
    function onDown(e) {
      if (!running) return;
      var p = toSim(e);
      drop(p[0], p[1], 6, 220);
      lastX = p[0]; lastY = p[1];
    }

    input.addEventListener('pointermove', onMove, { passive: true });
    input.addEventListener('pointerleave', onLeave, { passive: true });
    input.addEventListener('pointerdown', onDown, { passive: true });

    // Occasional random drops (off with reduced motion).
    function ambient() {
      if (!running) return;
      if (!document.hidden) drop(6 + Math.random() * (W - 12), 6 + Math.random() * (H - 12), 3.5, 36 + Math.random() * 34);
      ambientId = setTimeout(ambient, 1600 + Math.random() * 2400);
    }

    // Two drops when the water starts.
    function seed() {
      drop(W * 0.3, H * 0.4, 5, 130);
      drop(W * 0.7, H * 0.62, 4, 100);
    }

    return {
      start: function () {
        if (running) return;
        running = true;
        resize();
        seed();
        lastTime = 0; acc = 0;
        if (!reduceMotion) ambientId = setTimeout(ambient, 1200);
        rafId = requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        cancelAnimationFrame(rafId);
        clearTimeout(ambientId);
        lastX = null; lastY = null;
      },
      resize: function () {
        var rect = canvas.getBoundingClientRect();
        if (Math.abs(rect.width - cssW) < 1 && Math.abs(rect.height - cssH) < 1) return;
        resize();
      },
      drop: drop
    };
  }

  window.RiCapWater = { create: create };
})();
