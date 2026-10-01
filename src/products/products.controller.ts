import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Body,
  Query,
  DefaultValuePipe,
  BadRequestException,
  Headers,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProductsService } from './products.service.js';
import type { CreateProductInput } from './product.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const product = await this.productsService.findById(id);
    if (!product) throw new NotFoundException('Product was not found');
    return product;
  }

  @Post()
  async create(
    @Body() input: CreateProductInput,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.productsService.create(input, key);
    if (result.replay) res.setHeader('Idempotency-Replay', 'true');
    return result.product;
  }

  @Get()
  findPage(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    let afterId = 0;
    if (cursor !== undefined) {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
      const candidateId = Number(decoded);
      const canonical = Buffer.from(decoded, 'utf8').toString('base64url');
      if (
        !/^[1-9][0-9]*$/.test(decoded) ||
        !Number.isSafeInteger(candidateId) ||
        canonical !== cursor
      ) {
        throw new BadRequestException('Invalid cursor');
      }
      afterId = candidateId;
    }
    return this.productsService.findPage(limit, afterId);
  }
}
