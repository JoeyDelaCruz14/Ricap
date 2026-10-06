document.addEventListener('DOMContentLoaded', () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const elements = Array.from(document.querySelectorAll('.reveal'));
    if (!elements.length) return;

    const groups = new Map();
    elements.forEach((el) => {
        const parent = el.parentElement;
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(el);
    });

    groups.forEach((siblings) => {
        siblings.forEach((el, i) => {
            if (!el.style.getPropertyValue('--reveal-delay')) {
                el.style.setProperty('--reveal-delay', reduceMotion ? '0s' : `${i * 0.12}s`);
            }
        });
    });

    if (reduceMotion) {
        elements.forEach((el) => el.classList.add('in-view'));
        return;
    }

    let lastScrollY = window.scrollY;
    let scrollingUp = false;
    window.addEventListener('scroll', () => {
        const currentY = window.scrollY;
        scrollingUp = currentY < lastScrollY;
        lastScrollY = currentY;
    }, { passive: true });

    const revealedOnce = new WeakSet();

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            const el = entry.target;

            if (entry.isIntersecting) {
                el.classList.remove('reveal--blur-out');
                el.classList.add('in-view');
                revealedOnce.add(el);
            } else if (revealedOnce.has(el) && scrollingUp) {
                el.classList.remove('in-view');
                el.classList.add('reveal--blur-out');
            }
        });
    }, { threshold: 0.2 });

    elements.forEach((el) => observer.observe(el));
});