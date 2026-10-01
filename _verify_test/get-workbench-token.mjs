const API = process.env.API || "http://127.0.0.1:3000";
async function j(path, opts = {}) {
  const r = await fetch(API + path, opts);
  const b = await r.json().catch(() => ({}));
  return { status: r.status, body: b };
}
const login = await j("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "teacher", password: "teacher123456" })
});
if (!login.body?.success) { console.log("LOGIN_FAIL", JSON.stringify(login.body)); process.exit(1); }
const userToken = login.body.data.token || login.body.data.accessToken;

const ticket = await j("/api/ai/sso/ticket", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
  body: JSON.stringify({})
});
if (!ticket.body?.success) { console.log("TICKET_FAIL", JSON.stringify(ticket.body)); process.exit(1); }
const t = ticket.body.data.ticket;

const verify = await j("/api/ai/sso/verify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket: t })
});
if (!verify.body?.success) { console.log("VERIFY_FAIL", JSON.stringify(verify.body)); process.exit(1); }
console.log(verify.body.data.agentToken);
