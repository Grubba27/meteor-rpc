import { Tinytest } from "meteor/tinytest";
import { Meteor } from "meteor/meteor";
import { createMethod } from "../server-main";
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
  const test1 = createMethod(`${ id }.sum`, z.tuple([z.number(), z.number()]), (a1, a2) => a1 + a2);
  const result = test1(1, 1);
  test.equal(await result, 2);
})

Meteor.isServer && Tinytest.addAsync('rpc - join str', async function (test) {
  const id = new Date().toISOString()
  const test1 = createMethod(
    `${ id }.sum`,
    z.tuple([z.object({ foo: z.string(), bar: z.string() })]),
    ({ foo, bar }) => foo + bar,
    {
      hooks: {
        onAfterResolve: [(raw, [{foo, bar}], result) => {
          test.equal(result, 'foobar')
          test.equal(foo, 'foo')
          test.equal(bar, 'bar')
        }]
      }
    });

  test1.addBeforeResolveHook((raw, [{foo, bar}]) => {
    test.equal(foo, 'foo')
    test.equal(bar, 'bar')
  })
  test1.addAfterResolveHook((raw, [{foo, bar}], result) => {
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

  try {await err(1)} catch (e) {}
})
