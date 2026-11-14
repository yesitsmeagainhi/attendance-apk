# Attendly — native Android app

A genuinely native Android client for the Attendly attendance system, built with
Expo (React Native). Real Android views, real native camera and GPS — not a
WebView wrapping the website.

This covers the **employee** experience. Admin (reports, payroll, staff
management, approvals) stays on the web, where it belongs.

## Why the backend needed no changes

`getAppIdentity()` in the Next.js app already falls back to
`Authorization: Bearer <token>` when there is no session cookie, and both
`/api/auth/login` and `/api/auth/verify-otp` return the raw token in their JSON
response. The app stores that token and sends it as a header. Nothing on the
server was modified to support this client.

## Screens

| Screen | What it does |
|---|---|
| Login | Mobile number → 6-digit OTP. No SMS: an admin reads the pending code off their dashboard. |
| Today | Live punch state, today's in/out times, office, shift, and every punch cycle. |
| Punch | Front camera capture with GPS acquired in parallel, then upload. |
| History | Per-day records with status, duration, month summary, and the punch-in / punch-out selfies as tappable thumbnails. |
| Profile | Employee details and sign-out. |
| Payslips | Published monthly payslips (earnings, deductions, net pay in words), opened from Today. Same figures as the web panel. |

## Which server it talks to

`app.json` → `expo.extra.apiBaseUrl` controls the target. It is currently set to
**production**:

```json
"extra": { "apiBaseUrl": "https://asmvikas.abseducationalsolution.com" }
```

Anything done in the app now writes to the live database that 68 employees
depend on. The login and profile screens both display the active server, so it
is never ambiguous which one a build is hitting.

To develop against a local server instead, set the value to
`http://localhost:3000`, run `adb reverse tcp:3000 tcp:3000`, and build a
**debug** APK. Cleartext HTTP is permitted only in debug builds
(`android/app/src/debug/AndroidManifest.xml`); release builds are HTTPS-only.

## Release builds

Signing material lives in `credentials/` — **outside `android/`**, because
`expo prebuild --clean` deletes that directory wholesale and would take the
keystore with it. `credentials/` is gitignored.

```bash
cd e:/code/attendly-native/android && ./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. Unlike a debug
APK this embeds the JavaScript bundle, so it runs standalone with no Metro
server.

**Back up `credentials/attendly-release.jks` somewhere safe.** Android identifies
an app by its signing key; lose it and you cannot ship an update to a phone that
already has this app installed — every user would need to uninstall and
reinstall. If `credentials/keystore.properties` is missing the build silently
falls back to the debug key, which must never be distributed.

## Build

Requires JDK 21 and the Android SDK (platform 35, build-tools 35.0.0).

```bash
cd e:/code/attendly-native/android && ./gradlew assembleDebug
```

APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.

### Do not run `prebuild --clean`

`android/` is committed to this repository, not generated on demand, because it
holds three things `app.json` cannot express:

- the release signing config in `android/app/build.gradle`
- `reactNativeArchitectures=armeabi-v7a,arm64-v8a` in `android/gradle.properties`,
  which drops the emulator-only x86 libraries and takes the APK from 118 MB to 66 MB
- Gradle memory limits tuned for a 7.6 GB host

`npx expo prebuild --platform android --clean` deletes and recreates that
directory, silently reverting all three — the next release would be a
debug-signed 118 MB build. If you ever must regenerate it, re-apply those three
settings afterwards and restore `android/local.properties` with
`sdk.dir=C:/Android/sdk`.

Changes to app icons, permissions, and plugins in `app.json` still need a
prebuild to take effect. Run it **without** `--clean` and review the diff.

## Design decisions worth knowing

**GPS starts before the shutter.** The punch endpoint returns 400 with no
coordinates, and a cold fix takes 10–20 seconds. `app/punch.tsx` begins
acquiring location on mount, in parallel with the camera warming up, so the fix
is usually ready by the time the user frames the shot.

**Every selfie is compressed.** The server rejects images over 5 MB and phone
cameras routinely produce 4–8 MB. `compressPhoto()` resizes to 1280px at 80%
quality before upload. Without this, punches fail only on better handsets — a
bug that would not show up on a cheap test device.

**Tokens live in SecureStore.** They are plain UUIDs valid for a year, so they
go in the Android Keystore rather than AsyncStorage, which is readable on a
rooted device.

**Geo-fence rejections show the distance.** The server returns a `geoAlert`
object with the nearest branch, actual distance, and allowed radius. The punch
screen surfaces all three, so "you're not at the office" tells the user how far
off they are rather than leaving them guessing.

**Sessions are single-device.** `verify-otp` deletes an employee's existing
sessions before issuing a new token. Signing into this app signs the employee
out of their browser. The login screen says so up front rather than letting it
surprise people.

## Traps this codebase already hit

Four of these cost real debugging time. They are documented so the next change
does not reintroduce them.

**FormData file uploads.** React Native 0.86's New Architecture removed support
for the legacy `{ uri, name, type }` form part that almost every upload tutorial
still shows. It throws `Unsupported FormDataPart implementation`, which surfaces
as a *thrown fetch* — indistinguishable from being offline. The working form is
`expo-file-system`'s `File`, which implements `Blob`.

**Timestamps are UTC on the wire.** Punches are stamped by SQLite's
`CURRENT_TIMESTAMP` and the API converts to IST when deciding late/half-day.
Reading the clock digits out of the string renders every time 5.5 hours off, and
looks perfectly correct against locally-seeded data. `formatTime()` appends the
`Z` exactly as the server does.

**`duration` is minutes, `dayOfWeek` is an index.** Both are numbers, not
strings. Calling `.slice()` on `dayOfWeek` crashed the whole Timesheet tab.

**Stored selfies need the token on the image request.** `/api/attendance/photo`
is authenticated, so a bare `<Image source={{ uri }} />` gets a 401 and renders
nothing. `PunchPhoto.tsx` passes the Bearer header through `source.headers`. The
key format is load-bearing too: the endpoint rejects anything not shaped
`attendance/{date}/{employeeId}/{id}.jpg` before it even reads the file.

**Auth gating must key off the login route, not the tab group.** Redirecting
anything outside `(tabs)` bounces `/punch` and `/journal` the instant they mount,
which made the app's core feature unreachable while looking like a dead button.

## Host requirements

Building and running the emulator at once needs more than 8 GB. On a 7.6 GB
machine, Gradle's parallel workers plus a 3 GB AVD exhausted RAM and triggered
low-memory kills inside Android. `android/gradle.properties` is tuned down
accordingly (`parallel=false`, `workers.max=3`, `-Xmx1536m`) and the AVD is set
to 2 GB. Do not run a Gradle build and the emulator simultaneously.

## Not built yet

Face-detection framing (MLKit) and an offline punch queue — see the
implementation plan for why offline is contentious. Admin (reports, payroll,
staff management, approvals) stays on the web by design.

# attendance-apk
