import { FormEvent, useState } from 'react';
import api from '../utils/api';

export const AccountPage = () => {
  const [profile, setProfile] = useState({
    customerId: window.localStorage.getItem('contoso-customer-id') ?? 'demo-customer',
    name: window.localStorage.getItem('contoso-customer-name') ?? 'Taylor Morgan',
    email: window.localStorage.getItem('contoso-customer-email') ?? 'taylor.morgan@contoso.demo',
    addressLine1: '1 Contoso Way',
    city: 'Amsterdam',
    country: 'Netherlands',
    postalCode: '1011AB',
  });
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await api.put(`/account/${profile.customerId}`, profile);
    window.localStorage.setItem('contoso-customer-id', profile.customerId);
    window.localStorage.setItem('contoso-customer-name', profile.name);
    window.localStorage.setItem('contoso-customer-email', profile.email);
    setSaved(true);
  };

  return (
    <form className="rounded-3xl bg-white p-8 shadow-sm" onSubmit={handleSubmit}>
      <h1 className="text-3xl font-bold">Account</h1>
      <p className="mt-2 text-slate-600">Simple customer profile and shipping address form for the demo experience.</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {Object.entries(profile).map(([key, value]) => (
          <label key={key} className={`text-sm font-medium text-slate-700 ${key === 'addressLine1' ? 'md:col-span-2' : ''}`}>
            {key}
            <input
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
              value={value}
              onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value }))}
              readOnly={key === 'customerId'}
            />
          </label>
        ))}
      </div>
      <button className="mt-6 rounded-full bg-contoso-blue px-5 py-3 font-semibold text-white">Save profile</button>
      {saved && <p className="mt-3 text-sm text-emerald-600">Profile saved successfully.</p>}
    </form>
  );
};
