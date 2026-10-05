import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createEmployeeInvitation,
  createEmployeeInvitationHandler,
  createInvitationActivationHandlers,
  createInvitationToken,
  EMPLOYEE_INVITATION_TTL_MS,
  getEmployeeInvitationStatus,
  hashInvitationToken,
  isInvitationToken,
  parseEmployeeInvitationRequest,
  validateEmployeeInvitation,
  type EmployeeInvitationDelivery,
  type EmployeeInvitationStore,
  type InvitationCreation,
  type InvitationStatus,
  type StoredEmployeeInvitation,
} from "../src/lib/employee-invitation-core.ts";
import { verifyPassword } from "../src/lib/auth-core.ts";

const organizationId = "b20e9b55-2a9d-466f-88ec-531a1aef895a";
const otherOrganizationId = "477a64cc-38a7-4b62-9cf5-1089859328f7";
const membershipId = "a55dba72-b9a2-471d-b578-cb0f80230f0f";
const userId = "81ea2463-3946-4855-9416-21aa13b9f4d3";
const password = "correct horse battery staple";

class MemoryInvitationStore implements EmployeeInvitationStore {
  organizationId = "b20e9b55-2a9d-466f-88ec-531a1aef895a";
  membershipId = "a55dba72-b9a2-471d-b578-cb0f80230f0f";
  userId = "81ea2463-3946-4855-9416-21aa13b9f4d3";
  active = true;
  role = "MEMBER";
  hasPasswordCredential = false;
  invitations = new Map<string, StoredEmployeeInvitation>();
  passwordHash: string | null = null;
  createCalls = 0;

  async createInvitation(orgId: string, memberId: string, tokenHash: string, expiresAt: Date, now: Date): Promise<InvitationCreation> {
    this.createCalls += 1;
    if (orgId !== this.organizationId || memberId !== this.membershipId) return { status: "not_found" };
    if (!this.active) return { status: "inactive" };
    if (this.role !== "MEMBER") return { status: "wrong_role" };
    if (this.hasPasswordCredential) return { status: "existing_credential" };
    for (const [hash, prior] of this.invitations) {
      if (prior.organizationId === orgId && prior.membershipId === memberId && prior.consumedAt === null) {
        this.invitations.set(hash, { ...prior, consumedAt: now });
      }
    }
    const id = crypto.randomUUID();
    this.invitations.set(tokenHash, {
      id,
      userId: this.userId,
      organizationId: orgId,
      membershipId: memberId,
      expiresAt,
      consumedAt: null,
      hasPasswordCredential: false,
      membership: {
        id: memberId,
        userId: this.userId,
        organizationId: orgId,
        active: this.active,
        role: this.role,
      },
    });
    return { status: "created", invitationId: id, email: "employee@example.test" };
  }

  async invalidateInvitation(invitationId: string, now: Date) {
    for (const [hash, invitation] of this.invitations) {
      if (invitation.id === invitationId) this.invitations.set(hash, { ...invitation, consumedAt: now });
    }
  }

  async findInvitation(tokenHash: string) {
    return this.invitations.get(tokenHash) ?? null;
  }

  async activate(tokenHash: string, nextPasswordHash: string, now: Date): Promise<InvitationStatus> {
    const invitation = this.invitations.get(tokenHash) ?? null;
    const status = getEmployeeInvitationStatus(invitation, now);
    if (status !== "valid" || !invitation) return status;
    this.invitations.set(tokenHash, { ...invitation, consumedAt: now });
    this.passwordHash = nextPasswordHash;
    this.hasPasswordCredential = true;
    return "valid";
  }
}

test("invitation tokens are random 256-bit base64url values and only their SHA-256 digest is stored", () => {
  const tokens = new Set(Array.from({ length: 100 }, createInvitationToken));
  assert.equal(tokens.size, 100);
  for (const token of tokens) {
    assert.equal(isInvitationToken(token), true);
    assert.equal(token.length, 43);
    assert.equal(hashInvitationToken(token), createHash("sha256").update(token).digest("hex"));
    assert.notEqual(hashInvitationToken(token), token);
  }
  assert.equal(isInvitationToken("not-a-token"), false);
});

test("invitation validation enforces expiration, consumption, active MEMBER status, and exact membership linkage", async () => {
  const store = new MemoryInvitationStore();
  const token = createInvitationToken();
  const now = new Date("2026-10-05T12:00:00.000Z");
  const valid = {
    id: crypto.randomUUID(), userId, organizationId, membershipId,
    expiresAt: new Date(now.getTime() + EMPLOYEE_INVITATION_TTL_MS), consumedAt: null,
    hasPasswordCredential: false,
    membership: { id: membershipId, userId, organizationId, active: true, role: "MEMBER" },
  } satisfies StoredEmployeeInvitation;
  store.invitations.set(hashInvitationToken(token), valid);
  assert.equal(await validateEmployeeInvitation(token, store, now), "valid");
  assert.equal(await validateEmployeeInvitation("malformed", store, now), "invalid");
  assert.equal(getEmployeeInvitationStatus({ ...valid, expiresAt: now }, now), "expired");
  assert.equal(getEmployeeInvitationStatus({ ...valid, consumedAt: now }, now), "consumed");
  assert.equal(getEmployeeInvitationStatus({ ...valid, membership: { ...valid.membership!, active: false } }, now), "inactive");
  assert.equal(getEmployeeInvitationStatus({ ...valid, membership: { ...valid.membership!, role: "ADMIN" } }, now), "invalid");
  assert.equal(getEmployeeInvitationStatus({ ...valid, membership: { ...valid.membership!, organizationId: otherOrganizationId } }, now), "invalid");
  assert.equal(getEmployeeInvitationStatus({ ...valid, hasPasswordCredential: true }, now), "already_activated");
});

test("activation creates the LMS-007 password hash and consumes the invitation once", async () => {
  const sent: string[] = [];
  const freshStore = new MemoryInvitationStore();
  const capturingDelivery: EmployeeInvitationDelivery = {
    available: true,
    async send(_email, url) { sent.push(new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? ""); },
  };
  await createEmployeeInvitation(organizationId, membershipId, freshStore, capturingDelivery, "https://lms.example.test");
  const actualToken = sent[0];
  assert.ok(actualToken);
  assert.equal(freshStore.invitations.has(actualToken), false);
  assert.equal(freshStore.invitations.has(hashInvitationToken(actualToken)), true);
  const handlers = createInvitationActivationHandlers({
    store: freshStore,
    isTrustedRequest: () => true,
    readBody: async (request) => request.json(),
  });

  const activation = await handlers.ACTIVATE(new Request("https://lms.example.test/api/auth/invitations/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: actualToken, password, confirmPassword: password }),
  }));
  assert.equal(activation.status, 200);
  assert.deepEqual(await activation.json(), { success: true });
  assert.ok(freshStore.passwordHash);
  assert.equal(await verifyPassword(password, freshStore.passwordHash), true);
  assert.equal(await validateEmployeeInvitation(actualToken, freshStore), "consumed");

  const replay = await handlers.ACTIVATE(new Request("https://lms.example.test/api/auth/invitations/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: actualToken, password, confirmPassword: password }),
  }));
  assert.equal(replay.status, 410);
  assert.deepEqual(await replay.json(), { error: "invitation_already_used" });
  assert.equal(freshStore.invitations.size, 1);
});

test("malformed activation input, mismatched confirmation, and invalid passwords do not write credentials", async () => {
  const store = new MemoryInvitationStore();
  const handlers = createInvitationActivationHandlers({
    store,
    isTrustedRequest: () => true,
    readBody: async (request) => request.json(),
  });
  const send = (body: unknown) => handlers.ACTIVATE(new Request("https://lms.example.test/api/auth/invitations/activate", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  assert.equal((await send({ token: "bad", password, confirmPassword: password })).status, 400);
  assert.equal((await send({ token: createInvitationToken(), password, confirmPassword: "different password" })).status, 400);
  assert.equal((await send({ token: createInvitationToken(), password: "short", confirmPassword: "short" })).status, 400);
  assert.equal(store.passwordHash, null);
});

test("re-invitation invalidates the prior token, while disabled delivery creates no invitation", async () => {
  const store = new MemoryInvitationStore();
  const now = new Date("2026-10-05T12:00:00.000Z");
  const delivered: string[] = [];
  const delivery: EmployeeInvitationDelivery = {
    available: true,
    async send(_email, url) { delivered.push(new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? ""); },
  };
  const first = await createEmployeeInvitation(organizationId, membershipId, store, delivery, "https://lms.example.test", now);
  const firstToken = delivered[0];
  const firstRecord = store.invitations.get(hashInvitationToken(firstToken));
  assert.equal(firstRecord?.expiresAt.getTime(), now.getTime() + EMPLOYEE_INVITATION_TTL_MS);
  const second = await createEmployeeInvitation(organizationId, membershipId, store, delivery, "https://lms.example.test", now);
  assert.deepEqual(first, { status: "created" });
  assert.deepEqual(second, { status: "created" });
  assert.equal(await validateEmployeeInvitation(firstToken, store), "consumed");
  assert.equal(await validateEmployeeInvitation(delivered[1], store), "valid");
  assert.equal(delivered[0] === delivered[1], false);
  assert.equal(JSON.stringify(second).includes(delivered[1]), false);

  const unavailable = await createEmployeeInvitation(organizationId, membershipId, store, {
    available: false,
    async send() { throw new Error("must not send"); },
  }, "https://lms.example.test");
  assert.deepEqual(unavailable, { status: "delivery_unavailable" });
  assert.equal(store.createCalls, 2);
});

test("existing credentials, inactive memberships, wrong roles, bad URLs, and delivery failures are safe", async () => {
  const store = new MemoryInvitationStore();
  store.hasPasswordCredential = true;
  const delivery: EmployeeInvitationDelivery = { available: true, async send() {} };
  assert.deepEqual(
    await createEmployeeInvitation(organizationId, membershipId, store, delivery, "https://lms.example.test"),
    { status: "existing_credential" },
  );
  store.hasPasswordCredential = false;
  store.active = false;
  assert.deepEqual(
    await createEmployeeInvitation(organizationId, membershipId, store, delivery, "https://lms.example.test"),
    { status: "inactive" },
  );
  store.active = true;
  store.role = "ADMIN";
  assert.deepEqual(
    await createEmployeeInvitation(organizationId, membershipId, store, delivery, "https://lms.example.test"),
    { status: "wrong_role" },
  );
  store.role = "MEMBER";
  assert.deepEqual(
    await createEmployeeInvitation(organizationId, membershipId, store, delivery, "file:///tmp"),
    { status: "delivery_unavailable" },
  );
  assert.equal(parseEmployeeInvitationRequest({ organizationId }), false);
  assert.equal(parseEmployeeInvitationRequest({}), true);

  const failingStore = new MemoryInvitationStore();
  const failingDelivery: EmployeeInvitationDelivery = {
    available: true,
    async send() { throw new Error("provider error containing sensitive data"); },
  };
  const failed = await createEmployeeInvitation(
    organizationId,
    membershipId,
    failingStore,
    failingDelivery,
    "https://lms.example.test",
  );
  assert.deepEqual(failed, { status: "delivery_failed" });
  assert.equal(failingStore.invitations.size, 1);
  assert.equal([...failingStore.invitations.values()][0].consumedAt !== null, true);
});

test("admin invitation endpoint returns a generic success without token or tenant data", async () => {
  const store = new MemoryInvitationStore();
  const delivered: string[] = [];
  const handler = createEmployeeInvitationHandler({
    requireTenantContext: async () => ({ userId, organizationId, role: "OWNER" }),
    requirePermission: async () => undefined,
    store,
    delivery: {
      available: true,
      async send(_email, url) { delivered.push(new URLSearchParams(new URL(url).hash.slice(1)).get("token") ?? ""); },
    },
    appUrl: "https://lms.example.test",
    isTrustedRequest: () => true,
    readBody: async (request) => request.json(),
  });
  const response = await handler(new Request("https://lms.example.test/api/organizations/employees", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }), membershipId);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body, { success: true });
  assert.equal(JSON.stringify(body).includes(delivered[0]), false);
  assert.equal(JSON.stringify(body).includes(organizationId), false);
  assert.equal(store.invitations.has(delivered[0]), false);
  assert.equal(store.invitations.has(hashInvitationToken(delivered[0])), true);
});
