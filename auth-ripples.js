// Water surface inside the login/sign-up box (engine: water-core.js).
// Runs only while #authModal has the "open" class, so it costs nothing when the modal is closed.
// Sa madaling salita: ito ang gumagalaw na tubig sa likod ng login/sign-up box.
(function () {
  var modal = document.getElementById('authModal');
  var box = modal && modal.querySelector('.auth-box');
  var canvas = document.getElementById('authWater');
  if (!modal || !box || !canvas || !window.RiCapWater) return;
  var water = window.RiCapWater.create(canvas, { input: box, scale: 0.4, maxCells: 70000 });
  if (!water) return;

  // The box scrolls on small screens; keep the water and its veil pinned to the visible part.
  function pin() { box.style.setProperty('--water-y', box.scrollTop + 'px'); }
  box.addEventListener('scroll', pin, { passive: true });

  // Switching Log In / Sign Up changes the box height.
  var pending = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(water.resize);
    }).observe(box);
  }

  // home-interactive.js and admin-login.js open/close the modal by toggling "open".
  function sync() {
    if (modal.classList.contains('open')) {
      pin();
      water.start();
    } else {
      water.stop();
    }
  }
  new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
