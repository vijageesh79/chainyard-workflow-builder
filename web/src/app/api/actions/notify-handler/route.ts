import { NextRequest, NextResponse } from 'next/server';
import { ActionError, adminGraphql } from '@/lib/workflow/types';

/**
 * Hasura Event Trigger on notification_outbox INSERT.
 * Delivers Slack/email (logged + optional webhook).
 */
export async function POST(req: NextRequest) {
  try {
    const secret =
      req.headers.get('x-nhost-webhook-secret') ||
      req.headers.get('x-hasura-webhook-secret');
    const expected =
      process.env.NHOST_WEBHOOK_SECRET || 'workflow-builder-webhook-secret';
    if (secret !== expected) throw new ActionError('Unauthorized', 401);

    const body = await req.json();
    const row = body?.event?.data?.new as {
      id: string;
      channel: string;
      payload: {
        message?: string;
        to?: string;
        webhook_url?: string;
      };
    };

    if (!row?.id) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const payload = row.payload || {};
    let delivery = 'logged';

    if (row.channel === 'slack' && payload.webhook_url) {
      const res = await fetch(payload.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: payload.message || 'Workflow notify' }),
      });
      delivery = res.ok ? 'slack_ok' : `slack_fail_${res.status}`;
    } else {
      // Email: log for demo; wire SMTP/provider in production
      console.log('[notify]', {
        channel: row.channel,
        to: payload.to,
        message: payload.message,
      });
      delivery = 'email_logged';
    }

    await adminGraphql(
      `mutation Mark($id: uuid!, $status: String!) {
        update_notification_outbox_by_pk(
          pk_columns: { id: $id }
          _set: { status: $status }
        ) { id }
      }`,
      { id: row.id, status: delivery }
    );

    return NextResponse.json({ ok: true, delivery });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const status = err instanceof ActionError ? err.status : 500;
    return NextResponse.json({ message }, { status });
  }
}
