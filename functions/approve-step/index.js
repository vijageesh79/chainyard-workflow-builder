module.exports = async (req, res) => {
  const base = process.env.ACTION_FORWARD_URL;
  if (!base) return res.status(500).json({ message: 'ACTION_FORWARD_URL not set' });
  const r = await fetch(`${base.replace(/\/$/, '')}/approve-step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authorization: req.headers.authorization || '' },
    body: JSON.stringify(req.body),
  });
  res.status(r.status).send(await r.text());
};
