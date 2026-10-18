// Full-screen water surface for Water Ripples.html (engine: water-core.js).
// Sa madaling salita: ang gumagalaw na tubig sa Water Ripples.html.
(function () {
  var canvas = document.getElementById('water');
  if (!canvas || !window.RiCapWater) return;
  var water = window.RiCapWater.create(canvas, { input: window, scale: 0.34, maxCells: 110000 });
  if (!water) return;

  var pending = 0;
  window.addEventListener('resize', function () {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(water.resize);
  });

  water.start();
})();
