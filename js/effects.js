// Liquid cursor trail. Runs only on devices with a precise hovering pointer and
// no reduced-motion preference; created/destroyed live as those media queries change.
(function () {
  const canvas = document.getElementById("liquid");
  if (!canvas || !window.Liquid) return;

  const allowed = window.matchMedia(
    "(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)"
  );
  let instance = null;

  function sync() {
    if (allowed.matches && !instance) {
      canvas.hidden = false;
      instance = window.Liquid.createLiquid(
        { source: null, content: null, output: canvas },
        { color: [0.29, 0.933, 0.627] } // Reroll green #4aeea0
      );
      // No WebGL2 / float render targets: leave the page untouched.
      if (!instance) canvas.hidden = true;
    } else if (!allowed.matches && instance) {
      instance.destroy();
      instance = null;
      canvas.hidden = true;
    }
  }

  sync();
  allowed.addEventListener("change", sync);
})();
