# Reliability investigation, 2026-10-26

The reported incident returned the application to its default programme with empty history after weeks/months of use. Installation was probably through Edge; independently exported JSON files remained viable according to the user. No failed device database, exact incident date or installed release was available. No actual workout records were inspected or changed in this investigation.

## Diagnosis

The incident's exact cause is unproven. Investigation at application base c58a8ab/documentation commit c0b0125 demonstrated:

- Invalid legacy localStorage and absent data both became `undefined`; load then saved defaults and removed the original. An otherwise parseable older record with a blank exercise name lost its history in a synthetic reproduction.
- Complete-snapshot writes had no cross-window revision guard. A stale client changing one setting could replace a newer plan/history.
- Import had no confirmation. Edits during a pending replacement could leave imported data on screen and an older dataset in storage.
- Invalid editor drafts entered shared state, prevented subsequent saves and could produce a JSON export rejected by the importer.
- The only independent copy was a remembered manual export. IndexedDB, Cache Storage, localStorage and OPFS share browser-managed failure boundaries.

Commit 8277ffe (2026-08-24) moved the complete state from localStorage into canonical IndexedDB. Earlier loading failures also returned defaults; later edits could overwrite the original. Later repetition/theme migrations intentionally transformed fields, not whole history. Current cache activation does not delete workout databases.

Conditional incident ranking, without measured probabilities:

1. Missing/cleared browser storage or a different browser/profile/origin strongly matches the symptoms. This is not proof that eviction occurred.
2. The demonstrated historical fallback/migration becomes the leading application explanation if the loss followed that transition or a legacy load failure.
3. A stale/default client can overwrite newer data. Full loss requires an appropriately old/empty snapshot; ordinary concurrency usually loses only intervening changes.
4. Empty/older import, reset or a replacement race is possible; none is established as an action during this incident.
5. Quota, termination and corruption remain plausible, but write rejection alone should retain earlier committed history and is a weaker explanation for losing all older records.

[Microsoft documents eviction under pressure](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/offline). [Persistence permission reduces eviction risk](https://web.dev/articles/persistent-storage); it does not provide recovery after clearing or device loss. [Android Chrome WebAPKs use browser profile storage](https://web.dev/articles/webapks); exact Edge device behaviour remains a manual check. Routine process termination or browser update must not be asserted to erase an entire database without evidence.

## Implemented response

See [recovery.md](recovery.md), [ARCHITECTURE.md](../ARCHITECTURE.md) and [DECISIONS.md](../DECISIONS.md): versioned compare-and-replace transactions, preserved migration sources, exclusive confirmed replacements, validated drafts/backups, recovery checkpoints, independently verified files and optional immutable remote versions. Remote publishing defaults off and is prohibited on the shared GitHub Pages origin.

Secondary changes archive bands without rewriting history, expose recorded session values independently of the current plan and clone default palettes between datasets. An old JSON import byte limit was removed because exports could exceed it. Production dependency auditing is part of release verification; development tooling advisories are reported separately.

Storage benchmarks use process-local fake IndexedDB, not real Android disk latency. A single Windows/Node 24.19 diagnostic sample at 500/1,500 sessions was 4.17/12.49 MiB: initial commits 353/1,110 ms; checkpointed commits 861/2,150 ms. Checkpoint browsing/retention uses a small metadata index so ordinary saves do not load dozens of complete histories; file retention reads only deletion candidates. The remaining full-snapshot validation/hash/clone cost is a scaling limit. Measure real-device latency before changing the canonical model; no record-level sync or event-sourcing system was introduced.

Verification evidence and remaining release boundaries are maintained in [PROJECT_STATUS.md](../PROJECT_STATUS.md). Passing synthetic tests establishes these tested mechanisms and recovery paths; it does not identify the historical incident's cause.
