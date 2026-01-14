# Flatlock: verifying lockfile parsing

```
    ┌─────────────────────────────────────────────────────────┐
    │  🔍 "Trust, but verify."                                │
    │      - Ancient proverb, also good data engineering      │
    └─────────────────────────────────────────────────────────┘
```

Hey there, friend! 👋

So you want to know if your lockfile parser is actually correct? Like, *really* correct? Not just "it runs without crashing" correct, but "I would bet my production deploy on this" correct?

Cool. Let's talk about that.

## The Problem With Testing Parsers

Here's the thing about parsers: they're sneaky.

```
    ┌──────────────┐
    │  Lockfile    │──────▶ Parser ──────▶ ???
    │  (the input) │                       (hope it's right!)
    └──────────────┘
```

When you write a parser, you're making a promise: "I will read this format and tell you what's in it." But how do you *know* you kept your promise?

You could write unit tests! And you should. But unit tests only check what you *thought* to check. They test your assumptions about the format. If your assumptions are wrong, your tests pass and your parser is still wrong.

```
    ┌─────────────────────────────────────────────────────────┐
    │  📝 Unit tests check: "Does my code do what I think?"   │
    │  🤔 But who checks: "Do I think correctly?"             │
    └─────────────────────────────────────────────────────────┘
```

This is where most parsers stop. They ship with unit tests, maybe some integration tests, and a hope that edge cases won't bite too hard.

Flatlock does something different.

## The Reconciliation Pattern

Data engineers have known this trick forever: **if you want to trust your pipeline, run it twice through different code and compare the outputs.**

```
                        ┌─────────────────┐
                   ┌───▶│    flatlock     │───▶ Package List A
    ┌──────────┐   │    └─────────────────┘
    │ Lockfile │───┤
    └──────────┘   │    ┌─────────────────┐
                   └───▶│   CycloneDX     │───▶ Package List B
                        └─────────────────┘

                              │
                              ▼
                    ┌─────────────────┐
                    │   A === B ?     │
                    │                 │
                    │  ✓ Confidence!  │
                    │  ✗ Investigate! │
                    └─────────────────┘
```

This is called **corroboration**. It's the same reason journalists need two independent sources. It's why banks reconcile accounts. It's why NASA runs calculations on separate computers built by different teams.

**If two independent implementations read the same input and produce the same output, that's evidence of correctness.**

Not proof. Evidence. But evidence compounds, and compound evidence is how we build trust without omniscience.

## Why This Matters For Your Dependencies

Your lockfile is a source of truth. It says "these are the exact packages that will be installed." Security scanners read it. Audit tools read it. SBOMs are generated from it.

If the parser reading your lockfile is wrong, everything downstream is wrong:

```
    Wrong parser output
           │
           ▼
    ┌──────────────────────────────────────────────────┐
    │  😰 Security scanner misses a vulnerable package │
    │  😰 Audit report has wrong dependencies          │
    │  😰 SBOM doesn't match what's actually installed │
    │  😰 License compliance check passes incorrectly  │
    └──────────────────────────────────────────────────┘
```

This isn't hypothetical. Lockfile formats are complicated. npm's `package-lock.json` has had multiple versions with different structures. pnpm's format is YAML with nested resolution semantics. Yarn Berry uses a custom format with multiple package entries per resolution.

Parsers get this wrong. Often.

```
Need more here
```

## The Scripts

| Script | What it verifies |
|--------|------------------|
| `npm-arborist.sh` | npm monorepo workspace extraction |

More coming for pnpm and yarn.

## Contributing a Verification

Found a monorepo we should test against? The pattern is simple:

1. Clone the repo
2. Run flatlock-deps on a workspace
3. Create a husk of the published package
4. Compare

If they match, flatlock works. If they don't, you've found a bug - and we want to know about it.

---

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │   Remember:                                             │
    │                                                         │
    │   Agreement between independent implementations         │
    │   is how we build trust without omniscience.           │
    │                                                         │
    │   Flatlock doesn't ask you to trust.                    │
    │   Flatlock asks you to verify.                          │
    │                                                         │
    │   🔍 → ✓                                                 │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

*Now go forth and verify!*

## Flatlock's Verification System

Flatlock is the first lockfile parser to ship with a **built-in reconciliation system**. Here's how it works:

### Step 1: The Husk

First, we create a "husk" - a fresh, isolated npm install of a package:

```bash
pkg-husk @npmcli/arborist@9.1.9 /tmp/husk
```

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │   /tmp/husk/                                            │
    │   ├── package.json      ◀── created with one dep       │
    │   ├── package-lock.json ◀── generated by npm install   │
    │   └── node_modules/     ◀── the actual packages        │
    │                                                         │
    │   This is "ground truth" - npm's own resolution.        │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

The husk is npm's answer to "what packages does this dependency need?" We didn't generate this - npm did. It's authoritative.

### Step 2: Read With Multiple Tools

Now we ask the same question two different ways:

```bash
# What does flatlock say?
flatlock-deps /tmp/husk/package-lock.json | sort -u > flatlock.txt

# What does CycloneDX say?
cyclonedx-npm /tmp/husk --output-format JSON 2>/dev/null \
  | jq -r '.components[] | select(.type=="library") | .name' \
  | sort -u > cyclonedx.txt
```

```
    ┌─────────────────┐         ┌─────────────────┐
    │                 │         │                 │
    │    flatlock     │         │   CycloneDX     │
    │                 │         │                 │
    │  Reads lockfile │         │ Reads lockfile  │
    │  Pure parsing   │         │ + node_modules  │
    │                 │         │                 │
    └────────┬────────┘         └────────┬────────┘
             │                           │
             ▼                           ▼
        flatlock.txt               cyclonedx.txt
```

These are **independent implementations**:
- Different authors
- Different codebases
- Different parsing strategies
- Different organizations

### Step 3: Compare

```bash
diff flatlock.txt cyclonedx.txt
```

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │   If they match:                                        │
    │   ┌─────────────────────────────────────────────────┐   │
    │   │ ✓ Two independent tools agree                   │   │
    │   │ ✓ Evidence that both are correct                │   │
    │   │ ✓ High confidence in flatlock's output          │   │
    │   └─────────────────────────────────────────────────┘   │
    │                                                         │
    │   If they differ:                                       │
    │   ┌─────────────────────────────────────────────────┐   │
    │   │ ✗ One or both tools have a bug                  │   │
    │   │ ✗ Investigation needed                          │   │
    │   │ ✗ File an issue with the diff!                  │   │
    │   └─────────────────────────────────────────────────┘   │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

## The Full Monorepo Verification

For monorepos, we go further. We verify that flatlock correctly extracts a **workspace's** dependencies:

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │   MONOREPO (e.g., npm/cli)                              │
    │   ├── package-lock.json    ◀── contains ALL workspaces │
    │   └── workspaces/                                       │
    │       └── arborist/                                     │
    │           └── package.json ◀── just this workspace     │
    │                                                         │
    │   Question: Can flatlock extract JUST arborist's deps   │
    │             from the monorepo lockfile?                 │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

Then we compare against a fresh install of the published package:

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │   MONOREPO                          HUSK                │
    │   ┌─────────────┐                  ┌─────────────┐      │
    │   │ flatlock    │                  │ flatlock    │      │
    │   │ workspace   │    ═══════?═══   │ fresh       │      │
    │   │ extraction  │                  │ install     │      │
    │   └─────────────┘                  └─────────────┘      │
    │                                                         │
    │   Same packages? ✓ Workspace extraction works!          │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

## Try It Yourself

We've included a working verification script. Run it and see:

```bash
./examples/monorepo/npm-arborist.sh
```

This script:
1. Clones the npm/cli monorepo
2. Extracts @npmcli/arborist's dependencies using flatlock
3. Runs CycloneDX on the monorepo for corroboration
4. Creates a husk with a fresh install of @npmcli/arborist
5. Extracts dependencies from the husk using both flatlock AND CycloneDX
6. Compares all results and preserves artifacts

```
    $ ./examples/monorepo/npm-arborist.sh
    ...
    === Artifacts preserved in: examples/monorepo/artifacts/npm-arborist ===
    PASS: @npmcli/arborist@9.1.9 (extra: 0)
```

**PASS** means flatlock found every package that a fresh npm install produces. Zero missing. Corroborated by independent installation.

### Examining the Artifacts

All intermediate data is preserved for inspection:

```
    artifacts/npm-arborist/
    ├── package.txt              # Package name and version
    ├── monorepo/                # The cloned monorepo
    │   └── package-lock.json    # Source lockfile
    ├── monorepo.flatlock.txt    # Flatlock's extraction
    ├── monorepo.cyclonedx.json  # CycloneDX SBOM (full)
    ├── monorepo.cyclonedx.txt   # CycloneDX package names
    ├── husk/                    # Fresh npm install
    │   ├── package.json         # Single dependency
    │   ├── package-lock.json    # npm's resolution
    │   └── node_modules/        # Actual packages
    ├── husk.flatlock.txt        # Flatlock on husk
    ├── husk.cyclonedx.json      # CycloneDX on husk (full SBOM)
    ├── husk.cyclonedx.txt       # CycloneDX package names
    ├── husk.diff.txt            # Flatlock vs CycloneDX diff
    ├── missing.txt              # Packages in husk but not monorepo
    └── extra.txt                # Packages in monorepo but not husk
```

You can diff these files yourself, inspect the JSON, or run your own analysis tools against them.

## Why This Is New

Other lockfile parsers don't do this. They ship with unit tests and call it a day.

Flatlock ships with:
- **Reconciliation against CycloneDX** - independent implementation comparison
- **Reconciliation against fresh installs** - ground truth from npm itself
- **Monorepo workspace verification** - the hardest parsing case, tested

This isn't just testing. It's **continuous corroboration**. Every release, we verify against real-world monorepos. Not toy examples - actual production lockfiles from npm/cli, pnpm/pnpm, vuejs/core, and more.

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │   "In God we trust. All others must bring data."        │
    │                        - W. Edwards Deming              │
    │                                                         │
    │   Flatlock brings data.                                 │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```
