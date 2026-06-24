import { Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { Product } from '../types';

interface ProductCardProps {
  product: Product;
}

export const ProductCard = ({ product }: ProductCardProps) => {
  const { addItem } = useCart();
  const price = product.pricing?.salePrice ?? product.pricing?.listPrice ?? 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <img src={product.imageUrl} alt={product.name} className="h-48 w-full object-cover" />
      <div className="space-y-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-contoso-blue">{product.categoryName}</p>
          <Link to={`/products/${product.id}`} className="text-lg font-semibold text-slate-900 hover:text-contoso-blue">{product.name}</Link>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Star className="h-4 w-4 fill-current text-amber-400" /> {product.rating} ({product.reviewCount})
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-contoso-dark">${price.toFixed(2)}</span>
          <button className="rounded-full bg-contoso-blue px-4 py-2 text-sm font-semibold text-white" onClick={() => addItem(product)}>
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
};
