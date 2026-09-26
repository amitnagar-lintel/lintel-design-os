/** Raised when TEST_FIXTURE data would be turned into persistable rows (never allowed). */
export class TestFixturePersistenceError extends Error {
  constructor(what: string) {
    super(`TEST_FIXTURE data can never be persisted: ${what}`);
    this.name = "TestFixturePersistenceError";
  }
}

/** Raised when data cannot be represented faithfully in rows (e.g. a non-quarter-turn rotation). */
export class MappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingError";
  }
}
