import { AbstractLogger } from 'typeorm';
import type { LogLevel, LogMessage } from 'typeorm';

export class QueryCountLogger extends AbstractLogger {
  count = 0;

  constructor() {
    super(['query']);
  }

  reset(): void {
    this.count = 0;
  }

  logQuery(query: string, parameters?: unknown[]): void {
    this.count++;
    super.logQuery(query, parameters);
  }

  protected writeLog(
    level: LogLevel,
    logMessage: LogMessage | LogMessage[],
  ): void {
    for (const message of this.prepareLogMessages(logMessage, {
      highlightSql: false,
    })) {
      console.log(`[${message.type ?? level}] ${message.message}`);
    }
  }
}
