export interface Product {
  id: number;
  name: string;
  price_cents: number;
  stock: number;
}

export interface ProductsPage {
  items: Product[];
  next_cursor: string | null;
}

export type CreateProductInput = Omit<Product, 'id'>;
