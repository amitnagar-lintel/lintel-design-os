export class StorageError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

export class InvalidStorageKeyError extends StorageError {
  constructor(key: string, why: string) {
    super("InvalidStorageKeyError", `Invalid storage key '${key}': ${why}`);
  }
}

export class ChecksumMismatchError extends StorageError {
  constructor(key: string, expected: string, actual: string) {
    super("ChecksumMismatchError", `Checksum mismatch for '${key}': expected ${expected}, got ${actual}`);
  }
}

export class ObjectNotFoundError extends StorageError {
  constructor(key: string) {
    super("ObjectNotFoundError", `No object at '${key}'`);
  }
}

/** Stored objects are immutable: different content can never replace an existing key. */
export class ObjectExistsError extends StorageError {
  constructor(key: string) {
    super("ObjectExistsError", `An object with different content already exists at '${key}'`);
  }
}

/** The application refuses to delete files a snapshot or issued output still references. */
export class FileReferencedError extends StorageError {
  constructor(key: string) {
    super("FileReferencedError", `'${key}' is referenced by a snapshot or issued output and cannot be deleted`);
  }
}

export class SignedUrlError extends StorageError {
  constructor(message: string) {
    super("SignedUrlError", message);
  }
}
