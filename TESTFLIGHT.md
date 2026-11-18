# Getting Heptad onto your iPhone (TestFlight)

The **TestFlight** GitHub workflow builds, signs and uploads the app. You then install it with Apple's TestFlight app. Signing needs your Apple account, so a few steps are yours (one time only):

## 1. Apple Developer Program
You need a paid membership ([developer.apple.com/programs](https://developer.apple.com/programs/)). Your **Team ID** is on the Membership page.

## 2. Register the app
1. [Certificates, IDs & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list) → **+** → App IDs → App. Bundle ID: `com.pristinep.heptad` (or your own; see step 4).
2. [App Store Connect](https://appstoreconnect.apple.com/apps) → **+** → New App. Platform iOS, name "Heptad", that bundle ID, any SKU.

## 3. Create an API key
App Store Connect → **Users and Access → Integrations → App Store Connect API** → Team Keys → **+**. Choose the **Admin** role, so the workflow can manage signing certificates. Download the `.p8` file (you can download it only once), and note the **Key ID** and the **Issuer ID** shown above the list.

## 4. Add GitHub secrets
In this repository: **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `APPLE_TEAM_ID` | your Team ID |
| `ASC_KEY_ID` | the key's Key ID |
| `ASC_ISSUER_ID` | the Issuer ID |
| `ASC_KEY_P8` | the whole contents of the `.p8` file |

If you used a different bundle ID, also add a repository **variable** `BUNDLE_ID` with it.

## 5. Run it
**Actions → TestFlight → Run workflow.** When it finishes, Apple processes the build, usually in 5–30 minutes. In App Store Connect → your app → **TestFlight**, add yourself as an internal tester. Then install **TestFlight** from the App Store on your iPhone and tap **Install** next to Heptad.

Each run uploads a new build number, so you can run it again after every change.
