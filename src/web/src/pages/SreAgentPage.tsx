import { Play, ShieldAlert, ShieldCheck, Siren, StopCircle } from 'lucide-react';
import { useState } from 'react';
import { SreAgentReport, TelemetrySnapshot } from '../types';
import api from '../utils/api';

const classificationColors: Record<string, string> = {
  APPLICATION_OR_CLIENT_SIDE: 'bg-rose-100 text-rose-900',
  AZURE_SERVICE_SIDE: 'bg-orange-100 text-orange-900',
  DATABASE_CONFIG_OR_DATA_MODEL: 'bg-amber-100 text-amber-900',
  SQL_DATABASE_OR_SCHEMA: 'bg-yellow-100 text-yellow-900',
  HOST_OR_RUNTIME: 'bg-violet-100 text-violet-900',
  INSUFFICIENT_EVIDENCE: 'bg-slate-200 text-slate-800',
};

export const SreAgentPage = () => {
  const [report, setReport] = useState<SreAgentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [verification, setVerification] = useState<{ recovered: boolean; checks: { criterion: string; pass: boolean }[]; snapshot: TelemetrySnapshot } | null>(null);

  const runInvestigation = async () => {
    setLoading(true);
    try {
      const response = await api.get<SreAgentReport>('/sre-agent/investigate');
      setReport(response.data);
    } finally {
      setLoading(false);
    }
  };

  const verifyRecovery = async () => {
    const response = await api.post('/sre-agent/verify-recovery');
    setVerification(response.data);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-3xl font-bold">Azure SRE Agent — Incident Investigation</h1>
          <p className="mt-2 text-slate-600">{report ? `Incident ${report.incidentId} · ${new Date(report.generatedAt).toLocaleString()}` : 'No investigation has been run yet.'}</p>
        </div>
        <div className="flex gap-3">
          <button className="rounded-full bg-contoso-blue px-5 py-3 font-semibold text-white" onClick={() => void runInvestigation()}>{loading ? 'Running...' : 'Run Investigation'}</button>
          <button className="rounded-full border border-slate-200 px-5 py-3 font-semibold text-slate-700" onClick={() => void verifyRecovery()}>Verify Recovery</button>
        </div>
      </div>

      {!report ? (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-slate-500">Run the investigation to generate classification, evidence, safe actions, and recovery guidance.</div>
      ) : (
        <>
          <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className={`rounded-3xl p-6 shadow-sm ${classificationColors[report.primaryClassification] ?? classificationColors.INSUFFICIENT_EVIDENCE}`}>
              <p className="text-sm font-semibold uppercase tracking-wide">Primary classification</p>
              <h2 className="mt-2 text-3xl font-bold">{report.primaryClassification}</h2>
            </div>
            <div className="rounded-3xl bg-white p-6 shadow-sm">
              <p className="text-sm text-slate-500">Confidence</p>
              <p className="mt-2 inline-flex rounded-full bg-emerald-100 px-4 py-2 text-lg font-semibold text-emerald-800">{report.confidence}</p>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">Customer impact</h3><p className="mt-3 text-slate-600">{report.customerImpact}</p></div>
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">Ownership routing</h3><p className="mt-3 font-semibold text-contoso-dark">Primary Owner: {report.primaryOwner}</p><p className="mt-2 text-slate-600">Secondary Owners: {report.secondaryOwners.join(', ')}</p></div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">Evidence</h3><div className="mt-4 grid gap-3">{report.evidence.map((item) => <div key={item} className="rounded-2xl border border-slate-200 p-4 text-slate-700">{item}</div>)}</div></div>
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">Ruled-out causes</h3><div className="mt-4 grid gap-3">{report.ruledOutCauses.map((item) => <div key={item} className="flex gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-900"><ShieldCheck className="mt-1 h-5 w-5" />{item}</div>)}</div></div>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">Immediate safe actions</h3><div className="mt-4 grid gap-3">{report.immediateSafeActions.map((item) => <div key={item} className="flex gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-900"><Play className="mt-1 h-5 w-5" />{item}</div>)}</div></div>
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">Approval-required actions</h3><div className="mt-4 grid gap-3">{report.approvalRequiredActions.map((item) => <div key={item} className="flex gap-3 rounded-2xl bg-amber-50 p-4 text-amber-900"><ShieldAlert className="mt-1 h-5 w-5" />{item}</div>)}</div></div>
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">DO NOT DO</h3><div className="mt-4 grid gap-3">{report.doNotDoGuidance.map((item) => <div key={item} className="flex gap-3 rounded-2xl bg-rose-50 p-4 text-rose-900"><StopCircle className="mt-1 h-5 w-5" />{item}</div>)}</div></div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h3 className="text-xl font-semibold">Escalation recommendation</h3>
            <p className="mt-3 text-slate-700">{report.escalationRecommendation}</p>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">Verification criteria</h3><ul className="mt-4 space-y-2">{report.verificationCriteria.map((item) => <li key={item} className="rounded-2xl bg-slate-50 px-4 py-3 text-slate-700">• {item}</li>)}</ul></div>
            <div className="rounded-3xl bg-white p-6 shadow-sm"><h3 className="text-xl font-semibold">Executive summary</h3><p className="mt-3 text-slate-700">{report.executiveSummary}</p><h4 className="mt-6 text-lg font-semibold">Engineering RCA</h4><details className="mt-3 rounded-2xl bg-slate-50 p-4"><summary className="cursor-pointer font-semibold">Expand technical RCA</summary><p className="mt-3 text-slate-700">{report.engineeringRca}</p></details></div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-semibold">Teams update</h3>
              <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700" onClick={() => navigator.clipboard?.writeText(report.teamsUpdate)}>Copy update</button>
            </div>
            <textarea readOnly className="mt-4 min-h-[180px] w-full rounded-2xl border border-slate-200 p-4 text-sm text-slate-700" value={report.teamsUpdate} />
          </section>
        </>
      )}

      {verification && (
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <Siren className={`h-6 w-6 ${verification.recovered ? 'text-emerald-600' : 'text-rose-600'}`} />
            <h3 className="text-xl font-semibold">Recovery verification: {verification.recovered ? 'Recovered' : 'Still degraded'}</h3>
          </div>
          <div className="mt-4 grid gap-3">
            {verification.checks.map((check) => (
              <div key={check.criterion} className={`rounded-2xl p-4 ${check.pass ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}>
                {check.pass ? '✓' : '✗'} {check.criterion}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
