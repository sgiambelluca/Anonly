# Code signing policy

> **Status: Windows releases are not Authenticode-signed.** The project
> applied to the SignPath Foundation open source program on 2026-10-02 and the
> application was declined. There is no other free way to obtain an
> Authenticode certificate, and the project does not spend money on
> distribution, so Windows shows every release as coming from an unknown
> publisher. This page describes how releases are built and how to verify
> them without that signature.

## What Anonly is

Anonly is a desktop application that anonymizes PDF documents **entirely on
the user's computer**. It detects personal data (names, ID numbers, addresses,
case numbers and similar), lets the user review what it found, and exports a
new PDF where the original information cannot be recovered. It is released
under the [MIT license](./LICENSE) and its functionality is described in the
[README](./README.md) and on each
[GitHub release](https://github.com/sgiambelluca/Anonly/releases).

## How releases are built

Every published artifact is built from this repository by the release
workflow ([`.github/workflows/release.yml`](./.github/workflows/release.yml)):

- The Windows installer (`Anonly-Setup-<version>.exe`, NSIS) and the
  application files it installs.
- The macOS application.

Nothing is built or signed on a developer machine. The release workflow runs
on GitHub-hosted runners, only from a version tag on `main` whose commit
already passed CI, and only when the tag matches the version in
`apps/desktop-shell/package.json`.

The installer bundles open source components published by their own projects
(among them the Electron runtime, the Tesseract OCR engine, pdf.js, ONNX
Runtime and a BERT-based named-entity model), unmodified. There is no
proprietary code. The main components and their licenses are listed in
[`NOTICE`](./NOTICE) and in the app's _Acerca de_ (About) dialog, and the full
license texts of every bundled component ship inside the installer, in
`resources/renderer/licenses/THIRD_PARTY_LICENSES.txt`. The only third-party
data file, a first-name lexicon under CC-BY-2.5-AR, is credited in `NOTICE`
and inside the app.

## What is and is not signed

|                                   | Signature                          | What it covers                                |
| --------------------------------- | ---------------------------------- | --------------------------------------------- |
| Windows installer and application | None (no Authenticode)             | —                                             |
| macOS application                 | Ad-hoc, not notarized              | Nothing a user can verify against an identity |
| Updates, Windows and macOS        | Ed25519, with a key of the project | Each update, before it is installed           |

The Ed25519 check runs inside the app. On Windows the signature also binds the
version, the file name and the SHA-512 of the installer. It protects updates,
not the first installation: the first time, there is no installed app to
verify anything.

The risks this leaves open are listed in
[`docs/architecture/08_Security_Model.md`](./docs/architecture/08_Security_Model.md)
§2.3.

## Team roles

Anonly is maintained by a single person, who holds every role:

- **Committers and reviewers:** [Santino Giambelluca](https://github.com/sgiambelluca)
- **Releases:** [Santino Giambelluca](https://github.com/sgiambelluca) creates the version tags and publishes each release

Contributions from anyone else arrive as pull requests and are reviewed by the
maintainer before they are merged. Development uses AI coding assistants
under the maintainer's supervision; they have no repository or signing access
of their own, and every change is reviewed and committed by the maintainer.

## Privacy policy

Anonly never sends the content, name or metadata of a document anywhere. Its
only network connection asks GitHub Releases whether a new version exists and
downloads it. The full policy is in [`PRIVACY.md`](./PRIVACY.md).

## Verifying a download

There is no publisher signature to check, so use the two things every release
does publish:

- **Checksum:** `SHA256SUMS.txt` has the SHA-256 of each file.
- **Provenance:** every installer has a build attestation that ties it to the
  commit and workflow run that produced it:

  ```bash
  gh attestation verify <installer> --repo sgiambelluca/Anonly
  ```

Download installers only from the
[GitHub releases](https://github.com/sgiambelluca/Anonly/releases) of this
repository. No release of Anonly carries a publisher signature (Authenticode
or Apple Developer ID); treat a file that does as not coming from this
project.

## Uninstalling

Windows: _Settings → Apps → Installed apps → Anonly → Uninstall_.
How to remove the settings left in your user profile is explained in
[`PRIVACY.md`](./PRIVACY.md#qué-queda-en-tu-computadora).

## Reporting a problem

Report vulnerabilities, or a file you believe did not come from this project,
through
[GitHub's private vulnerability reporting](https://github.com/sgiambelluca/Anonly/security/advisories/new)
(see [`SECURITY.md`](./SECURITY.md)).
