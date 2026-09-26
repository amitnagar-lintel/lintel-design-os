/**
 * Build-time engine manifest (OD-S6-9): for each output engine, walk the static import graph from its entry module
 * and hash exactly what it reaches. Runtime imports only: `import type` / `export type` are not part of the runtime
 * closure. A dynamic `import()` or `require()` in the closure is refused, so nothing can escape the fingerprint.
 *
 * - internal files (workspace packages, reached files only) → per-package source hash
 * - external packages (resolved into node_modules) → "<version>+<integrity>" from pnpm-lock.yaml, transitively
 * - Node built-ins → the runtime major version
 *
 * Tests, READMEs, docs, UI and unreached modules are never read, so they can never change a fingerprint.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineClosure, EngineName, Sha256 } from "@lintel/persistence";
import { contentHash } from "@lintel/persistence";
import ts from "typescript";
import type { EngineEntry } from "./engine-entries.js";
import { ENGINE_ENTRIES } from "./engine-entries.js";
import type { EngineManifest, EngineManifestEntry } from "./engine-manifest.js";
import { engineFingerprint } from "./engine-manifest.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

export interface ManifestOptions {
  readonly root?: string;
  readonly entries?: Readonly<Partial<Record<EngineName, EngineEntry>>>;
  /** File reader (absolute path → content); tests substitute contents to prove what does and does not count. */
  readonly readFile?: (absolutePath: string) => string;
  readonly lockfile?: string;
  readonly runtime?: string;
}

const sha256 = (text: string): Sha256 => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface PackageInfo {
  readonly dir: string;
  readonly name: string;
  readonly manifest: { name: string; version?: string; dependencies?: Record<string, string>; exports?: unknown };
}

class ClosureWalker {
  private readonly files = new Map<string, PackageInfo>();
  private readonly externals = new Map<string, string>();
  private readonly packageCache = new Map<string, PackageInfo>();

  constructor(private readonly root: string, private readonly read: (p: string) => string, private readonly lockfile: string) {}

  walk(entryAbs: string): void {
    const queue = [entryAbs];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (this.files.has(file)) continue;
      this.files.set(file, this.packageOf(file));
      for (const spec of this.runtimeImports(file)) {
        const next = this.resolve(spec, file);
        if (next !== null) queue.push(next);
      }
    }
  }

  closure(entryAbs: string, runtime: string): EngineClosure {
    const byPackage = new Map<string, { info: PackageInfo; lines: string[] }>();
    for (const [file, info] of this.files) {
      const bucket = byPackage.get(info.name) ?? { info, lines: [] };
      bucket.lines.push(`${relative(info.dir, file).split(sep).join("/")}:${sha256(this.read(file))}`);
      byPackage.set(info.name, bucket);
    }
    const packages: Record<string, Sha256> = {};
    for (const name of [...byPackage.keys()].sort(byCodePoint)) {
      const { info, lines } = byPackage.get(name) as { info: PackageInfo; lines: string[] };
      const m = info.manifest;
      packages[name] = contentHash({ files: lines.sort(byCodePoint), manifest: { name: m.name, version: m.version ?? null, dependencies: m.dependencies ?? {}, exports: m.exports ?? null } });
    }
    const externals = Object.fromEntries([...this.externals.entries()].sort(([a], [b]) => byCodePoint(a, b)));
    return { packages, externals, entry: sha256(this.read(entryAbs)), runtime };
  }

  /** Runtime module specifiers of one file; dynamic import() and require() are refused. */
  private runtimeImports(file: string): string[] {
    const source = ts.createSourceFile(file, this.read(file), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const out: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const typeOnly = clause !== undefined && (clause.phaseModifier === ts.SyntaxKind.TypeKeyword || (clause.name === undefined && clause.namedBindings !== undefined
          && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((e) => e.isTypeOnly)));
        if (!typeOnly) out.push(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        const typeOnly = node.isTypeOnly || (node.exportClause !== undefined && ts.isNamedExports(node.exportClause)
          && node.exportClause.elements.length > 0 && node.exportClause.elements.every((e) => e.isTypeOnly));
        if (!typeOnly) out.push(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        throw new Error(`engine closure: dynamic import / require in ${relative(this.root, file)} would escape the engine fingerprint`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
  }

  private resolve(spec: string, from: string): string | null {
    if (spec.startsWith("node:") || isBuiltin(spec)) return null;
    if (spec.startsWith(".")) return this.resolveFile(resolve(dirname(from), spec), from, spec);
    const pkgName = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] as string);
    const pkgDir = this.findPackageDir(pkgName, dirname(from));
    if (pkgDir.includes(`${sep}node_modules${sep}`)) {
      this.addExternal(pkgDir);
      return null;
    }
    const info = this.packageAt(pkgDir);
    const sub = spec === pkgName ? "." : `./${spec.slice(pkgName.length + 1)}`;
    const exp = info.manifest.exports;
    const target = typeof exp === "string" && sub === "." ? exp : exp !== null && typeof exp === "object" ? (exp as Record<string, unknown>)[sub] : undefined;
    if (typeof target !== "string") throw new Error(`engine closure: ${spec} (from ${relative(this.root, from)}) has no resolvable export`);
    return this.resolveFile(join(pkgDir, target), from, spec);
  }

  private resolveFile(base: string, from: string, spec: string): string {
    const candidates = base.endsWith(".js") ? [`${base.slice(0, -3)}.ts`, base] : [base, `${base}.ts`, join(base, "index.ts")];
    for (const c of candidates) if (existsSync(c) && !c.endsWith(sep)) return realpathSync(c);
    throw new Error(`engine closure: cannot resolve ${spec} from ${relative(this.root, from)}`);
  }

  private findPackageDir(name: string, fromDir: string): string {
    for (let dir = fromDir; ; dir = dirname(dir)) {
      const candidate = join(dir, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
      if (dirname(dir) === dir) throw new Error(`engine closure: package ${name} is not installed`);
    }
  }

  private packageOf(file: string): PackageInfo {
    for (let dir = dirname(file); ; dir = dirname(dir)) {
      if (existsSync(join(dir, "package.json"))) return this.packageAt(dir);
      if (dirname(dir) === dir) throw new Error(`engine closure: ${file} is not inside a package`);
    }
  }

  private packageAt(dir: string): PackageInfo {
    const cached = this.packageCache.get(dir);
    if (cached !== undefined) return cached;
    const manifest = JSON.parse(this.read(join(dir, "package.json"))) as PackageInfo["manifest"];
    const info = { dir, name: manifest.name, manifest };
    this.packageCache.set(dir, info);
    return info;
  }

  /** An external package and, transitively, its own runtime dependencies: "<version>+<lockfile integrity>". */
  private addExternal(pkgDir: string): void {
    const { name, version, dependencies } = this.packageAt(pkgDir).manifest;
    if (this.externals.has(name)) return;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const m = new RegExp(`^  '?${esc(name)}@${esc(version ?? "")}'?:\\n    resolution: \\{integrity: ([^,}]+)`, "m").exec(this.lockfile);
    if (m === null) throw new Error(`engine closure: ${name}@${version ?? "?"} is not locked in pnpm-lock.yaml`);
    this.externals.set(name, `${version ?? ""}+${(m[1] as string).trim()}`);
    for (const dep of Object.keys(dependencies ?? {}).sort(byCodePoint)) this.addExternal(this.findPackageDir(dep, pkgDir));
  }
}

const cache = new Map<string, EngineManifest>();

/** Compute the manifest of every configured engine from the working tree. */
export function computeEngineManifest(options: ManifestOptions = {}): EngineManifest {
  const root = options.root ?? REPO_ROOT;
  const cacheable = options.readFile === undefined && options.entries === undefined && options.lockfile === undefined && options.runtime === undefined;
  const hit = cacheable ? cache.get(root) : undefined;
  if (hit !== undefined) return hit;
  const read = options.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const lockfile = options.lockfile ?? read(join(root, "pnpm-lock.yaml"));
  const runtime = options.runtime ?? `node-${process.versions.node.split(".")[0] ?? "0"}`;
  const engines: Partial<Record<EngineName, EngineManifestEntry>> = {};
  const entries = options.entries ?? ENGINE_ENTRIES;
  for (const name of (Object.keys(entries) as EngineName[]).sort(byCodePoint)) {
    const e = entries[name] as EngineEntry;
    const entryAbs = realpathSync(join(root, e.entry));
    const walker = new ClosureWalker(root, read, lockfile);
    walker.walk(entryAbs);
    const closure = walker.closure(entryAbs, runtime);
    engines[name] = { name, version: e.version, closure, fingerprint: engineFingerprint({ name, version: e.version, closure }) };
  }
  const manifest: EngineManifest = { schema: 1, engines };
  if (cacheable) cache.set(root, manifest);
  return manifest;
}
