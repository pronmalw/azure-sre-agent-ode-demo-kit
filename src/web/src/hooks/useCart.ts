import { useEffect, useMemo, useState } from 'react';
import { CartItem, Product } from '../types';

const STORAGE_KEY = 'contoso-retail-cart';
const CART_EVENT = 'contoso-cart-updated';

const readItems = (): CartItem[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
};

const persistItems = (items: CartItem[]): void => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(CART_EVENT));
};

export const useCart = () => {
  const [items, setItems] = useState<CartItem[]>(readItems());

  useEffect(() => {
    const sync = () => setItems(readItems());
    window.addEventListener(CART_EVENT, sync);
    return () => window.removeEventListener(CART_EVENT, sync);
  }, []);

  const addItem = (product: Product, quantity = 1): void => {
    const nextItems = [...items];
    const existing = nextItems.find((item) => item.productId === product.id);
    const unitPrice = product.pricing?.salePrice ?? product.pricing?.listPrice ?? 0;
    if (existing) {
      existing.quantity += quantity;
    } else {
      nextItems.push({ productId: product.id, productName: product.name, quantity, unitPrice });
    }
    setItems(nextItems);
    persistItems(nextItems);
  };

  const updateQuantity = (productId: string, quantity: number): void => {
    const nextItems = items
      .map((item) => (item.productId === productId ? { ...item, quantity: Math.max(1, quantity) } : item))
      .filter((item) => item.quantity > 0);
    setItems(nextItems);
    persistItems(nextItems);
  };

  const removeItem = (productId: string): void => {
    const nextItems = items.filter((item) => item.productId !== productId);
    setItems(nextItems);
    persistItems(nextItems);
  };

  const clearCart = (): void => {
    setItems([]);
    persistItems([]);
  };

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const tax = subtotal * 0.2;
    return { subtotal, tax, total: subtotal + tax };
  }, [items]);

  return {
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    totals,
  };
};
