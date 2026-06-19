/* Consistent JSON envelope helpers. */
export const ok = (res, data = {}, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

export const created = (res, data = {}, message = 'Created') =>
  ok(res, data, message, 201);

export const fail = (res, status = 400, message = 'Error', details) =>
  res.status(status).json({ success: false, message, details });
