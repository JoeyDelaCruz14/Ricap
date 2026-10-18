# Proposed Firebase rules for profile pictures and admin roles

Nothing here has been deployed. Merge these into your current rules in the Firebase console
(the repo has no rules files, so your existing rules for other paths are not shown here and must stay).

## 1. Who counts as admin

`admin-role.js` treats the admin email that your current Realtime Database rules already trust
(`auth.token.email === ...`) as admin, so no extra setup is needed for that account.
To add more admins later, either add their email hash in `admin-role.js` (and the email to your
rules), or use the optional `admins/<uid>` list below.

## 2. Optional: Realtime Database rule for an admins/ list

```json
"admins": {
  "$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": false
  }
}
```

Each user can only check their own entry; only the console (or the Admin SDK) can add admins.

## 3. Storage rules: add this match block

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // One picture per user, replaced on every upload.
    match /profile-pictures/{uid} {
      allow read: if true;
      allow create, update: if request.auth != null
                            && request.auth.token.firebase.sign_in_provider != 'anonymous'
                            && request.auth.uid == uid
                            && request.resource.size < 2 * 1024 * 1024
                            && request.resource.contentType.matches('image/(jpeg|png|webp)');
      allow delete: if request.auth != null && request.auth.uid == uid;
    }

    // Keep your existing rules for "Submitted images/" and "applications/" here.
  }
}
```

## 4. Firestore

`profiles/{key}.avatar` now holds the Storage download URL instead of a base64 image, and a new
`avatarUpdatedAt` timestamp is written next to it. No rule change is needed if your current
`profiles` rule already lets the user write their own profile document.
