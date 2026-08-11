'use client';

import { useMutation, useQuery, useSubscription } from '@apollo/client';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import {
  APPROVE_STEP,
  GET_RUN,
  GET_STEP_RUNS,
  GET_WORKFLOW,
  STEP_RUNS_SUB,
  WORKFLOW_RUN_SUB,
} from '@/graphql/operations';
import { useAuth } from '@/lib/providers';

export default function RunPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const runId = params.id;
  const workflowId = search.get('workflow');
  const { user } = useAuth();

  const wfQuery = useQuery(GET_WORKFLOW, {
    variables: { id: workflowId },
    skip: !workflowId,
  });

  const runQuery = useQuery(GET_RUN, {
    variables: { runId },
    skip: !runId,
    pollInterval: 1500,
  });

  const stepsQuery = useQuery(GET_STEP_RUNS, {
    variables: { runId },
    skip: !runId,
    pollInterval: 1500,
  });

  const stepsSub = useSubscription(STEP_RUNS_SUB, {
    variables: { runId },
    skip: !runId,
  });

  const runSub = useSubscription(WORKFLOW_RUN_SUB, {
    variables: { runId },
    skip: !runId,
  });

  const [approve, approveState] = useMutation(APPROVE_STEP, {
    onCompleted: () => {
      void runQuery.refetch();
      void stepsQuery.refetch();
    },
  });

  const stepRuns = stepsSub.data?.step_runs || stepsQuery.data?.step_runs || [];
  const run = runSub.data?.workflow_runs_by_pk || runQuery.data?.workflow_runs_by_pk;
  const pausedStep = stepRuns.find((s: { status: string }) => s.status === 'paused');
  const subError = stepsSub.error || runSub.error || runQuery.error || stepsQuery.error;
  const waiting =
    !run &&
    stepRuns.length === 0 &&
    (stepsSub.loading || runSub.loading || runQuery.loading || stepsQuery.loading);

  const myRole = useMemo(() => {
    const members = wfQuery.data?.workflows_by_pk?.organization?.members || [];
    const mine = members.find((m: { user_id: string }) => m.user_id === user?.id);
    return mine?.role || user?.role || 'viewer';
  }, [wfQuery.data, user]);

  const canApprove = myRole === 'owner' || myRole === 'editor';
  const isPaused = run?.status === 'paused' || Boolean(pausedStep);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">
            Chain<span>yard</span>
          </div>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Live run · {wfQuery.data?.workflows_by_pk?.name || 'Workflow'}
          </p>
        </div>
        <Link className="btn btn-ghost" href="/app">
          Back
        </Link>
      </header>

      <section className="grid-2">
        <div className="panel" style={{ padding: 22 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 18,
            }}
          >
            <span className="live-dot" />
            <h2 className="h2" style={{ margin: 0 }}>
              Step progress
            </h2>
            {run ? <span className={`chip ${run.status}`}>{run.status}</span> : null}
          </div>

          {subError ? (
            <p style={{ color: 'var(--coral)' }}>{subError.message}</p>
          ) : null}

          <div className="step-rail">
            {stepRuns.map(
              (
                sr: {
                  id: string;
                  status: string;
                  attempt_count: number;
                  error?: string;
                  output?: unknown;
                  workflow_step: {
                    name: string;
                    step_type: string;
                    position: number;
                  };
                },
                idx: number
              ) => (
                <div
                  key={sr.id}
                  className={`step-row ${sr.status === 'running' || sr.status === 'paused' ? 'active' : ''}`}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'rgba(13,115,119,0.12)',
                      display: 'grid',
                      placeItems: 'center',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  >
                    {sr.workflow_step.position}
                  </div>
                  <div>
                    <strong>{sr.workflow_step.name}</strong>
                    <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                      <span className="chip">{sr.workflow_step.step_type}</span>{' '}
                      attempts {sr.attempt_count}
                    </div>
                    {sr.error ? (
                      <pre
                        style={{
                          marginTop: 8,
                          whiteSpace: 'pre-wrap',
                          fontSize: 12,
                          color: '#8b1e1e',
                        }}
                      >
                        {sr.error}
                      </pre>
                    ) : null}
                    {sr.output ? (
                      <pre
                        style={{
                          marginTop: 8,
                          whiteSpace: 'pre-wrap',
                          fontSize: 12,
                          fontFamily: 'var(--font-mono)',
                          background: 'rgba(20,33,43,0.04)',
                          padding: 10,
                          borderRadius: 8,
                          maxHeight: 160,
                          overflow: 'auto',
                        }}
                      >
                        {JSON.stringify(sr.output, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                  <span className={`chip ${sr.status}`}>{sr.status}</span>
                </div>
              )
            )}
            {waiting ? (
              <p className="muted">Waiting for step updates…</p>
            ) : null}
          </div>
        </div>

        <aside className="panel" style={{ padding: 22, height: 'fit-content' }}>
          <h2 className="h2">
            {isPaused ? 'Paused — needs approval' : 'Approval gate'}
          </h2>
          {isPaused && pausedStep ? (
            <>
              <p className="muted" style={{ lineHeight: 1.5 }}>
                The run stopped at <strong>{pausedStep.workflow_step?.name || 'approval'}</strong>.
                Approve it to continue the remaining steps.
              </p>
              {canApprove ? (
                <button
                  className="btn btn-warn"
                  type="button"
                  disabled={approveState.loading}
                  onClick={() =>
                    approve({ variables: { stepRunId: pausedStep.id } })
                  }
                >
                  {approveState.loading ? 'Approving…' : 'Approve & resume'}
                </button>
              ) : (
                <p style={{ color: 'var(--coral)' }}>
                  Your role ({myRole}) cannot approve.
                </p>
              )}
              {approveState.error ? (
                <p style={{ color: 'var(--coral)' }}>
                  {approveState.error.message}
                </p>
              ) : null}
            </>
          ) : (
            <p className="muted">
              {run?.status === 'completed'
                ? 'Run completed. Quota incremented.'
                : run?.status === 'running'
                  ? 'Running. It will pause here if a step needs a person.'
                  : 'No approval pending.'}
            </p>
          )}

          {run?.error ? (
            <p style={{ color: 'var(--coral)', marginTop: 16 }}>{run.error}</p>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
