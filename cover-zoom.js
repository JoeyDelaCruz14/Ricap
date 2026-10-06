document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('bg-video');
    const hero = document.querySelector('.hero');
    if (!video || !hero) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const maxScale = 1.85; 
    let ticking = false;

    function update() {
        ticking = false;

        const rect = hero.getBoundingClientRect();
        const progress = Math.min(Math.max(-rect.top / rect.height, 0), 1);
        const scale = 1 + progress * (maxScale - 1);

        video.style.transform = `scale(${scale})`;
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