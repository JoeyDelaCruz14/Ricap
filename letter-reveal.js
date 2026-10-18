// Reveals an SVG title while scrolling. Not loaded by any page at the moment.
// Sa madaling salita: unti-unting lumalabas ang pamagat habang nag-i-scroll (hindi pa ginagamit).

document.addEventListener('DOMContentLoaded', () => {
    const wrap = document.getElementById('letterRevealWrap');
    const svg = document.getElementById('letterRevealSvg');
    if (!wrap || !svg) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return; 
    let ticking = false;
    // Reveals the letters by how far the section has scrolled.
    function update() {
        ticking = false;
        const rect = wrap.getBoundingClientRect();
        const total = rect.height - window.innerHeight;
        const scrolled = Math.min(Math.max(-rect.top, 0), total);
        const progress = total > 0 ? scrolled / total : 0;
        const reveal = Math.min(progress / 0.6, 1);
        const scale = 0.6 + reveal * 0.4;
        svg.style.opacity = reveal;
        svg.style.transform = `scale(${scale})`;
    }

    // Runs update() at most once per frame.
    function onScroll() {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(update);
        }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    update();
});