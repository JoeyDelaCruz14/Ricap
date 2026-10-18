// Contact form on main.html: checks the fields and shows a confirmation toast.
// Sa madaling salita: sinusuri nito ang contact form at nagpapakita ng mensahe kapag naipadala.

document.addEventListener("DOMContentLoaded", () => {
    const contactForm = document.getElementById("contactForm");
    const toast = document.getElementById("toast");
    const toastMessage = document.getElementById("toastMessage");
    // Simple email format check.
    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    // Confirmation message.
    function showContactToast(message) {
        if (!toast || !toastMessage) return;
        toastMessage.textContent = message;
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 3000);
    }

    if (!contactForm) return;

    contactForm.addEventListener("submit", event => {
        event.preventDefault();
        const name = document.getElementById("contactName").value.trim();
        const email = document.getElementById("contactEmail").value.trim();
        const message = document.getElementById("contactMessage").value.trim();
        if (!name || !email || !message) {
            showContactToast("Please complete all fields.");
            return;
        }
        if (!isValidEmail(email)) {
            showContactToast("Please enter a valid email.");
            return;
        }
        contactForm.reset();
        showContactToast("Thank you. Your message has been received.");
    });
});