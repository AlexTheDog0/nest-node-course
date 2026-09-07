import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { DatabaseService } from './database/database.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService, private readonly dbService: DatabaseService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async getHealth() {
    await this.dbService.checkConnection();
    return { status: 'ok', uptime: process.uptime() };
  }
}
