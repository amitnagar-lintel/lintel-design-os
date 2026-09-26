# Formula language (PRD §15)

Implemented by `@lintel/rules-engine` — a hand-written tokenizer, parser and evaluator. No `eval`.

- Numbers: `18`, `1.5`, `.5` · Booleans: `TRUE`, `FALSE` · Variables: `[A-Za-z_][A-Za-z0-9_]*` (case-sensitive).
- Operators: `+ - * /`, unary `-`, comparisons `< <= > >= == !=` (non-associative; use `AND()` to chain).
- Functions (upper-case): `MIN(a, …)`, `MAX(a, …)`, `ROUND(x[, digits 0–6])` (half away from zero),
  `CEIL`, `FLOOR`, `ABS`, `CLAMP(x, lo, hi)`, `IF(cond, a, b)` (lazy), `AND(…)`, `OR(…)` (short-circuit), `NOT(x)`.
- Strict types: arithmetic on booleans, boolean conditions from numbers and mixed-type `==` are errors.
- Errors never throw from `evaluate*`: `PARSE_ERROR`, `UNKNOWN_VARIABLE`, `UNKNOWN_FUNCTION`,
  `ARITY_ERROR`, `TYPE_ERROR`, `DIVISION_BY_ZERO`, `NON_FINITE_RESULT`, `CYCLIC_DEPENDENCY`.
- Named formula sets are evaluated in dependency order with cycle detection (`evaluateFormulaSet`).
- In component templates, `i` is the 0-based instance index.
- Rules: `{ when?, assert, severity, message }` — a false `assert` emits `severity`; an un-evaluable
  rule emits a BLOCKER (`RULE_NOT_EVALUABLE`) — it never silently passes. `{NAME}` in messages is interpolated.
