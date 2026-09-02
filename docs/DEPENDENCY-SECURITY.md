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
advisories are reviewed separately because Cargo may resolve optional or
platform-specific packages that are not compiled for ReturnRadar's supported
macOS target.

At the current lockfile, the remaining warnings are not known vulnerabilities:

- GTK3 and GLib warnings are resolved for Linux targets but are absent from the
  supported macOS graph.
- `rand 0.7.3` is a build dependency used through Tauri's HTML selector stack;
  its warning requires a custom logger calling `rand::rng()`, which ReturnRadar
  does not define.
- `spin 0.9.8` is yanked but is the version required by SQLx's current `flume`
  dependency. It remains an upgrade-tracking item.
- Other unmaintained warnings are transitive maintenance signals and remain
  visible in audit output for dependency-upgrade planning.
