// Admin page (Admin.html), admins only: reviews official applications, generates access codes
// and emails them to approved applicants. The review itself lives in applications.js, which the
// Applications tab in Maintenance uses too.
// Sa madaling salita: pahina ng admin para tingnan at aprubahan ang mga application ng mga opisyal.

import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { isAdminUser } from './admin-role.js';
import { watchApplications } from './applications.js';

document.addEventListener('DOMContentLoaded', () => {
    const adminGate = document.getElementById('adminGate');
    const adminPanel = document.getElementById('adminPanel');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const adminLoginError = document.getElementById('adminLoginError');
    const adminEmailLabel = document.getElementById('adminEmailLabel');
    const appList = document.getElementById('appList');
    const adminEmptyState = document.getElementById('adminEmptyState');
    let unsubscribeList = null;

    adminLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        adminLoginError.hidden = true;
        try {
            await signInWithEmailAndPassword(auth,
                document.getElementById('adminEmail').value.trim(),
                document.getElementById('adminPassword').value);
        } catch (err) {
            adminLoginError.textContent = 'Sign-in failed — check the email and password.';
            adminLoginError.hidden = false;
        }
    });

    document.getElementById('adminSignOutBtn').addEventListener('click', () => signOut(auth));

    onAuthStateChanged(auth, async (user) => {
        const isAdmin = await isAdminUser(user);
        if (user !== auth.currentUser) return;
        if (user && !user.isAnonymous && !isAdmin) {
            adminLoginError.textContent = 'This account does not have admin access.';
            adminLoginError.hidden = false;
        }
        if (isAdmin) {
            adminGate.hidden = true;
            adminPanel.hidden = false;
            adminEmailLabel.textContent = user.email;
            if (!unsubscribeList) unsubscribeList = watchApplications(appList, adminEmptyState);
        } else {
            adminGate.hidden = false;
            adminPanel.hidden = true;
            if (unsubscribeList) { unsubscribeList(); unsubscribeList = null; }
        }
    });
});
