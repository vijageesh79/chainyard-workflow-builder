-- AI Agent Workflow Builder — core schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE public.member_role AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE public.step_type AS ENUM (
  'llm_call',
  'http_request',
  'db_write',
  'notify',
  'conditional_branch',
  'approval_gate'
);
CREATE TYPE public.trigger_type AS ENUM (
  'manual',
  'webhook',
  'scheduled',
  'database_event'
);
CREATE TYPE public.run_status AS ENUM (
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled'
);
CREATE TYPE public.step_run_status AS ENUM (
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'skipped'
);

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  quota_limit INTEGER NOT NULL DEFAULT 100 CHECK (quota_limit >= 0),
  quota_used INTEGER NOT NULL DEFAULT 0 CHECK (quota_used >= 0),
  quota_period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.org_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role public.member_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX org_members_user_id_idx ON public.org_members (user_id);
CREATE INDEX org_members_org_id_idx ON public.org_members (org_id);

CREATE TABLE public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflows_org_id_idx ON public.workflows (org_id);

CREATE TABLE public.workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  step_type public.step_type NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, position)
);

CREATE INDEX workflow_steps_workflow_id_idx ON public.workflow_steps (workflow_id);

CREATE TABLE public.workflow_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows (id) ON DELETE CASCADE,
  trigger_type public.trigger_type NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  webhook_secret TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_triggers_workflow_id_idx ON public.workflow_triggers (workflow_id);
CREATE INDEX workflow_triggers_type_idx ON public.workflow_triggers (trigger_type);

CREATE TABLE public.workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows (id) ON DELETE CASCADE,
  status public.run_status NOT NULL DEFAULT 'pending',
  trigger_type public.trigger_type NOT NULL DEFAULT 'manual',
  triggered_by UUID,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error TEXT,
  current_step_position INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_runs_workflow_id_idx ON public.workflow_runs (workflow_id);
CREATE INDEX workflow_runs_status_idx ON public.workflow_runs (status);

CREATE TABLE public.step_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id UUID NOT NULL REFERENCES public.workflow_runs (id) ON DELETE CASCADE,
  workflow_step_id UUID NOT NULL REFERENCES public.workflow_steps (id) ON DELETE CASCADE,
  status public.step_run_status NOT NULL DEFAULT 'pending',
  input JSONB,
  output JSONB,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX step_runs_workflow_run_id_idx ON public.step_runs (workflow_run_id);
CREATE INDEX step_runs_status_idx ON public.step_runs (status);

-- Results written by db_write steps (and watched by database_event triggers)
CREATE TABLE public.workflow_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  workflow_run_id UUID REFERENCES public.workflow_runs (id) ON DELETE SET NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_data_org_id_idx ON public.workflow_data (org_id);
CREATE INDEX workflow_data_key_idx ON public.workflow_data (key);

-- Outbox for notify steps → Hasura Event Trigger delivers Slack/email
CREATE TABLE public.notification_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  workflow_run_id UUID REFERENCES public.workflow_runs (id) ON DELETE SET NULL,
  step_run_id UUID REFERENCES public.step_runs (id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('slack', 'email')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Aggregation: org usage this month + average completed run duration
CREATE OR REPLACE VIEW public.org_usage_stats AS
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.quota_used,
  o.quota_limit,
  GREATEST(o.quota_limit - o.quota_used, 0) AS quota_remaining,
  o.quota_period_start,
  COALESCE(
    (
      SELECT AVG(EXTRACT(EPOCH FROM (wr.completed_at - wr.started_at)))
      FROM public.workflow_runs wr
      JOIN public.workflows w ON w.id = wr.workflow_id
      WHERE w.org_id = o.id
        AND wr.status = 'completed'
        AND wr.started_at IS NOT NULL
        AND wr.completed_at IS NOT NULL
        AND wr.created_at >= date_trunc('month', now())
    ),
    0
  ) AS avg_run_duration_seconds,
  (
    SELECT COUNT(*)::integer
    FROM public.workflow_runs wr
    JOIN public.workflows w ON w.id = wr.workflow_id
    WHERE w.org_id = o.id
      AND wr.created_at >= date_trunc('month', now())
  ) AS runs_this_month
FROM public.organizations o;

-- Helper: is the current Hasura user a member of the org with one of the given roles?
-- Used from Hasura permission expressions via relationships (not SQL functions).

CREATE OR REPLACE FUNCTION public.reset_quota_if_new_period()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.quota_period_start < date_trunc('month', now()) THEN
    NEW.quota_period_start := date_trunc('month', now());
    NEW.quota_used := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_quota_period_trg
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE PROCEDURE public.reset_quota_if_new_period();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_updated_at_trg
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

CREATE TRIGGER workflows_updated_at_trg
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

COMMENT ON TABLE public.organizations IS 'Tenant root; quota_used incremented when a run completes successfully.';
COMMENT ON TABLE public.org_members IS 'Layer 1 membership + role (owner/editor/viewer).';
COMMENT ON COLUMN public.workflow_steps.step_type IS 'Layer 2: db_write/notify require owner to create; approval_gate resume checked in Action.';
COMMENT ON VIEW public.org_usage_stats IS 'Aggregation: quota remaining + avg run duration this month.';
