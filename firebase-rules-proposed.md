# Proposed Firebase rules for profile pictures and admin roles

Nothing here has been deployed. Merge these into your current rules in the Firebase console
(the repo has no rules files, so your existing rules for other paths are not shown here and must stay).

## 1. Before deploying the new code: list your admins

Citizens now sign in with Firebase email/password too, so "signed in" no longer means "admin".
For every existing admin:

1. Firebase console → Authentication → Users → copy the admin's **User UID**.
2. Realtime Database → Data → add `admins/<that uid>` = `true` (boolean).

Without this, admins will see "This account does not have admin access." on Admin and Maintenance.

## 2. Realtime Database rules: add this node

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
