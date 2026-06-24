import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import api from '../utils/api';

export const CheckoutPage = () => {
  const navigate = useNavigate();
  const { items, totals, clearCart } = useCart();
  const [form, setForm] = useState({
    customerId: window.localStorage.getItem('contoso-customer-id') ?? 'demo-customer',
    name: window.localStorage.getItem('contoso-customer-name') ?? 'Taylor Morgan',
    email: window.localStorage.getItem('contoso-customer-email') ?? 'taylor.morgan@contoso.demo',
    addressLine1: '1 Contoso Way',
    city: 'Amsterdam',
    country: 'Netherlands',
    postalCode: '1011AB',
    cardNumber: '4242 4242 4242 4242',
    expiry: '12/29',
    cvv: '123',
  });
  const [submitting, setSubmitting] = useState(false);

  const updateField = (field: keyof typeof form, value: string) => setForm((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/cart', { userId: form.customerId, items });
      const response = await api.post('/checkout', { ...form, userId: form.customerId, cart: { items } });
      window.localStorage.setItem('contoso-customer-id', form.customerId);
      window.localStorage.setItem('contoso-customer-name', form.name);
      window.localStorage.setItem('contoso-customer-email', form.email);
      clearCart();
      navigate('/order-confirmation', { state: { order: response.data.order } });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="grid gap-8 lg:grid-cols-[2fr_1fr]" onSubmit={handleSubmit}>
      <div className="space-y-6 rounded-3xl bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-3xl font-bold">Checkout</h1>
          <p className="mt-2 text-slate-600">Secure demo checkout flow backed by Cosmos cart storage and Azure SQL orders.</p>
        </div>
        <section className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Name<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.name} onChange={(event) => updateField('name', event.target.value)} /></label>
          <label className="text-sm font-medium text-slate-700">Email<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.email} onChange={(event) => updateField('email', event.target.value)} /></label>
          <label className="text-sm font-medium text-slate-700 md:col-span-2">Address line 1<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.addressLine1} onChange={(event) => updateField('addressLine1', event.target.value)} /></label>
          <label className="text-sm font-medium text-slate-700">City<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.city} onChange={(event) => updateField('city', event.target.value)} /></label>
          <label className="text-sm font-medium text-slate-700">Country<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.country} onChange={(event) => updateField('country', event.target.value)} /></label>
          <label className="text-sm font-medium text-slate-700">Postal code<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.postalCode} onChange={(event) => updateField('postalCode', event.target.value)} /></label>
        </section>
        <section>
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-xl font-semibold">Payment</h2>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">DEMO ONLY</span>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm font-medium text-slate-700 md:col-span-3">Card number<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.cardNumber} onChange={(event) => updateField('cardNumber', event.target.value)} /></label>
            <label className="text-sm font-medium text-slate-700">Expiry<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.expiry} onChange={(event) => updateField('expiry', event.target.value)} /></label>
            <label className="text-sm font-medium text-slate-700">CVV<input className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2" value={form.cvv} onChange={(event) => updateField('cvv', event.target.value)} /></label>
          </div>
        </section>
      </div>
      <aside className="rounded-3xl bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold">Order summary</h2>
        <div className="mt-4 space-y-2 text-sm text-slate-600">
          {items.map((item) => <div key={item.productId} className="flex justify-between"><span>{item.productName} × {item.quantity}</span><span>${(item.quantity * item.unitPrice).toFixed(2)}</span></div>)}
        </div>
        <div className="mt-6 space-y-3 border-t border-slate-200 pt-4 text-slate-700">
          <div className="flex justify-between"><span>Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
          <div className="flex justify-between"><span>Tax</span><span>${totals.tax.toFixed(2)}</span></div>
          <div className="flex justify-between text-lg font-semibold text-slate-900"><span>Total</span><span>${totals.total.toFixed(2)}</span></div>
        </div>
        <button disabled={submitting || items.length === 0} className="mt-6 w-full rounded-full bg-contoso-blue px-5 py-3 font-semibold text-white disabled:opacity-50">
          {submitting ? 'Placing order...' : 'Place Order'}
        </button>
      </aside>
    </form>
  );
};
