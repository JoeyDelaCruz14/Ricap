document.addEventListener('DOMContentLoaded', () => {
    const heroText = document.getElementById('heroText');
    if (!heroText) return;

    const text = heroText.textContent.trim();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    heroText.textContent = '';
    heroText.setAttribute('aria-label', text);

    const letters = text.split('').map((char, i) => {
        const span = document.createElement('span');
        span.className = 'letter';
        span.style.animationDelay = reduceMotion ? '0ms' : `${i * 90}ms`;
        span.textContent = char === ' ' ? '\u00A0' : char;
        span.setAttribute('aria-hidden', 'true');
        heroText.appendChild(span);
        return span;
    });

    const settle = () => {
        letters.forEach((letter) => {
            letter.style.animation = 'none';
            letter.style.opacity = '0.7';
            letter.style.transform = 'translateY(0) scale(1)';
            letter.style.filter = 'blur(0)';
            letter.classList.add('letter--interactive');
        });
        if (!reduceMotion) enableMagnetEffect(letters);
    };

    if (reduceMotion) {
        settle();
    } else {
        letters[letters.length - 1].addEventListener('animationend', settle, { once: true });
    }
});

function enableMagnetEffect(letters) {
    const maxDist = 300;        
    const liftAmount = 24;      
    const scaleAmount = 0.2;    
    const pullAmount = 12;     
    const gold = [238, 130, 238]; 
    const white = [255, 255, 255];

    let rafPending = false;
    let lastEvent = null;

    function update() {
        rafPending = false;
        if (!lastEvent) return;
        const { clientX, clientY } = lastEvent;

        letters.forEach((letter) => {
            const rect = letter.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = clientX - cx;
            const dy = clientY - cy;
            const dist = Math.hypot(dx, dy);
            const influence = Math.max(0, 1 - dist / maxDist);

            const lift = influence * liftAmount;
            const scale = 1 + influence * scaleAmount;
            const moveX = dist > 0 ? (dx / dist) * influence * pullAmount : 0;

            letter.style.transform = `translate(${moveX}px, ${-lift}px) scale(${scale})`;

            const t = influence;
            const r = Math.round(white[0] + (gold[0] - white[0]) * t);
            const g = Math.round(white[1] + (gold[1] - white[1]) * t);
            const b = Math.round(white[2] + (gold[2] - white[2]) * t);
            letter.style.color = t > 0.03 ? `rgb(${r}, ${g}, ${b})` : '';
        });
    }

    window.addEventListener('mousemove', (e) => {
        lastEvent = e;
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(update);
        }
    });

    window.addEventListener('mouseleave', () => {
        letters.forEach((letter) => {
            letter.style.transform = '';
            letter.style.color = '';
        });
    });
}