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

## 5. Realtime Database: full rules with accounts/ and applicationEmails/ added

Your two current blocks (`officialApplications`, `accessCodes`) are copied unchanged from the live
rules. Replace the whole rules JSON in the console with this (nothing else is removed).

```json
{
  "rules": {
    "officialApplications": {
      ".read": "auth != null && (auth.token.email === 'romromjoey14@gmail.com' || auth.token.email === 'admin14142006@gmail.com')",
      "$applicationId": {
        ".write": "(!data.exists() && newData.child('status').val() === 'pending') || (auth != null && (auth.token.email === 'romromjoey14@gmail.com' || auth.token.email === 'admin14142006@gmail.com'))"
      }
    },
    "accessCodes": {
      ".read": "auth != null && (auth.token.email === 'romromjoey14@gmail.com' || auth.token.email === 'admin14142006@gmail.com')",
      "$code": {
        ".read": true,
        ".write": "auth != null && (auth.token.email === 'romromjoey14@gmail.com' || auth.token.email === 'admin14142006@gmail.com')"
      }
    },
    "accounts": {
      "$key": {
        ".read": "auth != null",
        ".write": "auth != null && auth.token.email != null && $key === auth.token.email.toLowerCase().replace('.', ',') && (!data.exists() || !newData.exists())",
        ".validate": "newData.hasChildren(['createdAt'])"
      }
    },
    "applicationEmails": {
      "$key": {
        ".read": "auth != null",
        ".write": "auth != null && ((auth.token.email === 'romromjoey14@gmail.com' || auth.token.email === 'admin14142006@gmail.com') || (newData.val() === 'pending' && (!data.exists() || data.val() === 'rejected')))",
        ".validate": "newData.isString() && (newData.val() === 'pending' || newData.val() === 'approved' || newData.val() === 'rejected')"
      }
    },
    "admins": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": false
      }
    }
  }
}
```

What each new block allows:
- `accounts/<emailKey>`: any signed-in visitor (including the anonymous sign-in) can check if an
  email is taken; only the account itself can create its own entry (once) or delete it (Delete account on Profile).
- `applicationEmails/<emailKey>`: anyone signed in can read a status and mark an email `pending`
  (new application, or re-applying after `rejected`); only the two admin emails can set
  `approved` / `rejected`. Nobody else can mark themselves approved.
- `admins/<uid>`: optional list from section 2.

Known limit: an anonymous visitor could mark someone else's email as `pending`, which makes the
Verify page refuse that person's application until an admin rejects it. Same as today's
`officialApplications` rule, which also lets anyone create a pending application.

## 6. Access codes no longer saved on reports

New reports store `reporterKey` (a secret-keyed ID made by the `redeemAccessCode` Cloud Function)
instead of `reporterCode`. The key groups an official's reports but cannot be turned back into a code.

Steps, in this order (all done by you):

1. Create the secret (any long random string; keep a copy, the cleanup script needs it):
   `firebase functions:secrets:set REPORTER_KEY_SECRET`
2. Deploy the function: `firebase deploy --only functions:redeemAccessCode`
3. Dry run the cleanup, then apply it and issue new codes:
   ```
   cd functions
   set REPORTER_KEY_SECRET=<the same value>
   node scripts/remove-report-codes.js
   node scripts/remove-report-codes.js --apply --rotate
   ```
   It prints each official's new code; send them out. Old codes stop working.
4. Optional Firestore rule so no new report can carry a code again. Add inside your existing
   `match /reports/{id}` block's create condition (keep what you already check):
   ```
   allow create: if <your current condition>
                 && !('reporterCode' in request.resource.data)
                 && (!('reporterKey' in request.resource.data)
                     || request.resource.data.reporterKey == ''
                     || request.resource.data.reporterKey == request.auth.token.reporterKey);
   ```

## 7. Delete account (Profile)

Delete account removes, in this order: the profile picture (Storage rule in section 3 already allows
the owner to delete), `alertSubscribers/<uid>`, `profiles/<key>`, `accounts/<emailKey>` (section 5
rule now allows the owner to delete it), then the Firebase login. Each step that your rules refuse is
skipped with a console warning; the login is still deleted. For Firestore, the owner needs delete
permission on their own docs, for example:

```
match /alertSubscribers/{uid} {
  allow delete: if request.auth != null && request.auth.uid == uid;
}
match /profiles/{key} {
  allow delete: if request.auth != null && request.auth.uid == resource.data.uid;
}
```
