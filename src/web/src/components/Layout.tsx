import { ShoppingCart } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useCart } from '../hooks/useCart';
import { ServiceHealthBanner } from './ServiceHealthBanner';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-2 text-sm font-medium ${isActive ? 'bg-contoso-blue text-white' : 'text-slate-700 hover:bg-slate-100'}`;

export const Layout = () => {
  const { itemCount } = useCart();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <ServiceHealthBanner />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-2xl font-bold text-contoso-dark">Contoso Retail</Link>
          <nav className="flex items-center gap-2">
            <NavLink to="/" className={navLinkClass}>Home</NavLink>
            <NavLink to="/products" className={navLinkClass}>Products</NavLink>
            <NavLink to="/account" className={navLinkClass}>Account</NavLink>
            <NavLink to="/ops" className={navLinkClass}>Ops</NavLink>
          </nav>
          <Link to="/cart" className="relative rounded-full border border-slate-200 p-3 text-slate-700">
            <ShoppingCart className="h-5 w-5" />
            <span className="absolute -right-2 -top-2 rounded-full bg-contoso-blue px-2 text-xs font-semibold text-white">{itemCount}</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-6 text-sm text-slate-500">Contoso Retail demo kit — Cosmos DB for catalogue + Azure SQL for transactions.</div>
      </footer>
    </div>
  );
};
