import { Link, useLocation } from 'react-router-dom';
import { Order } from '../types';

export const OrderConfirmationPage = () => {
  const location = useLocation();
  const order = location.state?.order as Order | undefined;

  if (!order) {
    return (
      <div className="rounded-3xl bg-white p-10 shadow-sm">
        <h1 className="text-3xl font-bold">No order found</h1>
        <Link to="/products" className="mt-6 inline-flex rounded-full bg-contoso-blue px-5 py-3 font-semibold text-white">Return to products</Link>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-white p-10 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-emerald-600">Success</p>
      <h1 className="mt-2 text-3xl font-bold">Order confirmed</h1>
      <p className="mt-4 text-slate-600">Order ID: <span className="font-semibold text-slate-900">{order.orderId}</span></p>
      <p className="mt-2 text-slate-600">Estimated delivery: 3-5 business days</p>
      <div className="mt-6 rounded-2xl bg-slate-50 p-6">
        <p className="font-semibold">Summary</p>
        <p className="mt-2 text-slate-600">{order.items.length} items · Total ${order.totalAmount.toFixed(2)}</p>
      </div>
      <div className="mt-6 flex gap-3">
        <Link to="/orders" className="rounded-full bg-contoso-blue px-5 py-3 font-semibold text-white">View orders</Link>
        <Link to="/products" className="rounded-full border border-slate-200 px-5 py-3 font-semibold text-slate-700">Continue shopping</Link>
      </div>
    </div>
  );
};
