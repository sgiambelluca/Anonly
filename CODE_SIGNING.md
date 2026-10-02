# Code signing policy

> **Status: application to SignPath Foundation pending.** Releases up to
> v0.9.2 are **not** Authenticode-signed, and Windows shows them as coming
> from an unknown publisher. This policy applies from the first Windows
> release signed through SignPath.

Windows releases of Anonly:
Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## What Anonly is

Anonly is a desktop application that anonymizes PDF documents **entirely on
the user's computer**. It detects personal data (names, ID numbers, addresses,
case numbers and similar), lets the user review what it found, and exports a
new PDF where the original information cannot be recovered. It is released
under the [MIT license](./LICENSE) and its functionality is described in the
[README](./README.md) and on each
[GitHub release](https://github.com/sgiambelluca/Anonly/releases).

## What gets signed

Only Windows artifacts built from this repository by the release workflow
([`.github/workflows/release.yml`](./.github/workflows/release.yml)) are
submitted for signing:

- The Windows installer (`Anonly Setup <version>.exe`, NSIS) and the
  application files it installs.

Nothing is signed from a developer machine. The release workflow runs on
GitHub-hosted runners, only from a version tag on `main` whose commit already
passed CI, and only when the tag matches the version in
`apps/desktop-shell/package.json`. Every signing request is approved manually
by an approver (below).

The installer bundles open source components published by their own projects
(the Electron runtime, the Tesseract OCR engine, ONNX Runtime and a
BERT-based named-entity model), unmodified. Their licenses are OSI-approved:
MIT, Apache-2.0 and AFL-3.0. The only third-party data file, a first-name
lexicon under CC-BY-2.5-AR, is credited in [`NOTICE`](./NOTICE) and inside
the app.

macOS releases are not covered by this policy: they are ad-hoc signed and not
notarized. See
[`docs/architecture/08_Security_Model.md`](./docs/architecture/08_Security_Model.md)
§2.3.

## Team roles

Anonly is maintained by a single person, who holds every role:

- **Committers and reviewers:** [Santino Giambelluca](https://github.com/sgiambelluca)
- **Approvers:** [Santino Giambelluca](https://github.com/sgiambelluca)

Contributions from anyone else arrive as pull requests and are reviewed by the
maintainer before they are merged. Development uses AI coding assistants
under the maintainer's supervision; they have no repository or signing access
of their own, and every change is reviewed and committed by the maintainer.

All team members use multi-factor authentication on GitHub and on SignPath.

## Privacy policy

Anonly never sends the content, name or metadata of a document anywhere. Its
only network connection asks GitHub Releases whether a new version exists and
downloads it. The full policy is in [`PRIVACY.md`](./PRIVACY.md).

## Verifying a download

- **Signature:** right-click the installer → _Properties_ → _Digital
  Signatures_. The signer must be SignPath Foundation.
- **Checksum:** every release publishes `SHA256SUMS.txt` with the SHA-256 of
  each file.
- **Provenance:** every installer has a build attestation that ties it to the
  commit and workflow run that produced it:

  ```bash
  gh attestation verify <installer> --repo sgiambelluca/Anonly
  ```

Updates are also verified inside the app, with an Ed25519 key of the project,
before they are installed. That check does not replace the Authenticode
signature: it protects updates, not the first installation.

## Uninstalling

Windows: _Settings → Apps → Installed apps → Anonly → Uninstall_.
How to remove the settings left in your user profile is explained in
[`PRIVACY.md`](./PRIVACY.md#qué-queda-en-tu-computadora).

## Reporting a problem

Report vulnerabilities, or a signed file you believe did not come from this
project, through
[GitHub's private vulnerability reporting](https://github.com/sgiambelluca/Anonly/security/advisories/new)
(see [`SECURITY.md`](./SECURITY.md)).
