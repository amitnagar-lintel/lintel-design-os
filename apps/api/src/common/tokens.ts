/** Dependency-injection tokens. Every injection is explicit (`@Inject(TOKEN)`), so nothing relies on emitted decorator metadata. */
export const API_CONFIG = Symbol("API_CONFIG");
export const PG_POOL = Symbol("PG_POOL");
