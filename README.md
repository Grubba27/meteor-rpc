# RPC

## What is this package?

_Inspired on [zodern:relay](https://github.com/zodern/meteor-relay)_

This package provides functions for building E2E type-safe RPCs. The functions are:

- crateMethod
- createPublication
- createModule
- createClient


## How to download it?

```bash
meteor npm i grubba-rpc
meteor npm i zod
```

## How to use it?

```typescript
import {
  ReturnMethod, // <- Type
  ReturnSubscription, // <- Type
  Config, // <- Type
  SubscriptionCallbacks, // <- Type
  createMethod, // <- function
  createPublication // <- function
  createModule, // <- function
  createClient, // <- function
} from 'grubba-rpc';
```

### createMethod

```typescript

const test1 = createMethod('name', z.any(), () => 'str');
const result = await test1();
//    ˆ? is string and their value is 'str'
```

For semantics uses you can as well use the methods below with the same output as createMethod:

```typescript
const joinStr = createMutation(
  'join',
  z.object({ foo: z.string(), bar: z.string() }),
  ({ foo, bar }) => foo + bar);
const result = await joinStr({ foo: 'foo', bar: 'bar' });
//    ˆ? is string and their value is 'foobar'
```

```typescript
const query = createQuery(
  'query',
  z.object({ _id: z.string() }),
  async ({ _id }) => {
    const someData = await DB.findOne(_id);
    const otherData = await DB.find({ _id: { $ne: someData._id } }).fetchAsync();
    return { someData, otherData };
  });
const result = await query({ _id: 'id' });
//    ˆ? is string and their value is the item you was querying
```

_example of use_

createMethod accepts 4 arguments:

- name: string
- schema: ZodSchema (validator)
- handler (optional): function that receives the arguments of the method and returns the result
- config (optional): object with the following properties:

```typescript
type Config<S, T> = {
  rateLimit?: {
    interval: number,
    limit: number
  },
  hooks?: {
    onBeforeResolve?: Array<(raw: unknown, parsed: S,) => void>;
    onAfterResolve?: Array<(raw: Maybe<T>, parsed: S, result: T) => void>;
    onErrorResolve?: Array<(err: Meteor.Error | Error | unknown, raw: Maybe<T>, parsed: S) => void>;
  }
}
```

### createPublication

```typescript
  const publication = createPublication('findRooms', z.object({ level: z.number() }), ({ level }) => Rooms.find({ level: level }));
const result = publication({ level: 1 }, (rooms) => console.log(rooms));
//                                            ˆ? subscription

```

_example of use_

createPublication accepts 4 arguments:

- name: string
- schema: ZodSchema (validator)
- handler (optional): function that is being published
- config (optional): object with the following properties:

_note that subscription returns the subscription handler the same way as Meteor.publish_

```typescript
type Config<S, T> = {
  rateLimit?: {
    interval: number,
    limit: number
  },
  hooks?: {
    onBeforeResolve?: Array<(raw: unknown, parsed: S,) => void>;
    onAfterResolve?: Array<(raw: Maybe<T>, parsed: S, result: T) => void>;
    onErrorResolve?: Array<(err: Meteor.Error | Error | unknown, raw: Maybe<T>, parsed: S) => void>;
  }
}
```

### Advanced usage

you can take advantage of the hooks to add custom logic to your methods and publications

```typescript

const fn = createMethod('name', z.any(), () => 'str', {
  hooks: {
    onBeforeResolve: [
      (raw, parsed) => {
        console.log('before resolve', raw, parsed);
      }
    ],
    onAfterResolve: [
      (raw, parsed, result) => {
        console.log('after resolve', raw, parsed, result);
      }
    ],
    onErrorResolve: [
      (err, raw, parsed) => {
        console.log('error resolve', err, raw, parsed);
      }
    ]
  }
});
// valid ways as well
fn.addErrorResolveHook((err, raw, parsed) => {
  console.log('error resolve', err, raw, parsed);
});
fn.addBeforeResolveHook((raw, parsed) => {
  console.log('before resolve', raw, parsed);
});
fn.addAfterResolveHook((raw, parsed, result) => {
  console.log('after resolve', raw, parsed, result);
});
const result = await fn();
```

### Using safe methods

check this example that illustrates this 'secure way' of using safe methods, as it is not bundled in the client

```typescript

import { createMethod } from 'grubba-rpc'
import { z } from "zod";

const DescriptionValidator = z.object({ description: z.string() });

// tasks.mutations.ts
// it expects the return type to be a void
export const insert = createMethod('task.insert', DescriptionValidator).expect<void>();

// tasks.mutations.js
// If you are using javascript, you can use the following syntax
export const insert = createMethod('task.insert', DescriptionValidator).expect(z.void());
// or you can use other name such as:
export const insert = createMethod('task.insert', DescriptionValidator).returns(z.void());

// ---------

// tasks.methods.ts
import { insert } from './tasks.mutations.ts'

insertTask = ({ description }) => {
  TasksCollection.insert({
    description,
    userId: Meteor.userId(),
    createdAt: new Date(),
  });
};

insert.setResolver(insertTask);

// ---------


// client.ts
import { insert } from './tasks.mutations.ts'

insert({ description: 'test' });
//^? it return void and it will run
// if resolver is not set it will throw an error

```


### createModule

```typescript
const Tasks = createModule('tasks', {insert, remove, setChecked}).build();
const foo = createModule('foo')
  .addMethod('bar', z.string(), () => 'bar' as const)
  .addMethod('baz', z.string(), () => 'baz')
  .addQuery('get', z.string(), () => 'get')
  .addSubmodule('task', Tasks)
  .build();
const k = await foo.bar();
//   ?^ 'bar'
```

## Examples?

in the examples folder you can find a simple example of how to use this package it
uses [simpletasks](https://github.com/fredmaiaarantes/simpletasks) as a base

for downloading it you can do the command below or just access
this [link](https://github.com/Grubba27/meteor-rpc-template/generate)

```bash
git clone https://github.com/Grubba27/meteor-rpc-template.git
```

## React focused API

For now, only works for methods

```typescript

const test1 = createMethod('name', z.any(), () => 'str');
// in react context / component.tsx


const { data } = test1.useQuery();
// works like useSuspenseQuery from https://tanstack.com/query/latest/docs/react/reference/useSuspenseQuery


// or you can use for mutation
const { mutate } = test1.useMutation();
// uses the https://tanstack.com/query/v4/docs/react/reference/useMutation under the hood
```


## method.useQuery

This uses the same api as [useSuspenseQuery](https://tanstack.com/query/latest/docs/react/reference/useSuspenseQuery)

## method.useMutation

This uses the same api as [useMutation](https://tanstack.com/query/v4/docs/react/reference/useMutation)




### Using in the client

When using in the client you _should_ use the `createModule` and `build` methods to create a module that will be used in the client
and be sure that you are exporting the type of the module

_You should only create one client in your application_

You can have something like `api.ts` that will export the client and the type of the client

```typescript
// server.ts

const otherModule = createModule()
  .addMethod('bar', z.string(), () => 'bar')
  .build();
const server = createModule()
  .addMethod('foo', z.string(), () => 'foo')
  .addMethod('bar', z.string(), () => 'bar')
  .addSubmodule('other', otherModule)
  .build();

export type Server = typeof server;


// client.ts


const app = createClient<Server>();

app.foo("str") // <--- This is type safe
app.other.bar("str") // <--- This is type safe

```

