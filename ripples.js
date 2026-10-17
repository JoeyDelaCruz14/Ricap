(function () {
  var canvas = document.getElementById('water');
  var ctx = canvas.getContext('2d');
  var caption = document.getElementById('caption');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, cur, prev, bg, imgData, out;
  var DAMP = 0.985;

  function buildBackground() {
    bg = new Uint8ClampedArray(W * H * 4);
    for (var y = 0; y < H; y++) {
      var t = y / H;
      var r0 = 52 - 46 * t, g0 = 160 - 120 * t, b0 = 178 - 112 * t;
      var v = y / H * 7;
      for (var x = 0; x < W; x++) {
        var u = x / W * 12 * (W / H > 1 ? 1 : W / H * 1.6);
        var a = Math.sin(u * 1.7 + Math.sin(v * 2.3) * 1.6);
        var b = Math.sin(v * 2.1 + Math.sin(u * 1.9) * 1.6);
        var c = Math.sin((u + v) * 1.3 + Math.sin(u * 0.7 - v * 1.1) * 2.0);
        var r1 = Math.pow((1 - Math.abs(a)) * (1 - Math.abs(b)), 3);
        var r2 = Math.pow(1 - Math.abs(c), 8);
        var light = (70 * r1 + 38 * r2) * (1 - t * 0.55);
        var i = (y * W + x) * 4;
        bg[i]     = r0 + light * 0.8;
        bg[i + 1] = g0 + light;
        bg[i + 2] = b0 + light * 0.95;
        bg[i + 3] = 255;
      }
    }
  }

  function resize() {
    var scale = Math.min(0.5, 720 / Math.max(window.innerWidth, 1));
    W = Math.max(64, Math.floor(window.innerWidth * scale));
    H = Math.max(64, Math.floor(window.innerHeight * scale));
    canvas.width = W;
    canvas.height = H;
    cur = new Float32Array(W * H);
    prev = new Float32Array(W * H);
    buildBackground();
    imgData = ctx.createImageData(W, H);
    out = imgData.data;
    out.set(bg);
  }

  function drop(cx, cy, radius, strength) {
    var x0 = Math.max(1, Math.floor(cx - radius)), x1 = Math.min(W - 2, Math.ceil(cx + radius));
    var y0 = Math.max(1, Math.floor(cy - radius)), y1 = Math.min(H - 2, Math.ceil(cy + radius));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (d < radius) {
          cur[y * W + x] += strength * 0.5 * (1 + Math.cos(Math.PI * d / radius));
        }
      }
    }
  }

  function step() {
    var n = W * H;
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        var i = y * W + x;
        var s = (cur[i - 1] + cur[i + 1] + cur[i - W] + cur[i + W]) * 0.5 - prev[i];
        prev[i] = s * DAMP;
      }
    }
    var tmp = cur; cur = prev; prev = tmp;
  }

  function render() {
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        var i = y * W + x;
        var dx = cur[i - 1] - cur[i + 1];
        var dy = cur[i - W] - cur[i + W];
        var sx = x + (dx * 0.35) | 0;
        var sy = y + (dy * 0.35) | 0;
        if (sx < 0) sx = 0; else if (sx > W - 1) sx = W - 1;
        if (sy < 0) sy = 0; else if (sy > H - 1) sy = H - 1;
        var s = (sy * W + sx) * 4;
        var shade = (dx - dy) * 0.9;
        var spark = Math.max(0, (Math.abs(dx) + Math.abs(dy)) - 18) * 1.6;
        var o = i * 4;
        var rr = bg[s] + shade + spark;
        var gg = bg[s + 1] + shade + spark;
        var bb = bg[s + 2] + shade + spark;
        out[o]     = rr < 0 ? 0 : rr > 255 ? 255 : rr;
        out[o + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
        out[o + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        out[o + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  var lastX = null, lastY = null, touched = false;

  function toSim(e) {
    return [e.clientX / window.innerWidth * W, e.clientY / window.innerHeight * H];
  }

  function markUsed() {
    if (!touched) {
      touched = true;
      caption.classList.add('quiet');
    }
  }

  window.addEventListener('pointermove', function (e) {
    var p = toSim(e);
    if (lastX === null) { lastX = p[0]; lastY = p[1]; }
    var dist = Math.sqrt((p[0] - lastX) * (p[0] - lastX) + (p[1] - lastY) * (p[1] - lastY));
    var steps = Math.max(1, Math.ceil(dist / 3));
    var strength = Math.min(70, 22 + dist * 4);
    for (var k = 1; k <= steps; k++) {
      var f = k / steps;
      drop(lastX + (p[0] - lastX) * f, lastY + (p[1] - lastY) * f, 3, strength / Math.sqrt(steps));
    }
    lastX = p[0]; lastY = p[1];
    markUsed();
  });

  window.addEventListener('pointerleave', function () { lastX = null; lastY = null; });

  window.addEventListener('pointerdown', function (e) {
    var p = toSim(e);
    drop(p[0], p[1], 7, 260);
    lastX = p[0]; lastY = p[1];
    markUsed();
  });

  function ambient() {
    if (!reduceMotion && !document.hidden) {
      drop(8 + Math.random() * (W - 16), 8 + Math.random() * (H - 16), 4, 40 + Math.random() * 40);
    }
    setTimeout(ambient, 1800 + Math.random() * 2600);
  }

  window.addEventListener('resize', function () {
    resize();
    seed();
  });

  function seed() {
    drop(W * 0.32, H * 0.42, 6, 150);
    drop(W * 0.68, H * 0.58, 5, 110);
  }

  function frame() {
    step();
    render();
    requestAnimationFrame(frame);
  }

  resize();
  seed();
  ambient();
  requestAnimationFrame(frame);
})();