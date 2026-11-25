# Requirements to Verification

Desktop app (Electron, React, TypeScript) for the verification side of the V-model. It needs no server. Data is stored in one local JSON file.

## Run

```
npm install
npm start        # builds and launches the app
npm test         # core logic tests
```

## What it does

- **Import** requirements from CSV or Excel with automatic column mapping. Re-importing shows what is new, changed or missing.
- **Categorise** by type (functional plus non-functional kinds), V-model level, verification method, and standards or regulations (ISO, IEC, EU).
- **Suspect links**: if a re-import or edit changes a requirement's title, text or verification method, linked test cases are flagged until a reviewer confirms them.
- **Test cases** with preconditions, steps and expected results, pass criteria, environment and effort. Requirements and tests are many-to-many.
- **Equipment catalogue**: standard vs company-specific, calibration due date, status (available, in repair, to be built).
- **Test plans**: choose an equipment focus (all, standard only, company-specific), group tests by shared equipment, and see checks for expired calibration, drafts, suspect tests and scope violations.
- **Dashboard**: coverage by type, level and standard, gaps, orphan and suspect tests, and a traceability matrix.
- **Export** a plan to Excel (plan, tests, equipment, traceability, gaps, issues) or PDF.

## Extending

- New import formats (ReqIF, DOORS, Jira): implement `ImportSource` in `src/core/importers.ts`.
- Multi-user or shared database: implement `Repository` in `src/core/repository.ts`. Records already carry created/updated user, timestamp and version, and changes go to an audit log.
- Validation levels: extend `LEVELS` in `src/core/types.ts`.

A sample requirements file is in `samples/requirements.csv`. Standards go in one cell separated by `;`, with the clause in brackets, for example `ISO 13849 (PL d); EU Machinery Regulation 2023/1230`.
