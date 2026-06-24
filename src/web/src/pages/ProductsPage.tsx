import { useEffect, useMemo, useState } from 'react';
import { ProductCard } from '../components/ProductCard';
import { Product } from '../types';
import api from '../utils/api';

const categories = [
  { id: 'all', name: 'All' },
  { id: 'electronics', name: 'Electronics' },
  { id: 'home-kitchen', name: 'Home & Kitchen' },
  { id: 'clothing', name: 'Clothing' },
  { id: 'books-learning', name: 'Books & Learning' },
];

export const ProductsPage = () => {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    setLoading(true);
    void api
      .get<Product[]>('/products', { params: activeCategory === 'all' ? undefined : { categoryId: activeCategory } })
      .then((response) => setProducts(response.data))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [activeCategory]);

  const content = useMemo(() => {
    if (loading) {
      return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-slate-500">Loading products...</div>;
    }

    return (
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    );
  }, [loading, products]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Products</h1>
        <p className="mt-2 text-slate-600">Browse the Contoso catalogue with flexible product metadata served from Cosmos DB.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {categories.map((category) => (
          <button
            key={category.id}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${activeCategory === category.id ? 'bg-contoso-blue text-white' : 'bg-white text-slate-700 border border-slate-200'}`}
            onClick={() => setActiveCategory(category.id)}
          >
            {category.name}
          </button>
        ))}
      </div>
      {content}
    </div>
  );
};
