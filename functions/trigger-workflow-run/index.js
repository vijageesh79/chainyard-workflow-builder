module.exports = async (req, res) => {
  const base = process.env.ACTION_FORWARD_URL || process.env.NHOST_FUNCTIONS_FORWARD;
  if (!base) {
    return res.status(500).json({
      message: 'Set ACTION_FORWARD_URL to your Next.js /api/actions base URL',
    });
  }
  const target = `${base.replace(/\/$/, '')}/trigger-workflow-run`;
  const r = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...pickHeaders(req.headers) },
    body: JSON.stringify(req.body),
  });
  const text = await r.text();
  res.status(r.status).send(text);
};

function pickHeaders(h) {
  const out = {};
  for (const k of ['authorization', 'x-hasura-user-id', 'x-hasura-role']) {
    if (h[k]) out[k] = h[k];
  }
  return out;
}
