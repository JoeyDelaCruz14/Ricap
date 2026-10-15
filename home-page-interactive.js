(function () {
    'use strict';

    const root = document.documentElement;
    root.classList.add('hp-js');

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduceMotion = () => motionQuery.matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

    const nav = document.getElementById('nav');
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    const feed = document.getElementById('forumFeed');
    const backToTop = document.getElementById('backToTop');
    const title = document.querySelector('.forum-title');


    let ticking = false;
    function onScroll() {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            ticking = false;
            const y = window.scrollY;
            if (nav) nav.classList.toggle('is-condensed', y > 24);
            if (backToTop) backToTop.classList.toggle('is-visible', y > window.innerHeight * 0.9);
        });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();


    function scrollToTarget(target) {
        target.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
    }

    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a || a.getAttribute('href').length < 2) return;
        const target = document.getElementById(a.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        scrollToTarget(target);
    });

    if (backToTop) {
        backToTop.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
            if (title) title.focus({ preventScroll: true });
        });
    }


    function menuOpen() {
        return !!links && links.classList.contains('open');
    }

    function closeMenu(returnFocus) {
        if (!menuOpen()) return;
        links.classList.remove('open');
        if (toggle) {
            toggle.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
            if (returnFocus) toggle.focus();
        }
    }

    if (links && toggle) {
        new MutationObserver(() => {
            const open = menuOpen();
            document.body.classList.toggle('hp-menu-open', open);
            if (open && toggle.offsetParent !== null) {
                const first = links.querySelector('li:not([hidden]) a');
                if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
            }
        }).observe(links, { attributes: true, attributeFilter: ['class'] });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && menuOpen()) closeMenu(true);
        });

        document.addEventListener('click', (e) => {
            if (!menuOpen()) return;
            if (toggle.contains(e.target)) return;
            if (e.target.closest('#navLinks a') || !links.contains(e.target)) closeMenu(false);
        });

        window.addEventListener('resize', () => {
            if (menuOpen() && toggle.offsetParent === null) closeMenu(false);
        });
    }


    const seenPosts = new Set();

    const revealObserver = 'IntersectionObserver' in window
        ? new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                el.classList.add('is-in');
                if (el.dataset.id) seenPosts.add(el.dataset.id);
                revealObserver.unobserve(el);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
        : null;

    function reveal(el, delay) {
        if (!revealObserver || reduceMotion()) return;
        el.classList.add('hp-reveal');
        el.style.setProperty('--hp-delay', (delay || 0) + 'ms');
        revealObserver.observe(el);
    }

    document.querySelectorAll('.forum-sidebar .sidebar-block').forEach((block, i) => {
        if (block.getBoundingClientRect().top > window.innerHeight) reveal(block, Math.min(i, 4) * 70);
    });


    function prepareFeed() {
        let fresh = 0;
        feed.querySelectorAll(':scope > .post').forEach((post) => {
            if (post.classList.contains('hp-reveal')) return;
            if (seenPosts.has(post.dataset.id) || reduceMotion()) {
                post.classList.add('hp-reveal', 'is-settled', 'is-in');
                return;
            }
            reveal(post, Math.min(fresh, 5) * 70);
            fresh += 1;
        });
    }

    if (feed) {
        new MutationObserver(prepareFeed).observe(feed, { childList: true });
        prepareFeed();
    }


    if (feed) {
        let tiltCard = null;
        let tiltFrame = 0;
        let lastEvent = null;

        function resetTilt(card) {
            if (!card) return;
            card.classList.remove('is-tilting');
            card.style.removeProperty('--rx');
            card.style.removeProperty('--ry');
        }

        feed.addEventListener('pointermove', (e) => {
            if (!finePointer.matches || reduceMotion() || e.pointerType !== 'mouse') return;
            const card = e.target.closest('.post');
            if (card !== tiltCard) { resetTilt(tiltCard); tiltCard = card; }
            if (!card || card.matches(':focus-within')) { resetTilt(card); return; }
            lastEvent = e;
            if (tiltFrame) return;
            tiltFrame = requestAnimationFrame(() => {
                tiltFrame = 0;
                if (!tiltCard || !lastEvent) return;
                const r = tiltCard.getBoundingClientRect();
                const px = (lastEvent.clientX - r.left) / r.width - 0.5;
                const py = (lastEvent.clientY - r.top) / r.height - 0.5;
                tiltCard.classList.add('is-tilting');
                tiltCard.style.setProperty('--rx', (-py * 3).toFixed(2) + 'deg');
                tiltCard.style.setProperty('--ry', (px * 3).toFixed(2) + 'deg');
            });
        });

        feed.addEventListener('pointerleave', () => { resetTilt(tiltCard); tiltCard = null; });
        feed.addEventListener('focusin', (e) => resetTilt(e.target.closest('.post')));
    }


    const statIds = ['statReports', 'statRivers', 'statOfficials'];
    const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

    statIds.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;

        let shown = 0;
        let frame = 0;
        const observer = new MutationObserver(onWrite);

        function write(text) {
            el.textContent = text;
            observer.takeRecords();
        }

        function onWrite() {
            const target = parseInt(el.textContent.replace(/[^\d-]/g, ''), 10);
            if (!Number.isFinite(target)) return;
            cancelAnimationFrame(frame);

            if (reduceMotion() || target === shown) {
                shown = target;
                write(target.toLocaleString());
                return;
            }

            const from = shown;
            const duration = Math.min(1600, 700 + Math.abs(target - from) * 12);
            const start = performance.now();
            write(from.toLocaleString());

            const step = (now) => {
                const t = Math.min(1, (now - start) / duration);
                shown = Math.round(from + (target - from) * easeOutExpo(t));
                write(shown.toLocaleString());
                if (t < 1) frame = requestAnimationFrame(step);
            };
            frame = requestAnimationFrame(step);
        }

        observer.observe(el, { childList: true, characterData: true, subtree: true });
        if (el.textContent.trim() !== '0') onWrite();
    });
})();
