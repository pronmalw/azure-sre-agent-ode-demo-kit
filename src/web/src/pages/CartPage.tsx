import { Link } from 'react-router-dom';
import { useCart } from '../hooks/useCart';

export const CartPage = () => {
  const { items, updateQuantity, removeItem, totals } = useCart();

  if (items.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
        <h1 className="text-3xl font-bold">Your cart is empty</h1>
        <p className="mt-3 text-slate-600">Browse the product catalogue to add your first item.</p>
        <Link to="/products" className="mt-6 inline-flex rounded-full bg-contoso-blue px-5 py-3 font-semibold text-white">Continue shopping</Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">Shopping cart</h1>
        {items.map((item) => (
          <div key={item.productId} className="flex items-center justify-between rounded-2xl bg-white p-5 shadow-sm">
            <div>
              <p className="text-lg font-semibold">{item.productName}</p>
              <p className="text-slate-500">${item.unitPrice.toFixed(2)} each</p>
            </div>
            <div className="flex items-center gap-3">
              <input type="number" min={1} className="w-20 rounded-xl border border-slate-200 px-3 py-2" value={item.quantity} onChange={(event) => updateQuantity(item.productId, Number(event.target.value))} />
              <button className="rounded-full border border-slate-200 px-4 py-2 text-sm" onClick={() => removeItem(item.productId)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <aside className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">Order summary</h2>
        <div className="mt-6 space-y-3 text-slate-600">
          <div className="flex justify-between"><span>Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Tax (20%)</span><span>${totals.tax.toFixed(2)}</span></div>
          <div className="flex justify-between border-t border-slate-200 pt-3 text-lg font-semibold text-slate-900"><span>Total</span><span>${totals.total.toFixed(2)}</span></div>
        </div>
        <Link to="/checkout" className="mt-6 inline-flex w-full justify-center rounded-full bg-contoso-blue px-5 py-3 font-semibold text-white">
          Proceed to Checkout
        </Link>
      </aside>
    </div>
  );
};
