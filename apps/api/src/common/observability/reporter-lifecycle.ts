import type { OnApplicationShutdown } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import { ERROR_REPORTER } from "../tokens.js";
import type { ErrorReporter } from "./error-reporter.js";

/** Sends any pending error reports before the process exits. */
@Injectable()
export class ReporterLifecycle implements OnApplicationShutdown {
  constructor(@Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.reporter.enabled) await this.reporter.flush(2000);
  }
}
