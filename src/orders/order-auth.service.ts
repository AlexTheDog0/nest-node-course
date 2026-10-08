import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { verifyToken, type OrderIdentity } from './order-token.js';
import type { Env } from '../config/env.schema.js';

@Injectable()
export class OrderAuthService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  authenticate(token: unknown): OrderIdentity {
    const path = this.config.get('REALTIME_TOKEN_SECRET_FILE', { infer: true });
    // Configuration failures are server errors, not misleading authentication errors.
    const key = readFileSync(path ?? 'secrets/realtime-token-key');
    try {
      return verifyToken(token, key);
    } catch {
      throw new UnauthorizedException('Invalid or expired order token');
    }
  }

  fromHeader(authorization?: string): OrderIdentity {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer order token required');
    }
    return this.authenticate(authorization.slice(7));
  }
}
