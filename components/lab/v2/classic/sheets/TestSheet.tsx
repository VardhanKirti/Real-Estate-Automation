'use client';
/**
 * Test sheet (01 18), Classic tree: the Log a test form (Trial Reels or YouTube Test & Compare) and the
 * test detail with 06's labels. Create POSTs /api/lab/tests; metrics, result and stop PATCH /api/lab/tests/[id];
 * Judge now POSTs /api/lab/tests/[id]/judge. No delete.
 */
import { useState } from 'react';
import type { TestDetailView, TestFormView, TestSheetView } from '@/lib/lab/view/sheets/test';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { Btn, ConfirmDialog } from '../dialogs';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { Tag } from '../parts';
import { Block, type SheetCommon } from './common';

type Arm = { id: string; label: string; variantText: string; postId: string };
const ARM_IDS = ['A', 'B', 'C'];

function TestForm({ form, readOnly }: { form: TestFormView; readOnly: string | null }) {
  const { post, busy } = useLabPost();
  const [kind, setKind] = useState(form.kinds[0]?.id ?? 'trial_reels');
  const [title, setTitle] = useState('');
  const [hypothesis, setHyp] = useState('');
  const vars = kind === 'trial_reels' ? form.variables.trial_reels : form.variables.yt_test_compare;
  const [variable, setVariable] = useState<string>(vars[0]);
  const [lift, setLift] = useState('');
  const [video, setVideo] = useState(form.youtubeVideos[0]?.id ?? '');
  const [arms, setArms] = useState<Arm[]>([
    { id: 'A', label: 'A', variantText: '', postId: form.prefillPostId ?? '' },
    { id: 'B', label: 'B', variantText: '', postId: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const k = form.kinds.find((x) => x.id === kind)!;
  const setArm = (i: number, patch: Partial<Arm>) => setArms((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async () => {
    const t = title.trim();
    if (t.length < form.limits.titleMin || t.length > form.limits.titleMax) return setError(C.test.errTitle);
    if (hypothesis.length > form.limits.hypothesisMax) return setError(C.test.errHyp);
    if (arms.length < form.limits.armsMin || arms.length > form.limits.armsMax) return setError(C.test.errArms);
    if (kind === 'trial_reels' && arms.some((a) => !a.postId)) return setError(C.test.errPosts);
    if (kind === 'yt_test_compare' && !video) return setError(C.test.errVideo);
    setError(null);
    const l = form.lifts.find((x) => x.featureKey === lift);
    const r = await post('/api/lab/tests', {
      kind, title: t, hypothesis, variable,
      featureKey: l?.featureKey, expectedSign: l?.expectedSign,
      platform: kind === 'trial_reels' ? 'instagram' : 'youtube',
      arms: arms.map((a) => ({ id: a.id, label: a.label, variantText: a.variantText, postId: kind === 'trial_reels' ? a.postId : video })),
    }, { key: 'create', refresh: false, quiet: true, okText: C.test.logged });
    if (r.ok) {
      const test = r.data.test as { id?: string } | undefined;
      if (test?.id) { const u = new URL(window.location.href); u.searchParams.set('test', test.id); u.searchParams.delete('post'); window.history.replaceState(null, '', u); }
    } else if (typeof r.data.error === 'string') setError(r.data.error);
  };

  return (
    <form className="lab2c-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="lab2c-actrow" role="radiogroup" aria-label={C.test.kind}>
        {form.kinds.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={kind === x.id} className="lab2c-fchip" aria-current={kind === x.id ? 'true' : undefined} onClick={() => { setKind(x.id); setVariable((x.id === 'trial_reels' ? form.variables.trial_reels : form.variables.yt_test_compare)[0]); }}>{x.label}</button>
        ))}
      </div>
      <p className="lab2c-muted" data-lab-ink="">{k.help}</p>
      {k.hygiene.length > 0 && <ul className="lab2c-hygiene">{k.hygiene.map((h) => <li key={h} data-lab-ink="">{h}</li>)}</ul>}
      <label className="lab2c-field">
        <span className="lab2c-field-label" data-lab-ink="">{C.test.title}</span>
        <input className="lab2c-input" value={title} maxLength={form.limits.titleMax} onChange={(e) => setTitle(e.target.value)} disabled={!!readOnly} />
      </label>
      <label className="lab2c-field">
        <span className="lab2c-field-label" data-lab-ink="">{C.test.hypothesis}</span>
        <textarea className="lab2c-input" value={hypothesis} maxLength={form.limits.hypothesisMax} onChange={(e) => setHyp(e.target.value)} disabled={!!readOnly} />
      </label>
      <span className="lab2c-field-row">
        <label className="lab2c-field">
          <span className="lab2c-field-label" data-lab-ink="">{C.test.variable}</span>
          <select className="lab2c-input" value={variable} onChange={(e) => setVariable(e.target.value)} disabled={!!readOnly}>
            {vars.map((v) => <option key={v} value={v}>{C.test.vars[v] ?? v}</option>)}
          </select>
        </label>
        {form.lifts.length > 0 && (
          <label className="lab2c-field">
            <span className="lab2c-field-label" data-lab-ink="">{C.test.lift}</span>
            <select className="lab2c-input" value={lift} onChange={(e) => setLift(e.target.value)} disabled={!!readOnly}>
              <option value="" />
              {form.lifts.map((l) => <option key={l.featureKey} value={l.featureKey}>{l.label}</option>)}
            </select>
          </label>
        )}
      </span>
      {kind === 'yt_test_compare' && (
        <label className="lab2c-field">
          <span className="lab2c-field-label" data-lab-ink="">{C.test.video}</span>
          <select className="lab2c-input" value={video} onChange={(e) => setVideo(e.target.value)} disabled={!!readOnly}>
            {form.youtubeVideos.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
      )}
      <Block title={C.test.arms}>
        {arms.map((a, i) => (
          <div key={a.id} className="lab2c-arm">
            <span className="lab2c-arm-id" data-lab-ink="">{a.label}</span>
            <input className="lab2c-input" value={a.variantText} maxLength={form.limits.variantMax} placeholder={C.test.variant} aria-label={`${C.test.variant} ${a.label}`} onChange={(e) => setArm(i, { variantText: e.target.value })} disabled={!!readOnly} />
            {kind === 'trial_reels' && (
              <select className="lab2c-input" value={a.postId} onChange={(e) => setArm(i, { postId: e.target.value })} aria-label={`${C.test.post} ${a.label}`} disabled={!!readOnly}>
                <option value="" />
                {form.instagramPosts.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
          </div>
        ))}
        {arms.length < form.limits.armsMax && !readOnly && (
          <span><Btn onClick={() => setArms((x) => [...x, { id: ARM_IDS[x.length], label: ARM_IDS[x.length], variantText: '', postId: '' }])}>{C.test.addArm}</Btn></span>
        )}
      </Block>
      {error && <p className="lab2c-field-err" role="alert">{error}</p>}
      {readOnly && <p className="lab2c-muted" data-lab-ink="">{readOnly}</p>}
      <span><Btn primary type="submit" disabled={!!readOnly} busy={busy === 'create'}>{C.test.create}</Btn></span>
    </form>
  );
}

const METRIC_KEYS = ['reach', 'views', 'likes', 'shares', 'saved'] as const;

/** 01 18.2 Enter metrics (Trial Reels, manual): one row per arm, read at 72 hours. */
function MetricsForm({ d, readOnly, onSave, busy }: { d: TestDetailView; readOnly: string | null; onSave: (arms: unknown[]) => unknown; busy: boolean }) {
  const [vals, setVals] = useState<Record<string, Record<string, string>>>({});
  const set = (arm: string, k: string, v: string) => setVals((x) => ({ ...x, [arm]: { ...x[arm], [k]: v.replace(/[^0-9]/g, '') } }));
  const save = () => onSave(d.test.arms.map((a) => ({
    id: a.id,
    postId: a.postId,
    metrics: { atAgeH: 72, source: 'manual', ...Object.fromEntries(METRIC_KEYS.map((k) => [k, vals[a.id]?.[k] ? Number(vals[a.id][k]) : null])) },
  })));
  return (
    <Block title={C.test.enterMetrics}>
      <div className="lab2c-table-wrap">
        <table className="lab2c-table">
          <thead><tr><th scope="col">{C.test.arms}</th>{METRIC_KEYS.map((k) => <th key={k} scope="col">{C.test.metric[k]}</th>)}</tr></thead>
          <tbody>
            {d.arms.map((a) => (
              <tr key={a.id}>
                <td data-lab-ink="">{a.label}</td>
                {METRIC_KEYS.map((k) => (
                  <td key={k}><input className="lab2c-input lab2c-input-s" inputMode="numeric" value={vals[a.id]?.[k] ?? ''} onChange={(e) => set(a.id, k, e.target.value)} aria-label={`${a.label} ${C.test.metric[k]}`} disabled={!!readOnly} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span><Btn disabled={!!readOnly} busy={busy} onClick={save}>{C.setupSheet.save}</Btn></span>
    </Block>
  );
}

function TestDetail({ d, readOnly }: { d: TestDetailView; readOnly: string | null }) {
  const { post, busy } = useLabPost();
  const [stop, setStop] = useState(false);
  const t = d.test;
  const patch = (body: Record<string, unknown>, key: string) => post(`/api/lab/tests/${encodeURIComponent(t.id)}`, body, { key, method: 'PATCH' });
  return (
    <div className="lab2c-sheetbody">
      <div className="lab2c-idea-meta">
        <Tag tone={d.tone === 'ok' ? 'strong' : 'quiet'}>{d.statusLabel}</Tag>
        <span className="lab2c-muted" data-lab-ink="">{d.kindLabel}</span>
      </div>
      {d.resultSubline && <p className="lab2c-note" data-lab-ink="">{d.resultSubline}</p>}
      {d.confirmsText && <p className="lab2c-note" data-lab-ink="">{d.confirmsText}</p>}
      {t.hypothesis && <Block title={C.test.hypothesis}><p className="lab2c-pred" data-lab-ink="">{t.hypothesis}</p></Block>}
      <Block title={C.test.arms}>
        <ul className="lab2c-arms">
          {d.arms.map((a) => (
            <li key={a.id} className="lab2c-arm-row" data-winner={a.isWinner ? '' : undefined}>
              <span className="lab2c-arm-id" data-lab-ink="">{a.label}</span>
              <span className="lab2c-arm-main">
                <span data-lab-ink="">{a.variantText}</span>
                <span className="lab2c-muted" data-lab-ink="">{a.metricsText}</span>
              </span>
              {a.postHref && <a href={a.postHref} className="lab2-textlink">{C.test.post}</a>}
            </li>
          ))}
        </ul>
      </Block>
      {d.hygiene.length > 0 && <ul className="lab2c-hygiene">{d.hygiene.map((h) => <li key={h} data-lab-ink="">{h}</li>)}</ul>}
      {d.actions.enterMetrics && <MetricsForm d={d} readOnly={readOnly} onSave={(arms) => patch({ arms }, 'metrics')} busy={busy === 'metrics'} />}
      <div className="lab2c-actrow">
        {d.actions.judgeNow && <Btn primary disabled={!!readOnly} busy={busy === 'judge'} onClick={() => void post(`/api/lab/tests/${encodeURIComponent(t.id)}/judge`, {}, { key: 'judge' })}>{C.test.judge}</Btn>}
        {d.actions.recordResult && d.arms.map((a) => (
          <Btn key={a.id} disabled={!!readOnly} onClick={() => void patch({ result: 'winner', winnerArm: a.id }, `w-${a.id}`)}>{`${C.test.results.winner}: ${a.label}`}</Btn>
        ))}
        {d.actions.recordResult && (['performed_same', 'inconclusive'] as const).map((res) => (
          <Btn key={res} disabled={!!readOnly} onClick={() => void patch({ result: res }, res)}>{C.test.results[res]}</Btn>
        ))}
        {d.actions.stop && <Btn disabled={!!readOnly} onClick={() => setStop(true)}>{C.test.stop}</Btn>}
      </div>
      <ConfirmDialog open={stop} title={C.test.stop} body={C.test.stopConfirm} confirmLabel={C.test.stop} onClose={() => setStop(false)} onConfirm={() => { setStop(false); void patch({ status: 'abandoned' }, 'stop'); }} />
    </div>
  );
}

export function TestSheet({ view, readOnly }: { view: TestSheetView } & SheetCommon) {
  return view.mode === 'new' ? <TestForm form={view.form} readOnly={readOnly} /> : <TestDetail d={view.test} readOnly={readOnly} />;
}
