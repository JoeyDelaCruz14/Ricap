// Effects and the auth modal on main.html: reveal on scroll, video dimming and card tilt on scroll,
// cursor glow and magnetic buttons (mouse only), opening/closing the login and sign-up modal,
// show/hide password and the password strength bar.
// The login and sign-up submit handlers at the end are the old local-only versions; admin-login.js
// and account-auth.js handle those forms first and stop these from running.

document.addEventListener("DOMContentLoaded", () => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const isSmallScreen = window.matchMedia("(max-width: 900px)").matches;
    const allowPointerFX = canHover && !prefersReducedMotion && !isSmallScreen;
    // Fade elements in as they scroll into view.
    const revealElements = document.querySelectorAll(".reveal");

    const revealObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            const el = entry.target;

            if (entry.isIntersecting) {
                el.classList.add("in-view");
                el.classList.remove("reveal--blur-out");
            } else if (el.classList.contains("in-view") && entry.boundingClientRect.top < 0) {
                el.classList.add("reveal--blur-out");
            }
        });
    }, { threshold: 0.12 });

    revealElements.forEach(element => revealObserver.observe(element));
    // Scroll effects: dim the background video and tilt cards.
    const video = document.getElementById("bg-video");
    const videoBackground = document.querySelector(".video-background");
    const scrollTiltElements = Array.from(document.querySelectorAll(".scroll-tilt"));
    let videoDim = null;
    if (videoBackground) {
        videoDim = document.createElement("div");
        videoDim.className = "video-dim";
        videoBackground.appendChild(videoDim);
    }

    const tiltVisible = new Set();
    let viewportHeight = window.innerHeight;
    let scrollTicking = false;

    // Runs updateOnScroll() at most once per frame.
    function requestScrollUpdate() {
        if (scrollTicking) return;
        scrollTicking = true;
        requestAnimationFrame(updateOnScroll);
    }

    // Dims the video and tilts visible cards by scroll position.
    function updateOnScroll() {
        scrollTicking = false;
        const y = window.scrollY || document.documentElement.scrollTop;

        const viewportCenter = viewportHeight / 2;
        const measurements = [];
        if (!prefersReducedMotion) {
            tiltVisible.forEach(element => {
                const rect = element.getBoundingClientRect();
                measurements.push({ element: element, center: rect.top + rect.height / 2 });
            });
        }

        if (video && !prefersReducedMotion) {
            const scale = 1.05 + Math.min(y / 5000, 0.08);
            video.style.transform = "scale(" + scale.toFixed(4) + ")";
        }
        if (videoDim) {
            videoDim.style.opacity = Math.min(0.45, y / 2500).toFixed(3);
        }

        measurements.forEach(item => {
            const distance = Math.max(-1, Math.min(1, (item.center - viewportCenter) / viewportCenter));
            const rotateX = distance * 8;
            const scale = 1 - Math.abs(distance) * 0.06;
            item.element.style.transform =
                "perspective(900px) rotateX(" + (-rotateX).toFixed(2) + "deg) scale(" + scale.toFixed(3) + ")";
        });
    }

    if (scrollTiltElements.length && !prefersReducedMotion) {
        const tiltObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) tiltVisible.add(entry.target);
                else tiltVisible.delete(entry.target);
            });
            requestScrollUpdate();
        }, { rootMargin: "20% 0px 20% 0px" });

        scrollTiltElements.forEach(element => tiltObserver.observe(element));
    }

    window.addEventListener("scroll", requestScrollUpdate, { passive: true });
    window.addEventListener("resize", () => {
        viewportHeight = window.innerHeight;
        requestScrollUpdate();
    }, { passive: true });
    requestScrollUpdate();

    if (allowPointerFX) {
        const cursorGlow = document.createElement("div");
        cursorGlow.className = "cursor-glow";
        document.body.appendChild(cursorGlow);

        const hero = document.querySelector(".hero-content");

        let mouseX = window.innerWidth / 2;
        let mouseY = window.innerHeight / 2;
        let glowX = mouseX;
        let glowY = mouseY;
        let heroX = 0;
        let heroY = 0;
        let pointerLoopRunning = false;

        // Moves the cursor glow.
        function paintGlow() {
            cursorGlow.style.transform =
                "translate3d(" + glowX.toFixed(1) + "px, " + glowY.toFixed(1) + "px, 0) translate(-50%, -50%)";
        }

        // Eases the glow (and hero) towards the mouse every frame.
        function pointerLoop() {
            glowX += (mouseX - glowX) * 0.08;
            glowY += (mouseY - glowY) * 0.08;
            paintGlow();

            if (hero) {
                hero.style.transform = "translate3d(" + (heroX * 12).toFixed(2) + "px, " + (heroY * 12).toFixed(2) + "px, 0)";
            }

            if (Math.abs(mouseX - glowX) > 0.5 || Math.abs(mouseY - glowY) > 0.5) {
                requestAnimationFrame(pointerLoop);
            } else {
                pointerLoopRunning = false;
            }
        }

        document.addEventListener("mousemove", event => {
            mouseX = event.clientX;
            mouseY = event.clientY;
            heroX = event.clientX / window.innerWidth - 0.5;
            heroY = event.clientY / window.innerHeight - 0.5;

            if (!pointerLoopRunning) {
                pointerLoopRunning = true;
                requestAnimationFrame(pointerLoop);
            }
        }, { passive: true });

        paintGlow();
    }

    if (allowPointerFX) {
        document.querySelectorAll(".magnetic").forEach(button => {
            button.addEventListener("mousemove", event => {
                const rect = button.getBoundingClientRect();
                const x = event.clientX - rect.left - rect.width / 2;
                const y = event.clientY - rect.top - rect.height / 2;
                button.style.transform = `translate(${x * .15}px, ${y * .15}px)`;
            });

            button.addEventListener("mouseleave", () => {
                button.style.transform = "translate(0, 0)";
            });
        });

        document.querySelectorAll(".tilt-card").forEach(card => {
            card.addEventListener("mousemove", event => {
                const rect = card.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                const rotateY = ((x / rect.width) - .5) * 10;
                const rotateX = ((y / rect.height) - .5) * -10;
                card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
            });

            card.addEventListener("mouseleave", () => {
                card.style.transform = "perspective(900px) rotateX(0) rotateY(0) scale(1)";
            });
        });
    }

    // Login / sign-up modal.
    const authModal = document.getElementById("authModal");
    const authClose = document.getElementById("authClose");
    const authTabs = document.querySelectorAll(".auth-tab");
    const loginForm = document.getElementById("loginForm");
    const signupForm = document.getElementById("signupForm");
    const authTitle = document.getElementById("authTitle");
    const authSubtitle = document.getElementById("authSubtitle");

    // Opens the login / sign-up modal on the given tab.
    function openAuth(tab = "login") {
        if (!authModal) return;
        authModal.classList.add("open");
        document.body.style.overflow = "hidden";
        switchAuth(tab);
    }

    // Closes the modal.
    function closeAuth() {
        if (!authModal) return;
        authModal.classList.remove("open");
        document.body.style.overflow = "";
    }

    // Switches between the Log In and Sign Up tabs.
    function switchAuth(tab) {
        authTabs.forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
        loginForm.classList.toggle("active", tab === "login");
        signupForm.classList.toggle("active", tab === "signup");

        if (tab === "login") {
            authTitle.textContent = "Welcome back.";
            authSubtitle.textContent = "Log in to continue to RiCap.";
        } else {
            authTitle.textContent = "Join RiCap.";
            authSubtitle.textContent = "Create your account and start monitoring.";
        }
    }

    document.querySelectorAll("[data-auth]").forEach(button => {
        button.addEventListener("click", () => openAuth(button.dataset.auth));
    });

    authTabs.forEach(tab => {
        tab.addEventListener("click", () => switchAuth(tab.dataset.tab));
    });

    if (authClose) authClose.addEventListener("click", closeAuth);
    const backdrop = document.querySelector(".auth-backdrop");
    if (backdrop) backdrop.addEventListener("click", closeAuth);
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && authModal && authModal.classList.contains("open")) closeAuth();
    });

    document.querySelectorAll(".password-toggle").forEach(button => {
        button.addEventListener("click", () => {
            const target = document.getElementById(button.dataset.target);
            if (!target) return;

            if (target.type === "password") {
                target.type = "text";
                button.textContent = "Hide";
            } else {
                target.type = "password";
                button.textContent = "Show";
            }
        });
    });

    // Password strength bar on the sign-up form.
    const password = document.getElementById("signupPassword");
    const strengthProgress = document.getElementById("strengthProgress");
    const strengthText = document.getElementById("strengthText");

    if (password) {
        password.addEventListener("input", () => {
            const value = password.value;
            let score = 0;
            if (value.length >= 8) score++;
            if (/[A-Z]/.test(value)) score++;
            if (/[0-9]/.test(value)) score++;
            if (/[^A-Za-z0-9]/.test(value)) score++;
            strengthProgress.style.width = (score * 25) + "%";
            const labels = ["Enter a password", "Weak password", "Fair password", "Good password", "Strong password"];
            strengthText.textContent = labels[score];
        });
    }

    // Small message at the bottom of the page.
    const showToast = message => {
        const toast = document.getElementById("toast");
        const toastMessage = document.getElementById("toastMessage");
        if (!toast) return;
        toastMessage.textContent = message;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3000);
    };

    // Old local sign-up (see the note at the top of this file).
    signupForm.addEventListener("submit", event => {
        event.preventDefault();

        const name = document.getElementById("signupName").value.trim();
        const email = document.getElementById("signupEmail").value.trim();
        const passwordValue = document.getElementById("signupPassword").value;
        if (!name || !email || !passwordValue) {
            showToast("Please complete all fields.");
            return;
        }

        localStorage.setItem("ricapAccount", JSON.stringify({ name, email, password: passwordValue }));
        signupForm.reset();
        strengthProgress.style.width = "0%";
        strengthText.textContent = "Enter a password";
        switchAuth("login");
        document.getElementById("loginEmail").value = email;
        showToast("Account created successfully.");
    });

    // Old local login (see the note at the top of this file).
    loginForm.addEventListener("submit", event => {
        event.preventDefault();

        const email = document.getElementById("loginEmail").value.trim();
        const passwordValue = document.getElementById("loginPassword").value;
        const savedAccount = localStorage.getItem("ricapAccount");
        if (!savedAccount) {
            showToast("No account found. Please sign up first.");
            return;
        }
        const account = JSON.parse(savedAccount);
        if (email !== account.email || passwordValue !== account.password) {
            showToast("Incorrect email or password.");
            return;
        }

        localStorage.setItem("ricapLoggedIn", "true");
        closeAuth();
        showToast("Welcome back, " + account.name + ".");
    });

});