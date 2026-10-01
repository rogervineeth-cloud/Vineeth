/**
 * Migration 016 (Razorpay payment orders) against a real PostgreSQL
 * (throwaway local cluster; see helpers/local-postgres.ts), migrations
 * 001-016 in order. Skipped (not failed) without PostgreSQL server binaries.
 *
 * No Razorpay call is made: these are the database guarantees the API relies
 * on — server pricing, one order per attempt, exactly-once fulfilment under
 * concurrency, amount/currency checks, webhook de-duplication, refunds
 * recorded without revocation, browser roles locked out, and credits charged
 * by migration 013 like any plan.
 */
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { LocalPostgres } from "./helpers/local-postgres";

const pg = LocalPostgres.create();
const d = pg ? describe : describe.skip;
jest.setTimeout(120_000);

const MIGRATIONS = path.join(__dirname, "..", "supabase", "migrations");
const ROLLBACK = path.join(__dirname, "..", "supabase", "rollback", "016_payment_orders_down.sql");
const BUYER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const as = (role: string, user: string, sql: string) => `set role ${role}; set request.jwt.claim.sub = '${user}'; ${sql}`;

d("migration 016 (payment orders) on PostgreSQL", () => {
  beforeAll(() => {
    pg!.start();
    for (const f of fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) pg!.psqlFile(path.join(MIGRATIONS, f));
    pg!.psql(`insert into auth.users values ('${BUYER}'), ('${OTHER}')`);
  });
  afterAll(() => pg!.stop());

  const create = (user: string, key: string, sku: string, addon = false, mode = "test") =>
    pg!.psql(`select outcome || '|' || coalesce(payment_order_id::text, '') || '|' || coalesce(amount_paise::text, '') from public.create_payment_order('${user}', '${key}', '${sku}', ${addon}, '${mode}')`).split("|");
  const attach = (orderId: string, rzp: string) => pg!.psql(`select public.attach_razorpay_order('${orderId}', '${rzp}')`);
  const fulfil = (rzp: string, pay: string, amount: number, currency = "INR", source = "verify") =>
    `select outcome from public.fulfil_payment_order('${rzp}', '${pay}', ${amount}, '${currency}', '${source}')`;
  const plans = (u: string) => pg!.psql(`select coalesce(string_agg(plan_type || ':' || resumes_used || '/' || resumes_allotted || ':' || is_test, ',' order by purchased_at), '') from public.user_plans where user_id = '${u}'`);
  const addons = (u: string) => Number(pg!.psql(`select count(*) from public.user_addons where user_id = '${u}'`));

  it("prices are the server's (paise), for every SKU and bundle", () => {
    const price = (sku: string, addon: boolean) => pg!.psql(`select public.payment_sku_price_paise('${sku}', ${addon})`);
    expect(["single", "fresher", "job_hunter", "career", "linkedin_rewrite"].map((s) => price(s, false))).toEqual(["9900", "24900", "59900", "99900", "49900"]);
    expect(["single", "fresher", "job_hunter", "career"].map((s) => price(s, true))).toEqual(["49800", "64800", "99800", "139800"]);
    expect(() => price("linkedin_rewrite", true)).toThrow(/cannot be bundled/);
    expect(() => price("unlimited", false)).toThrow(/unknown sku/);
  });

  it("an order row can never carry a price other than the server's", () => {
    expect(() => pg!.psql(`insert into public.payment_orders (user_id, client_request_key, sku, amount_paise, mode, receipt)
      values ('${BUYER}', '${randomUUID()}', 'career', 100, 'test', 'x1')`)).toThrow(/payment_orders_server_price/);
  });

  it("one order per checkout attempt: same key returns the same order; a different purchase under that key is refused", () => {
    const key = randomUUID();
    const [o1, id1, amt] = create(BUYER, key, "fresher");
    expect([o1, amt]).toEqual(["created", "24900"]);
    expect(create(BUYER, key, "fresher").slice(0, 2)).toEqual(["existing", id1]);
    expect(create(BUYER, key, "career")[0]).toBe("key_reused");
    expect(create(BUYER, key, "fresher", true)[0]).toBe("key_reused");
    // Another user's identical key is a different order.
    expect(create(OTHER, key, "fresher")[0]).toBe("created");
  });

  it("8 concurrent creates for one attempt -> one order", async () => {
    const key = randomUUID();
    const res = await pg!.concurrently(Array.from({ length: 8 }, () =>
      `select payment_order_id from public.create_payment_order('${BUYER}', '${key}', 'single', false, 'test')`));
    expect(new Set(res.map((r) => r.out)).size).toBe(1);
    expect(Number(pg!.psql(`select count(*) from public.payment_orders where client_request_key = '${key}'`))).toBe(1);
  });

  it("the first attached Razorpay order id wins", () => {
    const [, id] = create(BUYER, randomUUID(), "single");
    expect(attach(id, "order_A1")).toBe("order_A1");
    expect(attach(id, "order_A2")).toBe("order_A1");
  });

  it("fulfil grants a pack once: credits, 1-year expiry, test flag, link to the order", () => {
    const [, id] = create(BUYER, randomUUID(), "fresher");
    attach(id, "order_F1");
    expect(pg!.psql(fulfil("order_F1", "pay_F1", 24900))).toBe("fulfilled");
    expect(pg!.psql(fulfil("order_F1", "pay_F1", 24900, "INR", "webhook"))).toBe("already_fulfilled");
    expect(plans(BUYER)).toBe("fresher:0/5:true");
    expect(pg!.psql(`select (expires_at between now() + interval '364 days' and now() + interval '366 days')::text || '|' || razorpay_payment_id || '|' || (payment_order_id = '${id}')::text from public.user_plans where payment_order_id = '${id}'`)).toBe("true|pay_F1|true");
    expect(pg!.psql(`select status || '|' || fulfilled_via || '|' || razorpay_payment_id from public.payment_orders where id = '${id}'`)).toBe("fulfilled|verify|pay_F1");
  });

  it("6 concurrent fulfils (verify + webhooks) -> exactly one grant", async () => {
    const [, id] = create(OTHER, randomUUID(), "career", true);
    attach(id, "order_C1");
    const res = await pg!.concurrently(Array.from({ length: 6 }, (_, i) => fulfil("order_C1", "pay_C1", 139800, "INR", i % 2 ? "webhook" : "verify")));
    expect(res.map((r) => r.out).sort()).toEqual(["already_fulfilled", "already_fulfilled", "already_fulfilled", "already_fulfilled", "already_fulfilled", "fulfilled"]);
    expect(Number(pg!.psql(`select count(*) from public.user_plans where payment_order_id = '${id}'`))).toBe(1);
    expect(Number(pg!.psql(`select count(*) from public.user_addons where payment_order_id = '${id}'`))).toBe(1);
  });

  it("wrong amount, wrong currency, unknown order, second payment: nothing granted", () => {
    const [, id] = create(BUYER, randomUUID(), "single");
    attach(id, "order_M1");
    const before = plans(BUYER);
    expect(pg!.psql(fulfil("order_M1", "pay_M1", 100))).toBe("amount_mismatch");
    expect(pg!.psql(fulfil("order_M1", "pay_M1", 9900, "USD"))).toBe("currency_mismatch");
    expect(pg!.psql(fulfil("order_NOPE", "pay_M1", 9900))).toBe("unknown_order");
    expect(plans(BUYER)).toBe(before);
    expect(pg!.psql(fulfil("order_M1", "pay_M1", 9900))).toBe("fulfilled");
    expect(pg!.psql(fulfil("order_M1", "pay_M2", 9900))).toBe("different_payment");
    expect(Number(pg!.psql(`select count(*) from public.user_plans where payment_order_id = '${id}'`))).toBe(1);
  });

  it("standalone LinkedIn Rewrite grants one add-on and no credits", () => {
    const before = plans(BUYER);
    const addonsBefore = addons(BUYER);
    const [, id] = create(BUYER, randomUUID(), "linkedin_rewrite");
    attach(id, "order_L1");
    expect(pg!.psql(fulfil("order_L1", "pay_L1", 49900))).toBe("fulfilled");
    expect(plans(BUYER)).toBe(before);
    expect(addons(BUYER)).toBe(addonsBefore + 1);
  });

  it("purchased credits are charged by migration 013 like any plan", () => {
    const u = "33333333-3333-4333-8333-333333333333";
    pg!.psql(`insert into auth.users values ('${u}')`);
    const [, id] = create(u, randomUUID(), "single");
    attach(id, "order_G1");
    pg!.psql(fulfil("order_G1", "pay_G1", 9900));
    const key = randomUUID();
    const fp = "b".repeat(64);
    expect(pg!.psql(`select outcome from public.begin_resume_generation('${u}', '${key}', '${fp}', 150)`)).toBe("started");
    const row = JSON.stringify({ jd_text: "jd", resume_json: {}, ats_score: 70, tailored_role: "x", matched_keywords: [], missing_keywords: [], contact_snapshot: {}, template: "classic", regen_of_resume_id: null });
    expect(pg!.psql(`select outcome from public.complete_resume_generation('${u}', '${key}', true, ${q(row)}::jsonb)`)).toBe("completed");
    expect(plans(u)).toBe("single:1/1:true");
  });

  it("webhook events: new, then duplicate once processed; an unprocessed event is retried", () => {
    const ev = (id: string) => pg!.psql(`select public.record_payment_event('${id}', 'payment.captured', 'order_X', '{}'::jsonb)`);
    expect(ev("evt_1")).toBe("new");
    expect(ev("evt_1")).toBe("retry");
    pg!.psql(`select public.mark_payment_event_processed('evt_1')`);
    expect(ev("evt_1")).toBe("duplicate");
  });

  it("refunds are recorded and set the order status, without revoking credits", () => {
    const [, id] = create(OTHER, randomUUID(), "job_hunter");
    attach(id, "order_R1");
    pg!.psql(fulfil("order_R1", "pay_R1", 59900));
    const before = plans(OTHER);
    const refund = (rid: string, amt: number, st: string) => pg!.psql(`select public.record_payment_refund('${rid}', 'pay_R1', ${amt}, '${st}')`);
    expect(refund("rfnd_1", 10000, "processed")).toBe("recorded");
    expect(pg!.psql(`select status from public.payment_orders where id = '${id}'`)).toBe("partially_refunded");
    expect(refund("rfnd_2", 49900, "processed")).toBe("recorded");
    expect(refund("rfnd_2", 49900, "processed")).toBe("recorded"); // replay: no double count
    expect(pg!.psql(`select status from public.payment_orders where id = '${id}'`)).toBe("refunded");
    expect(Number(pg!.psql(`select count(*) from public.payment_refunds where payment_order_id = '${id}'`))).toBe(2);
    expect(plans(OTHER)).toBe(before);
    expect(pg!.psql(`select public.record_payment_refund('rfnd_x', 'pay_unknown', 100, 'processed')`)).toBe("unknown_payment");
  });

  it("browser roles: no function execution, no writes, and only their own orders readable", () => {
    for (const role of ["authenticated", "anon"]) {
      expect(() => pg!.psql(as(role, BUYER, `select * from public.create_payment_order('${BUYER}', '${randomUUID()}', 'single', false, 'test')`))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(role, BUYER, fulfil("order_F1", "pay_x", 24900)))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(role, BUYER, `insert into public.payment_orders (user_id, client_request_key, sku, amount_paise, mode, receipt) values ('${BUYER}', '${randomUUID()}', 'single', 9900, 'test', 'zz')`))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(role, BUYER, `select count(*) from public.payment_events`))).toThrow(/permission denied/);
      expect(() => pg!.psql(as(role, BUYER, `select count(*) from public.payment_refunds`))).toThrow(/permission denied/);
    }
    expect(() => pg!.psql(as("authenticated", BUYER, `update public.payment_orders set status = 'fulfilled'`))).toThrow(/permission denied/);
    const visible = pg!.psql(as("authenticated", BUYER, `select count(distinct user_id) || ':' || bool_and(user_id = '${BUYER}') from public.payment_orders`));
    expect(visible).toBe("1:true");
  });

  it("rollback refuses while orders exist (financial records)", () => {
    expect(() => pg!.psqlFile(ROLLBACK)).toThrow(/rollback refused/);
    expect(Number(pg!.psql(`select count(*) from public.payment_orders`))).toBeGreaterThan(0);
  });
});
