import { Meteor } from 'meteor/meteor';
import { Migrations } from 'meteor/percolate:migrations';
import './db/migrations';
import './tasks/tasks.methods';
import './tasks/tasks.publications';
import '../common/tasks/mutations.hooks';
import '../common/tasks/mutations';
import { createModule } from 'grubba-rpc';
import { z } from 'zod';

/**
 * @exports @type {App}
 */
const app = createModule('Foo')
  .addMethod('bar', () => 'bar')
  .addMethod(
    'something',
    z.object({
      foo: z.string(),
    }),
    ({ foo }) => {
      console.log(foo);
      return foo;
    }
  )
  .build();

/**
 * This is the server-side entry point
 */
Meteor.startup(() => {
  Migrations.migrateTo('latest');
});
