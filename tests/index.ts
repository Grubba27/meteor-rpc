// @ts-ignore
import { Tinytest } from "meteor/tinytest";
import { Meteor } from "meteor/meteor";
import { createMethod, createPublication } from "../server-main";
import { z } from "zod";

Meteor.isServer && Tinytest.addAsync('rpc - example', async function (test) {
  const id = new Date().toISOString()
  const test1 = createMethod(`${ id }.num`, z.any(), () => 4);
  const result = await test1();
  test.equal(result, 4);
})

Meteor.isServer && Tinytest.addAsync('rpc - text', async function (test) {
  const id = new Date().toISOString()
  const test1 = createMethod(`${ id }.str`, z.any(), () => 'str');
  const result = await test1();
  test.equal(result, 'str');
})

Meteor.isServer && Tinytest.addAsync('rpc - sum', async function (test) {
  const id = new Date().toISOString()
  const test1 = createMethod(`${ id }.sum`, z.array(z.number(), z.number()), ([a1, a2]) => a1 + a2);
  const result = test1([1, 1]);
  test.equal(await result, 2);
})


Meteor.isServer && Tinytest.addAsync('rpc - identity', async function (test) {
  const id = new Date().toISOString()
  const test1 = createMethod(`${ id }.identity`, z.number(), (a1) => a1 );
  const result = test1(1);
  test.equal(await result, 1);
})
Meteor.isServer && Tinytest.addAsync('rpc - join str', async function (test) {
  const id = new Date().toISOString()
  const test1 = createMethod(
    `${ id }.sum`,
    z.object({ foo: z.string(), bar: z.string() }),
    ({ foo, bar }) => foo + bar,
    {
      hooks: {
        onAfterResolve: [(raw, { foo, bar }, result) => {
          test.equal(result, 'foobar')
          test.equal(foo, 'foo')
          test.equal(bar, 'bar')
        }]
      }
    });

  test1.addBeforeResolveHook((raw, { foo, bar }) => {
    test.equal(foo, 'foo')
    test.equal(bar, 'bar')
  })
  test1.addAfterResolveHook((raw, { foo, bar }, result) => {
    test.equal(result, 'foobar')
    test.equal(foo, 'foo')
    test.equal(bar, 'bar')
  })
  const result = await test1({ foo: 'foo', bar: 'bar' });
  test.equal(result, 'foobar');
})

Meteor.isServer && Tinytest.addAsync('rpc - err', async function (test) {
  const id = new Date().toISOString()
  const err = createMethod(
    `${ id }.err`,
    z.tuple([z.number()]),
    (a1) => {
      throw new Error('err')
    }, {
      hooks: {
        onErrorResolve: [(err, raw, [a1]) => {
          test.throws(() => {
            throw err
          }, 'err');
        }]
      }
    });

  err.addErrorResolveHook((err) => {
    test.throws(() => {
      throw err
    }, 'err');
  })

  try {
    await err(1)
  } catch (e) {
  }
})
Meteor.isServer && Tinytest.addAsync('rpc - add resolver later', async function (test) {
  const id = new Date().toISOString()
  const math = z.object({ n1: z.number(), n2: z.number() });
  const fn = createMethod(`${ id }.fn`, math).expect<number>()


  fn.setResolver(({n1 , n2}) => n1 + n2)
  const result = await fn({n1: 1, n2: 2})
  test.equal(result, 3)
})

Meteor.isServer && Tinytest.addAsync('rpc - add resolver later using zod', async function (test) {
  const id = new Date().toISOString()
  const math = z.object({ n1: z.number(), n2: z.number() });
  const fn = createMethod(`${ id }.fn`, math).expect(z.number())

  fn.setResolver(({n1 , n2}) => n1 + n2)

  const result = await fn({n1: 1, n2: 2})
  test.equal(result, 3)
})

Meteor.isServer && Tinytest.addAsync('rpc - full test', async function (test) {
  const nameValidator = z.object({ first: z.string(), last: z.string() });
  const getFullName = createMethod('some', nameValidator, async ({first, last}) => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(1000)
    return `${first} ${last}`
  })
  const d = await getFullName({last: 'last', first: 'first'})
  test.equal(d , 'first last')
})
