import { useEffect, useState } from 'react';
import { ProductCard } from '../components/ProductCard';
import { Product } from '../types';
import api from '../utils/api';

const categories = [
  { id: 'electronics', name: 'Electronics' },
  { id: 'home-kitchen', name: 'Home & Kitchen' },
  { id: 'clothing', name: 'Clothing' },
  { id: 'books-learning', name: 'Books & Learning' },
];

export const HomePage = () => {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    void api
      .get<Product[]>('/products')
      .then((response) => setProducts(response.data.slice(0, 8)))
      .catch(() => setProducts([]));
  }, []);

  return (
    <div className="space-y-10">
      <section className="rounded-3xl bg-gradient-to-r from-contoso-dark to-contoso-blue px-8 py-14 text-white">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-blue-100">Contoso Retail</p>
        <h1 className="max-w-3xl text-4xl font-bold">Welcome to Contoso Retail — Shop the best deals</h1>
        <p className="mt-4 max-w-2xl text-lg text-blue-50">Demo-ready commerce experience with Cosmos DB catalogue data, Azure SQL pricing, and an Azure SRE Agent investigation workflow.</p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-white/10 px-4 py-2">📦 Products from Cosmos DB</span>
          <span className="rounded-full bg-white/10 px-4 py-2">💳 Pricing from Azure SQL</span>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-semibold">Featured categories</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {categories.map((category) => (
            <div key={category.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-wide text-contoso-blue">Category</p>
              <h3 className="mt-2 text-lg font-semibold">{category.name}</h3>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-semibold">Featured products</h2>
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
};
