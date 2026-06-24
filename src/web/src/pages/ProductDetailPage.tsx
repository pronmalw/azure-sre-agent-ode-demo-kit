import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { Product, Review } from '../types';
import api from '../utils/api';

export const ProductDetailPage = () => {
  const { id } = useParams();
  const { addItem } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    if (!id) {
      return;
    }
    void api.get<Product>(`/products/${id}`).then((response) => setProduct(response.data)).catch(() => setProduct(null));
    void api.get<Review[]>(`/products/${id}/reviews`).then((response) => setReviews(response.data)).catch(() => setReviews([]));
  }, [id]);

  const attributeEntries = useMemo(() => Object.entries(product?.attributes ?? {}), [product]);
  const price = product?.pricing?.salePrice ?? product?.pricing?.listPrice ?? 0;

  if (!product) {
    return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-slate-500">Loading product details...</div>;
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
      <img src={product.imageUrl} alt={product.name} className="h-full min-h-[320px] w-full rounded-3xl object-cover shadow-sm" />
      <div className="space-y-6 rounded-3xl bg-white p-8 shadow-sm">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-contoso-blue">{product.categoryName}</p>
          <h1 className="mt-2 text-3xl font-bold">{product.name}</h1>
          <p className="mt-3 text-slate-600">{product.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {attributeEntries.map(([key, value]) => (
            <span key={key} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
              {key}: {Array.isArray(value) ? value.join(', ') : String(value)}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-3xl font-bold text-contoso-dark">${price.toFixed(2)}</span>
          <div className="flex items-center gap-3">
            <input type="number" min={1} className="w-20 rounded-xl border border-slate-200 px-3 py-2" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
            <button className="rounded-full bg-contoso-blue px-5 py-3 font-semibold text-white" onClick={() => addItem(product, quantity)}>
              Add to cart
            </button>
          </div>
        </div>
        <section>
          <h2 className="text-xl font-semibold">Reviews</h2>
          <div className="mt-4 space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{review.title}</p>
                  <span className="text-sm text-amber-500">★ {review.rating}</span>
                </div>
                <p className="mt-2 text-slate-600">{review.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
