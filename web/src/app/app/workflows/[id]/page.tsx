'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  DELETE_STEPS,
  DELETE_TRIGGERS,
  GET_MY_ORGS,
  GET_WORKFLOW,
  INSERT_STEPS,
  INSERT_TRIGGERS,
  INSERT_WORKFLOW,
  UPDATE_WORKFLOW,
} from '@/graphql/operations';
import { useAuth } from '@/lib/providers';

type StepDraft = {
  name: string;
  step_type: string;
  config: string;
};

type TriggerDraft = {
  trigger_type: string;
  config: string;
  webhook_secret: string;
};

const STEP_TYPES = [
  'llm_call',
  'http_request',
  'db_write',
  'notify',
  'conditional_branch',
  'approval_gate',
] as const;

const DEFAULT_CONFIG: Record<string, string> = {
  llm_call:
    '{\n  "prompt": "Classify sentiment. Reply SENTIMENT: positive or SENTIMENT: negative.\\n\\n{{input.text}}"\n}',
  http_request:
    '{\n  "url": "https://postman-echo.com/post",\n  "method": "POST"\n}',
  db_write: '{\n  "key": "result",\n  "value_from_previous": true\n}',
  notify:
    '{\n  "channel": "email",\n  "message": "Notify: {{previous}}",\n  "to": "ops@example.com"\n}',
  conditional_branch: '{\n  "field": "text",\n  "contains": "positive"\n}',
  approval_gate: '{\n  "message": "Needs owner/editor approval"\n}',
};

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const isNew = params.id === 'new';
  const router = useRouter();
  const { user, accessToken } = useAuth();

  const orgsQuery = useQuery(GET_MY_ORGS, { skip: !accessToken });
  const wfQuery = useQuery(GET_WORKFLOW, {
    variables: { id: params.id },
    skip: isNew || !params.id,
  });

  const [orgId, setOrgId] = useState('');
  const [name, setName] = useState('Untitled workflow');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([
    {
      name: 'Analyze',
      step_type: 'llm_call',
      config: DEFAULT_CONFIG.llm_call,
    },
    {
      name: 'HTTP echo',
      step_type: 'http_request',
      config: DEFAULT_CONFIG.http_request,
    },
    {
      name: 'Branch',
      step_type: 'conditional_branch',
      config: DEFAULT_CONFIG.conditional_branch,
    },
  ]);
  const [triggers, setTriggers] = useState<TriggerDraft[]>([
    { trigger_type: 'manual', config: '{}', webhook_secret: '' },
  ]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [insertWorkflow] = useMutation(INSERT_WORKFLOW);
  const [updateWorkflow] = useMutation(UPDATE_WORKFLOW);
  const [deleteSteps] = useMutation(DELETE_STEPS);
  const [insertSteps] = useMutation(INSERT_STEPS);
  const [deleteTriggers] = useMutation(DELETE_TRIGGERS);
  const [insertTriggers] = useMutation(INSERT_TRIGGERS);

  const myRole = useMemo(() => {
    const org = orgsQuery.data?.organizations?.find(
      (o: { id: string }) => o.id === orgId
    );
    const member = org?.members?.find(
      (m: { user_id: string }) => m.user_id === user?.id
    );
    return member?.role || user?.role || 'viewer';
  }, [orgsQuery.data, orgId, user]);

  const isOwner = myRole === 'owner';
  const canEdit = myRole === 'owner' || myRole === 'editor';

  useEffect(() => {
    if (!orgId && orgsQuery.data?.organizations?.[0]?.id) {
      setOrgId(orgsQuery.data.organizations[0].id);
    }
  }, [orgsQuery.data, orgId]);

  useEffect(() => {
    const wf = wfQuery.data?.workflows_by_pk;
    if (!wf) return;
    setOrgId(wf.org_id);
    setName(wf.name);
    setDescription(wf.description || '');
    setSteps(
      wf.steps.map(
        (s: { name: string; step_type: string; config: unknown }) => ({
          name: s.name,
          step_type: s.step_type,
          config: JSON.stringify(s.config ?? {}, null, 2),
        })
      )
    );
    setTriggers(
      wf.triggers.map(
        (t: {
          trigger_type: string;
          config: unknown;
          webhook_secret?: string;
        }) => ({
          trigger_type: t.trigger_type,
          config: JSON.stringify(t.config ?? {}, null, 2),
          webhook_secret: t.webhook_secret || '',
        })
      )
    );
  }, [wfQuery.data]);

  function moveStep(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= steps.length) return;
    const copy = [...steps];
    const tmp = copy[index];
    copy[index] = copy[next];
    copy[next] = tmp;
    setSteps(copy);
  }

  async function onSave() {
    if (!canEdit) {
      setError('Viewers cannot edit workflows');
      return;
    }
    setSaving(true);
    setError('');
    try {
      for (const s of steps) {
        if (
          (s.step_type === 'db_write' || s.step_type === 'notify') &&
          !isOwner
        ) {
          throw new Error('Only owners can add db_write or notify steps');
        }
        JSON.parse(s.config || '{}');
      }
      for (const t of triggers) {
        if (t.trigger_type === 'webhook' && !isOwner) {
          throw new Error('Only owners can add webhook triggers');
        }
        JSON.parse(t.config || '{}');
      }

      let workflowId = isNew ? '' : params.id;
      if (isNew) {
        const res = await insertWorkflow({
          variables: {
            object: {
              org_id: orgId,
              name,
              description,
              is_active: true,
            },
          },
        });
        workflowId = res.data.insert_workflows_one.id;
      } else {
        await updateWorkflow({
          variables: {
            id: workflowId,
            set: { name, description },
          },
        });
        await deleteSteps({ variables: { workflowId } });
        await deleteTriggers({ variables: { workflowId } });
      }

      await insertSteps({
        variables: {
          objects: steps.map((s, position) => ({
            workflow_id: workflowId,
            name: s.name,
            step_type: s.step_type,
            config: JSON.parse(s.config || '{}'),
            position,
          })),
        },
      });

      await insertTriggers({
        variables: {
          objects: triggers.map((t) => ({
            workflow_id: workflowId,
            trigger_type: t.trigger_type,
            config: JSON.parse(t.config || '{}'),
            webhook_secret: t.webhook_secret || null,
            is_active: true,
          })),
        },
      });

      router.push(`/app/workflows/${workflowId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">
            Chain<span>yard</span>
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {isNew ? 'New workflow' : 'Edit workflow'} · you are{' '}
            <strong>{myRole}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn btn-ghost" href="/app">
            Cancel
          </Link>
          <button
            className="btn"
            type="button"
            disabled={saving || !canEdit}
            onClick={onSave}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {error ? <p style={{ color: 'var(--coral)' }}>{error}</p> : null}

      <section className="grid-2">
        <div className="panel" style={{ padding: 22 }}>
          <h2 className="h2">Details</h2>
          {isNew ? (
            <div className="field">
              <label>Organization</label>
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {(orgsQuery.data?.organizations || []).map(
                  (o: { id: string; name: string }) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  )
                )}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <h2 className="h2" style={{ marginTop: 24 }}>
            Steps
          </h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {steps.map((s, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  padding: 14,
                  background: 'rgba(255,255,255,0.7)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    marginBottom: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <input
                    value={s.name}
                    onChange={(e) => {
                      const copy = [...steps];
                      copy[i] = { ...copy[i], name: e.target.value };
                      setSteps(copy);
                    }}
                    style={{ flex: 1, minWidth: 140 }}
                  />
                  <select
                    value={s.step_type}
                    onChange={(e) => {
                      const type = e.target.value;
                      const copy = [...steps];
                      copy[i] = {
                        ...copy[i],
                        step_type: type,
                        config: DEFAULT_CONFIG[type] || '{}',
                      };
                      setSteps(copy);
                    }}
                  >
                    {STEP_TYPES.filter((t) => {
                      if ((t === 'db_write' || t === 'notify') && !isOwner) {
                        return s.step_type === t;
                      }
                      return true;
                    }).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => moveStep(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => moveStep(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  value={s.config}
                  onChange={(e) => {
                    const copy = [...steps];
                    copy[i] = { ...copy[i], config: e.target.value };
                    setSteps(copy);
                  }}
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 12 }}
            onClick={() =>
              setSteps([
                ...steps,
                {
                  name: `Step ${steps.length + 1}`,
                  step_type: 'llm_call',
                  config: DEFAULT_CONFIG.llm_call,
                },
              ])
            }
          >
            Add step
          </button>
        </div>

        <aside className="panel" style={{ padding: 22, height: 'fit-content' }}>
          <h2 className="h2">Triggers</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {triggers.map((t, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div className="field">
                  <label>Type</label>
                  <select
                    value={t.trigger_type}
                    onChange={(e) => {
                      const copy = [...triggers];
                      copy[i] = { ...copy[i], trigger_type: e.target.value };
                      setTriggers(copy);
                    }}
                  >
                    <option value="manual">manual</option>
                    <option value="webhook" disabled={!isOwner && t.trigger_type !== 'webhook'}>
                      webhook (owner)
                    </option>
                    <option value="scheduled">scheduled</option>
                    <option value="database_event">database_event</option>
                  </select>
                </div>
                {t.trigger_type === 'webhook' ? (
                  <div className="field">
                    <label>Webhook secret</label>
                    <input
                      value={t.webhook_secret}
                      onChange={(e) => {
                        const copy = [...triggers];
                        copy[i] = {
                          ...copy[i],
                          webhook_secret: e.target.value,
                        };
                        setTriggers(copy);
                      }}
                    />
                  </div>
                ) : null}
                <div className="field">
                  <label>Config (JSON)</label>
                  <textarea
                    value={t.config}
                    onChange={(e) => {
                      const copy = [...triggers];
                      copy[i] = { ...copy[i], config: e.target.value };
                      setTriggers(copy);
                    }}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setTriggers(triggers.filter((_, j) => j !== i))
                  }
                >
                  Remove trigger
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 12 }}
            onClick={() =>
              setTriggers([
                ...triggers,
                { trigger_type: 'manual', config: '{}', webhook_secret: '' },
              ])
            }
          >
            Add trigger
          </button>

          <p className="muted" style={{ marginTop: 18, lineHeight: 1.5, fontSize: '0.9rem' }}>
            Layer 2: <code>db_write</code>, <code>notify</code>, and{' '}
            <code>webhook</code> require owner. Approval resume is checked again
            inside the Action handler.
          </p>
        </aside>
      </section>
    </main>
  );
}
