// In-memory stand-ins for the Meteor APIs meteor-rpc touches, for fast unit tests.
// They mimic the behavior that matters to the library (DDP wire cloning, error sanitizing,
// merge-box ref counting, reactive cursors), not all of Meteor. Real-Meteor coverage lives
// in examples/basic (npm run test:meteor).

type Doc = { _id: string } & Record<string, unknown>;
type Fields = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tracker (synchronous invalidation, which is enough for tests)
// ---------------------------------------------------------------------------

let current: Computation | null = null;

class Dependency {
  private readonly dependents = new Set<Computation>();
  depend(): void {
    if (!current) return;
    this.dependents.add(current);
    current.deps.add(this);
  }
  changed(): void {
    for (const computation of [...this.dependents]) computation.invalidate();
  }
  remove(computation: Computation): void {
    this.dependents.delete(computation);
  }
}

class Computation {
  firstRun = true;
  stopped = false;
  readonly deps = new Set<Dependency>();
  constructor(private readonly fn: (computation: Computation) => void) {
    this.run();
    this.firstRun = false;
  }
  private run(): void {
    for (const dep of this.deps) dep.remove(this);
    this.deps.clear();
    const previous = current;
    current = this;
    try {
      this.fn(this);
    } finally {
      current = previous;
    }
  }
  invalidate(): void {
    if (!this.stopped) this.run();
  }
  stop(): void {
    this.stopped = true;
    for (const dep of this.deps) dep.remove(this);
    this.deps.clear();
  }
}

export const Tracker = {
  autorun: (fn: (computation: Computation) => void): Computation => new Computation(fn),
  nonreactive<T>(fn: () => T): T {
    const previous = current;
    current = null;
    try {
      return fn();
    } finally {
      current = previous;
    }
  },
};

// ---------------------------------------------------------------------------
// Stores and Mongo
// ---------------------------------------------------------------------------

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

class Store {
  readonly docs = new Map<string, Doc>();
  readonly dep = new Dependency();
  readonly listeners = new Set<() => void>();
  merge(id: string, fields: Fields): void {
    const next: Record<string, unknown> = { ...(this.docs.get(id) ?? {}), _id: id };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) delete next[key];
      else next[key] = clone(value);
    }
    this.docs.set(id, next as Doc);
    this.notify();
  }
  remove(id: string): void {
    if (this.docs.delete(id)) this.notify();
  }
  clear(): void {
    if (this.docs.size === 0) return;
    this.docs.clear();
    this.notify();
  }
  notify(): void {
    this.dep.changed();
    for (const listener of [...this.listeners]) listener();
  }
}

const stores = new Map<string, Store>();
const collectionNames = new Set<string>();

function storeFor(namespace: string, name: string): Store {
  const key = `${namespace}\u0000${name}`;
  let store = stores.get(key);
  if (!store) {
    store = new Store();
    stores.set(key, store);
  }
  return store;
}

type Selector = string | Record<string, unknown> | undefined;

function matches(doc: Doc, selector: Selector): boolean {
  if (selector === undefined) return true;
  if (typeof selector === "string") return doc._id === selector;
  return Object.entries(selector).every(([key, value]) => doc[key] === value);
}

let idCounter = 0;

export class Cursor<T extends Doc = Doc> {
  constructor(
    private readonly store: Store,
    private readonly selector: Selector,
  ) {}

  private matching(): T[] {
    return [...this.store.docs.values()]
      .filter((doc) => matches(doc, this.selector))
      .map(clone) as T[];
  }

  fetch(): T[] {
    this.store.dep.depend();
    return this.matching();
  }

  async fetchAsync(): Promise<T[]> {
    return this.fetch();
  }

  count(): number {
    return this.fetch().length;
  }

  forEach(callback: (doc: T, index: number) => void): void {
    this.fetch().forEach(callback);
  }

  map<R>(callback: (doc: T, index: number) => R): R[] {
    return this.fetch().map(callback);
  }

  observe(callbacks: {
    addedAt?: (doc: T, index: number, before: null) => void;
    removedAt?: (doc: T, index: number) => void;
    _suppress_initial?: boolean;
  }): { stop(): void } {
    let docs = this.matching();
    if (!callbacks._suppress_initial) {
      for (const [index, doc] of docs.entries()) callbacks.addedAt?.(doc, index, null);
    }
    const listener = () => {
      const next = this.matching();
      for (let index = docs.length - 1; index >= 0; index--)
        callbacks.removedAt?.(docs[index]!, index);
      for (const [index, doc] of next.entries()) callbacks.addedAt?.(doc, index, null);
      docs = next;
    };
    this.store.listeners.add(listener);
    return { stop: () => this.store.listeners.delete(listener) };
  }

  observeChanges(callbacks: {
    added?: (id: string, fields: Fields) => void;
    changed?: (id: string, fields: Fields) => void;
    removed?: (id: string) => void;
  }): { stop(): void } {
    const split = (doc: T): Fields => {
      const { _id, ...fields } = doc;
      return fields;
    };
    let known = new Map(this.matching().map((doc) => [doc._id, doc]));
    for (const [id, doc] of known) callbacks.added?.(id, split(doc));
    const listener = () => {
      const next = new Map(this.matching().map((doc) => [doc._id, doc]));
      for (const id of known.keys()) if (!next.has(id)) callbacks.removed?.(id);
      for (const [id, doc] of next) {
        const before = known.get(id);
        if (!before) {
          callbacks.added?.(id, split(doc));
          continue;
        }
        const changed: Fields = {};
        for (const key of new Set([...Object.keys(before), ...Object.keys(doc)])) {
          if (JSON.stringify(before[key]) !== JSON.stringify(doc[key])) changed[key] = doc[key];
        }
        if (Object.keys(changed).length > 0) callbacks.changed?.(id, changed);
      }
      known = next;
    };
    this.store.listeners.add(listener);
    return { stop: () => this.store.listeners.delete(listener) };
  }

  async observeChangesAsync(
    callbacks: Parameters<Cursor<T>["observeChanges"]>[0],
  ): Promise<{ stop(): void }> {
    return this.observeChanges(callbacks);
  }
}

interface FakeConnectionTag {
  readonly __namespace?: string;
}

export class Collection<T extends Doc = Doc> {
  private readonly store: Store;
  constructor(
    readonly name: string,
    options?: { connection?: FakeConnectionTag | null },
  ) {
    const namespace = options?.connection?.__namespace ?? "default";
    const key = `${namespace}\u0000${name}`;
    if (collectionNames.has(key)) throw new Error(`There is already a collection named "${name}"`);
    collectionNames.add(key);
    this.store = storeFor(namespace, name);
  }
  find(selector?: Selector): Cursor<T> {
    return new Cursor<T>(this.store, selector);
  }
  findOne(selector?: Selector): T | undefined {
    return this.find(selector).fetch()[0];
  }
  async findOneAsync(selector?: Selector): Promise<T | undefined> {
    return this.findOne(selector);
  }
  async insertAsync(doc: Omit<T, "_id"> & { _id?: string }): Promise<string> {
    const { _id = `id${++idCounter}`, ...fields } = doc;
    this.store.merge(_id, fields);
    return _id;
  }
  async updateAsync(id: string, fields: Fields): Promise<void> {
    this.store.merge(id, fields);
  }
  async removeAsync(id: string): Promise<void> {
    this.store.remove(id);
  }
  /** Test helper: documents currently in this collection. */
  all(): T[] {
    return Tracker.nonreactive(() => this.find().fetch());
  }
}

export const Mongo = { Collection, Cursor };

// ---------------------------------------------------------------------------
// Meteor: methods, publications, DDP-like wire
// ---------------------------------------------------------------------------

export class MeteorError extends Error {
  readonly errorType = "Meteor.Error";
  constructor(
    readonly error: string | number,
    readonly reason?: string,
    readonly details?: unknown,
  ) {
    super(`${reason ?? ""} [${error}]`);
  }
}

/** What crosses the fake wire: Meteor.Errors keep error/reason/details, anything else becomes a 500. */
function sanitize(error: unknown): MeteorError {
  if (error instanceof MeteorError)
    return new MeteorError(error.error, error.reason, clone(error.details));
  return new MeteorError(500, "Internal server error");
}

export const fakeState = {
  isServer: true,
  isClient: true,
  userId: null as string | null,
};

const connectionInfo = {
  id: "fake-connection",
  clientAddress: "127.0.0.1",
  httpHeaders: {},
  close() {},
  onClose() {},
};

type Handler = (this: unknown, ...args: unknown[]) => unknown;
const methods = new Map<string, Handler>();
const publications = new Map<string, Handler>();
const refCounts = new Map<string, number>();

async function callVia(name: string, args: unknown[]): Promise<unknown> {
  const handler = methods.get(name);
  if (!handler) throw new MeteorError(404, `Method '${name}' not found`);
  const invocation = {
    userId: fakeState.userId,
    isSimulation: false,
    connection: connectionInfo,
    setUserId() {},
    unblock() {},
  };
  try {
    return clone(await handler.apply(invocation, clone(args)));
  } catch (error) {
    throw sanitize(error);
  }
}

function subscribeVia(namespace: string, name: string, rawArgs: unknown[]) {
  const args = [...rawArgs];
  const last = args[args.length - 1] as { onReady?: unknown; onStop?: unknown } | undefined;
  const callbacks =
    last &&
    typeof last === "object" &&
    (typeof last.onReady === "function" || typeof last.onStop === "function")
      ? (args.pop() as { onReady?: () => void; onStop?: (error?: unknown) => void })
      : {};
  const owned = new Set<string>();
  const stopCallbacks: Array<() => void> = [];
  let ready = false;
  let stopped = false;

  const finish = (error?: unknown) => {
    if (stopped) return;
    stopped = true;
    for (const fn of stopCallbacks) fn();
    for (const key of owned) {
      const [collection, id] = key.split("\u0001") as [string, string];
      const count = (refCounts.get(`${namespace}\u0002${key}`) ?? 1) - 1;
      refCounts.set(`${namespace}\u0002${key}`, count);
      if (count <= 0) storeFor(namespace, collection).remove(id);
    }
    callbacks.onStop?.(error);
  };

  const subscription = {
    userId: fakeState.userId,
    connection: connectionInfo,
    added(collection: string, id: string, fields: Fields) {
      const key = `${collection}\u0001${id}`;
      if (!owned.has(key)) {
        owned.add(key);
        refCounts.set(
          `${namespace}\u0002${key}`,
          (refCounts.get(`${namespace}\u0002${key}`) ?? 0) + 1,
        );
      }
      storeFor(namespace, collection).merge(id, fields);
    },
    changed(collection: string, id: string, fields: Fields) {
      storeFor(namespace, collection).merge(id, fields);
    },
    removed(collection: string, id: string) {
      owned.delete(`${collection}\u0001${id}`);
      storeFor(namespace, collection).remove(id);
    },
    ready() {
      if (ready || stopped) return;
      ready = true;
      callbacks.onReady?.();
    },
    stop: () => finish(),
    error: (error: unknown) => finish(sanitize(error)),
    onStop(fn: () => void) {
      stopCallbacks.push(fn);
    },
    unblock() {},
  };

  subscriptionLog.push({ name, args: clone(args) });
  queueMicrotask(async () => {
    const handler = publications.get(name);
    if (!handler) return finish(new MeteorError(404, `Subscription '${name}' not found`));
    try {
      await handler.apply(subscription, clone(args));
    } catch (error) {
      subscription.error(error);
    }
  });

  return { stop: () => finish(), ready: () => ready };
}

/** Every subscription started, for assertions such as "subscribed exactly once". */
export const subscriptionLog: Array<{ name: string; args: unknown[] }> = [];

export const Meteor = {
  get isServer() {
    return fakeState.isServer;
  },
  get isClient() {
    return fakeState.isClient;
  },
  isDevelopment: true,
  Error: MeteorError,
  methods(defs: Record<string, Handler>) {
    for (const [name, handler] of Object.entries(defs)) {
      if (methods.has(name)) throw new Error(`A method named '${name}' is already defined`);
      methods.set(name, handler);
    }
  },
  publish(name: string, handler: Handler) {
    if (publications.has(name)) throw new Error(`A publication named '${name}' is already defined`);
    publications.set(name, handler);
  },
  callAsync: (name: string, ...args: unknown[]) => callVia(name, args),
  subscribe: (name: string, ...args: unknown[]) => subscribeVia("default", name, args),
};

/** A separate DDP connection, like `DDP.connect(url)`: its own client collections. */
export function createFakeConnection(namespace: string) {
  return {
    __namespace: namespace,
    callAsync: (name: string, ...args: unknown[]) => callVia(name, args),
    subscribe: (name: string, ...args: unknown[]) => subscribeVia(namespace, name, args),
  };
}

export const EJSON = {
  stringify: (value: unknown) => JSON.stringify(value),
};

/** Fake `ddp-rate-limiter` rules, recorded for assertions. */
export const rateLimiterRules: Array<{
  rule: Record<string, unknown>;
  limit: number;
  interval: number;
}> = [];

const DDPRateLimiter = {
  addRule(rule: Record<string, unknown>, limit: number, interval: number) {
    rateLimiterRules.push({ rule, limit, interval });
    return `rule${rateLimiterRules.length}`;
  },
};

/** Exposes the fakes through the `Package` global, exactly where meteor-rpc looks for them. */
export function installPackages({ rateLimiter = true } = {}): void {
  (globalThis as { Package?: unknown }).Package = {
    meteor: { Meteor },
    mongo: { Mongo },
    tracker: { Tracker },
    ejson: { EJSON },
    ...(rateLimiter ? { "ddp-rate-limiter": { DDPRateLimiter } } : {}),
  };
}

/** Simulates an app without `meteor add ddp-rate-limiter`. */
export function installRateLimiter(installed: boolean): void {
  installPackages({ rateLimiter: installed });
}

/** Clears methods, publications and documents. Stores and collection instances survive on purpose. */
export function resetFakes(): void {
  methods.clear();
  publications.clear();
  refCounts.clear();
  subscriptionLog.length = 0;
  rateLimiterRules.length = 0;
  for (const store of stores.values()) store.clear();
  fakeState.isServer = true;
  fakeState.isClient = true;
  fakeState.userId = null;
  installPackages();
}
