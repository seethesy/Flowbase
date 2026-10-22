export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("The HYPERDRIVE binding is not configured.");
    this.name = "DatabaseNotConfiguredError";
  }
}
