# ADR-0001 — Lintel Design OS lives in its own monorepo

Status: **Accepted** (2026-09-26)

## Context
`amitnagar-lintel/lintel-os-ops` is the live CRM/operations system: a single-file vanilla-JS PWA on
Supabase whose CLAUDE.md forbids a build step. The Design OS PRD requires a strict-TypeScript
monorepo with separated engines (PRD §7, §8).

## Decision
Design OS is built in this repository, `amitnagar-lintel/lintel-design-os`. `lintel-os-ops` is not
modified by Design OS work and is not merged into this repo. The Design OS PRD and CLAUDE.md apply only here.

## Consequences
- Both CLAUDE.md rulebooks can be followed literally.
- Integration with ops (projects, clients, rooms) is a later, explicit boundary (API or adapter) —
  never a second copy of ops data models.
