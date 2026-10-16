(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const form = $('applyForm');
    if (!form) return;

    const fields = [
        { el: $('firstName'), msg: 'Enter your first name.' },
        { el: $('lastName'), msg: 'Enter your last name.' },
        { el: $('roleInput'), msg: 'Choose your role.' },
        { el: $('orgInput'), msg: 'Enter your organization or barangay.' },
        { el: $('emailInput'), msg: 'Enter a valid email address, e.g. you@example.com.' },
        { el: $('phoneInput'), msg: 'Enter a PH mobile number, e.g. 09171234567.' }
    ].filter(f => f.el);
    const requiredFields = fields.filter(f => f.el.required);

    const capturePreview = $('capturePreview');
    const captureBox = $('captureBox');
    const fileInput = $('fileInput');
    const fill = $('applyProgressFill');
    const text = $('applyProgressText');
    const steps = $('applySteps');

    const touched = new WeakSet();

    const firstName = $('firstName'), lastName = $('lastName'), fullName = $('fullName');
    function syncFullName() {
        if (!fullName || !firstName || !lastName) return;
        fullName.value = [firstName.value.trim(), lastName.value.trim()].filter(Boolean).join(' ');
    }
    [firstName, lastName].forEach(el => el && el.addEventListener('input', syncFullName));
    form.addEventListener('reset', () => setTimeout(syncFullName));
    syncFullName();

    function isValid(el) {
        if (el.id === 'phoneInput') return el.value.trim() === '' || /^(09|\+639)\d{9}$/.test(el.value.replace(/[\s-]/g, ''));
        return el.value.trim() !== '' && el.checkValidity();
    }

    function hasPhoto() {
        return !!capturePreview && !capturePreview.hidden;
    }

    function messageFor(f) {
        const id = f.el.id + 'Msg';
        let m = $(id);
        if (!m) {
            m = document.createElement('small');
            m.id = id;
            m.className = 'field-msg';
            m.setAttribute('aria-live', 'polite');
            f.el.closest('.field').appendChild(m);
            const describedBy = (f.el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean);
            describedBy.push(id);
            f.el.setAttribute('aria-describedby', describedBy.join(' '));
        }
        return m;
    }

    function check(f) {
        if (!touched.has(f.el)) return;
        const ok = isValid(f.el);
        const field = f.el.closest('.field');
        field.classList.toggle('is-valid', ok);
        field.classList.toggle('is-invalid', !ok);
        f.el.setAttribute('aria-invalid', String(!ok));
        messageFor(f).textContent = ok ? '' : f.msg;
    }

    function update() {
        const doneFields = requiredFields.filter(f => isValid(f.el)).length;
        const photo = hasPhoto();
        const done = doneFields + (photo ? 1 : 0);
        const total = requiredFields.length + 1;

        if (fill) fill.style.width = Math.round((done / total) * 100) + '%';
        if (text) {
            text.textContent = done === total
                ? 'All set. Review your details, then submit.'
                : done + ' of ' + total + ' complete';
        }
        form.classList.toggle('is-complete', done === total);

        if (steps) {
            const detailsDone = doneFields === requiredFields.length && fields.every(f => isValid(f.el));
            const state = {
                details: detailsDone ? 'done' : 'current',
                photo: photo ? 'done' : (detailsDone ? 'current' : ''),
                review: detailsDone && photo ? 'current' : '',
                code: ''
            };
            steps.querySelectorAll('li[data-step]').forEach(li => {
                const s = state[li.dataset.step];
                li.classList.toggle('is-done', s === 'done');
                li.classList.toggle('is-current', s === 'current');
            });
        }
    }

    fields.forEach(f => {
        const evt = f.el.tagName === 'SELECT' ? 'change' : 'input';
        f.el.addEventListener(evt, () => { check(f); update(); });
        f.el.addEventListener('blur', () => {
            if (f.el.value !== '' || touched.has(f.el)) touched.add(f.el);
            check(f);
            update();
        });
    });

    if (capturePreview) {
        new MutationObserver(update).observe(capturePreview, { attributes: true, attributeFilter: ['hidden'] });
    }

    const submitBtn = $('applySubmitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            fields.forEach(f => { touched.add(f.el); check(f); });
            if (!hasPhoto() && captureBox) {
                captureBox.classList.remove('is-missing');
                void captureBox.offsetWidth;
                captureBox.classList.add('is-missing');
            }
        });
    }

    if (captureBox && fileInput) {
        const canDrop = () => !$('captureEmpty').hidden;
        ['dragenter', 'dragover'].forEach(type => captureBox.addEventListener(type, e => {
            if (!canDrop()) return;
            e.preventDefault();
            captureBox.classList.add('is-dragover');
        }));
        ['dragleave', 'dragend'].forEach(type => captureBox.addEventListener(type, () => {
            captureBox.classList.remove('is-dragover');
        }));
        captureBox.addEventListener('drop', e => {
            captureBox.classList.remove('is-dragover');
            if (!canDrop() || !e.dataTransfer || !e.dataTransfer.files.length) return;
            e.preventDefault();
            try {
                fileInput.files = e.dataTransfer.files;
                fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (err) {
                console.warn('RiCap: drag and drop not supported here; use the Upload photo button', err);
            }
        });
        captureBox.addEventListener('animationend', () => captureBox.classList.remove('is-missing'));
    }

    update();
})();
