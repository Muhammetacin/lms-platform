import assert from "node:assert/strict";
import test from "node:test";
import type { OrganizationRole } from "../src/generated/prisma/enums.ts";
import {
  bootstrapDevelopmentOwner,
  type DevelopmentBootstrapConfig,
  type DevelopmentBootstrapStore,
  type ExistingBootstrapSetup,
} from "../src/lib/dev-bootstrap-core.ts";

function environment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    DEV_BOOTSTRAP_EMAIL: "admin@example.test",
    DEV_BOOTSTRAP_PASSWORD: "local-owner-password-12",
    DEV_BOOTSTRAP_NAME: "Local Admin",
    DEV_BOOTSTRAP_ORG_NAME: "Local Demo",
    DEV_BOOTSTRAP_ORG_SLUG: "local-demo",
    ...overrides,
  };
}

class MemoryBootstrapStore implements DevelopmentBootstrapStore {
  setup: ExistingBootstrapSetup = { user: null, organization: null, membership: null };
  passwordHash: string | null = null;
  readCount = 0;
  createCount = 0;
  membershipCount = 0;

  async findSetup() {
    this.readCount += 1;
    return structuredClone(this.setup);
  }

  async createOwnerSetup(config: DevelopmentBootstrapConfig, passwordHash: string) {
    this.createCount += 1;
    this.membershipCount += 1;
    this.passwordHash = passwordHash;
    this.setup = {
      user: {
        id: "user-1",
        email: config.email,
        name: config.name,
        hasPasswordCredential: true,
      },
      organization: { id: "org-1", name: config.organizationName },
      membership: { role: "OWNER" as OrganizationRole, active: true },
    };
  }
}

test("creates a development OWNER setup and stores only the hash", async () => {
  const store = new MemoryBootstrapStore();
  const password = "local-owner-password-12";
  const hashPassword = async (value: string) => `scrypt-test-hash:${value.length}`;
  const result = await bootstrapDevelopmentOwner(environment(), store, hashPassword);

  assert.deepEqual(result, {
    created: true,
    email: "admin@example.test",
    organizationName: "Local Demo",
  });
  assert.equal(store.setup.user?.email, "admin@example.test");
  assert.equal(store.setup.organization?.name, "Local Demo");
  assert.deepEqual(store.setup.membership, { role: "OWNER", active: true });
  assert.equal(store.passwordHash, `scrypt-test-hash:${password.length}`);
  assert.equal(JSON.stringify(store.setup).includes(password), false);
  assert.equal(store.passwordHash?.includes(password), false);
  assert.equal(store.createCount, 1);
});

test("repeated bootstrap is idempotent and preserves the existing credential", async () => {
  const store = new MemoryBootstrapStore();
  let hashCount = 0;
  const hashPassword = async (value: string) => {
    hashCount += 1;
    return `hash-${hashCount}-${value.length}`;
  };
  await bootstrapDevelopmentOwner(environment(), store, hashPassword);
  const originalHash = store.passwordHash;
  const result = await bootstrapDevelopmentOwner(
    environment({ DEV_BOOTSTRAP_PASSWORD: "a-different-local-password" }),
    store,
    hashPassword,
  );

  assert.equal(result.created, false);
  assert.equal(store.createCount, 1);
  assert.equal(store.membershipCount, 1);
  assert.equal(store.passwordHash, originalHash);
  assert.equal(hashCount, 1);
});

test("duplicate membership is not created and unexpected existing accounts fail safely", async () => {
  const store = new MemoryBootstrapStore();
  await bootstrapDevelopmentOwner(environment(), store, async () => "opaque-hash");
  await bootstrapDevelopmentOwner(environment(), store, async () => "unused-hash");
  assert.equal(store.membershipCount, 1);

  const conflict = new MemoryBootstrapStore();
  conflict.setup = {
    user: {
      id: "existing-user",
      email: "admin@example.test",
      name: "Someone Else",
      hasPasswordCredential: true,
    },
    organization: null,
    membership: null,
  };
  await assert.rejects(
    bootstrapDevelopmentOwner(environment(), conflict, async () => "unused-hash"),
    /belongs to a different setup\. No data was changed\./,
  );
  assert.equal(conflict.createCount, 0);
});

test("production-like environments are rejected before store reads or writes", async () => {
  const store = new MemoryBootstrapStore();
  await assert.rejects(
    bootstrapDevelopmentOwner(environment({ NODE_ENV: "production" }), store, async () => "unused"),
    /disabled in production environments/,
  );
  await assert.rejects(
    bootstrapDevelopmentOwner(environment({ VERCEL_ENV: "production" }), store, async () => "unused"),
    /disabled in production environments/,
  );
  assert.equal(store.createCount, 0);
  assert.equal(store.readCount, 0);
});

test("bootstrap validates required local inputs without returning their secrets", async () => {
  const store = new MemoryBootstrapStore();
  await assert.rejects(
    bootstrapDevelopmentOwner(environment({ DEV_BOOTSTRAP_PASSWORD: "short" }), store, async () => "unused"),
    /at least 12 characters/,
  );
  await assert.rejects(
    bootstrapDevelopmentOwner(environment({ DEV_BOOTSTRAP_ORG_SLUG: "Invalid Slug" }), store, async () => "unused"),
    /lowercase letters, numbers, and single hyphens/,
  );
  assert.equal(store.createCount, 0);
});
