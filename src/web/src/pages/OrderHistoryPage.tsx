import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Order } from '../types';
import api from '../utils/api';

export const OrderHistoryPage = () => {
  const customerId = window.localStorage.getItem('contoso-customer-id') ?? 'demo-customer';
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    void api.get<Order[]>(`/orders/${customerId}`).then((response) => setOrders(response.data)).catch(() => setOrders([]));
  }, [customerId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Order history</h1>
        <p className="mt-2 text-slate-600">Orders for customer ID <span className="font-semibold">{customerId}</span>.</p>
      </div>
      <div className="space-y-4">
        {orders.map((order) => (
          <div key={order.orderId} className="rounded-2xl bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">Order {order.orderId}</p>
                <p className="text-sm text-slate-500">{new Date(order.orderDate).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold capitalize">{order.status}</span>
                <span className="font-semibold text-contoso-dark">${order.totalAmount.toFixed(2)}</span>
                <Link to="/order-confirmation" state={{ order }} className="text-sm font-semibold text-contoso-blue underline">View detail</Link>
              </div>
            </div>
            <p className="mt-3 text-slate-600">Items: {order.items.length}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
