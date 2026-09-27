import { dataSource } from './data-source.js';
import { productRevenue } from './reports/product-revenue.js';

await dataSource.initialize();
try {
  // Keep PostgreSQL bigint/numeric aggregate strings intact: Number could lose precision.
  console.table(await productRevenue(dataSource));
} finally {
  await dataSource.destroy();
}
