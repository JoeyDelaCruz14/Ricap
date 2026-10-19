// Nav for main.html: shadow on scroll and the mobile menu (closes on link click, Esc or outside click).
// Sa madaling salita: ang menu sa itaas ng main.html (anino kapag nag-scroll at menu sa cellphone).

document.addEventListener('DOMContentLoaded', () => {

    const nav = document.getElementById('nav');
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    const scrubFill = document.getElementById('navScrubFill');

    if (!nav || !toggle || !links) return;

    // Opens the mobile menu.
    function openMenu() {
        toggle.classList.add('open');
        links.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
    }

    // Closes the mobile menu.
    function closeMenu() {
        toggle.classList.remove('open');
        links.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
    }

    // True while the mobile menu is open.
    function isOpen() {
        return links.classList.contains('open');
    }

    toggle.addEventListener('click', () => {
        if (isOpen()) {
            closeMenu();
        } else {
            openMenu();
        }
    });

    links.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
            closeMenu();
        });
    });

    document.addEventListener('click', (e) => {
        if (!isOpen()) return;
        if (links.contains(e.target) || toggle.contains(e.target)) return;
        closeMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen()) {
            closeMenu();
        }
    });

    // Nav shadow once the page is scrolled.
    function updateOnScroll() {
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;

        if (scrollTop > 10) {
            nav.classList.add('scrolled');
        } else {
            nav.classList.remove('scrolled');
        }

        if (scrubFill && docHeight > 0) {
            const progress = Math.min(100, Math.max(0, (scrollTop / docHeight) * 100));
            scrubFill.style.width = progress + '%';
        }
    }

    window.addEventListener('scroll', updateOnScroll, { passive: true });
    window.addEventListener('resize', updateOnScroll);
    updateOnScroll();
});