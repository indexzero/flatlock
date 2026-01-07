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
