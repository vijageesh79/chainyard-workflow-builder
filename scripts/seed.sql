INSERT INTO public.organizations (id, name, quota_limit, quota_used)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Org A — Acme Agents', 50, 0),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Org B — Beta Bots', 50, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.org_members (org_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'editor'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'viewer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '44444444-4444-4444-4444-444444444444', 'owner')
ON CONFLICT (org_id, user_id) DO NOTHING;

INSERT INTO public.workflows (id, org_id, name, description, created_by)
VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Sentiment Gate Pipeline',
  'LLM → HTTP → conditional branch → approval → db_write',
  '11111111-1111-1111-1111-111111111111'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workflow_steps (id, workflow_id, name, step_type, config, position) VALUES
  (
    'd1111111-1111-1111-1111-111111111111',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Analyze sentiment',
    'llm_call',
    '{"prompt":"Classify the sentiment of this text. Reply with exactly SENTIMENT: positive or SENTIMENT: negative, then a one-sentence reason.\\n\\nText: {{input.text}}"}'::jsonb,
    0
  ),
  (
    'd2222222-2222-2222-2222-222222222222',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Echo to httpbin',
    'http_request',
    '{"url":"https://postman-echo.com/post","method":"POST"}'::jsonb,
    1
  ),
  (
    'd3333333-3333-3333-3333-333333333333',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Branch on sentiment',
    'conditional_branch',
    '{"field":"text","contains":"positive"}'::jsonb,
    2
  ),
  (
    'd4444444-4444-4444-4444-444444444444',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Human approval',
    'approval_gate',
    '{"message":"Owner/editor must approve before persisting result"}'::jsonb,
    3
  ),
  (
    'd5555555-5555-5555-5555-555555555555',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Persist result',
    'db_write',
    '{"key":"sentiment_result","value_from_previous":true}'::jsonb,
    4
  ),
  (
    'd6666666-6666-6666-6666-666666666666',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'Notify ops',
    'notify',
    '{"channel":"email","message":"Sentiment pipeline finished: {{previous}}","to":"ops@acme.test"}'::jsonb,
    5
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.workflow_triggers (id, workflow_id, trigger_type, config, webhook_secret, is_active) VALUES
  (
    'e1111111-1111-1111-1111-111111111111',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'manual',
    '{}'::jsonb,
    NULL,
    true
  ),
  (
    'e2222222-2222-2222-2222-222222222222',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'webhook',
    '{}'::jsonb,
    'org-a-webhook-secret',
    true
  ),
  (
    'e3333333-3333-3333-3333-333333333333',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'database_event',
    '{"watch_key":"demo_event"}'::jsonb,
    NULL,
    true
  ),
  (
    'e4444444-4444-4444-4444-444444444444',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'scheduled',
    '{"cron":"*/5 * * * *"}'::jsonb,
    NULL,
    false
  )
ON CONFLICT (id) DO NOTHING;
