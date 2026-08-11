module.exports = async (req, res) => {
  const base = process.env.ACTION_FORWARD_URL;
  if (!base) return res.status(500).json({ message: 'ACTION_FORWARD_URL not set' });
  const r = await fetch(`${base.replace(/\/$/, '')}/scheduled-runner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-nhost-webhook-secret': req.headers['x-nhost-webhook-secret'] || '',
    },
    body: JSON.stringify(req.body || {}),
  });
  res.status(r.status).send(await r.text());
};
