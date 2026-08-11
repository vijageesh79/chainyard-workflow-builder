'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  GET_MY_ORGS,
  GET_ORG_WORKFLOWS,
  TRIGGER_RUN,
} from '@/graphql/operations';
import { useAuth } from '@/lib/providers';

export default function AppHome() {
  const { user, logout, ready, accessToken } = useAuth();
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [runError, setRunError] = useState('');

  useEffect(() => {
    if (ready && !user) router.replace('/');
  }, [ready, user, router]);

  const orgsQuery = useQuery(GET_MY_ORGS, { skip: !accessToken });
  const orgs = orgsQuery.data?.organizations || [];
  const usage = orgsQuery.data?.org_usage_stats || [];

  useEffect(() => {
    if (!orgId && orgs[0]?.id) setOrgId(orgs[0].id);
  }, [orgs, orgId]);

  const workflowsQuery = useQuery(GET_ORG_WORKFLOWS, {
    variables: { orgId },
    skip: !orgId,
  });

  const [triggerRun, triggerState] = useMutation(TRIGGER_RUN);
  const myRole = useMemo(() => {
    const org = orgs.find((o: { id: string }) => o.id === orgId);
    const member = org?.members?.find(
      (m: { user_id: string }) => m.user_id === user?.id
    );
    return member?.role || user?.role || 'viewer';
  }, [orgs, orgId, user]);

  const canRun = myRole === 'owner' || myRole === 'editor';
  const orgUsage = usage.find((u: { org_id: string }) => u.org_id === orgId);
  const selectedOrg = orgs.find((o: { id: string }) => o.id === orgId);

  async function onRun(workflowId: string) {
    setRunError('');
    try {
      const res = await triggerRun({
        variables: {
          workflowId,
          input: { text: 'This product launch looks excellent and ready.' },
        },
      });
      const runId = res.data?.triggerWorkflowRun?.workflow_run_id;
      if (runId) router.push(`/app/runs/${runId}?workflow=${workflowId}`);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Failed to start run');
    }
  }

  if (!ready || !user) {
    return <main className="app-shell">Loading…</main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">
            Chain<span>yard</span>
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {user.displayName} · role <strong>{myRole}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link className="btn btn-ghost" href="/app/workflows/new">
            New workflow
          </Link>
          <button className="btn btn-ghost" type="button" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="grid-2">
        <div className="panel" style={{ padding: 22 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            <h2 className="h2" style={{ margin: 0 }}>
              Workflows
            </h2>
            <select
              value={orgId || ''}
              onChange={(e) => setOrgId(e.target.value)}
              style={{
                borderRadius: 10,
                border: '1px solid var(--line)',
                padding: '0.45rem 0.7rem',
                background: 'white',
              }}
            >
              {orgs.map((o: { id: string; name: string }) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          {orgsQuery.error ? (
            <p style={{ color: 'var(--coral)' }}>
              GraphQL error: {orgsQuery.error.message}. Is Hasura running on
              :8080?
            </p>
          ) : null}

          {runError ? (
            <p style={{ color: 'var(--coral)' }}>{runError}</p>
          ) : null}

          <div style={{ display: 'grid', gap: 12 }}>
            {(workflowsQuery.data?.workflows || []).map(
              (wf: {
                id: string;
                name: string;
                description?: string;
                steps: Array<{ step_type: string }>;
                triggers: Array<{ trigger_type: string }>;
                runs: Array<{ id: string; status: string; created_at: string }>;
              }) => (
                <article
                  key={wf.id}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    padding: 16,
                    background: 'rgba(255,255,255,0.7)',
                    animation: 'rise 0.5s ease both',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'start',
                    }}
                  >
                    <div>
                      <Link href={`/app/workflows/${wf.id}`}>
                        <strong style={{ fontSize: '1.05rem' }}>{wf.name}</strong>
                      </Link>
                      <p className="muted" style={{ margin: '6px 0 10px' }}>
                        {wf.description || 'No description'}
                      </p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {wf.steps.map((s, i) => (
                          <span key={i} className="chip">
                            {s.step_type}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
                      {wf.runs[0] ? (
                        <span className={`chip ${wf.runs[0].status}`}>
                          {wf.runs[0].status}
                        </span>
                      ) : (
                        <span className="chip">no runs</span>
                      )}
                      {canRun ? (
                        <button
                          className="btn"
                          type="button"
                          disabled={triggerState.loading}
                          onClick={() => onRun(wf.id)}
                        >
                          Run
                        </button>
                      ) : null}
                      {wf.runs[0] ? (
                        <Link
                          className="btn btn-ghost"
                          href={`/app/runs/${wf.runs[0].id}?workflow=${wf.id}`}
                          style={{ fontSize: '0.85rem', padding: '0.45rem 0.8rem' }}
                        >
                          Latest run
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <p className="muted" style={{ margin: '12px 0 0', fontSize: '0.85rem' }}>
                    Triggers:{' '}
                    {wf.triggers.map((t) => t.trigger_type).join(', ') || 'none'}
                  </p>
                </article>
              )
            )}
            {!workflowsQuery.loading &&
            (workflowsQuery.data?.workflows || []).length === 0 ? (
              <p className="muted">
                No workflows visible for this org. Create one, or sign in as Org A
                owner to see the seeded demo.
              </p>
            ) : null}
          </div>
        </div>

        <aside className="panel" style={{ padding: 22, height: 'fit-content' }}>
          <h2 className="h2">Usage</h2>
          <p style={{ margin: 0, fontSize: '2rem', fontFamily: 'var(--font-display)', fontWeight: 800 }}>
            {orgUsage?.quota_used ?? selectedOrg?.quota_used ?? 0}
            <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>
              {' '}
              / {orgUsage?.quota_limit ?? selectedOrg?.quota_limit ?? '—'}
            </span>
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            Calls used this period · {orgUsage?.runs_this_month ?? 0} runs this
            month
          </p>
          {orgUsage?.avg_run_duration_seconds != null ? (
            <p className="muted" style={{ marginTop: 4 }}>
              Avg duration:{' '}
              {Number(orgUsage.avg_run_duration_seconds).toFixed(1)}s
            </p>
          ) : null}

          <hr
            style={{
              border: 0,
              borderTop: '1px solid var(--line)',
              margin: '20px 0',
            }}
          />

          <h2 className="h2">Cross-org check</h2>
          <p className="muted" style={{ lineHeight: 1.5 }}>
            Sign in as <code>owner-b@beta.test</code> — Org B cannot see Org A
            workflows, even if you paste an Org A workflow ID into the URL.
          </p>
        </aside>
      </section>
    </main>
  );
}
