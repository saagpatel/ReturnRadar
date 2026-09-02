# Dependency security

ReturnRadar treats its committed lockfiles as part of the security boundary.
Pull requests run RustSec and secret scanning in addition to the normal test and
build suites.

## RUSTSEC-2023-0071

`rsa 0.9.10` can appear in `Cargo.lock` through SQLx's optional MySQL support.
The advisory has no patched release. ReturnRadar supports SQLite only and does
not enable SQLx's MySQL feature, so `rsa` is absent from the feature-resolved
macOS dependency graph.

`script/check_rustsec.sh` permits this one lockfile advisory only after
`cargo tree` proves that `rsa` is inactive for both Apple silicon and Intel
macOS target graphs. If a future dependency or target-specific feature
activates it, the check fails before the RustSec exception is applied.

All other RustSec vulnerabilities remain release-blocking. Warning-class
advisories are reviewed separately because Cargo may resolve optional,
build-only, or platform-specific packages that do not expose the reported
condition in ReturnRadar's supported macOS target.

At the current lockfile, two warning-class advisories require explicit,
fail-closed target and feature checks:

- `glib 0.18.5` (`RUSTSEC-2024-0429`) is constrained by Tauri's GTK 0.18
  dependency line. It is resolved for Linux but absent from both supported
  macOS graphs. A direct `glib 0.20` pin is not compatible with that upstream
  constraint.
- `rand 0.7.3` (`RUSTSEC-2026-0097`) is constrained by Tauri's HTML selector
  build chain. It has no normal or development dependency edge on either
  supported macOS target, and its optional `log` feature is disabled, so the
  advisory's custom logger precondition is absent. A direct `rand 0.8.6` pin is
  not compatible with `phf_generator 0.8`.

`script/check_rustsec.sh` reads cargo-audit's current advisory report and checks
every affected `glib` and `rand` package instance in the lockfile for Apple
silicon and Intel macOS. If an additional vulnerable version appears, either
package becomes active outside the reviewed boundary, or the feature condition
changes, CI fails and requires the exception to be reviewed or removed.

Other current warnings remain maintenance signals:

- GTK3 warnings are Linux-only for ReturnRadar's supported targets.
- `spin 0.9.8` is yanked but is the version required by SQLx's current `flume`
  dependency. It remains an upgrade-tracking item.
- Other unmaintained warnings are transitive maintenance signals and remain
  visible in audit output for dependency-upgrade planning.
