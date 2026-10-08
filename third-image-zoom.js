document.addEventListener('DOMContentLoaded', () => {
    const image = document.querySelector('.third-image');
    const section = document.querySelector('.third');
    if (!image || !section) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const maxScale = 1.12; 
    let ticking = false;

    function update() {
        ticking = false;

        const rect = section.getBoundingClientRect();
        const vh = window.innerHeight;
        const progress = Math.min(Math.max((vh - rect.top) / (vh + rect.height), 0), 1);
        const scale = 1 + progress * (maxScale - 1);

        image.style.transform = `scale(${scale})`;
    }

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