import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';
import { Job } from './entities/job.entity.js';
import { User } from './entities/user.entity.js';
import { Product } from './entities/product.entity.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function connection() {
  if (process.env.DB_URL) return { url: process.env.DB_URL };
  const port = Number(required('DB_PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535');
  }
  return {
    host: required('DB_HOST'),
    port,
    username: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
  };
}

export const dataSource = new DataSource({
  type: 'postgres',
  ...connection(),
  synchronize: false,
  entities: [User, Product, Order, OrderItem, Job],
  migrations: [fileURLToPath(new URL('./migrations/*.js', import.meta.url))],
});
